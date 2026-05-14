using Microsoft.EntityFrameworkCore;
using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<HelpRequest> HelpRequests => Set<HelpRequest>();
    public DbSet<BetaFeedback> BetaFeedback => Set<BetaFeedback>();
    public DbSet<DataDeletionRequest> DataDeletionRequests => Set<DataDeletionRequest>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Rate-limiting lookups on /api/delete-user-data filter by (Email,
        // CreatedAt) and (ClientIp, CreatedAt). Indexes keep those CountAsync
        // queries cheap as the table grows.
        modelBuilder.Entity<DataDeletionRequest>()
            .HasIndex(r => new { r.Email, r.CreatedAt })
            .HasDatabaseName("IX_DataDeletionRequests_Email_CreatedAt");

        modelBuilder.Entity<DataDeletionRequest>()
            .HasIndex(r => new { r.ClientIp, r.CreatedAt })
            .HasDatabaseName("IX_DataDeletionRequests_ClientIp_CreatedAt");
    }
}
