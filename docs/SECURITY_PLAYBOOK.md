# DIYHelper2 — Security & Abuse Response Playbook

Operational runbook for security incidents, cost runaway events, and the rotation cadence for keys and pins. Keep this up to date — the point is a reader can execute steps without tribal knowledge.

## Contact

- Disclosure: bursons@gmail.com (mirrored at `/.well-known/security.txt`).
- Primary responder: Stephen.

## Defense layers (current)

| Layer | Location | Toggle |
| --- | --- | --- |
| Per-IP rate limiter (fixed window) | `Program.cs` — `AddRateLimiter` | hardcoded |
| Per-device daily AI quota | `Services/DeviceQuotaService.cs` | `DAILY_DEVICE_AI_LIMIT` env (default 60) |
| OpenAI moderation pre-check | `AI/ModerationService.cs` | on when `OPENAI_API_KEY` set |
| Prompt-injection guard | system prompts in `Program.cs` | hardcoded |
| Shared-secret app key | `Middleware/AppKeyMiddleware.cs` | `APP_KEY` / Secrets Manager |
| Play Integrity | `AI/PlayIntegrityVerifier.cs` | `PLAY_INTEGRITY_PROJECT_NUMBER` env |
| SSRF guard (outbound) | `Integrations/SsrfGuardHandler.cs` | always on |
| AI kill-switch | `FeatureFlags.AiKillSwitch` | `AI_KILL_SWITCH=true` env |
| Deletion verification | `/api/confirm-deletion` | always on |
| Cert pinning (Android) | `res/xml/network_security_config.xml` | always on in release |

## Immediate levers during an incident

### "OpenAI spend is spiking"

1. Set `AI_KILL_SWITCH=true` in Elastic Beanstalk → Configuration → Software. Takes effect within ~1 minute of the env redeploy. `/api/analyze`, `/api/ask-helper`, `/api/diagnose`, `/api/clarify`, `/api/verify-step` all return 503.
2. Check CloudWatch dashboard for top device IDs / IPs in the 429 bucket. Note offenders.
3. If traffic is from a narrow set of devices, tighten `DAILY_DEVICE_AI_LIMIT` (default 60) before re-enabling.
4. If abuse keeps coming from a rotating IP set, verify Play Integrity is active — if not, bring it online (see below).

### "Someone found a prompt-injection that leaks the system prompt"

1. Update the injection guard in the affected endpoint's `systemPrompt` in `Program.cs`.
2. Add a regression test with the offending payload.
3. Deploy. Meanwhile, temporary kill-switch is the blast-radius limiter.

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
- [ ] `/.well-known/security.txt` `Expires:` is >60 days in the future.
- [ ] Dependency scan (`npm audit`, `dotnet list package --vulnerable`) is clean.

## When Play Integrity blocks legitimate users

Common causes: rooted personal device, LineageOS, MicroG, work-profile oddities. The backend currently fails **open** on integrity errors (logs a warning). `PLAY_INTEGRITY_REQUIRE_MEETS_DEVICE_INTEGRITY=true` makes it fail closed. Only turn that on after you've tailed `integrity_failed` logs for a week and confirmed the population is <0.5% and trending toward known-bad signals. Otherwise you're locking out hobbyist users.

## Auditing deletion receipts

```sql
-- Pending verifications >30 min old (cruft to clean up)
SELECT "Id", "RequestId", "CreatedAt"
FROM "DataDeletionRequests"
WHERE "Status" = 'pending_verification'
  AND "VerificationCodeExpiresAt" < now();

-- Verified but not completed (your SLA clock is ticking)
SELECT "Id", "RequestId", "VerifiedAt"
FROM "DataDeletionRequests"
WHERE "Status" = 'verified';
```

30-day SLA starts at `VerifiedAt`, per the privacy policy.
