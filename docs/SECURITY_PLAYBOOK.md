# DIYHelper2 — Security & Abuse Response Playbook

Operational runbook for security incidents, cost runaway events, and the rotation cadence for keys and pins. Keep this up to date — the point is a reader can execute steps without tribal knowledge.

## Contact

- Disclosure: bursons@gmail.com (mirrored at `/.well-known/security.txt`).
- Primary responder: Stephen.

## Defense layers (current)

| Layer | Location | Toggle |
| --- | --- | --- |
| Per-IP rate limiter (fixed window) | `Program.cs` — `AddRateLimiter`. Buckets: `ai` 20/min, `translate` 120/min, `submit` 10/min, `public` 60/min, plus a `GlobalLimiter` backstop on every route so an endpoint without an explicit policy is still bounded. | `GLOBAL_RATE_LIMIT_PER_MINUTE` (default 300) |
| Trusted client-IP resolution | `Security/ClientIp.cs` + `ForwardLimit` on `UseForwardedHeaders`. Every per-IP control (rate limiter, admin lockout, deletion throttle) keys off the connection peer resolved by `ForwardedHeadersMiddleware`, never the raw `X-Forwarded-For` header — which the caller controls. | `FORWARDED_HEADERS_FORWARD_LIMIT` (default 1 = one proxy, Caddy). **Raise only when a hop is genuinely added; too high re-opens header spoofing.** |
| Image content sniffing | `Validation/ImageSniffer.cs`, applied via `MediaValidation.ValidateImage` on every image entry point | always on — rejects payloads whose bytes aren't a JPEG/PNG/WebP/HEIC before any metered AI/OCR call |
| Bounded anonymous writes | `Validation/UgcValidation.cs` (`/api/community-projects`, `/api/feedback`) | always on |
| Tech-token revocation | `Services/TechTokenService.VersionOf` + `TechPrincipalOfAsync` in `Program.cs` | always on — deactivating/deleting a technician or re-issuing their login code invalidates outstanding bearer tokens immediately |
| Stripe webhook verification | `/api/stripe/webhook` — HMAC-SHA256 with a 5-minute timestamp tolerance (replay protection) | `STRIPE_WEBHOOK_SECRET`. **Fails closed outside Development**: unset ⇒ 503, and the boot preflight refuses to start if Stripe is otherwise live. |
| Twilio webhook verification | `Integrations/Messaging/TwilioSignature.cs` — HMAC-SHA1 over URL + sorted POST params | `TWILIO_AUTH_TOKEN` (preferred) or `TWILIO_WEBHOOK_TOKEN` (shared `?token=`, weaker). Fails closed outside Development. Set `TWILIO_WEBHOOK_BASE_URL` if a proxy rewrites the host. |
| Boot-time security preflight | `Security/SecurityPreflight.cs` | always on outside Development — one consolidated report; fatal entries abort startup |
| HSTS | `app.UseHsts()` (non-Development only), 1 year, `includeSubDomains`, no preload | always on in deployed environments |
| Dependency vulnerability gate | `backend/Directory.Build.props` — `NuGetAudit` with `NU1903`/`NU1904` as errors | always on; high/critical advisories fail the build |
| Per-device daily AI quota | `Services/DeviceQuotaService.cs` | `DAILY_DEVICE_AI_LIMIT` env (default 60) |
| Per-user AI cost quota (USD) | `Services/DeviceQuotaService.cs` | `DAILY_DEVICE_AI_LIMIT` env; thread-safe counter |
| OpenAI moderation pre-check | `AI/ModerationService.cs` | on when `OPENAI_API_KEY` set |
| Prompt-injection guard (system prompt) | system prompts in `Program.cs` | hardcoded |
| Prompt-injection guard (user input wrapping) | `Validation/PromptSanitizer.cs` — `PromptSanitizer.Wrap` | always on; every AI endpoint wraps free-text fields in `<user_input>` tags and strips the tag from the payload |
| Case-insensitive email normalization | `/api/delete-user-data` | normalize to lowercase before rate-limit lookup so an attacker cannot bypass `PerEmailPerDay` by toggling case |
| Shared-secret app key | `Middleware/AppKeyMiddleware.cs` | `APP_KEY` / Secrets Manager |
| Admin Basic Auth + per-IP lockout | `Middleware/AdminAuthMiddleware.cs`. Covers `/admin/*`, `/api/admin/*`, and the owner-only API surfaces. | `ADMIN_USERNAME` / `ADMIN_PASSWORD`; fails closed |
| Play Integrity | `AI/PlayIntegrityVerifier.cs` | `PLAY_INTEGRITY_PROJECT_NUMBER` env |
| SSRF guard (outbound) | `Integrations/SsrfGuardHandler.cs` | always on — blocks loopback (full `127/8` not just `127.0.0.1`), link-local incl. AWS IMDS `169.254.169.254`, RFC1918, CGNAT `100.64/10`, IPv6 unspecified `::`, unique-local `fc00::/7`, link-local, site-local, and IPv4-mapped equivalents |
| AI kill-switch | `FeatureFlags.AiKillSwitch` | `AI_KILL_SWITCH=true` env |
| Deletion verification | `/api/confirm-deletion` | always on |
| Cert pinning (Android) | `res/xml/network_security_config.xml` | always on in release |
| Security headers (CSP / X-Frame-Options / COOP-COEP-CORP) | `Middleware/SecurityHeadersMiddleware.cs` | always on |
| Error response sanitization (no raw exception text in `/api/translate` etc.) | `Middleware/ExceptionHandlerMiddleware.cs` + endpoint handlers | always on |
| Sentry error reporting + scrubbing | `Observability/SentrySetup.cs` | on when `Sentry__Dsn` env set. Scrubs `Authorization`/`Cookie`/`X-Api-Key`/`X-Admin-Token`/`X-App-Key`/`X-Play-Integrity-Token` headers, drops breadcrumbs whose data keys contain `authorization`/`token`/`password`/`secret`/`cookie`/`api-key`, redacts `sk-…`/`Bearer …`/JWT-looking tokens from messages, never ships request bodies (`MaxRequestBodySize = None`), tags every event with the request `correlation_id`. |
| Security disclosure contact | `wwwroot/.well-known/security.txt` | RFC 9116. `Expires:` must be bumped on every release. |

## Immediate levers during an incident

### "OpenAI spend is spiking"

1. Set `AI_KILL_SWITCH=true` in Elastic Beanstalk → Configuration → Software. Takes effect within ~1 minute of the env redeploy. `/api/analyze`, `/api/ask-helper`, `/api/diagnose`, `/api/clarify`, `/api/verify-step` all return 503.
2. Check CloudWatch dashboard for top device IDs / IPs in the 429 bucket. Note offenders.
3. If traffic is from a narrow set of devices, tighten `DAILY_DEVICE_AI_LIMIT` (default 60) before re-enabling.
4. If abuse keeps coming from a rotating IP set, verify Play Integrity is active — if not, bring it online (see below).

### "Someone found a prompt-injection that leaks the system prompt"

1. Update the injection guard in the affected endpoint's `systemPrompt` in `Program.cs`.
2. Confirm the user-supplied fields are wrapped in `PromptSanitizer.Wrap(...)` — if the new endpoint isn't, that's the root cause. The wrapper strips `<user_input>` boundaries from the payload so an attacker can't close the tag and pose as the developer turn.
3. Add a regression test with the offending payload (mirror `DIYHelper2.Tests/PromptSanitizerTests.cs`).
4. Deploy. Meanwhile, temporary kill-switch is the blast-radius limiter.

### "Sentry is flooding with the same error"

1. Confirm it's a real error and not Sentry's own noise.
2. Add an `AddExceptionFilterForType<T>()` line in `Observability/SentrySetup.cs` for known-benign transient types (we already filter `OperationCanceledException` and `TaskCanceledException`).
3. If the burst is from a single user, find them by the `correlation_id` tag Sentry stamps on every event — that maps 1:1 to the `X-Correlation-Id` response header the mobile app logged.
4. If Sentry itself is the problem (e.g., DSN compromised, spam events), unset `Sentry__Dsn` in EB env config to disable cleanly — `SentrySetup.AddSentryObservability` is a no-op without it.

### "Deletion spam"

Per-IP and per-email rate limits are in `/api/delete-user-data`. If someone weaponizes the endpoint:
1. Tighten `PerEmailPerDay` / `PerIpPerDay` constants.
2. Scan the `DataDeletionRequests` table for unverified rows and purge stale ones.

## Rotation cadence

| What | Cadence | How |
| --- | --- | --- |
| `APP_KEY` | every major release | Rotate value in Secrets Manager JSON → bump `EXPO_PUBLIC_APP_KEY` in the `.env.production.local` the release build consumes → ship. Old installs continue working until they update; schedule a sunset if you need forced-upgrade. |
| OpenAI API key | every 90 days or on staff change | AWS Secrets Manager → rotate. No app-side change. |
| Google Cloud service account (Play Integrity, Translate) | every 90 days | Google Cloud Console → new key → update `GOOGLE_APPLICATION_CREDENTIALS` file on the EB instance. |
| TLS cert for `api.diyhelper.org` | automatic via ACM | When ACM rotates, **you must re-pin** — see below. |
| Android cert pins | at each TLS rotation, and whenever the intermediate CA changes | See "Cert-pin rotation" below. |
| `network_security_config.xml` `expiration` | bump to now+12mo on every release that touches pins | Prevents bricking users if we forget the rotation. |
| Sentry DSN | only on compromise | Sentry DSNs are low-risk public-ish identifiers; rotation is event-driven, not scheduled. If you do rotate, update `Sentry__Dsn` env on the backend and `EXPO_PUBLIC_SENTRY_DSN` (or the `app.json` fallback) on mobile. |
| Full cross-portfolio cadence | see `docs/SECRETS_ROTATION.md` | Master rotation table; covers JWT signing keys, AI provider keys, Google service accounts, RevenueCat, AWS access keys, app-key, TLS certs, cert pins. |

## Cert-pin rotation

`app/android/app/src/main/res/xml/network_security_config.xml` has two pins — primary (current leaf cert) and backup (typically the intermediate CA). Releasing with only one pin is a footgun: when ACM rotates the leaf, every existing install hard-fails the TLS handshake.

Procedure (run before every release):

```bash
./app/scripts/compute-cert-pins.sh api.diyhelper.org
```

Take the `depth=0` (leaf) and `depth=1` (intermediate) outputs and put them into the `<pin-set>` block, primary then backup. Bump the `expiration` attribute to roughly +12 months. Commit.

If ACM has already rotated and you see TLS handshake failures in Sentry, the fix is to either:
- Ship an emergency update with the new pins, or
- Temporarily remove the `<pin-set>` block to restore connectivity while you prep a proper release.

## New-release checklist (security-relevant)

- [ ] Cert pins re-computed and committed.
- [ ] `<pin-set expiration>` bumped ~12 months.
- [ ] `EXPO_PUBLIC_APP_KEY` rotated in the release build env.
- [ ] ProGuard mapping uploaded (Gradle `assembleRelease` runs the Sentry plugin).
- [ ] `docs/PLAY_DATA_SAFETY.md` still reflects the current data flows.
- [ ] `/.well-known/security.txt` `Expires:` is >60 days in the future (current value: `2026-11-17`; renew by ~2026-09-17).
- [ ] Sentry receiving events from both mobile + backend in prod (`Sentry__Dsn` env set on EB; `EXPO_PUBLIC_SENTRY_DSN` or `app.json` fallback set on mobile).
- [ ] Dependency scan (`npm audit`, `dotnet list package --vulnerable`) is clean. The backend build now enforces this for high/critical advisories — if it fails on `NU1903`/`NU1904`, pin the fixed version in `backend/Directory.Build.props` rather than lowering the gate.

## Boot-time security preflight

`Security/SecurityPreflight.cs` runs once at startup in every non-Development environment and reports on the configuration each protection depends on.

- **Critical:** `STRIPE_SECRET_KEY` set without `STRIPE_WEBHOOK_SECRET`. Payment webhooks now refuse unsigned events, so this isn't a hole — it silently means no job is ever marked paid.
- **Warnings:** `APP_KEY`, `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `TECH_TOKEN_KEY`, `CRM_TOKEN_ENC_KEY` unset; Twilio configured with no webhook guard. Each is degraded-but-safe — the affected gate fails closed, or state simply doesn't survive a redeploy.

By default a critical finding is logged at `Critical` and startup continues: nothing in this list risks data loss (unlike the `DATABASE_URL` check, which does abort), and taking the whole API down over a recoverable payments gap is the worse failure. Set **`SECURITY_PREFLIGHT_STRICT=true`** to turn critical findings into a refusal to start — do that once a deployment's configuration is verified good, so any later regression is caught at deploy time rather than by a customer.

Grep startup logs for `Security preflight` after any deploy that touches configuration.

## When Play Integrity blocks legitimate users

Common causes: rooted personal device, LineageOS, MicroG, work-profile oddities. The backend currently fails **open** on integrity errors (logs a warning). `PLAY_INTEGRITY_REQUIRE_MEETS_DEVICE_INTEGRITY=true` makes it fail closed. Only turn that on after you've tailed `integrity_failed` logs for a week and confirmed the population is <0.5% and trending toward known-bad signals. Otherwise you're locking out hobbyist users.

## Data deletion: how a request is actually fulfilled

Three stages, and it matters that all three exist — for a long time only the first two did, so a "verified" request sat forever and no data was ever removed.

1. `POST /api/delete-user-data` — creates a `pending_verification` row and emails a 6-digit code. The response is identical whether or not the address is known, so the endpoint can't be used to test whether someone is a customer.
2. `POST /api/confirm-deletion` — constant-time compares the code, flips the row to `verified`.
3. `Services/DataDeletionExecutionService` — a background sweep (every 15 min) that finds `verified` rows, wipes the data, and stamps `Status = 'completed'` + `CompletedAt`. That timestamp is also what `RetentionService` later uses to age out the receipt itself.

**Scope is the verified email only.** The code is delivered to the email, so email ownership is the only thing the flow proves. The phone on a request is unverified and is deliberately *not* used as a match key — otherwise anyone could pair their own address with a stranger's phone number, verify themselves, and destroy that stranger's records. The sweep matches rows by email (case-insensitively), then follows those rows to the phone numbers and device ids they contain to clean up `SmsMessages`, `MaintenanceReminders` and `PushTokens`.

Tables cleared: `HelpRequests`, `Customers`, `SmsMessages`, `MaintenanceReminders`, `PushTokens`. `BetaFeedback` and `AnalyticsEvents` are left alone — both are anonymous (no email/phone column) and carry no link back to a person.

A wipe that throws part-way leaves the row in `verified` and is retried on the next sweep; the deletes are idempotent, so a retry over already-removed rows is a no-op.

```sql
-- Pending verifications >30 min old (cruft to clean up)
SELECT "Id", "RequestId", "CreatedAt"
FROM "DataDeletionRequests"
WHERE "Status" = 'pending_verification'
  AND "VerificationCodeExpiresAt" < now();

-- Verified but not yet executed. A handful is normal (the sweep runs every
-- 15 min); anything older than an hour means the worker is wedged or throwing —
-- check logs for "Data deletion failed for requestId".
SELECT "Id", "RequestId", "VerifiedAt"
FROM "DataDeletionRequests"
WHERE "Status" = 'verified';

-- Completed, with the receipt of what was removed.
SELECT "RequestId", "VerifiedAt", "CompletedAt", "Notes"
FROM "DataDeletionRequests"
WHERE "Status" = 'completed'
ORDER BY "CompletedAt" DESC
LIMIT 50;
```

30-day SLA starts at `VerifiedAt`, per the privacy policy.
