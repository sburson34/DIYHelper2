using DIYHelper2.Api.Services;

namespace DIYHelper2.Tests;

/// <summary>
/// A5 RouteOptimizer unit tests: haversine against a known great-circle
/// distance (±1%) and nearest-neighbor ordering on fixed points.
/// </summary>
public class RouteOptimizerTests
{
    private static RouteOptimizer.Stop Stop(int id, double? lat, double? lng, DateTime? scheduled = null) =>
        new(id, $"Job {id}", $"{id} Main St", "Town", "55555", lat, lng, scheduled);

    [Fact]
    public void Haversine_NycToLa_MatchesKnownDistanceWithinOnePercent()
    {
        // NYC (40.7128, -74.0060) → LA (34.0522, -118.2437): great-circle
        // distance ≈ 2,445.6 miles.
        var miles = RouteOptimizer.HaversineMiles(40.7128, -74.0060, 34.0522, -118.2437);
        Assert.InRange(miles, 2445.6 * 0.99, 2445.6 * 1.01);
    }

    [Fact]
    public void Haversine_ZeroDistance_ForSamePoint()
    {
        Assert.Equal(0, RouteOptimizer.HaversineMiles(45.0, -93.0, 45.0, -93.0), 6);
    }

    [Fact]
    public void Optimize_OrdersByNearestNeighbor_FromEarliestScheduledStop()
    {
        // Four points on the equator-ish line: A at 0.0, B at 0.1, D at 0.2,
        // C at 0.5 degrees longitude. A is the earliest-scheduled anchor, so
        // nearest-neighbor gives A → B → D → C (NOT schedule order A,B,C,D).
        var day = new DateTime(2026, 7, 20, 12, 0, 0, DateTimeKind.Utc);
        var stops = new[]
        {
            Stop(1, 0.0, 0.0, day),                 // A — earliest
            Stop(2, 0.0, 0.1, day.AddHours(1)),     // B
            Stop(3, 0.0, 0.5, day.AddHours(2)),     // C — scheduled before D but farther
            Stop(4, 0.0, 0.2, day.AddHours(3)),     // D
        };

        var plan = RouteOptimizer.Optimize(stops);

        Assert.Equal(new[] { 1, 2, 4, 3 }, plan.Stops.Select(l => l.Stop.Id).ToArray());
        Assert.Empty(plan.Unroutable);
        Assert.Equal(0, plan.Stops[0].LegMiles);
        // Every subsequent leg has a positive distance and the total is their sum.
        var legs = plan.Stops.Skip(1).Select(l => l.LegMiles!.Value).ToList();
        Assert.All(legs, m => Assert.True(m > 0));
        Assert.Equal(Math.Round(legs.Sum(), 1), plan.TotalMiles, 1);
    }

    [Fact]
    public void Optimize_AppendsUngeocodedStops_InScheduleOrder_AndReportsThemUnroutable()
    {
        var day = new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc);
        var stops = new[]
        {
            Stop(10, 44.98, -93.27, day),              // geocoded anchor
            Stop(11, null, null, day.AddHours(2)),     // no coords
            Stop(12, 44.99, -93.28, day.AddHours(1)),  // geocoded
            Stop(13, null, null, day.AddHours(1)),     // no coords, earlier than 11
        };

        var plan = RouteOptimizer.Optimize(stops);

        Assert.Equal(new[] { 10, 12, 13, 11 }, plan.Stops.Select(l => l.Stop.Id).ToArray());
        Assert.Equal(new[] { 13, 11 }, plan.Unroutable.ToArray());
        Assert.Null(plan.Stops[2].LegMiles);
        Assert.Null(plan.Stops[3].LegMiles);
    }

    [Fact]
    public void Optimize_EmptyInput_YieldsEmptyPlan()
    {
        var plan = RouteOptimizer.Optimize(Array.Empty<RouteOptimizer.Stop>());
        Assert.Empty(plan.Stops);
        Assert.Empty(plan.Unroutable);
        Assert.Equal(0, plan.TotalMiles);
    }
}
