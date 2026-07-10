namespace DIYHelper2.Api.Services;

/// <summary>
/// Pure, deterministic day-route ordering for a technician's stops: greedy
/// nearest-neighbor by haversine distance, starting from the earliest-scheduled
/// geocoded stop. Un-geocoded stops can't be routed — they're appended after
/// the ordered legs in schedule order and reported as <c>unroutable</c>.
/// Static + side-effect free so it's directly unit-testable.
/// </summary>
public static class RouteOptimizer
{
    public record Stop(
        int Id, string ProjectTitle, string? Address, string? City, string? Zip,
        double? Lat, double? Lng, DateTime? ScheduledFor);

    /// <summary><c>LegMiles</c> is the distance from the previous ordered stop
    /// (0 for the first), or null for an appended unroutable stop.</summary>
    public record Leg(Stop Stop, double? LegMiles);

    public record RoutePlan(List<Leg> Stops, double TotalMiles, List<int> Unroutable);

    private const double EarthRadiusMiles = 3958.7613;

    /// <summary>Great-circle distance between two coordinates, in miles.</summary>
    public static double HaversineMiles(double lat1, double lng1, double lat2, double lng2)
    {
        static double Rad(double deg) => deg * Math.PI / 180.0;
        var dLat = Rad(lat2 - lat1);
        var dLng = Rad(lng2 - lng1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
              + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2))
              * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return EarthRadiusMiles * 2 * Math.Asin(Math.Min(1.0, Math.Sqrt(a)));
    }

    public static RoutePlan Optimize(IReadOnlyCollection<Stop> stops)
    {
        var geocoded = stops
            .Where(s => s.Lat.HasValue && s.Lng.HasValue)
            .OrderBy(s => s.ScheduledFor ?? DateTime.MaxValue)
            .ThenBy(s => s.Id)
            .ToList();
        var unroutable = stops
            .Where(s => !s.Lat.HasValue || !s.Lng.HasValue)
            .OrderBy(s => s.ScheduledFor ?? DateTime.MaxValue)
            .ThenBy(s => s.Id)
            .ToList();

        var ordered = new List<Leg>(stops.Count);
        double total = 0;
        if (geocoded.Count > 0)
        {
            var current = geocoded[0];      // earliest-scheduled geocoded stop anchors the route
            var remaining = geocoded.Skip(1).ToList();
            ordered.Add(new Leg(current, 0));
            while (remaining.Count > 0)
            {
                var next = remaining
                    .OrderBy(s => HaversineMiles(current.Lat!.Value, current.Lng!.Value, s.Lat!.Value, s.Lng!.Value))
                    .ThenBy(s => s.Id)
                    .First();
                var miles = HaversineMiles(current.Lat!.Value, current.Lng!.Value, next.Lat!.Value, next.Lng!.Value);
                total += miles;
                ordered.Add(new Leg(next, Math.Round(miles, 1)));
                remaining.Remove(next);
                current = next;
            }
        }

        // Un-geocoded stops trail the route in schedule order (no leg distance).
        ordered.AddRange(unroutable.Select(s => new Leg(s, null)));

        return new RoutePlan(ordered, Math.Round(total, 1), unroutable.Select(s => s.Id).ToList());
    }
}
