namespace DIYHelper2.Api.Validation;

/// <summary>
/// The closed set of lifecycle values a <c>HelpRequest.Status</c> may take.
///
/// <para><b>Why.</b> Both the owner PUT and the technician PUT assigned
/// <c>dto.Status</c> straight onto the row, so the column accepted any string a
/// client sent. That is more than a tidiness problem: reaching
/// <c>"completed"</c> fires <c>JobCompletionService</c> — an accounting invoice,
/// a report email, a maintenance reminder and a review text, all on the
/// operator's accounts and all aimed at a real customer. A typo'd or invented
/// status also silently drops the job out of every dashboard query, since those
/// filter on exact strings. Validating at the edge keeps the state machine and
/// the side effects it triggers honest.</para>
/// </summary>
public static class JobStatus
{
    public const string New = "new";
    public const string Scheduled = "scheduled";
    public const string OnTheWay = "on_the_way";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";

    private static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    {
        New, Scheduled, OnTheWay, InProgress, Completed, Cancelled,
    };

    /// <summary>Statuses a technician may set from the field app. Deliberately
    /// narrower than the owner's: dispatch decisions (scheduling a job, taking it
    /// back to "new", cancelling it) belong to the office, while a tech reports
    /// progress on work already assigned to them.</summary>
    private static readonly HashSet<string> TechAllowed = new(StringComparer.Ordinal)
    {
        OnTheWay, InProgress, Completed,
    };

    public static bool IsValid(string? status) => status is not null && Allowed.Contains(status);

    public static bool IsValidForTech(string? status) => status is not null && TechAllowed.Contains(status);

    /// <summary>Human-readable list for the 400 body, so a client author can see
    /// what was expected without reading the source.</summary>
    public static string AllowedList => string.Join(", ", Allowed);

    public static string TechAllowedList => string.Join(", ", TechAllowed);
}
