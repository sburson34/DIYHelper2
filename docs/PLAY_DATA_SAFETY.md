# Play Console — Data Safety form answers

Reference for filling out the Google Play Console "Data safety" section. Keep this in sync with what the app actually does; Google spot-audits against live traffic.

Last reviewed: 2026-04-23

## 1. Data collection & sharing overview

- **Does your app collect or share any required user data?** Yes.
- **Is all user data collected encrypted in transit?** Yes (HTTPS to `api.diyhelper.org`, TLS 1.2+ enforced by the ALB).
- **Do you provide a way for users to request data be deleted?** Yes — in-app "Delete my data" flow (`/api/delete-user-data` + `/api/confirm-deletion`). 30-day SLA stated in the privacy policy.

## 2. Data types — declare these

### Personal info
| Type | Collected | Shared | Purpose | Required/Optional |
| --- | --- | --- | --- | --- |
| Name | Yes | No | Account management, Customer support (populates the contractor help-request form) | Optional |
| Email address | Yes | No | Account management, Customer support | Optional |
| Phone number | Yes | No | Customer support (shared only with the human contractor the user explicitly contacts) | Optional |

### Location
| Type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Approximate location (ZIP code, if user enters it) | Yes | No | App functionality (permit lookup, local weather) — user-supplied text input, not geolocation APIs |

### Photos and videos
| Type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Photos | Yes | **Yes — with OpenAI for AI analysis** | App functionality (project analysis). Images sent base64 to our backend, forwarded to OpenAI GPT-4o. |
| Videos | No | — | Captured locally but **not sent to any server** (vision API doesn't accept video). |

### Audio
| Type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Voice recordings | No | — | Speech recognition runs on-device via `expo-speech-recognition`. Audio never leaves the device. |

### Files and docs
- Not collected.

### App activity
| Type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| App interactions (crash breadcrumbs) | Yes | Yes — Sentry | Analytics, Crash reporting, Performance monitoring. PII-scrubbed via `src/services/sentry.ts` `beforeSend`. |
| Other user-generated content (project descriptions, step notes) | Yes | **Yes — OpenAI** | App functionality — the user's typed project description is sent to the AI. |

### App info & performance
| Type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Crash logs | Yes | Yes — Sentry | Crash reporting |
| Diagnostics | Yes | Yes — Sentry | Performance monitoring |

### Device or other IDs
| Type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Device or other IDs | Yes | No | Security — app-generated install UUID (`@device_id`) used by the backend's per-device daily AI quota. Reset whenever the user clears app data. Not Advertising ID. |

## 3. Security practices

Answer yes to these:

- Data is encrypted in transit (HTTPS + TLS 1.2+, cert pinning in release builds).
- Users can request that their data be deleted (in-app flow + 30-day SLA).
- Data collection aligns with the Play Families Policy (not a children's app; content is DIY home repair).
- Independent security review: no (self-reviewed). If/when you engage a pentester, flip this to yes and keep the report handy.

## 4. Privacy-policy URL

Link: https://api.diyhelper.org/privacy-policy.html (served from the backend `wwwroot/`). Update the file when any answer above changes.

## 5. Third-party processors to declare

These receive user data and must be mentioned in the privacy policy:

- **OpenAI** (`api.openai.com`) — receives project descriptions + base64 photos for GPT-4o analysis. Terms require OpenAI not to train on API data.
- **Anthropic** (`api.anthropic.com`) — fallback AI provider; same category of data.
- **Sentry** (`sentry.io`) — scrubbed crash/breadcrumb data. No PII per the scrubbing rules in `src/services/sentry.ts`.
- **Google Translate** (`translation.googleapis.com`) — UI strings only (no user content).
- **AWS** (hosting) — processor relationship, not a separate data sharing.

## 6. Answers that commonly trip reviewers

- **"Is any of the collected data required for the app to function?"** Only the device ID; everything else is optional. The mobile app works (UI-only) without a profile, ZIP, photos, etc.
- **"Does your app share data with third parties for advertising?"** No — there are no ad SDKs.
- **"Does your app sell or transfer data to data brokers?"** No.
- **"Does your app process sensitive data (health, precise location, financial, etc.)?"** No precise location, no health data, no financial account data. Affiliate links go out to Amazon / Home Depot, but we do not collect or process payment info — they handle checkout end-to-end.

## 7. When to re-review

Revisit this document whenever:
- A new third-party processor is added (new AI provider, new telemetry, new OCR vendor).
- A new kind of user input is collected (new screen that asks for different PII).
- The privacy policy is updated.
- A major Android/Play policy change hits (Google ships Data Safety updates roughly twice a year).
