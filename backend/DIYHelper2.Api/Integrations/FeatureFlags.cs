namespace DIYHelper2.Api.Integrations;

/// <summary>
/// Reads feature flag env vars at startup. Frontend pulls these via GET /api/features.
/// Scaffolded APIs stay dark until their credentials land and the flag is flipped on.
/// </summary>
public class FeatureFlags
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

    public FeatureFlags()
    {
        AmazonPa = ReadBool("FEATURES_AMAZON_PA");
        Attom = ReadBool("FEATURES_ATTOM");
        PaintColors = ReadBool("FEATURES_PAINT_COLORS");
        ClaudeFallback = ReadBool("FEATURES_CLAUDE_FALLBACK");
        // The following default to ON when the upstream key is set, OFF otherwise.
        YouTube = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("YOUTUBE_API_KEY"));
        Weather = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("OPENWEATHER_API_KEY"));
        Reddit = ReadBool("FEATURES_REDDIT", defaultValue: true);
        PubChem = ReadBool("FEATURES_PUBCHEM", defaultValue: true);
        ReceiptOcr = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("MINDEE_API_KEY"));
        // ML Kit features — all default OFF until validated on target devices.
        BarcodeScanner = ReadBool("FEATURES_BARCODE_SCANNER");
        ImageLabeling = ReadBool("FEATURES_IMAGE_LABELING");
        OnDeviceTranslation = ReadBool("FEATURES_ON_DEVICE_TRANSLATION");
        DigitalInk = ReadBool("FEATURES_DIGITAL_INK");
        EntityExtraction = ReadBool("FEATURES_ENTITY_EXTRACTION");
        PoseDetection = ReadBool("FEATURES_POSE_DETECTION");
    }

    private static bool ReadBool(string name, bool defaultValue = false)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrEmpty(raw)) return defaultValue;
        return raw.Equals("true", StringComparison.OrdinalIgnoreCase) || raw == "1";
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
    };
}
