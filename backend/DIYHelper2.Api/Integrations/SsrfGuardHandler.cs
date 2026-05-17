using System.Net;
using System.Net.Sockets;

namespace DIYHelper2.Api.Integrations;

/// <summary>
/// DelegatingHandler that resolves a request's target host and rejects any
/// address in a loopback, link-local, or RFC1918 private range. Defends
/// against DNS rebinding where an attacker-controlled public hostname
/// resolves to 169.254.169.254 (EC2 metadata) or 127.0.0.1 (SSRF into
/// services bound to localhost).
///
/// Attach this to every typed HttpClient that reaches the public internet.
/// Wrap a SocketsHttpHandler underneath; we do not call down to the default
/// handler since that would allow the connect to proceed after our check.
/// </summary>
public class SsrfGuardHandler : DelegatingHandler
{
    private readonly ILogger<SsrfGuardHandler> _logger;

    public SsrfGuardHandler(ILogger<SsrfGuardHandler> logger)
    {
        _logger = logger;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var host = request.RequestUri?.Host;
        if (string.IsNullOrEmpty(host))
            return await base.SendAsync(request, cancellationToken);

        IPAddress[] addresses;
        if (IPAddress.TryParse(host, out var literal))
        {
            addresses = new[] { literal };
        }
        else
        {
            try
            {
                addresses = await Dns.GetHostAddressesAsync(host, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "SsrfGuard: DNS resolution failed for {Host}", host);
                throw;
            }
        }

        foreach (var addr in addresses)
        {
            if (IsForbidden(addr))
            {
                _logger.LogWarning("SsrfGuard: blocked request to {Host} → {Ip}", host, addr);
                throw new HttpRequestException($"Outbound request to private/loopback address blocked: {addr}");
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }

    private static bool IsForbidden(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            // 10.0.0.0/8
            if (b[0] == 10) return true;
            // 172.16.0.0/12
            if (b[0] == 172 && (b[1] & 0xF0) == 16) return true;
            // 192.168.0.0/16
            if (b[0] == 192 && b[1] == 168) return true;
            // 169.254.0.0/16 (link-local, includes AWS IMDS 169.254.169.254)
            if (b[0] == 169 && b[1] == 254) return true;
            // 0.0.0.0/8 (unspecified; covers the literal 0.0.0.0)
            if (b[0] == 0) return true;
            // 100.64.0.0/10 (CGNAT)
            if (b[0] == 100 && (b[1] & 0xC0) == 64) return true;
            // 127.0.0.0/8 fully (IPAddress.IsLoopback only matches 127.0.0.1;
            // 127.x.y.z is reserved and routes to the local host on Linux).
            if (b[0] == 127) return true;
            // 255.255.255.255 limited broadcast
            if (b[0] == 255 && b[1] == 255 && b[2] == 255 && b[3] == 255) return true;
            return false;
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal) return true;
            var b = ip.GetAddressBytes();
            // :: (unspecified) — Linux treats this as the local host on connect.
            if (IsAllZero(b)) return true;
            // fc00::/7 unique local
            if ((b[0] & 0xFE) == 0xFC) return true;
            // Mapped IPv4
            if (ip.IsIPv4MappedToIPv6) return IsForbidden(ip.MapToIPv4());
            return false;
        }

        return false;
    }

    private static bool IsAllZero(byte[] b)
    {
        for (int i = 0; i < b.Length; i++)
            if (b[i] != 0) return false;
        return true;
    }
}
