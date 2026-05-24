using DIYHelper2.Api.Data;
using Sburson.Shared.Telemetry;

namespace DIYHelper2.Api.Services.Telemetry;

/// <summary>App binding of the shared telemetry ingest service over AppDbContext.</summary>
public sealed class TelemetryIngestService : TelemetryIngestServiceBase<AppDbContext>
{
    public TelemetryIngestService(AppDbContext db, ILogger<TelemetryIngestService> logger)
        : base(db, logger) { }
}
