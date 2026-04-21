using Microsoft.EntityFrameworkCore;
using DIYHelper2.Api.Models;

namespace DIYHelper2.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<HelpRequest> HelpRequests => Set<HelpRequest>();
    public DbSet<BetaFeedback> BetaFeedback => Set<BetaFeedback>();
    public DbSet<DataDeletionRequest> DataDeletionRequests => Set<DataDeletionRequest>();
}
