namespace DIYHelper2.Api.Security;

/// <summary>
/// One consolidated boot-time check of the security-relevant configuration.
///
/// <para><b>Why.</b> Most of this app's protections are conditional on a secret
/// being present: the shared app key, the tech-token signing key, the CRM token
/// encryption key, the admin credentials, the webhook signing secrets. Each was
/// handled independently and quietly — a missing value produced at most a warning
/// buried in startup logs, or nothing at all, and the deployment ran on
/// indefinitely with a gate that looked configured but wasn't. This turns the
/// whole set into a single deploy-time signal.</para>
///
/// <para>Two severities. A <b>critical</b> entry means the deployment is silently
/// broken in a way an operator would otherwise discover from a customer. A
/// <b>warning</b> means degraded but safe — a gate that fails closed, or state
/// that won't survive a redeploy. Development is exempt throughout: local runs
/// are expected to have almost none of this set.</para>
///
/// <para><b>Why critical findings don't abort by default.</b> Program.cs does
/// refuse to start on a missing <c>DATABASE_URL</c>, but that one risks data
/// loss. Nothing here does: every gate below fails closed, and the payment case
/// self-heals once the secret is set (Stripe re-signs each retry for ~3 days).
/// Taking the whole API down — the customer app included — would be the worse
/// outcome of the two. So the default is a loud <c>LogCritical</c>, and
/// <c>SECURITY_PREFLIGHT_STRICT=true</c> turns critical findings into a refusal
/// to start. Turn strict on once a deployment's configuration is known good; it
/// then catches any later regression at deploy time instead of at runtime.</para>
/// </summary>
public static class SecurityPreflight
{
    /// <summary>
    /// Validates configuration. Logs findings, and throws
    /// <see cref="InvalidOperationException"/> on a critical finding when
    /// <c>SECURITY_PREFLIGHT_STRICT=true</c>. <paramref name="secretOrEnv"/>
    /// resolves a name through the Secrets Manager bundle then the environment,
    /// matching how the app itself reads that value.
    /// </summary>
    public static void Run(IHostEnvironment environment, ILogger logger, Func<string, string?> secretOrEnv)
    {
        if (environment.IsDevelopment()) return;

        var strict = string.Equals(
            Environment.GetEnvironmentVariable("SECURITY_PREFLIGHT_STRICT"), "true",
            StringComparison.OrdinalIgnoreCase);

        var critical = new List<string>();
        var warnings = new List<string>();

        // ── Critical: a live payment provider whose webhooks we cannot verify ──
        // The Stripe webhook marks a job paid. It now refuses unsigned events, so
        // an unset signing secret doesn't open a hole — it silently stops every
        // payment from ever being recorded. Catch that at deploy, not at the first
        // customer checkout.
        var stripeKey = Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY");
        var stripeWebhookSecret = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");
        if (!string.IsNullOrWhiteSpace(stripeKey) && string.IsNullOrWhiteSpace(stripeWebhookSecret))
        {
            critical.Add("STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — "
                + "payment webhooks are rejected as unverifiable, so no job will ever be marked paid.");
        }

        // ── Warnings: gates that fail closed, or state that won't survive a deploy ──
        if (string.IsNullOrWhiteSpace(secretOrEnv("APP_KEY")))
        {
            warnings.Add("APP_KEY is not set — AppKeyMiddleware is a no-op, so the API accepts "
                + "requests from clients other than our own app builds.");
        }

        if (string.IsNullOrWhiteSpace(secretOrEnv("ADMIN_USERNAME")) || string.IsNullOrWhiteSpace(secretOrEnv("ADMIN_PASSWORD")))
        {
            warnings.Add("ADMIN_USERNAME/ADMIN_PASSWORD are not both set — the super-admin login is "
                + "disabled (per-brand dashboard logins still work).");
        }

        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TECH_TOKEN_KEY")))
        {
            warnings.Add("TECH_TOKEN_KEY is not set — tech tokens are signed with an ephemeral "
                + "per-process key, so every technician is signed out on each redeploy.");
        }

        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CRM_TOKEN_ENC_KEY")))
        {
            warnings.Add("CRM_TOKEN_ENC_KEY is not set — stored CRM/accounting OAuth tokens cannot be "
                + "decrypted after a restart and each brand must reconnect.");
        }

        // Twilio's inbound webhooks write DB rows and send SMS on the operator's
        // account. They fail closed without a guard, which means missing config
        // breaks inbound SMS rather than exposing it — a warning, not a stop.
        var twilioAuthToken = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN");
        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TWILIO_ACCOUNT_SID"))
            && string.IsNullOrWhiteSpace(twilioAuthToken)
            && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TWILIO_WEBHOOK_TOKEN")))
        {
            warnings.Add("Twilio is partly configured but neither TWILIO_AUTH_TOKEN (signature "
                + "validation) nor TWILIO_WEBHOOK_TOKEN is set — inbound SMS/voice webhooks will be rejected.");
        }

        foreach (var w in warnings)
            logger.LogWarning("Security preflight: {Warning}", w);

        foreach (var c in critical)
            logger.LogCritical("Security preflight: {Problem}", c);

        if (critical.Count > 0 && strict)
        {
            throw new InvalidOperationException(
                $"Security preflight failed in '{environment.EnvironmentName}' "
                + $"(SECURITY_PREFLIGHT_STRICT=true): {string.Join(" | ", critical)}");
        }

        logger.LogInformation(
            "Security preflight complete in environment {Environment}: {CriticalCount} critical, {WarningCount} warning(s). Strict mode: {Strict}.",
            environment.EnvironmentName, critical.Count, warnings.Count, strict);
    }
}
