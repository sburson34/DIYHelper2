using Microsoft.Extensions.Configuration;
using Sburson.Shared.FeatureFlags;

namespace DIYHelper2.Api.Integrations;

/// <summary>
/// Reads feature flag env vars / IConfiguration at startup. Frontend pulls
/// these via GET /api/features. Scaffolded APIs stay dark until their
/// credentials land and the flag is flipped on.
///
/// Inherits from <see cref="FeatureFlagsBase"/> for the shared IsEnabled /
/// EnabledWhenSet helpers; the typed properties + ToPublicJson stay app-specific.
/// </summary>
public class FeatureFlags : FeatureFlagsBase
{
    public bool AmazonPa { get; }
    public bool Attom { get; }
    public bool PaintColors { get; }
    public bool ClaudeFallback { get; }
    public bool YouTube { get; }
    public bool Weather { get; }
    public bool Reddit { get; }
    public bool PubChem { get; }
    public bool ReceiptOcr { get; }

    // ML Kit features (on-device, controlled by backend flags for fleet management)
    public bool BarcodeScanner { get; }
    public bool ImageLabeling { get; }
    public bool OnDeviceTranslation { get; }
    public bool DigitalInk { get; }
    public bool EntityExtraction { get; }
    public bool PoseDetection { get; }

    // Emergency kill-switch. When true, all /api/analyze, /api/ask-helper,
    // /api/diagnose, /api/clarify, and /api/verify-step endpoints return 503.
    // Flip via the AI_KILL_SWITCH env var for an immediate rollout without a
    // redeploy. Use when an abuse wave or provider outage is draining the
    // OpenAI budget faster than per-device quotas can contain.
    public bool AiKillSwitch { get; }

    public FeatureFlags(IConfiguration config) : base(config)
    {
        AmazonPa = IsEnabled("AmazonPa");
        Attom = IsEnabled("Attom");
        PaintColors = IsEnabled("PaintColors");
        ClaudeFallback = IsEnabled("ClaudeFallback");
        // Auto-enable when the upstream key is set, OFF otherwise.
        YouTube = EnabledWhenSet("YOUTUBE_API_KEY");
        Weather = EnabledWhenSet("OPENWEATHER_API_KEY");
        Reddit = IsEnabled("Reddit", defaultValue: true);
        PubChem = IsEnabled("PubChem", defaultValue: true);
        ReceiptOcr = EnabledWhenSet("MINDEE_API_KEY");
        // ML Kit features — all default OFF until validated on target devices.
        BarcodeScanner = IsEnabled("BarcodeScanner");
        ImageLabeling = IsEnabled("ImageLabeling");
        OnDeviceTranslation = IsEnabled("OnDeviceTranslation");
        DigitalInk = IsEnabled("DigitalInk");
        EntityExtraction = IsEnabled("EntityExtraction");
        PoseDetection = IsEnabled("PoseDetection");
        // Read AI_KILL_SWITCH directly (no FEATURES_ prefix) to preserve the
        // existing deployment contract — flipping this is a fleet-wide emergency
        // lever and the env var is documented in the runbook by that name.
        var aiKillRaw = Environment.GetEnvironmentVariable("AI_KILL_SWITCH");
        AiKillSwitch = !string.IsNullOrEmpty(aiKillRaw)
            && (aiKillRaw.Equals("true", StringComparison.OrdinalIgnoreCase) || aiKillRaw == "1");
    }

    public object ToPublicJson() => new
    {
        amazonPa = AmazonPa,
        attom = Attom,
        paintColors = PaintColors,
        claudeFallback = ClaudeFallback,
        youtube = YouTube,
        weather = Weather,
        reddit = Reddit,
        pubchem = PubChem,
        receiptOcr = ReceiptOcr,
        barcodeScanner = BarcodeScanner,
        imageLabeling = ImageLabeling,
        onDeviceTranslation = OnDeviceTranslation,
        digitalInk = DigitalInk,
        entityExtraction = EntityExtraction,
        poseDetection = PoseDetection,
        aiKillSwitch = AiKillSwitch,
    };
}
