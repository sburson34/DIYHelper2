# Manual verification checklist

Surfaces that cannot be automated reliably. Run through this list once
per release candidate; record date + initials + pass/fail in the log at
the bottom.

## Mobile

- [ ] Cold launch on a real Android phone: time-to-first-pixel < 3 s.
- [ ] Cold launch on a real iPhone: time-to-first-pixel < 3 s.
- [ ] OnboardingScreen → AiConsentScreen → main drawer renders.
- [ ] CaptureScreen: launch real camera, take a photo, see preview thumb.
- [ ] CaptureScreen: pick from photo library, see preview thumb.
- [ ] CaptureScreen: hit "Analyze" with a real DIY photo; result returns
      < 30 s with a non-empty title and steps.
- [ ] ResultScreen: tap "Build" → WorkSteps; checkboxes persist on
      navigate-away-and-back.
- [ ] AnnotateScreen: draw on a photo, save, see saved annotation on
      ProjDet.
- [ ] PaintMatchScreen: take a photo of a real coloured wall; the
      dominant hex displayed matches the wall to the naked eye.
- [ ] LiveHelpScreen: grant camera permission, ask a question, hear TTS
      response.
- [ ] Diagnose: enter a real symptom ("toilet runs every 5 min");
      response includes ranked causes.
- [ ] Inventory: scan a real barcode; the item is added.
- [ ] ShoppingList: mark an item as bought; persists across app restart.
- [ ] Settings → "Send feedback" → ReportProblem submit → confirm by
      checking backend `/api/feedback` for the entry.
- [ ] Settings → "Delete my data" → enter email → receive the 6-digit
      code email → confirm the request flips to `verified` in the admin
      view.
- [ ] Push notifications: trigger a reminder via in-app workshop step;
      receive the notification on the lock screen.
- [ ] Sign-in: Google OAuth (if applicable) completes and returns to the
      app with the user populated.
- [ ] Theme toggle: light/dark works on every screen.
- [ ] Language toggle: en → es switches every visible label.

## Backend

- [ ] /healthz returns 200 on the deployed instance.
- [ ] /privacy-policy.html and /terms-of-service.html load in a browser
      at the production URL.
- [ ] /.well-known/security.txt is reachable on the production URL.
- [ ] Sentry receives a synthetic error from the deployed backend after
      a forced exception (e.g. via the staging-only `/debug/throw` route
      if present, or by sending a malformed request that trips the
      handler).
- [ ] OpenAI vision call from a real device completes < 30 s end-to-end.
- [ ] Anthropic vision call (with AI_PROVIDER=anthropic) completes
      < 30 s end-to-end.
- [ ] AI_KILL_SWITCH=true → mobile app shows the friendly "AI
      temporarily unavailable" banner (verify via a test deployment
      with the flag flipped).
- [ ] Per-IP rate limit fires after 20 /api/analyze calls/min from the
      same client; client sees 429.

## Live contract (run after `nightly.yml` `live-contract` job)

- [ ] OpenAi live test passed (or skipped with a clear reason).
- [ ] Anthropic live test passed (or skipped with a clear reason).
- [ ] No unexpected charge spikes in OpenAI / Anthropic dashboards
      (per-run cost should be < $0.001).

## App-store readiness

- [ ] `docs/app-store-listing.md` copy reviewed.
- [ ] `docs/store-screenshots-plan.md` screenshots refreshed against
      the latest build.
- [ ] `PrivacyInfo.xcprivacy` matches actual data collection.
- [ ] All 5 CI workflows green on main for the build being submitted.

## Verification log

| Date       | Initials | Build / SHA | Result | Notes                          |
|------------|----------|-------------|--------|--------------------------------|
| (template) | xx       | abc1234     | pass   | first dry run of this checklist |
