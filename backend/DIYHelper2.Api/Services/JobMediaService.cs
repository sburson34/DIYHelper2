using DIYHelper2.Api.Models;
using Sburson.Shared.Storage;

namespace DIYHelper2.Api.Services;

/// <summary>
/// Owns the S3 offload of job media (booking photo, tech before/after photos,
/// customer signature). Every operation is FAIL-SOFT: storage being
/// unconfigured (no <c>Storage:S3:Bucket</c>) or an S3 hiccup never fails the
/// caller — a failed Put just means the base64 column keeps the payload
/// (dual-read window), and a failed Delete leaves an orphan for the bucket
/// lifecycle rule to reap.
/// </summary>
public class JobMediaService
{
    /// <summary>The media kinds a job carries, as they appear in the
    /// <c>/media/{kind}</c> proxy routes.</summary>
    public static readonly string[] Kinds = { "image", "before", "after", "signature" };

    private static readonly TimeSpan PresignTtl = TimeSpan.FromMinutes(5);

    private readonly ILogger<JobMediaService> _logger;
    private readonly IObjectStorage? _storage;

    // IObjectStorage is registered only when Storage:S3:Bucket is configured
    // (AddSburonObjectStorage); the default-null parameter makes it optional.
    public JobMediaService(ILogger<JobMediaService> logger, IObjectStorage? storage = null)
    {
        _logger = logger;
        _storage = storage;
    }

    public bool IsConfigured => _storage is not null;

    /// <summary>
    /// Store one media payload in S3. Returns the object key, or null when
    /// storage is unconfigured or the Put failed — the caller then keeps the
    /// base64 in its column exactly as before the offload existed.
    /// </summary>
    public async Task<string?> StoreAsync(string brand, int jobId, string kind, string base64, CancellationToken ct = default)
    {
        if (_storage is null) return null;

        byte[] bytes;
        try { bytes = Convert.FromBase64String(base64); }
        catch (FormatException) { return null; } // validated upstream; belt-and-braces

        // Signatures are PNG (transparent canvas export); photos are JPEG.
        var (ext, contentType) = kind == "signature" ? ("png", "image/png") : ("jpg", "image/jpeg");
        var key = $"{brand}/help-requests/{jobId}/{kind}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.{ext}";
        try
        {
            using var stream = new MemoryStream(bytes);
            await _storage.PutAsync(key, stream, contentType, ct);
            return key;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "S3 put failed for job {JobId} media '{Kind}'; keeping base64 column.", jobId, kind);
            return null;
        }
    }

    /// <summary>Presigned GET URL (5-minute TTL) for a stored object, or null
    /// when unconfigured / presign failed.</summary>
    public async Task<Uri?> PresignAsync(string key, CancellationToken ct = default)
    {
        if (_storage is null) return null;
        try
        {
            return await _storage.GetPresignedUrlAsync(key, PresignTtl, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "S3 presign failed for key {Key}.", key);
            return null;
        }
    }

    /// <summary>Fetch a stored object's bytes (report email inlining). Null on
    /// any failure — the report simply skips that image.</summary>
    public async Task<byte[]?> GetBytesAsync(string key, CancellationToken ct = default)
    {
        if (_storage is null) return null;
        try
        {
            await using var stream = await _storage.GetAsync(key, ct);
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms, ct);
            return ms.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "S3 get failed for key {Key}.", key);
            return null;
        }
    }

    /// <summary>Delete a single object, fail-soft (orphans are reaped by the
    /// bucket lifecycle rule).</summary>
    public async Task DeleteKeyAsync(string? key, CancellationToken ct = default)
    {
        if (_storage is null || string.IsNullOrEmpty(key)) return;
        try
        {
            await _storage.DeleteAsync(key, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "S3 delete failed for key {Key}.", key);
        }
    }

    /// <summary>Delete every stored object a job owns (owner delete /
    /// retention purge). Per-key fail-soft.</summary>
    public async Task DeleteForAsync(HelpRequest r, CancellationToken ct = default)
    {
        await DeleteKeyAsync(r.ImageKey, ct);
        await DeleteKeyAsync(r.BeforePhotoKey, ct);
        await DeleteKeyAsync(r.AfterPhotoKey, ct);
        await DeleteKeyAsync(r.SignatureKey, ct);
    }

    /// <summary>
    /// The (key, legacyBase64, contentType) triple for one media kind of a job,
    /// or null for an unknown kind. Single source of truth for the proxy routes
    /// and the *Url projections.
    /// </summary>
    public static (string? Key, string? Base64, string ContentType)? MediaOf(HelpRequest r, string kind) => kind switch
    {
        "image" => (r.ImageKey, r.ImageBase64, "image/jpeg"),
        "before" => (r.BeforePhotoKey, r.BeforePhotoBase64, "image/jpeg"),
        "after" => (r.AfterPhotoKey, r.AfterPhotoBase64, "image/jpeg"),
        "signature" => (r.SignatureKey, r.SignatureBase64, "image/png"),
        _ => null,
    };

    /// <summary>
    /// Serve one media kind for an already-authorized job: 302 to a presigned
    /// URL when the object is in S3, streamed bytes when only the legacy base64
    /// column has data (dual-read window), else 404.
    /// </summary>
    public async Task<IResult> ServeAsync(HelpRequest r, string kind, CancellationToken ct = default)
    {
        if (MediaOf(r, kind) is not { } media) return Results.NotFound();

        if (!string.IsNullOrEmpty(media.Key))
        {
            var url = await PresignAsync(media.Key, ct);
            if (url is not null) return Results.Redirect(url.ToString());
            // Presign failed → fall through to the legacy column (usually empty
            // once a key is set, but a 404 beats a 500 here either way).
        }

        if (!string.IsNullOrEmpty(media.Base64))
        {
            try { return Results.File(Convert.FromBase64String(media.Base64), media.ContentType); }
            catch (FormatException) { return Results.NotFound(); }
        }

        return Results.NotFound();
    }

    /// <summary>
    /// The relative proxy URL for one media kind on one surface, or null when
    /// the job has neither an S3 key nor legacy base64 for that kind.
    /// <paramref name="surfacePrefix"/> is e.g. <c>/api/tech/jobs</c>.
    /// </summary>
    public static string? MediaUrl(HelpRequest r, string kind, string surfacePrefix)
    {
        var media = MediaOf(r, kind);
        if (media is null) return null;
        return string.IsNullOrEmpty(media.Value.Key) && string.IsNullOrEmpty(media.Value.Base64)
            ? null
            : $"{surfacePrefix}/{r.Id}/media/{kind}";
    }
}
