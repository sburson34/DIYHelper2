namespace DIYHelper2.Api.Services;

/// <summary>
/// Sends verification codes to the email on file for a pending deletion
/// request. Prefers AWS SES when DELETION_MAIL_FROM is configured; falls back
/// to a log line in development so local testers can read the code from the
/// console.
/// </summary>
public class DeletionMailer
{
    private readonly ILogger<DeletionMailer> _logger;
    private readonly string? _fromAddress;
    private readonly string _region;

    public DeletionMailer(ILogger<DeletionMailer> logger)
    {
        _logger = logger;
        _fromAddress = Environment.GetEnvironmentVariable("DELETION_MAIL_FROM");
        _region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "us-east-1";
    }

    public async Task SendVerificationCodeAsync(string email, string code, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_fromAddress))
        {
            _logger.LogWarning(
                "DELETION_MAIL_FROM not configured; verification code for {EmailHash} will not be sent. " +
                "Set DELETION_MAIL_FROM to a verified SES identity.",
                HashForLog(email));
            return;
        }

        try
        {
            using var ses = new Amazon.SimpleEmail.AmazonSimpleEmailServiceClient(Amazon.RegionEndpoint.GetBySystemName(_region));
            var request = new Amazon.SimpleEmail.Model.SendEmailRequest
            {
                Source = _fromAddress,
                Destination = new Amazon.SimpleEmail.Model.Destination { ToAddresses = new List<string> { email } },
                Message = new Amazon.SimpleEmail.Model.Message
                {
                    Subject = new Amazon.SimpleEmail.Model.Content("DIY Helper: confirm your data deletion request"),
                    Body = new Amazon.SimpleEmail.Model.Body
                    {
                        Text = new Amazon.SimpleEmail.Model.Content(
                            $"Your verification code is {code}.\n\n" +
                            "Enter it in the DIY Helper app to confirm you want your data deleted.\n" +
                            "This code expires in 30 minutes.\n\n" +
                            "If you did not request deletion, you can ignore this email."),
                    },
                },
            };
            await ses.SendEmailAsync(request, ct);
            _logger.LogInformation("Sent deletion verification code to {EmailHash}", HashForLog(email));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send deletion verification email to {EmailHash}", HashForLog(email));
            throw;
        }
    }

    private static string HashForLog(string s)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(s.ToLowerInvariant()));
        return Convert.ToHexString(bytes)[..12].ToLowerInvariant();
    }
}
