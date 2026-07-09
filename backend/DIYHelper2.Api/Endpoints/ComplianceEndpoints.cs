using DIYHelper2.Api.Data;
using DIYHelper2.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Sburson.Shared.DataDeletion;
using Sburson.Shared.Email;

namespace DIYHelper2.Api.Endpoints;

/// <summary>
/// Store-compliance surfaces: the two-step verified data-deletion flow
/// (Apple/Google requirement) and beta feedback capture.
/// </summary>
public static class ComplianceEndpoints
{
    public static IEndpointRouteBuilder MapCompliance(this IEndpointRouteBuilder app)
    {
        // ── Privacy: server-side data deletion ──────────────────────────────
        // Two-step verified flow:
        //   1. POST /api/delete-user-data — user submits email/phone. Server creates
        //      a pending_verification row, stores a hashed 6-digit code, and emails it
        //      to the address on file. Response is identical whether the email was
        //      found or not so the endpoint cannot be used as an existence oracle.
        //   2. POST /api/confirm-deletion — user submits { requestId, code }. Server
        //      constant-time compares, marks row "verified", and hands off to the
        //      out-of-band wipe. Rate-limited by attempt count to prevent brute force.
        app.MapPost("/api/delete-user-data", async (
            [FromBody] DeleteUserDataDto dto,
            HttpContext context,
            AppDbContext db,
            IEmailService mailer,
            ILogger<Program> logger) =>
        {
            var name = (dto.Name ?? "").Trim();
            // Normalize email to lowercase so rate-limit + lookup are case-insensitive.
            // RFC 5321 makes the local-part technically case-sensitive, but virtually no
            // real-world MTA cares, and a case-sensitive comparison lets an attacker
            // sidestep the per-email throttle by toggling case.
            var email = (dto.Email ?? "").Trim().ToLowerInvariant();
            var phone = (dto.Phone ?? "").Trim();

            if (string.IsNullOrEmpty(email) && string.IsNullOrEmpty(phone))
                return Results.Json(new { error = "email or phone required" }, statusCode: 400);

            var correlationId = context.Items["CorrelationId"] as string;
            var appVersion = context.Request.Headers["X-App-Version"].ToString();
            var clientIp = context.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',').FirstOrDefault()?.Trim()
                           ?? context.Connection.RemoteIpAddress?.ToString();

            const int PerEmailPerDay = 3;
            const int PerIpPerDay = 20;
            var since = DateTime.UtcNow.AddHours(-24);

            int emailCount = 0;
            if (!string.IsNullOrEmpty(email))
                emailCount = await db.DataDeletionRequests.CountAsync(r => r.Email == email && r.CreatedAt >= since);

            int ipCount = 0;
            if (!string.IsNullOrEmpty(clientIp))
                ipCount = await db.DataDeletionRequests.CountAsync(r => r.ClientIp == clientIp && r.CreatedAt >= since);

            var fakeRequestId = Guid.NewGuid().ToString();

            if (emailCount >= PerEmailPerDay)
            {
                logger.LogWarning("delete-user-data: per-email rate limit hit. email={EmailHash} ip={Ip} correlationId={CorrelationId}",
                    Hash(email), clientIp, correlationId);
                return Results.Ok(new { status = "pending_verification", requestId = fakeRequestId });
            }
            if (ipCount >= PerIpPerDay)
            {
                logger.LogWarning("delete-user-data: per-IP rate limit hit. ip={Ip} correlationId={CorrelationId}",
                    clientIp, correlationId);
                return Results.Ok(new { status = "pending_verification", requestId = fakeRequestId });
            }

            // Generate 6-digit code from a cryptographically secure RNG, store its
            // SHA-256 hash, email the plain code. 30-minute TTL.
            var code = System.Security.Cryptography.RandomNumberGenerator.GetInt32(0, 1_000_000)
                .ToString("D6", System.Globalization.CultureInfo.InvariantCulture);

            var record = new DataDeletionRequest
            {
                RequestId = Guid.NewGuid().ToString(),
                Name = string.IsNullOrEmpty(name) ? null : name,
                Email = string.IsNullOrEmpty(email) ? null : email,
                Phone = string.IsNullOrEmpty(phone) ? null : phone,
                Status = "pending_verification",
                CreatedAt = DateTime.UtcNow,
                ClientIp = clientIp,
                CorrelationId = correlationId,
                AppVersion = string.IsNullOrEmpty(appVersion) ? null : appVersion,
                VerificationCodeHash = HashCode(code),
                VerificationCodeExpiresAt = DateTime.UtcNow.AddMinutes(30),
            };
            db.DataDeletionRequests.Add(record);
            await db.SaveChangesAsync();

            if (!string.IsNullOrEmpty(email))
            {
                try
                {
                    await mailer.SendAsync(
                        email,
                        "DIY Helper: confirm your data deletion request",
                        $"Your verification code is {code}.\n\n" +
                        "Enter it in the DIY Helper app to confirm you want your data deleted.\n" +
                        "This code expires in 30 minutes.\n\n" +
                        "If you did not request deletion, you can ignore this email.");
                }
                catch (Exception ex) { logger.LogWarning(ex, "delete-user-data: mailer failed; user can retry."); }
            }

            logger.LogInformation(
                "delete-user-data: queued. requestId={RequestId} emailHash={EmailHash} phoneHash={PhoneHash} correlationId={CorrelationId}",
                record.RequestId, Hash(email), Hash(phone), correlationId);

            return Results.Ok(new { status = "pending_verification", requestId = record.RequestId });

            static string Hash(string? s)
            {
                if (string.IsNullOrEmpty(s)) return "";
                using var sha = System.Security.Cryptography.SHA256.Create();
                var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(s.ToLowerInvariant()));
                return Convert.ToHexString(bytes).Substring(0, 12).ToLowerInvariant();
            }

            static string HashCode(string code)
            {
                using var sha = System.Security.Cryptography.SHA256.Create();
                var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(code));
                return Convert.ToHexString(bytes).ToLowerInvariant();
            }
        });

        app.MapPost("/api/confirm-deletion", async (
            [FromBody] ConfirmDeletionDto dto,
            HttpContext context,
            AppDbContext db,
            ILogger<Program> logger) =>
        {
            if (string.IsNullOrWhiteSpace(dto.RequestId) || string.IsNullOrWhiteSpace(dto.Code))
                return Results.Json(new { error = "requestId and code required" }, statusCode: 400);

            var correlationId = context.Items["CorrelationId"] as string;
            var record = await db.DataDeletionRequests.FirstOrDefaultAsync(r => r.RequestId == dto.RequestId);

            // Constant response shape regardless of whether the record exists — the
            // endpoint must not reveal whether a given requestId is valid.
            var invalid = Results.Json(new { error = "Invalid or expired verification code.", code = "invalid_code" }, statusCode: 400);

            if (record == null) return invalid;
            if (record.Status != "pending_verification") return invalid;
            if (record.VerificationCodeHash == null || record.VerificationCodeExpiresAt == null) return invalid;
            if (record.VerificationCodeExpiresAt < DateTime.UtcNow) return invalid;
            if (record.VerificationAttempts >= 5)
            {
                logger.LogWarning("confirm-deletion: too many attempts for {RequestId} correlationId={CorrelationId}", dto.RequestId, correlationId);
                return invalid;
            }

            using var sha = System.Security.Cryptography.SHA256.Create();
            var providedHash = Convert.ToHexString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(dto.Code.Trim()))).ToLowerInvariant();

            if (!FixedTimeEquals(providedHash, record.VerificationCodeHash))
            {
                record.VerificationAttempts++;
                await db.SaveChangesAsync();
                return invalid;
            }

            record.Status = "verified";
            record.VerifiedAt = DateTime.UtcNow;
            record.VerificationCodeHash = null;
            record.VerificationCodeExpiresAt = null;
            await db.SaveChangesAsync();

            logger.LogInformation("confirm-deletion: verified requestId={RequestId} correlationId={CorrelationId}", dto.RequestId, correlationId);
            return Results.Ok(new { status = "verified", requestId = record.RequestId });

            static bool FixedTimeEquals(string a, string b)
            {
                if (a.Length != b.Length) return false;
                int diff = 0;
                for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
                return diff == 0;
            }
        });

        // ── Beta feedback ─────────────────────────────────────────────────
        app.MapPost("/api/feedback", [EnableRateLimiting("submit")] async ([FromBody] CreateFeedbackDto dto, AppDbContext db) =>
        {
            var feedback = new BetaFeedback
            {
                ClientId = dto.Id ?? "",
                Description = dto.Description ?? "",
                WhatYouWereDoing = dto.WhatYouWereDoing,
                ReproSteps = dto.ReproSteps,
                AppVersion = dto.Metadata?.AppVersion,
                BuildNumber = dto.Metadata?.BuildNumber,
                Platform = dto.Metadata?.Platform,
                OsVersion = dto.Metadata?.OsVersion,
                Environment = dto.Metadata?.Environment,
                GitCommit = dto.Metadata?.GitCommit,
                CurrentScreen = dto.Metadata?.CurrentScreen,
                CorrelationId = dto.Metadata?.LastCorrelationId,
                CreatedAt = DateTime.UtcNow,
            };
            db.BetaFeedback.Add(feedback);
            await db.SaveChangesAsync();
            return Results.Created($"/api/feedback/{feedback.Id}", new { id = feedback.Id });
        });

        app.MapGet("/api/feedback", async (AppDbContext db) =>
        {
            var results = await db.BetaFeedback
                .OrderByDescending(f => f.CreatedAt)
                .Take(100)
                .Select(f => new
                {
                    f.Id, f.ClientId, f.Description, f.WhatYouWereDoing, f.ReproSteps,
                    f.AppVersion, f.Platform, f.OsVersion, f.CurrentScreen,
                    f.Environment, f.GitCommit, f.CorrelationId, f.CreatedAt,
                })
                .ToListAsync();
            return Results.Ok(results);
        });

        return app;
    }
}
