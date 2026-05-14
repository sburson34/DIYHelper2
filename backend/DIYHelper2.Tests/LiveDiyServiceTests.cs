using System.Text.Json;
using DIYHelper2.Api.AI;
using DIYHelper2.Api.Services;
using Xunit;

namespace DIYHelper2.Tests;

public class LiveDiyServiceTests
{
    private static readonly HighRiskAssessment NoRisk = new(false, Array.Empty<string>());
    private static readonly HighRiskAssessment GasRisk = new(true, new[] { "gas" });

    [Fact]
    public void BuildUserPrompt_IncludesAllUserContext()
    {
        var prompt = LiveDiyService.BuildUserPrompt(
            taskDescription: "Replace kitchen faucet",
            currentStep: 3,
            userQuestion: "Do I shut off the water first?",
            hasImage: true,
            riskAssessment: NoRisk);

        Assert.Contains("Replace kitchen faucet", prompt);
        Assert.Contains("3", prompt);
        Assert.Contains("Do I shut off the water first?", prompt);
        Assert.Contains("photo of what the user is currently looking at is attached", prompt);
        Assert.Contains("Return JSON only", prompt);
    }

    [Fact]
    public void BuildUserPrompt_NotesMissingImage()
    {
        var prompt = LiveDiyService.BuildUserPrompt(
            "task", null, null, hasImage: false, NoRisk);

        Assert.Contains("No photo was provided", prompt);
    }

    [Fact]
    public void BuildUserPrompt_AddsSafetyOverride_WhenHighRisk()
    {
        var prompt = LiveDiyService.BuildUserPrompt(
            "Replace gas water heater valve", null, null, hasImage: true, GasRisk);

        Assert.Contains("SAFETY OVERRIDE", prompt);
        Assert.Contains("gas", prompt);
        Assert.Contains("shouldEscalateToProfessional=true", prompt);
    }

    [Fact]
    public void BuildResponse_PassesThroughAiResult_WhenSafeAndParseable()
    {
        var rawAi = """
            {
              "currentAssessment": "Looking at a kitchen faucet base.",
              "nextInstruction": "Place a bucket under the supply lines.",
              "safetyWarnings": ["Turn off water at the shutoff valve first."],
              "confidenceScore": 0.85,
              "shouldEscalateToProfessional": false,
              "escalationReason": "",
              "suggestedTools": ["adjustable wrench", "bucket"]
            }
            """;

        var result = LiveDiyService.BuildResponse(rawAi, NoRisk, "session-abc");

        Assert.Equal("Looking at a kitchen faucet base.", result["currentAssessment"].GetString());
        Assert.Equal("Place a bucket under the supply lines.", result["nextInstruction"].GetString());
        Assert.False(result["shouldEscalateToProfessional"].GetBoolean());
        Assert.Equal(0.85, result["confidenceScore"].GetDouble(), 2);
        Assert.Equal("session-abc", result["sessionId"].GetString());
        Assert.Equal(2, result["suggestedTools"].GetArrayLength());
    }

    [Fact]
    public void BuildResponse_ForcesEscalation_WhenClassifierFlags()
    {
        // AI is happily giving step-by-step gas-line guidance — we still must
        // override and escalate.
        var rawAi = """
            {
              "currentAssessment": "Old brass gas line shutoff visible.",
              "nextInstruction": "Use a 9/16 wrench to loosen the union nut.",
              "safetyWarnings": [],
              "confidenceScore": 0.9,
              "shouldEscalateToProfessional": false,
              "escalationReason": "",
              "suggestedTools": ["9/16 wrench"]
            }
            """;

        var result = LiveDiyService.BuildResponse(rawAi, GasRisk, "session-xyz");

        Assert.True(result["shouldEscalateToProfessional"].GetBoolean());
        var warnings = result["safetyWarnings"].EnumerateArray()
            .Select(w => w.GetString() ?? "").ToArray();
        Assert.Contains(warnings, w => w!.Contains("gas", StringComparison.OrdinalIgnoreCase));
        var reason = result["escalationReason"].GetString();
        Assert.Contains("gas", reason!);
    }

    [Fact]
    public void BuildResponse_FailsSafe_WhenAiResponseUnparseable()
    {
        var result = LiveDiyService.BuildResponse(
            "totally not JSON at all <html>",
            NoRisk,
            "session-1");

        Assert.True(result["shouldEscalateToProfessional"].GetBoolean());
        Assert.False(string.IsNullOrEmpty(result["nextInstruction"].GetString()));
        Assert.False(string.IsNullOrEmpty(result["currentAssessment"].GetString()));
        Assert.True(result["safetyWarnings"].GetArrayLength() > 0);
    }

    [Fact]
    public void BuildResponse_FailsSafe_WhenAiResponseNull()
    {
        var result = LiveDiyService.BuildResponse(null, NoRisk, "session-2");

        Assert.True(result["shouldEscalateToProfessional"].GetBoolean());
        Assert.Equal("session-2", result["sessionId"].GetString());
    }

    [Fact]
    public void BuildResponse_GeneratesSessionId_WhenMissing()
    {
        // Mobile client may not send a session ID on the first turn.
        var rawAi = "{\"currentAssessment\":\"x\",\"nextInstruction\":\"y\",\"safetyWarnings\":[],\"confidenceScore\":0.5,\"shouldEscalateToProfessional\":false,\"suggestedTools\":[]}";

        var result = LiveDiyService.BuildResponse(rawAi, NoRisk, "passed-in-id");

        Assert.Equal("passed-in-id", result["sessionId"].GetString());
    }

    [Fact]
    public void BuildResponse_FillsDefaults_WhenAiOmitsFields()
    {
        // AI returned a minimal but valid JSON object with most fields missing.
        var rawAi = "{\"nextInstruction\":\"check the valve\"}";

        var result = LiveDiyService.BuildResponse(rawAi, NoRisk, "s");

        Assert.Equal("check the valve", result["nextInstruction"].GetString());
        Assert.Equal("", result["currentAssessment"].GetString());
        Assert.Equal(0, result["safetyWarnings"].GetArrayLength());
        Assert.Equal(0, result["suggestedTools"].GetArrayLength());
        Assert.Equal(0.0, result["confidenceScore"].GetDouble());
        Assert.False(result["shouldEscalateToProfessional"].GetBoolean());
    }

    [Fact]
    public void BuildResponse_MergesClassifierAndModelWarnings_WithoutDuplicates()
    {
        var rawAi = """
            {
              "currentAssessment": "x",
              "nextInstruction": "y",
              "safetyWarnings": ["Wear safety glasses."],
              "confidenceScore": 0.5,
              "shouldEscalateToProfessional": false,
              "suggestedTools": []
            }
            """;

        var result = LiveDiyService.BuildResponse(rawAi, GasRisk, "s");
        var warnings = result["safetyWarnings"].EnumerateArray()
            .Select(w => w.GetString() ?? "").ToArray();

        Assert.Contains(warnings, w => w!.Contains("Wear safety glasses"));
        Assert.Contains(warnings, w => w!.Contains("gas", StringComparison.OrdinalIgnoreCase));
    }
}
