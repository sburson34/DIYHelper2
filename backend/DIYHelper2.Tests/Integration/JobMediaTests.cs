using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DIYHelper2.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace DIYHelper2.Tests.Integration;

/// <summary>
/// A4 S3 photo offload: booking/tech uploads store to object storage (key set,
/// base64 column nulled), each surface's media proxy 302s to a presigned URL,
/// legacy base64-only rows stream bytes (dual-read), auth scoping 404s
/// cross-tenant/cross-device probes, and owner delete removes the S3 objects.
/// </summary>
public class JobMediaTests : IClassFixture<ApiFactory>
{
    private static readonly string TinyPngB64 =
        Convert.ToBase64String(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4 });

    private readonly ApiFactory _factory;
    public JobMediaTests(ApiFactory factory) => _factory = factory;

    private static int _ipSeq;

    /// <summary>Fresh client per call: no auto-redirect (the proxy tests assert
    /// on the 302 itself — following it would re-enter the TestServer and 404)
    /// and a unique X-Forwarded-For so the per-IP "submit" rate limiter never
    /// couples tests in this class together.</summary>
    private HttpClient NewClient()
    {
        var c = _factory.CreateClient(
            new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        c.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.44.{Interlocked.Increment(ref _ipSeq)}.1");
        return c;
    }

    private HttpClient Device(string brand, string device)
    {
        var c = NewClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Add("X-Device-Id", device);
        return c;
    }

    private async Task<int> BookAsync(HttpClient device, string? imageBase64 = null)
    {
        var resp = await device.PostAsJsonAsync("/api/help-requests", new
        {
            customerName = "M", customerEmail = "m@x.example", customerPhone = "5551112222",
            projectTitle = "Media job", userDescription = "d", projectData = "{}", imageBase64,
        });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private async Task<DIYHelper2.Api.Models.HelpRequest> RowAsync(int id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Data.AppDbContext>();
        return (await db.HelpRequests.FindAsync(id))!;
    }

    private async Task<(int techId, string token)> SeedTechAndLoginAsync(string brand, int jobId)
    {
        var admin = _factory.CreateAdminClient();
        var create = await admin.PostAsJsonAsync("/api/technicians", new { name = "Media Tech", brand });
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var techId = created.GetProperty("id").GetInt32();
        var code = created.GetProperty("loginCode").GetString()!;

        var assign = await admin.PutAsJsonAsync($"/api/help-requests/{jobId}", new { assignedTechId = techId });
        Assert.Equal(HttpStatusCode.OK, assign.StatusCode);

        var login = NewClient();
        login.DefaultRequestHeaders.Add("X-Brand", brand);
        var loginResp = await login.PostAsJsonAsync("/api/tech/login", new { code });
        Assert.Equal(HttpStatusCode.OK, loginResp.StatusCode);
        var token = (await loginResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        return (techId, token);
    }

    private HttpClient TechClient(string brand, string token)
    {
        var c = NewClient();
        c.DefaultRequestHeaders.Add("X-Brand", brand);
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Booking_StoresPhotoInS3_AndNullsBase64Column()
    {
        await _factory.SeedBrandAsync("med-book", "Med Book", "leads@mb.example");
        var device = Device("med-book", "mb-dev");
        var jobId = await BookAsync(device, TinyPngB64);

        var row = await RowAsync(jobId);
        Assert.NotNull(row.ImageKey);
        Assert.Null(row.ImageBase64);
        Assert.StartsWith($"med-book/help-requests/{jobId}/image-", row.ImageKey);
        Assert.EndsWith(".jpg", row.ImageKey);
        Assert.Equal(Convert.FromBase64String(TinyPngB64), _factory.Storage.Objects[row.ImageKey!]);

        // Customer detail advertises the proxy URL (and no legacy base64 remains).
        var detail = await device.GetFromJsonAsync<JsonElement>($"/api/my/requests/{jobId}");
        Assert.Equal($"/api/my/requests/{jobId}/media/image", detail.GetProperty("imageUrl").GetString());
    }

    [Fact]
    public async Task Booking_PutFailure_FailsSoftToBase64Column()
    {
        await _factory.SeedBrandAsync("med-soft", "Med Soft", "leads@ms.example");
        var device = Device("med-soft", "ms-dev");
        _factory.Storage.ThrowOnEverything = true;
        try
        {
            var jobId = await BookAsync(device, TinyPngB64);
            var row = await RowAsync(jobId);
            Assert.Null(row.ImageKey);
            Assert.Equal(TinyPngB64, row.ImageBase64);
        }
        finally
        {
            _factory.Storage.ThrowOnEverything = false;
        }
    }

    [Fact]
    public async Task TechPut_StoresPhotosAndSignature_WithKindSpecificKeys()
    {
        await _factory.SeedBrandAsync("med-tech", "Med Tech", "leads@mt.example");
        var device = Device("med-tech", "mt-dev");
        var jobId = await BookAsync(device);
        var (_, token) = await SeedTechAndLoginAsync("med-tech", jobId);
        var tech = TechClient("med-tech", token);

        var put = await tech.PutAsJsonAsync($"/api/tech/jobs/{jobId}", new
        {
            beforePhotoBase64 = TinyPngB64,
            afterPhotoBase64 = TinyPngB64,
            signatureBase64 = TinyPngB64,
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var row = await RowAsync(jobId);
        Assert.NotNull(row.BeforePhotoKey);
        Assert.NotNull(row.AfterPhotoKey);
        Assert.NotNull(row.SignatureKey);
        Assert.Null(row.BeforePhotoBase64);
        Assert.Null(row.AfterPhotoBase64);
        Assert.Null(row.SignatureBase64);
        Assert.EndsWith(".jpg", row.BeforePhotoKey);
        Assert.EndsWith(".png", row.SignatureKey); // signatures are PNG
        Assert.Equal("image/png", _factory.Storage.ContentTypes[row.SignatureKey!]);

        // Tech detail exposes the proxy URLs; base64 fields are null post-offload.
        var detail = await tech.GetFromJsonAsync<JsonElement>($"/api/tech/jobs/{jobId}");
        Assert.Equal($"/api/tech/jobs/{jobId}/media/before", detail.GetProperty("beforePhotoUrl").GetString());
        Assert.Equal($"/api/tech/jobs/{jobId}/media/signature", detail.GetProperty("signatureUrl").GetString());
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("beforePhotoBase64").ValueKind);
    }

    [Fact]
    public async Task MediaProxies_RedirectToPresignedUrl_OnAllThreeSurfaces()
    {
        await _factory.SeedBrandAsync("med-proxy", "Med Proxy", "leads@mp.example");
        var device = Device("med-proxy", "mp-dev");
        var jobId = await BookAsync(device, TinyPngB64);
        var (_, token) = await SeedTechAndLoginAsync("med-proxy", jobId);
        var row = await RowAsync(jobId);
        var expected = $"https://example.test/fake/{row.ImageKey}";

        // 302s carry a Location to the presigned URL; don't follow it (these
        // clients all have AllowAutoRedirect off).
        var admin = NewClient();
        admin.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(
                $"{ApiFactory.AdminUsername}:{ApiFactory.AdminPassword}")));
        foreach (var (client, path) in new[]
        {
            (admin, $"/api/help-requests/{jobId}/media/image"),
            (TechClient("med-proxy", token), $"/api/tech/jobs/{jobId}/media/image"),
            (device, $"/api/my/requests/{jobId}/media/image"),
        })
        {
            var resp = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.Found, resp.StatusCode);
            Assert.Equal(expected, resp.Headers.Location!.ToString());
        }
    }

    [Fact]
    public async Task MediaProxy_LegacyBase64Row_StreamsDecodedBytes()
    {
        await _factory.SeedBrandAsync("med-legacy", "Med Legacy", "leads@ml.example");
        var device = Device("med-legacy", "ml-dev");
        var jobId = await BookAsync(device);

        // Simulate a pre-offload row: base64 column populated, no key.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DIYHelper2.Api.Data.AppDbContext>();
            var row = (await db.HelpRequests.FindAsync(jobId))!;
            row.ImageBase64 = TinyPngB64;
            await db.SaveChangesAsync();
        }

        var resp = await device.GetAsync($"/api/my/requests/{jobId}/media/image");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("image/jpeg", resp.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Convert.FromBase64String(TinyPngB64), await resp.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task MediaProxy_NoMediaOrUnknownKind_Is404()
    {
        await _factory.SeedBrandAsync("med-404", "Med 404", "leads@m4.example");
        var device = Device("med-404", "m4-dev");
        var jobId = await BookAsync(device); // no photo at all

        Assert.Equal(HttpStatusCode.NotFound,
            (await device.GetAsync($"/api/my/requests/{jobId}/media/image")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await device.GetAsync($"/api/my/requests/{jobId}/media/nonsense")).StatusCode);
    }

    [Fact]
    public async Task MediaProxy_CrossDeviceAndCrossTenant_Are404()
    {
        await _factory.SeedBrandAsync("med-iso-a", "Med Iso A", "leads@mia.example",
            username: "med-iso-a-admin", password: "med-iso-a-pass");
        await _factory.SeedBrandAsync("med-iso-b", "Med Iso B", "leads@mib.example");
        var device = Device("med-iso-a", "mia-dev");
        var jobId = await BookAsync(device, TinyPngB64);

        // Another device on the same brand can't fetch it.
        var otherDevice = Device("med-iso-a", "other-dev");
        Assert.Equal(HttpStatusCode.NotFound,
            (await otherDevice.GetAsync($"/api/my/requests/{jobId}/media/image")).StatusCode);

        // A scoped console login for another brand can't fetch it (404, not 403).
        await _factory.SeedBrandAsync("med-iso-b", "Med Iso B", "leads@mib.example",
            username: "med-iso-b-admin", password: "med-iso-b-pass");
        var otherBrandAdmin = _factory.CreateBrandClient("med-iso-b-admin", "med-iso-b-pass");
        Assert.Equal(HttpStatusCode.NotFound,
            (await otherBrandAdmin.GetAsync($"/api/help-requests/{jobId}/media/image")).StatusCode);
    }

    [Fact]
    public async Task OwnerDelete_RemovesS3Objects()
    {
        await _factory.SeedBrandAsync("med-del", "Med Del", "leads@md.example");
        var device = Device("med-del", "md-dev");
        var jobId = await BookAsync(device, TinyPngB64);
        var row = await RowAsync(jobId);
        var key = row.ImageKey!;
        Assert.True(_factory.Storage.Objects.ContainsKey(key));

        var admin = _factory.CreateAdminClient();
        var del = await admin.DeleteAsync($"/api/help-requests/{jobId}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        Assert.False(_factory.Storage.Objects.ContainsKey(key));
    }
}
