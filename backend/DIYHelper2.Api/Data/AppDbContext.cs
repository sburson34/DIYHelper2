using Microsoft.EntityFrameworkCore;
using DIYHelper2.Api.Models;
using Sburson.Shared.DataDeletion;
using Sburson.Shared.Telemetry;

namespace DIYHelper2.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<HelpRequest> HelpRequests => Set<HelpRequest>();
    public DbSet<Brand> Brands => Set<Brand>();
    public DbSet<BetaFeedback> BetaFeedback => Set<BetaFeedback>();
    public DbSet<DataDeletionRequest> DataDeletionRequests => Set<DataDeletionRequest>();
    public DbSet<PushToken> PushTokens => Set<PushToken>();
    public DbSet<PushCampaign> PushCampaigns => Set<PushCampaign>();

    // Anonymous product-usage events (shared schema). See Sburson.Shared.Telemetry.
    public DbSet<AnalyticsEvent> AnalyticsEvents => Set<AnalyticsEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyAnalyticsEvent();

        // Rate-limiting lookups on /api/delete-user-data filter by (Email,
        // CreatedAt) and (ClientIp, CreatedAt). Indexes keep those CountAsync
        // queries cheap as the table grows.
        modelBuilder.Entity<DataDeletionRequest>()
            .HasIndex(r => new { r.Email, r.CreatedAt })
            .HasDatabaseName("IX_DataDeletionRequests_Email_CreatedAt");

        modelBuilder.Entity<DataDeletionRequest>()
            .HasIndex(r => new { r.ClientIp, r.CreatedAt })
            .HasDatabaseName("IX_DataDeletionRequests_ClientIp_CreatedAt");

        // ── White-label brands ────────────────────────────────────────────
        // Slug is the tenant key (matches the app's X-Brand header). Dashboard
        // username is unique among rows that have one (partial index on Postgres;
        // a plain unique index on SQLite tolerates multiple NULLs already).
        modelBuilder.Entity<Brand>()
            .HasIndex(b => b.Slug)
            .IsUnique()
            .HasDatabaseName("IX_Brands_Slug");

        var usernameIndex = modelBuilder.Entity<Brand>()
            .HasIndex(b => b.DashboardUsername)
            .IsUnique()
            .HasDatabaseName("IX_Brands_DashboardUsername");
        // Postgres treats multiple NULLs as distinct only with a filtered index;
        // add the filter there so brands without a dashboard login don't collide.
        // SQLite (tests/local) already allows multiple NULLs in a unique index,
        // so leave it unfiltered to keep OnModelCreating provider-portable.
        if (Database.IsNpgsql())
            usernameIndex.HasFilter("\"DashboardUsername\" IS NOT NULL");

        // Leads are filtered/scoped by Brand on every admin list query.
        modelBuilder.Entity<HelpRequest>()
            .HasIndex(r => r.Brand)
            .HasDatabaseName("IX_HelpRequests_Brand");

        // Non-null with a server default so the ALTER on the existing RDS table
        // backfills historical rows to the flagship brand instead of failing.
        modelBuilder.Entity<HelpRequest>()
            .Property(r => r.Brand)
            .HasDefaultValue("diyhelper");

        // ── Push notifications ────────────────────────────────────────────
        // The Expo token is the natural key: a re-register from the same device
        // upserts this row (see the /api/push/register handler). Unique so we
        // never fan a broadcast out to the same device twice.
        modelBuilder.Entity<PushToken>()
            .HasIndex(t => t.Token)
            .IsUnique()
            .HasDatabaseName("IX_PushTokens_Token");

        // Audience queries filter by (Brand, IsActive, MarketingOptIn) on every
        // broadcast and audience-count call — a composite index keeps them cheap
        // as the token table grows.
        modelBuilder.Entity<PushToken>()
            .HasIndex(t => new { t.Brand, t.IsActive, t.MarketingOptIn })
            .HasDatabaseName("IX_PushTokens_Brand_Active_OptIn");

        // Campaign history is listed per-brand; the dispatch worker scans for
        // due scheduled rows by (Status, ScheduledFor).
        modelBuilder.Entity<PushCampaign>()
            .HasIndex(c => c.Brand)
            .HasDatabaseName("IX_PushCampaigns_Brand");
        modelBuilder.Entity<PushCampaign>()
            .HasIndex(c => new { c.Status, c.ScheduledFor })
            .HasDatabaseName("IX_PushCampaigns_Status_ScheduledFor");
    }
}
