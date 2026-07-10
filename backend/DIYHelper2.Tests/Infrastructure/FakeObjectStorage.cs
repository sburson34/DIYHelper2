using System.Collections.Concurrent;
using Sburson.Shared.Storage;

namespace DIYHelper2.Tests.Infrastructure;

/// <summary>
/// In-memory <see cref="IObjectStorage"/> stand-in for integration tests
/// (same shape as PianoHelper's). Captures the bytes passed to
/// <see cref="PutAsync"/> so assertions can check upload behavior without
/// hitting AWS. Presigned URLs are deterministic
/// <c>https://example.test/fake/{key}</c> links so redirect tests can assert
/// on the Location header.
/// </summary>
public sealed class FakeObjectStorage : IObjectStorage
{
    private readonly ConcurrentDictionary<string, byte[]> _objects = new();
    private readonly ConcurrentDictionary<string, string> _contentTypes = new();

    public IReadOnlyDictionary<string, byte[]> Objects => _objects;
    public IReadOnlyDictionary<string, string> ContentTypes => _contentTypes;

    /// <summary>Set to make every operation throw — exercises the fail-soft paths.</summary>
    public bool ThrowOnEverything { get; set; }

    public async Task<string> PutAsync(
        string key,
        Stream body,
        string contentType,
        CancellationToken ct = default)
    {
        if (ThrowOnEverything) throw new IOException("FakeObjectStorage forced failure");
        using var ms = new MemoryStream();
        await body.CopyToAsync(ms, ct);
        _objects[key] = ms.ToArray();
        _contentTypes[key] = contentType;
        return key;
    }

    public async Task<PutObjectMetadata> PutAndGetMetadataAsync(
        string key,
        Stream body,
        string contentType,
        CancellationToken ct = default)
    {
        await PutAsync(key, body, contentType, ct);
        return new PutObjectMetadata(key, "test-version");
    }

    public Task<Stream> GetAsync(string key, CancellationToken ct = default)
    {
        if (ThrowOnEverything) throw new IOException("FakeObjectStorage forced failure");
        if (!_objects.TryGetValue(key, out var bytes))
            throw new FileNotFoundException(key);
        return Task.FromResult<Stream>(new MemoryStream(bytes));
    }

    public Task DeleteAsync(string key, CancellationToken ct = default)
    {
        if (ThrowOnEverything) throw new IOException("FakeObjectStorage forced failure");
        _objects.TryRemove(key, out _);
        _contentTypes.TryRemove(key, out _);
        return Task.CompletedTask;
    }

    public Task<Uri> GetPresignedUrlAsync(string key, TimeSpan ttl, CancellationToken ct = default)
    {
        if (ThrowOnEverything) throw new IOException("FakeObjectStorage forced failure");
        return Task.FromResult(new Uri($"https://example.test/fake/{key}"));
    }
}
