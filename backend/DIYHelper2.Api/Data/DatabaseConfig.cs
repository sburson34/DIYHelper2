using Microsoft.EntityFrameworkCore;

namespace DIYHelper2.Api.Data;

/// <summary>
/// Centralises how <see cref="AppDbContext"/> is wired up so the same logic
/// runs for the runtime app and the design-time EF tools.
///
/// Provider selection:
///  - If <c>DATABASE_URL</c> is set, use Postgres. Accepts either the libpq
///    URL form (<c>postgres://user:pass@host/db?sslmode=require</c>) that
///    Neon/Supabase/Render hand out, or a raw Npgsql key-value string.
///  - Otherwise, use SQLite at <c>helpRequests.db</c>. Good for local dev and
///    for tests (which further override to an in-memory SQLite connection).
/// </summary>
public static class DatabaseConfig
{
    public enum Provider { Sqlite, Postgres }

    public static Provider ResolveProvider() =>
        string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DATABASE_URL"))
            ? Provider.Sqlite
            : Provider.Postgres;

    public static void Configure(DbContextOptionsBuilder options)
    {
        switch (ResolveProvider())
        {
            case Provider.Postgres:
                var dbUrl = Environment.GetEnvironmentVariable("DATABASE_URL")!;
                options.UseNpgsql(NormalizeConnectionString(dbUrl), npgsql =>
                {
                    // Transient-fault resiliency. An RDS failover, reboot, or a
                    // brief network blip otherwise surfaces as an unhandled
                    // NpgsqlException on whatever request happened to be running.
                    // EnableRetryOnFailure wraps every query/SaveChanges in an
                    // execution strategy that retries transient errors with
                    // exponential backoff. Safe here because the app uses no
                    // manually-managed transactions (which the strategy would
                    // otherwise reject).
                    npgsql.EnableRetryOnFailure(
                        maxRetryCount: 5,
                        maxRetryDelay: TimeSpan.FromSeconds(10),
                        errorCodesToAdd: null);
                    // Bound how long a single command can hang so a wedged
                    // connection fails fast instead of tying up a request thread.
                    npgsql.CommandTimeout(30);
                });
                break;
            case Provider.Sqlite:
            default:
                options.UseSqlite("Data Source=helpRequests.db");
                break;
        }
    }

    /// <summary>
    /// Npgsql accepts both libpq URLs and key-value strings since 7.x, but we
    /// normalise anyway so we can log a sanitised version and so we can add
    /// sensible defaults (e.g. force <c>sslmode=require</c>) without surprising
    /// anyone who pasted a URL from a dashboard.
    /// </summary>
    public static string NormalizeConnectionString(string raw)
    {
        if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
            && !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            return raw; // already key=value
        }

        var uri = new Uri(raw);
        var userInfo = uri.UserInfo.Split(':', 2);
        var user = Uri.UnescapeDataString(userInfo[0]);
        var pass = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "";
        var db = uri.AbsolutePath.TrimStart('/');

        var builder = new Npgsql.NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort ? 5432 : uri.Port,
            Username = user,
            Password = pass,
            Database = db,
            SslMode = Npgsql.SslMode.Require,
        };

        // Pass through any query-string options (e.g. channel_binding=require
        // for Neon). Unknown keys are ignored by Npgsql.
        if (uri.Query.Length > 1)
        {
            foreach (var kv in uri.Query[1..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = kv.Split('=', 2);
                var key = Uri.UnescapeDataString(parts[0]);
                var val = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
                if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(val)) continue;
                try { builder[key] = val; } catch { /* ignore unknown keys */ }
            }
        }

        return builder.ConnectionString;
    }
}
