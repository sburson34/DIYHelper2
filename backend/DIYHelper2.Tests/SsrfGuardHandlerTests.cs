using System.Net;
using DIYHelper2.Api.Integrations;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DIYHelper2.Tests;

/// <summary>
/// SsrfGuardHandler is the outbound-request choke point. Every typed HttpClient
/// in the API is wired through it. These tests pin down the set of address
/// ranges we refuse to talk to so a future "loosen this for X" change cannot
/// silently re-enable IMDS / loopback / link-local traffic.
/// </summary>
public class SsrfGuardHandlerTests
{
    [Theory]
    [InlineData("http://127.0.0.1/")]
    [InlineData("http://127.10.20.30/")]              // full 127.0.0.0/8, not just .0.0.1
    [InlineData("http://169.254.169.254/latest/meta-data/")] // AWS IMDS
    [InlineData("http://10.0.0.1/")]
    [InlineData("http://172.16.0.1/")]
    [InlineData("http://172.31.255.254/")]
    [InlineData("http://192.168.1.1/")]
    [InlineData("http://0.0.0.0/")]
    [InlineData("http://0.1.2.3/")]                   // 0.0.0.0/8
    [InlineData("http://100.64.0.1/")]                // CGNAT
    [InlineData("http://255.255.255.255/")]           // limited broadcast
    [InlineData("http://[::1]/")]                     // IPv6 loopback
    [InlineData("http://[::]/")]                      // IPv6 unspecified
    [InlineData("http://[fc00::1]/")]                 // IPv6 unique-local
    [InlineData("http://[fd00::1]/")]                 // IPv6 unique-local
    [InlineData("http://[fe80::1]/")]                 // IPv6 link-local
    [InlineData("http://[::ffff:127.0.0.1]/")]        // IPv4-mapped loopback
    [InlineData("http://[::ffff:169.254.169.254]/")]  // IPv4-mapped IMDS
    public async Task Blocks_PrivateAndReservedAddresses(string url)
    {
        using var client = BuildClient();
        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync(url));
    }

    private static HttpClient BuildClient()
    {
        var guard = new SsrfGuardHandler(NullLogger<SsrfGuardHandler>.Instance)
        {
            // Pin the inner handler so the test never tries to actually open a
            // TCP socket. The guard either throws first (expected) or we'd
            // reach the stub, which returns 200 — the asserts catch that case
            // as a failure.
            InnerHandler = new StubInnerHandler(),
        };
        return new HttpClient(guard);
    }

    private sealed class StubInnerHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
    }
}
