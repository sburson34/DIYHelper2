using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace DIYHelper2.Api.Data;

/// <summary>
/// Design-time factory used by <c>dotnet ef migrations add</c> and similar
/// tooling. Forces the Postgres provider so migrations are always generated
/// against the production dialect regardless of the developer's local
/// <c>DATABASE_URL</c>. Runtime wiring still goes through <see cref="DatabaseConfig"/>.
/// </summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            // A placeholder connection string is fine — migrations commands
            // don't actually connect unless invoked with `database update`
            // against a live server.
            .UseNpgsql("Host=localhost;Database=migrations_scratch;Username=postgres;Password=postgres")
            .Options;

        return new AppDbContext(options);
    }
}
