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
    public DbSet<BrandCrmConnection> BrandCrmConnections => Set<BrandCrmConnection>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Technician> Technicians => Set<Technician>();
    public DbSet<PriceBookItem> PriceBookItems => Set<PriceBookItem>();
    public DbSet<BrandAccountingConnection> BrandAccountingConnections => Set<BrandAccountingConnection>();
    public DbSet<SmsMessage> SmsMessages => Set<SmsMessage>();

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

        // ── Customers (lightweight, password-less end users) ──────────────
        // A returning customer is matched by (Brand, DeviceId) on every request
        // and by (Brand, Email) when they re-enter the same address on a new
        // device. Neither is unique — the same person may reinstall (new device)
        // or share a device — so these are plain lookup indexes, and the upsert
        // handler picks the most-recent match rather than relying on uniqueness.
        modelBuilder.Entity<Customer>()
            .HasIndex(c => new { c.Brand, c.DeviceId })
            .HasDatabaseName("IX_Customers_Brand_DeviceId");
        modelBuilder.Entity<Customer>()
            .HasIndex(c => new { c.Brand, c.Email })
            .HasDatabaseName("IX_Customers_Brand_Email");

        // "My Jobs" lists a device's requests: filter by (Brand, DeviceId),
        // newest first. Reuses the DeviceId column added to HelpRequest.
        modelBuilder.Entity<HelpRequest>()
            .HasIndex(r => new { r.Brand, r.DeviceId })
            .HasDatabaseName("IX_HelpRequests_Brand_DeviceId");

        // The tech app lists a technician's assigned jobs by (Brand, AssignedTechId).
        modelBuilder.Entity<HelpRequest>()
            .HasIndex(r => new { r.Brand, r.AssignedTechId })
            .HasDatabaseName("IX_HelpRequests_Brand_AssignedTechId");

        // Technicians are listed + login-verified per brand.
        modelBuilder.Entity<Technician>()
            .HasIndex(t => new { t.Brand, t.IsActive })
            .HasDatabaseName("IX_Technicians_Brand_Active");

        // Price-book items are listed per brand.
        modelBuilder.Entity<PriceBookItem>()
            .HasIndex(p => new { p.Brand, p.IsActive })
            .HasDatabaseName("IX_PriceBookItems_Brand_Active");
        // Exact money: fixed precision instead of the provider default.
        modelBuilder.Entity<PriceBookItem>()
            .Property(p => p.DefaultPrice)
            .HasPrecision(12, 2);
        modelBuilder.Entity<HelpRequest>()
            .Property(r => r.QuoteTotal)
            .HasPrecision(12, 2);
        modelBuilder.Entity<HelpRequest>()
            .Property(r => r.LaborCost)
            .HasPrecision(12, 2);
        modelBuilder.Entity<HelpRequest>()
            .Property(r => r.PartsCost)
            .HasPrecision(12, 2);

        // ── CRM connections ───────────────────────────────────────────────
        // One CRM connection per brand: the dispatcher looks a brand's connection
        // up by slug on every lead, and the OAuth callback upserts by slug.
        modelBuilder.Entity<BrandCrmConnection>()
            .HasIndex(c => c.BrandSlug)
            .IsUnique()
            .HasDatabaseName("IX_BrandCrmConnections_BrandSlug");

        // One accounting (QuickBooks) connection per brand.
        modelBuilder.Entity<BrandAccountingConnection>()
            .HasIndex(c => c.BrandSlug)
            .IsUnique()
            .HasDatabaseName("IX_BrandAccountingConnections_BrandSlug");

        // SMS log is read per lead (conversation) and per brand (recent activity).
        modelBuilder.Entity<SmsMessage>()
            .HasIndex(m => new { m.Brand, m.HelpRequestId })
            .HasDatabaseName("IX_SmsMessages_Brand_HelpRequestId");
    }
}
