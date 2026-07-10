namespace DIYHelper2.Api.Models;

public class HelpRequest : IBrandOwned
{
    public int Id { get; set; }

    /// <summary>White-label tenant this lead belongs to (see <see cref="Brand"/>).
    /// Set from the app's <c>X-Brand</c> header at create time; determines which
    /// company the lead is emailed to and which dashboard can see it. Denormalized
    /// string (no FK) so a lead survives brand rename/removal and unknown slugs.</summary>
    public string Brand { get; set; } = "diyhelper";

    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string ProjectTitle { get; set; } = string.Empty;
    public string UserDescription { get; set; } = string.Empty;
    public string ProjectData { get; set; } = string.Empty;
    public string? ImageBase64 { get; set; }

    /// <summary>Lifecycle of the lead as the customer sees it in "My Jobs":
    /// <c>new</c> → <c>scheduled</c> → <c>on_the_way</c> → <c>in_progress</c> →
    /// <c>completed</c> (or <c>cancelled</c>). Set by the brand operator from the
    /// dashboard; the mobile app renders a progress bar from it.</summary>
    public string Status { get; set; } = "new";

    // ── Booking details (customer-supplied at request time) ────────────────
    /// <summary>Per-install device id (<c>X-Device-Id</c>) of the app that
    /// created this request. Lets the customer see only their own jobs without a
    /// login (see <c>GET /api/my/requests</c>). Denormalized, no FK.</summary>
    public string? DeviceId { get; set; }

    /// <summary>Service category the customer picked when booking (e.g.
    /// "Plumbing"), drawn from the brand's configured service types.</summary>
    public string? ServiceType { get; set; }

    /// <summary>The date the customer would like the visit (their preference).</summary>
    public DateTime? PreferredDate { get; set; }

    /// <summary>Coarse preferred time window, e.g. "morning" / "afternoon" /
    /// "evening" / "anytime". Free text kept short.</summary>
    public string? PreferredWindow { get; set; }

    /// <summary>The customer's <see cref="Asset"/> this job is about (per-asset
    /// service history). Ownership-validated at booking; denormalized id, no FK,
    /// so history survives asset deletion.</summary>
    public int? AssetId { get; set; }

    /// <summary>The <see cref="CustomerProperty"/> this job was booked against.
    /// Its address columns (and coords, when known) are copied onto this row at
    /// booking time. Denormalized id, no FK.</summary>
    public int? PropertyId { get; set; }

    // ── Service address (where the tech goes) ─────────────────────────────
    /// <summary>Street address line. The app sends a single line at booking;
    /// City/State/Zip are refined from the console.</summary>
    public string? Address { get; set; }

    public string? City { get; set; }
    public string? State { get; set; }
    public string? Zip { get; set; }

    /// <summary>Geocoded (or console-entered) coordinates. Filled best-effort
    /// by <see cref="Integrations.GeocodingClient"/> after save; power the
    /// route view and the tech app's Navigate button.</summary>
    public double? Lat { get; set; }

    public double? Lng { get; set; }

    // ── Scheduling (operator-confirmed, drives "tech on the way") ──────────
    /// <summary>The appointment time the operator confirmed. Distinct from
    /// <see cref="PreferredDate"/>: this is the committed slot shown to the
    /// customer once <see cref="Status"/> becomes <c>scheduled</c>.</summary>
    public DateTime? ScheduledFor { get; set; }

    /// <summary>Live ETA in minutes the operator sets when the tech is en route
    /// (<see cref="Status"/> = <c>on_the_way</c>); the app shows "arriving in ~N
    /// min". Cleared once the job starts.</summary>
    public int? TechEtaMinutes { get; set; }

    /// <summary>The <see cref="Technician"/> assigned to this job (null = still
    /// unassigned). Denormalized id, no FK, so a tech row can be deactivated
    /// without orphaning history. Drives the tech app's "my jobs" list.</summary>
    public int? AssignedTechId { get; set; }

    // ── Field completion (captured by the tech app) ───────────────────────
    /// <summary>Base64 "before" photo the tech captures on arrival.</summary>
    public string? BeforePhotoBase64 { get; set; }

    /// <summary>Base64 "after" photo the tech captures on completion.</summary>
    public string? AfterPhotoBase64 { get; set; }

    /// <summary>Base64 PNG of the customer's on-site signature.</summary>
    public string? SignatureBase64 { get; set; }

    // ── S3 media keys (JobMediaService) ────────────────────────────────────
    // When object storage is configured, new photo/signature uploads land in
    // S3 and only the key is stored here (the matching *Base64 column is
    // nulled). The base64 columns above remain for the dual-read window: rows
    // written before the offload still stream their bytes directly.
    // TODO(DropLegacyBase64Columns): schedule a migration dropping
    // ImageBase64/BeforePhotoBase64/AfterPhotoBase64/SignatureBase64 no
    // earlier than 2026-10-08 (90 days after the A4 offload shipped) — the
    // 90-day retention purge will have aged every legacy base64 row out by then.

    /// <summary>S3 object key of the customer's booking photo (null = not offloaded).</summary>
    public string? ImageKey { get; set; }

    /// <summary>S3 object key of the tech's "before" photo.</summary>
    public string? BeforePhotoKey { get; set; }

    /// <summary>S3 object key of the tech's "after" photo.</summary>
    public string? AfterPhotoKey { get; set; }

    /// <summary>S3 object key of the customer's signature PNG.</summary>
    public string? SignatureKey { get; set; }

    /// <summary>Free-text notes the tech adds from the field (what was done).</summary>
    public string? CompletionNotes { get; set; }

    /// <summary>When work started (status → in_progress). Paired with
    /// <see cref="CompletedAt"/> to derive labor hours for timesheets.</summary>
    public DateTime? StartedAt { get; set; }

    /// <summary>When the tech marked the job completed.</summary>
    public DateTime? CompletedAt { get; set; }

    // ── Quote / estimate ───────────────────────────────────────────────────
    /// <summary>JSON array of quote lines <c>[{description, amount, quantity}]</c>
    /// the owner built for this job. Null = no quote yet.</summary>
    public string? QuoteLinesJson { get; set; }

    /// <summary>Sum of the quote lines at send time (exact money as decimal).</summary>
    public decimal? QuoteTotal { get; set; }

    /// <summary>Quote lifecycle: null (none) → <c>sent</c> → <c>approved</c> /
    /// <c>declined</c> (the customer's choice, from the app).</summary>
    public string? QuoteStatus { get; set; }

    /// <summary>Tiered (Good/Better/Best) quote, when the owner sent options
    /// instead of a single line set: JSON array
    /// <c>[{name, lines:[{description,amount,quantity}], total}]</c> with
    /// totals computed server-side at send time. Null for single-line quotes.
    /// While options are pending, <see cref="QuoteTotal"/> and
    /// <see cref="QuoteLinesJson"/> stay null; approval materializes the
    /// chosen option into them so invoicing/payments work unchanged.</summary>
    public string? QuoteOptionsJson { get; set; }

    /// <summary>The option name the customer approved (e.g. "Better").
    /// Null until an options quote is approved.</summary>
    public string? QuoteSelectedOption { get; set; }

    public DateTime? QuoteSentAt { get; set; }
    public DateTime? QuoteRespondedAt { get; set; }

    /// <summary>Id of the invoice created in the brand's accounting system
    /// (QuickBooks) when this job completed. Null until synced; set once to make
    /// the sync idempotent (we never double-invoice a job).</summary>
    public string? InvoiceRemoteId { get; set; }

    // ── Job costing (owner-entered, powers "did we make money?") ───────────
    /// <summary>Labor cost the shop incurred on this job.</summary>
    public decimal? LaborCost { get; set; }

    /// <summary>Parts/materials cost the shop incurred on this job.</summary>
    public decimal? PartsCost { get; set; }

    // ── Payment (collected via Stripe) ─────────────────────────────────────
    /// <summary>When the customer paid (Stripe checkout.session.completed). Null
    /// = unpaid.</summary>
    public DateTime? PaidAt { get; set; }

    /// <summary>Amount paid, in the brand's currency.</summary>
    public decimal? AmountPaid { get; set; }

    // ── Reporting + recurring maintenance ──────────────────────────────────
    /// <summary>When the completed-job report was emailed to the customer.</summary>
    public DateTime? ReportSentAt { get; set; }

    /// <summary>If set, completing this job schedules a maintenance reminder this
    /// many months out (recurring-revenue engine). Null = no recurring reminder.</summary>
    public int? MaintenanceIntervalMonths { get; set; }

    /// <summary>Id of the record created in the brand's external CRM when this
    /// lead was pushed there (see <see cref="Integrations.Crm.CrmLeadDispatcher"/>).
    /// Null when the brand has no CRM connection, when the push failed, or when
    /// the provider returns no id (e.g. a generic webhook). Stored for
    /// idempotency + dashboard deep-linking.</summary>
    public string? CrmRemoteId { get; set; }

    public string? Notes { get; set; }
    public DateTime? FollowUpDate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
