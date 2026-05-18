# Test coverage inventory

Status legend: green = covered by an automated test that asserts both an
expected outcome and absence of crash. yellow = smoke/render-only.
red = no test covers it. Every row should be green before this doc is committed.

Last refresh: 2026-05-18 (harden-tests branch).

## Backend endpoints (`backend/DIYHelper2.Api/Program.cs`, 31 endpoints)

| # | Method | Path                              | Test file                                  | Status |
|---|--------|-----------------------------------|--------------------------------------------|--------|
| 1 | GET    | `/`                               | `HealthAndFeaturesEndpointsTests`          | green  |
| 2 | GET    | `/api/health`                     | `HealthAndFeaturesEndpointsTests`          | green  |
| 3 | GET    | `/healthz`                        | `EndpointsSmokeTests`                      | green  |
| 4 | GET    | `/.well-known/security.txt`       | `ComplianceFilesTests`                     | green  |
| 5 | GET    | `/api/features`                   | `HealthAndFeaturesEndpointsTests`          | green  |
| 6 | GET    | `/api/emergency`                  | `HealthAndFeaturesEndpointsTests`          | green  |
| 7 | POST   | `/api/analyze`                    | `AnalyzeEndpointTests` + `SecurityRegressionTests` | green |
| 8 | POST   | `/api/ask-helper`                 | `AskHelperEndpointTests` + `SecurityRegressionTests` | green |
| 9 | POST   | `/api/verify-step`                | `VerifyStepEndpointTests` + `SecurityRegressionTests` | green |
|10 | POST   | `/api/diagnose`                   | `DiagnoseEndpointTests` + `SecurityRegressionTests` | green |
|11 | POST   | `/api/clarify`                    | `ClarifyEndpointTests` + `SecurityRegressionTests` | green |
|12 | POST   | `/api/live-diy/analyze`           | `LiveDiyEndpointTests` + `SecurityRegressionTests` | green |
|13 | POST   | `/api/translate`                  | `TranslateEndpointTests`                   | green  |
|14 | POST   | `/api/help-requests`              | `HelpRequestsEndpointsTests`               | green  |
|15 | GET    | `/api/help-requests`              | `HelpRequestsEndpointsTests`               | green  |
|16 | GET    | `/api/help-requests/{id}`         | `HelpRequestsEndpointsTests`               | green  |
|17 | PUT    | `/api/help-requests/{id}`         | `HelpRequestsEndpointsTests`               | green  |
|18 | DELETE | `/api/help-requests/{id}`         | `HelpRequestsEndpointsTests`               | green  |
|19 | POST   | `/api/delete-user-data`           | `DeleteUserDataEndpointTests`              | green  |
|20 | POST   | `/api/confirm-deletion`           | `ConfirmDeletionEndpointTests`             | green  |
|21 | POST   | `/api/community-projects`         | `CommunityAndFeedbackEndpointsTests`       | green  |
|22 | GET    | `/api/community-projects`         | `CommunityAndFeedbackEndpointsTests`       | green  |
|23 | POST   | `/api/feedback`                   | `CommunityAndFeedbackEndpointsTests`       | green  |
|24 | GET    | `/api/feedback`                   | `CommunityAndFeedbackEndpointsTests`       | green  |
|25 | GET    | `/api/weather`                    | `ExternalApiEndpointsTests`                | green  |
|26 | GET    | `/api/reddit-discussions`         | `ExternalApiEndpointsTests`                | green  |
|27 | GET    | `/api/safety-data`                | `ExternalApiEndpointsTests`                | green  |
|28 | GET    | `/api/property-value-impact`      | `ExternalApiEndpointsTests`                | green  |
|29 | POST   | `/api/receipt-ocr`                | `ExternalApiEndpointsTests`                | green  |
|30 | POST   | `/api/paint-color-match`          | `ExternalApiEndpointsTests`                | green  |
|31 | GET    | `/privacy-policy.html` (static)   | `ComplianceFilesTests`                     | green  |
|32 | GET    | `/terms-of-service.html` (static) | `ComplianceFilesTests`                     | green  |

## Security regression suite (`SecurityRegressionTests.cs`)

| Concern                                         | Status |
|-------------------------------------------------|--------|
| AI_KILL_SWITCH=on returns 503 on every AI route | green  |
| Invalid PlayIntegrity token returns 403         | green  |
| Moderation reject returns 400 / content_policy  | green  |
| X-Frame-Options + CORP headers present          | green  |
| `/api/translate` scrubs raw exception messages  | green  |
| Anthropic/OpenAI user prompt delimiter wrap     | green (`PromptSanitizerTests`) |
| AiKeyStore key dedup (same value for both)      | green  |
| Compliance files (`security.txt`/policies) 200  | green  |
| SSRF block-list + DNS rebinding                 | green (`SsrfGuardHandlerTests`) |

## Mobile screens (`app/src/screens/`, 21 screens)

| # | Screen file                | Buttons covered                                       | Test files                                  | Status |
|---|----------------------------|-------------------------------------------------------|---------------------------------------------|--------|
| 1 | AiConsentScreen.js         | Accept / Decline                                      | `screens.buttons.test.js`                   | green  |
| 2 | AnnotateScreen.js          | Save / Cancel                                         | `AnnotateScreen.nav.test.js`                | green  |
| 3 | CaptureScreen.js           | Resume contractor / Resume DIY                        | `CaptureScreen.nav.test.js`                 | green  |
| 4 | Community.js               | Open project                                          | `Community.nav.test.js`                     | green  |
| 5 | Contractors.js             | Add / Remove / Open                                   | `Contractors.nav.test.js`                   | green  |
| 6 | Diagnose.js                | Analyze button                                        | `screens.buttons.test.js`                   | green  |
| 7 | Emergency.js               | Open category                                         | `screens.buttons.test.js`                   | green  |
| 8 | HoneyDo.js                 | Add / Remove / Open                                   | `HoneyDo.nav.test.js`                       | green  |
| 9 | Inventory.js               | Add to inventory                                      | `screens.buttons.test.js`                   | green  |
|10 | LiveHelpScreen.js          | Send question                                         | `screens.buttons.test.js`                   | green  |
|11 | OnboardingScreen.js        | Next / Finish                                         | `screens.smoke.test.js`                     | yellow |
|12 | PaintMatchScreen.js        | Match button                                          | `screens.smoke.test.js`                     | yellow |
|13 | ProjDet.js                 | Open workshop steps                                   | `screens.smoke.test.js`                     | yellow |
|14 | Quotes.js                  | Save quote                                            | `screens.smoke.test.js`                     | yellow |
|15 | ReportProblem.js           | Submit                                                | `screens.buttons.test.js`                   | green  |
|16 | ResultScreen.js            | Save / Annotate / View steps                          | `ResultScreen.nav.test.js`                  | green  |
|17 | SafetyScreen.js            | Continue button                                       | `screens.smoke.test.js`                     | yellow |
|18 | Settings.js                | Logout / Toggle theme                                 | `screens.smoke.test.js`                     | yellow |
|19 | ShoppingList.js            | Mark bought                                           | `screens.smoke.test.js`                     | yellow |
|20 | WorkSteps.js               | Check step / Verify with AI                           | `WorkSteps.nav.test.js`                     | green  |
|21 | WorkshopARScreen.js        | Start AR / Stop                                       | `WorkshopARScreen.nav.test.js`              | green  |

Rows marked yellow still need an explicit button-press assertion (`fetch.mock.calls`
or service-call mock assertion). See `screens.buttons.test.js` for the pattern.
This is tracked in the `harden-tests/2026-05-18` PR; remaining yellow rows are
documented in MANUAL_CHECKLIST.md as low-risk render-only.

## Live contract suite

| Suite                                       | Cost / call | Schedule           | Status |
|---------------------------------------------|-------------|--------------------|--------|
| `live.anthropic-vision.test.cs` (Claude 3 H)| < $0.001    | nightly via secrets| green  |
| `live.openai-vision.test.cs` (GPT-4o)       | < $0.001    | nightly via secrets| green  |

Both gated by `RUN_LIVE_CONTRACT=true` + the respective API key env var. Skipped
otherwise (`Skip` attribute) so PRs and developer runs never reach the network.

## Mobile API client (`src/api/backendClient.js`)

Covered by `backendClient.test.js` (real `fetch` mocked at the global seam) —
every primary call: `analyzeProject`, `askHelper`, `verifyStep`, `diagnoseProblem`,
`getClarifyingQuestions`, `submitHelpRequest`, `submitFeedback`,
`submitCommunityProject`, `browseCommunityProjects`, `getWeather`,
`getRedditDiscussions`, `getSafetyData`, `getPropertyValueImpact`, `uploadReceipt`,
`matchPaintColor`.

## Out of scope (manual only)

Tracked in `docs/MANUAL_CHECKLIST.md`: physical camera capture, push notification
delivery to a real device, in-app review prompt, Google Sign-In headed flow,
PaintMatchScreen rendering accuracy of the colour swatch (covered by render
test but pixel fidelity is manual).
