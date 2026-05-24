using DIYHelper2.Api.Data;
using Sburson.Shared.Telemetry;

namespace DIYHelper2.Api.Services.Telemetry;

/// <summary>App binding of the shared usage-digest service over AppDbContext.</summary>
public sealed class UsageDigestService : UsageDigestServiceBase<AppDbContext>
{
    public UsageDigestService(AppDbContext db) : base(db) { }
}
