namespace DIYHelper2.Api.AI;

/// <summary>
/// Keyword-based classifier that flags DIY tasks the app should not be coaching
/// users through. The Live DIY Coach runs this BEFORE the AI call so we can:
///   1. Inject a "stop and call a pro" instruction into the system prompt
///      (defense-in-depth — keeps the model from going off-script).
///   2. Force <c>shouldEscalateToProfessional=true</c> on the response even if
///      the model disagrees.
///
/// Coverage maps to the categories explicitly called out in the product spec:
/// electrical, gas, structural, roofing, garage door springs, heavy machinery.
/// Keep matches conservative — false positives steer users toward a pro, which
/// is the safe direction. False negatives are the failure we care about.
/// </summary>
public static class HighRiskTaskClassifier
{
    // Keywords are lowercased and matched as substrings against the lowercased
    // input. Multi-word phrases ("load-bearing", "torsion spring") catch the
    // dangerous variant without flagging benign uses of the constituent words.
    private static readonly Dictionary<string, string[]> HazardCategories = new(StringComparer.OrdinalIgnoreCase)
    {
        ["electrical"] = new[]
        {
            "live wire", "live wiring", "240v", "240 v", "240-volt", "240 volt",
            "breaker panel", "service panel", "main panel", "subpanel", "sub-panel",
            "knob and tube", "knob-and-tube", "aluminum wiring",
            "electrocut", "shock hazard", "rewire",
        },
        ["gas"] = new[]
        {
            "gas line", "gas leak", "natural gas", "propane line",
            "pilot light", "gas valve", "gas meter", "gas appliance",
            "smell of gas", "gas smell",
        },
        ["structural"] = new[]
        {
            "load bearing", "load-bearing", "support beam", "support column",
            "structural wall", "structural beam", "foundation crack", "settling foundation",
        },
        ["roofing"] = new[]
        {
            "on the roof", "climb the roof", "climb on the roof", "walk the roof",
            "shingle replacement", "replace shingles", "roof leak repair",
            "ridge cap", "rafter repair", "roof flashing",
        },
        ["garage_spring"] = new[]
        {
            "garage door spring", "torsion spring", "extension spring",
            "garage door cable",
        },
        ["heavy_machinery"] = new[]
        {
            "chainsaw", "stump grinder", "skid steer", "excavator",
            "jackhammer", "concrete saw", "table saw blade change",
        },
    };

    public static HighRiskAssessment Assess(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return new HighRiskAssessment(false, Array.Empty<string>());

        var lower = text.ToLowerInvariant();
        var matched = new List<string>();
        foreach (var (category, keywords) in HazardCategories)
        {
            foreach (var keyword in keywords)
            {
                if (lower.Contains(keyword))
                {
                    matched.Add(category);
                    break;
                }
            }
        }

        return new HighRiskAssessment(matched.Count > 0, matched.ToArray());
    }

    /// <summary>
    /// Human-readable warning for a category. Used as the
    /// <c>safetyWarnings</c> entry when forcing escalation.
    /// </summary>
    public static string WarningFor(string category) => category switch
    {
        "electrical" => "This task involves high-voltage electrical work. Stop and call a licensed electrician — even brief contact with live wiring can be fatal.",
        "gas" => "This task involves a gas line or appliance. Stop, ventilate the area, and call your gas utility or a licensed plumber. Do not operate switches or open flames.",
        "structural" => "This task involves load-bearing or structural elements. Stop and consult a structural engineer or licensed contractor before proceeding.",
        "roofing" => "Roof work carries serious fall risk. Stop and hire a licensed roofer — falls from height are a leading cause of DIY fatalities.",
        "garage_spring" => "Garage door springs store enough energy to cause severe injury or death. Stop and call a garage door technician.",
        "heavy_machinery" => "This task involves equipment that requires operator training. Stop and either rent with training or hire a professional.",
        _ => "This task may be unsafe to attempt without professional help.",
    };
}

public readonly record struct HighRiskAssessment(bool IsHighRisk, string[] Categories);
