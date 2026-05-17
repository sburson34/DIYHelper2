# Secrets rotation — portfolio-wide

Cross-portfolio template for credential, key, and pin rotation. Every app in the
portfolio (DIYHelper2, PianoHelper, ScheduleHelper, DevSpendHelper, etc.)
follows this cadence. Per-app deviations belong in that app's
`docs/SECURITY_PLAYBOOK.md` — overrides should be the exception, not the rule.

## Rotation table

| Secret | Cadence | Storage | How to rotate | App-side change required? |
| --- | --- | --- | --- | --- |
| JWT signing keys | **90 days** or immediately on compromise | AWS Secrets Manager (`<app>-jwt-signing-key`) | Generate new key → write new value alongside the old as `<app>-jwt-signing-key-next` → rotate apps to validate both → cut over → delete old key after a 14-day overlap | Yes — backend reads both keys during overlap; mobile no-op |
| OpenAI API key | **90 days** or on staff change | AWS Secrets Manager (`<app>-secrets` bundle key `OPENAI_API_KEY`) | OpenAI dashboard → create new key → update Secrets Manager bundle → restart backend → revoke old key after 24h | None — backend pulls on startup |
| Anthropic API key | **90 days** or on staff change | AWS Secrets Manager (`<app>-secrets` bundle key `ANTHROPIC_API_KEY`) | Anthropic console → new key → update bundle → restart → revoke old | None |
| Google service accounts (Play Integrity, Translate, Vision) | **90 days** | JSON file on EC2 host at `/opt/<app>/google-sa.json`, referenced by `GOOGLE_APPLICATION_CREDENTIALS` | Cloud Console → IAM → service account → keys → add → download → replace on host → restart container → delete old | None |
| App-key (mobile↔backend shared secret) | **every major release** | AWS Secrets Manager (`<app>-secrets` bundle key `APP_KEY`) + build-time `EXPO_PUBLIC_APP_KEY` in mobile release env | Generate new key → write to Secrets Manager bundle → bump `EXPO_PUBLIC_APP_KEY` in `.env.production.local` → ship release → optionally schedule a sunset window during which the backend accepts both | Yes — mobile rebuild required |
| TLS certs (`api-<app>.<domain>`) | Automatic via ACM (~60 day rotation) | AWS Certificate Manager | Nothing — ACM auto-renews on the ALB. **But:** every renewal invalidates Android cert pins; see next row. | None directly |
| Android cert pins (`network_security_config.xml`) | At each TLS rotation, and **on every release that touches pins** | Checked into mobile repo | `./app/scripts/compute-cert-pins.sh api-<app>.<domain>` → take depth=0 (leaf) + depth=1 (intermediate) → put into `<pin-set>` block primary then backup → bump `expiration` to now+12mo → commit + ship | Yes — mobile rebuild required |
| RevenueCat platform keys | **180 days** | RevenueCat dashboard → project → API keys; mobile reads from `src/config/revenuecat.ts` (build-time) | RevenueCat → new platform key → swap in mobile config → ship → revoke old after store rollout | Yes — mobile rebuild required |
| Sentry DSN (mobile + backend) | **Only on compromise** | Backend: `Sentry__Dsn` env. Mobile: `EXPO_PUBLIC_SENTRY_DSN` or hardcoded fallback in `app.json` `extra.sentryDsn`. | Sentry → project settings → client keys → revoke old → take new DSN → update both | Yes — mobile rebuild for the new fallback; backend env update |
| AWS access keys (long-lived IAM users) | **90 days** — but **prefer IAM roles instead**; EB instances and EC2 hosts should use instance profiles so there are no long-lived keys to rotate | AWS IAM | If you must use long-lived keys: IAM → user → security credentials → make new key → rotate consumer → deactivate old → delete after 7 days | Depends on consumer |
| Admin auth (Basic) | **90 days** or on staff change | AWS Secrets Manager (`<app>-secrets` bundle keys `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`) | Generate new bcrypt hash → update bundle → restart | None |
| Deletion-mail SES domain identity | Reverify annually; rotate DKIM keys at SES default (auto) | AWS SES | SES auto-rotates DKIM keys; just confirm the records still resolve | None |
| GHCR PAT (used by `deploy.yml`) | **90 days** | GitHub repo secret `GHCR_PAT` | GitHub user settings → developer settings → PAT → fine-grained → `write:packages` → store as repo secret → invalidate old | None |
| EAS account token | On staff change | Expo dashboard | Revoke + reissue, paste into CI secrets | None |
| `EXPO_PUBLIC_*` env vars (non-secret config) | Per release | `app/.env.production.local` (untracked) + EAS secret store | EAS CLI: `eas secret:push` | Yes — mobile rebuild |

## Procedural rules

1. **Never commit a secret in source.** The repo holds the *name* of a secret
   (`Sentry__Dsn`, `OPENAI_API_KEY`) and reads it from env or AWS Secrets
   Manager at startup. The DIYHelper2 startup pull pattern in `Program.cs` is
   the reference — copy it to new apps.
2. **Overlap windows are mandatory for rotations that can break clients.** JWT
   signing keys and the app-key must be honored *concurrently* with their
   predecessor for at least 14 days so installs that haven't updated yet keep
   working.
3. **Log the rotation.** Every rotation gets a one-line entry in the per-app
   `docs/SECURITY_PLAYBOOK.md` "Rotation log" section: `2026-05-17: OPENAI_API_KEY rotated, old revoked 2026-05-18`. Helps the next responder know what changed.
4. **TLS + pin coupling.** ACM renews TLS automatically (~60 day cadence). The
   pins **do not** rotate automatically. The release checklist must verify
   the pins still match the live leaf + intermediate — if you ship a stale
   pin, every install hard-fails on the next ACM rotation.
5. **Prefer roles over keys.** Wherever AWS is the consumer (EC2 → SES, EC2
   → Secrets Manager, EC2 → S3) attach an instance profile. Long-lived IAM
   access keys are reserved for things that genuinely can't use roles (e.g.,
   GitHub Actions runners that haven't been migrated to OIDC).
6. **Compromise response.** When you suspect a secret is leaked, **rotate
   first, investigate second.** The 24h cost of a rotation is trivial; the
   cost of a compromised key sitting active for an extra day is not.

## Quick-reference: incident rotation

```
# 1. Rotate the leaked secret immediately.
aws secretsmanager update-secret \
  --secret-id <app>-secrets \
  --secret-string "$(jq '.OPENAI_API_KEY = "sk-new..."' < current.json)"

# 2. Bounce the backend so the new value is in the running process.
aws elasticbeanstalk restart-app-server --environment-name <app>-prod

# 3. Revoke the old key in the provider's dashboard.

# 4. Note the rotation in the per-app SECURITY_PLAYBOOK Rotation log.
```

## When to revisit this document

- A new secret enters the portfolio (new provider, new key category).
- Regulatory cadence changes (PCI, SOC2 audit, etc.) tighten a window.
- An incident reveals that a cadence row was too lax — shorten it and note the date.
- An app deviates from the table for a real reason — link the deviation from the per-app playbook back to this doc so they don't silently diverge.
