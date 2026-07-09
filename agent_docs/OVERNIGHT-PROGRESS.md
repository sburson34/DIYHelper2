# Overnight autonomous run — 2026-07-09

Branch: `feat/home-services-growth` (off `main` @ 729f9a7). All new work committed here, one commit per feature, so it's reviewable/reversible.

**Context:** Phases 1–6 of the internal ops app + customer-app Wave 1 were already committed (bundled into `729f9a7`, misleadingly messaged "feat(branding)"). Working tree was clean at start, so "commit this" was already satisfied. This run builds the growth features I recommended, then the rest of the list.

**Standing decisions:**
- External-credential integrations (Twilio, live Stripe, QBO) are built as **fail-soft seams** flagged off by env vars, mirroring the existing CRM/billing seam pattern. They no-op cleanly until keys are added. Tested for the not-configured + composition/logic paths (can't hit real providers without creds).
- Postgres-only prod, SQLite for tests (existing convention). Every feature: model → migration → endpoints → console/app as relevant → tests → verify (dotnet test + npm lint/test) → commit.
- Keeping edits in separate Program.cs / ApiFactory.cs regions from the parallel Housecall Pro CRM work.

## Thread list (priority order)
1. [DONE ✅] SMS / communication layer (Twilio seam): reminders, on-the-way texts, missed-call text-back, review-request automation
2. [DONE ✅] Field payment loop (Stripe payment links / collect on completion, deposits, invoice follow-ups)
3. [DONE ✅] Job report (HTML email) + warranty/maintenance reminders + recurring maintenance auto-scheduling
4. [ ] Tiered "Good/Better/Best" quotes
5. [ ] Service history per property/asset
6. [DONE ✅] Deeper analytics (conversion funnel, tech utilization)
7. [DONE ✅] AI quote assistant (photos+desc → suggested price-book lines)
8. [DONE ✅] AI review responder (draft replies)
9. [DONE ✅] Owner "next best action" daily digest
10. [DONE ✅] Inventory / truck stock
11. [ ] Online self-scheduling into real slots
12. [ ] Multi-property / property-manager accounts
13. [DONE ✅] Timesheets — labor hours per tech (StartedAt→CompletedAt rollup)
14. [ ] Route optimization (needs address capture first — may be partial)
15. [DONE ✅] AI dispatcher — rule-based least-loaded-tech suggestion (deterministic + explainable)

## Log
_(newest last)_

### Setup
- Confirmed prior work committed in HEAD; created branch `feat/home-services-growth`.
- Started thread 1 (SMS/communication).

### Thread 1 — SMS/communication (DONE, 249 backend tests green)
- Seam: `Integrations/Messaging/` — `ISmsSender` + fail-soft `TwilioSmsSender` (real REST, SSRF-guarded), `TwilioOptions` (env `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER`). `Services/MessagingService` composes + logs.
- `SmsMessage` table (conversation log), `Brand.SmsFromNumber` (per-brand number). Migration `AddSmsMessaging`.
- Automations wired into owner PUT status transitions: scheduled→confirm, on_the_way→"tech on the way", completed→review request. Fire only on real transitions, best-effort.
- Owner: `PUT /api/help-requests/{id}/message` (send), `GET .../messages` (log). Console: "Text customer" panel with iMessage-style bubbles on the lead detail.
- Twilio webhooks (public): `POST /api/sms/incoming` (records replies, links to lead by phone), `POST /api/sms/voice` (missed-call text-back → TwiML + auto-text). Guarded by optional `TWILIO_WEBHOOK_TOKEN` (?token=).
- **DECISION/FINDING:** external webhooks can't send `X-App-Key`, so I added `/api/sms/` to `AppKeyOptions.PublicPathPrefixes`. ⚠️ **The existing OAuth `/callback` endpoints (Jobber/QBO/Housecall) are NOT in that list** — if `APP_KEY` is set in prod, those callbacks would be rejected by AppKeyMiddleware. Left untouched (parallel-owned CRM territory) but flagging: verify whether APP_KEY is set in prod, and if so add the callback paths too.
- Tests: `SmsTests` (fail-soft manual send, status transition doesn't fail, inbound webhook records + links). 3 tests.

### Thread 2 — Field payments (DONE, 251 backend tests green)
- Extended `IPaymentProvider` with `CreateJobPaymentAsync` (Stripe Checkout, payment mode, dynamic amount) — StripePaymentProvider impl. `HelpRequest.PaidAt/AmountPaid`. Migration `AddJobPayments`.
- Owner: `PUT /api/help-requests/{id}/payment-link` (amount defaults to approved quote; optional `sendSms` texts the link). Tech: `POST /api/tech/jobs/{id}/payment-link` (collect on-site → opens Stripe URL). Console "Payment" panel (create link / create-&-text / paid badge); tech app "Collect payment" button.
- Stripe webhook `POST /api/stripe/webhook` (public, `/api/stripe/` added to AppKey exempt prefixes) → marks job paid from `metadata.jobId`. HMAC-SHA256 signature validation when `STRIPE_WEBHOOK_SECRET` set; accepts in dev when unset.
- Env: reuses `STRIPE_SECRET_KEY`; adds `STRIPE_WEBHOOK_SECRET`. Dormant until keys set.
- Tests: `PaymentTests` (link unavailable when unconfigured, webhook marks paid from metadata). 2 tests.

### Thread 3 — Job report + maintenance (DONE, 253 backend tests green)
- **Refactor:** all completion side-effects consolidated into `JobCompletionService.HandleAsync` (invoice sync + report email + maintenance scheduling + review SMS), called from BOTH the owner PUT and tech PUT on the transition into "completed". Removed the old inline `TrySyncInvoiceAsync` static helper. This means a tech completing a job now also triggers the report/review, which it didn't before.
- **Job report:** branded HTML email (before/after photos, work notes, total, signature as inline data URIs) sent once on completion (`HelpRequest.ReportSentAt`). Owner "Send/Resend job report" button + `PUT /api/help-requests/{id}/report`.
- **Maintenance:** `MaintenanceReminder` table — deliberately SEPARATE from HelpRequest because RetentionService purges help-requests at 90 days; a months-out reminder must survive. `HelpRequest.MaintenanceIntervalMonths` (owner picks None/3/6/12 in the console); on completion a reminder is scheduled. `MaintenanceReminderService` (daily BackgroundService) sweeps due+unsent reminders, emails (+texts if SMS configured), marks sent. Scan logic is a static `ProcessDueAsync` for testability.
- Migration `AddReportsAndMaintenance`. Tests: `ReportAndMaintenanceTests` (report+maintenance on completion, reminder sweep sends+marks). 2 tests.
- **DECISION:** recurring auto-scheduling implemented as reminder-nudges (email/SMS "time for your next service"), not auto-created leads. Auto-creating a full booking is a bigger commitment and needs a confirmed availability model — deferred. The nudge drives the customer back into the booking flow, which is the same outcome with less risk.

### Threads 7–9 — AI owner tools + next-actions (DONE, 256 backend tests green)
- Reuse `IAIVisionClient` + `AiWorkflow` (swapped for `FakeAi` in tests), guarded by AiKillSwitch + AiSpendGuard + key presence (no device-quota/integrity — these are owner-authed admin tools). `/api/ai` added to admin gate.
- **AI quote assistant:** `PUT /api/help-requests/{id}/suggest-quote` — job photo + description + brand price book → JSON `{lines:[...]}`. Console "✨ Suggest with AI" button in the quote builder appends suggestions for review.
- **AI review responder:** `POST /api/ai/review-response` — review text (+rating/company) → drafted reply. Console tool on Overview.
- **Next-best-action:** `GET /api/ops/next-actions` — rule-based counts (new leads, quotes to chase >2d, completed+unpaid, scheduled-no-tech, maintenance due ≤7d). "Needs your attention" chips on Overview.
- Tests: `AiOwnerToolsTests` (suggest lines, review draft, next-actions counts). 3 tests. No migration (no schema change).

### Threads 6 + 10 — Analytics + Inventory (DONE, 258 backend tests green)
- **Analytics:** extended `/api/ops/summary` with booking rate (booked/leads), completion rate, quote win rate (approved/decided), collected vs outstanding revenue, avg jobs/tech. New KPI cards on Overview. No new table.
- **Inventory:** `InventoryItem` table (name, sku, quantity, reorderAt) + full CRUD `/api/inventory` + a "low" flag when quantity ≤ reorderAt. New "Inventory" console tab with inline qty/reorder editing + LOW badge. Migration `AddInventory`.
- Tests: `InventoryTests` (low-stock flag, admin-gated). 2 tests.

### Thread 15 — Smart dispatch (DONE, 259 backend tests green)
- **DECISION:** built the dispatcher as a **rule-based** least-loaded-tech suggestion (`GET /api/help-requests/{id}/suggest-tech` → active tech with fewest open jobs), not an LLM call. Rationale: deterministic, explainable ("Aaron — 2 open jobs"), free, and testable. True skill/location-aware AI dispatch needs a skills model + geocoded addresses (see route optimization below), so this is the right first version. Console "Suggest" link in the scheduler assignee row. Test: `DispatchTests`. No migration.
