using System.Net.Http.Headers;
using System.Text.Json;

namespace DIYHelper2.Api.Integrations;

public record ReceiptLineItem(string Description, double? Qty, double? UnitPrice, double? Total);

public record ReceiptData(
    string? Merchant,
    string? Date,
    double? Total,
    List<ReceiptLineItem> LineItems
);

/// <summary>
/// Mindee "Expense Receipt v5" wrapper. Free tier: 250 pages/month. Needs MINDEE_API_KEY.
/// </summary>
public class ReceiptOcrClient
{
    private readonly HttpClient _http;
    private readonly ILogger<ReceiptOcrClient> _logger;
    private readonly string? _apiKey;

    public ReceiptOcrClient(HttpClient http, ILogger<ReceiptOcrClient> logger)
    {
        _http = http;
        _logger = logger;
        _apiKey = Environment.GetEnvironmentVariable("MINDEE_API_KEY");
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);

    public async Task<ReceiptData?> ParseAsync(byte[] imageBytes, string mimeType, CancellationToken ct = default)
    {
        if (!IsConfigured) return null;

        try
        {
            using var form = new MultipartFormDataContent();
            var content = new ByteArrayContent(imageBytes);
            content.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType ?? "image/jpeg");
            form.Add(content, "document", $"receipt.{GuessExt(mimeType)}");

            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict");
            req.Headers.Authorization = new AuthenticationHeaderValue("Token", _apiKey);
            req.Content = form;

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("Mindee OCR failed {Status}", (int)resp.StatusCode);
                return null;
            }
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));

            // Mindee response root → document.inference.prediction
            if (!doc.RootElement.TryGetProperty("document", out var document)) return null;
            if (!document.TryGetProperty("inference", out var inference)) return null;
            if (!inference.TryGetProperty("prediction", out var prediction)) return null;

            string? merchant = GetNestedString(prediction, "supplier_name", "value");
            string? date = GetNestedString(prediction, "date", "value");
            double? total = GetNestedDouble(prediction, "total_amount", "value");

            var items = new List<ReceiptLineItem>();
            if (prediction.TryGetProperty("line_items", out var lines) && lines.ValueKind == JsonValueKind.Array)
            {
                foreach (var l in lines.EnumerateArray())
                {
                    string desc = l.TryGetProperty("description", out var dd) ? dd.GetString() ?? "" : "";
                    double? qty = l.TryGetProperty("quantity", out var qq) && qq.ValueKind == JsonValueKind.Number ? qq.GetDouble() : null;
                    double? unit = l.TryGetProperty("unit_price", out var uu) && uu.ValueKind == JsonValueKind.Number ? uu.GetDouble() : null;
                    double? lTotal = l.TryGetProperty("total_amount", out var tt) && tt.ValueKind == JsonValueKind.Number ? tt.GetDouble() : null;
                    items.Add(new ReceiptLineItem(desc, qty, unit, lTotal));
                }
            }

            return new ReceiptData(merchant, date, total, items);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Receipt OCR exception");
            return null;
        }
    }

    private static string? GetNestedString(JsonElement el, params string[] path)
    {
        var cur = el;
        foreach (var p in path)
        {
            if (!cur.TryGetProperty(p, out cur)) return null;
        }
        return cur.ValueKind == JsonValueKind.String ? cur.GetString() : cur.ToString();
    }

    private static double? GetNestedDouble(JsonElement el, params string[] path)
    {
        var cur = el;
        foreach (var p in path)
        {
            if (!cur.TryGetProperty(p, out cur)) return null;
        }
        return cur.ValueKind == JsonValueKind.Number ? cur.GetDouble() : null;
    }

    private static string GuessExt(string? mime) => mime switch
    {
        "image/png" => "png",
        "image/heic" => "heic",
        "application/pdf" => "pdf",
        _ => "jpg"
    };
}
