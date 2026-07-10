# Acme Eats — Apple 4.2.6 / 4.3 pre-submission checklist

Apple rejects white-label apps submitted from an agency account (Guideline
4.2.6) and "spam" re-skins that duplicate a sibling app (Guideline 4.3). Work
through every line before the first App Store submission of
`com.acmefoodtruck.eats`. Google Play has analogous policies (spam &
minimum-functionality) — the same checklist applies there in practice.

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Submit from the **customer's own** Apple Developer account — never the agency's. Acme Food Truck must enroll (D-U-N-S for org accounts takes days-to-weeks; start early), add the agency as Admin/Developer in App Store Connect if needed. Update `eas.json → submit` with Acme's `appleId` / `ascAppId` / `appleTeamId` (currently placeholders). | **TODO — customer** (enrollment) + **TODO — us** (eas.json submit config once credentials exist) | Customer + us |
| 2 | Globally unique bundle ID, never reused across listings. `com.acmefoodtruck.eats` is unique in this repo (`npm run brands` shows no collision with `com.diyhelper2` / `com.acme.homehelp`) and is customer-scoped, not agency-scoped. Never re-register it for another app if this listing is ever removed. | **DONE** (kit) — verify uniqueness at registration time in the customer's account | Us |
| 3 | Distinct app **name** vs sibling white-label apps: "Acme Eats" vs "DIYHelper2" / "Acme Home Helper" — distinct. | **DONE** (kit) | — |
| 4 | Distinct **icon**: `brands/acme-food-truck/icon.png` composed from the customer's own logo on `#17337a`. | **DONE** (kit) | — |
| 5 | Distinct **screenshots**: must be captured from an Acme Eats build (its colors, name, Poppins font) — do not reuse another brand's screenshots. | **TODO — us** (after first `production:acme-food-truck` build) | Us |
| 6 | Distinct **description/subtitle/keywords**: food-truck-specific copy in `store-listing.md`, not shared with any sibling listing. | **DONE** (kit) | — |
| 7 | **Customer-specific content or features documented.** A pure re-skin gets rejected under 4.3. Document what makes Acme Eats substantively Acme's: the customer's own menu/content, brand identity throughout, and any Acme-only features. ⚠️ Note: this codebase is a DIY home-repair assistant — the store copy promises ordering, order-ready notifications, and a truck map. Those features must actually exist in the shipped build, both for 4.3 and for accuracy Guideline 2.3.1. Reconcile copy vs. functionality before submitting. | **TODO — us + customer** (write the differentiation statement; verify promised features exist) | Us + customer |
| 8 | **Customer-owned privacy policy live** before submission: https://acmefoodtruck.example/privacy must resolve on the customer's domain (`.example` is a placeholder — confirm the real URL and that the page is actually live). Wired into the app via `brand.json → privacyPolicyUrl` and into both store forms. | **PARTIAL** — URL wired in kit; **TODO — customer** to host the live page | Customer |
| 9 | **Customer-owned terms URL live** before submission. `brand.json → termsUrl` is currently `null`, so the app falls back to the platform-default terms — a customer-branded app pointing at another company's terms is a rejection/confusion risk. Customer supplies the URL; we set it in `brands/acme-food-truck/brand.json` (host-managed) and re-build. | **TODO — customer** (supply URL) + **TODO — us/host** (update brand.json) | Customer + us |
| 10 | **Customer support URL / contact**: App Store Connect requires a Support URL; Play requires a support email. Must be Acme's own (e.g. acmefoodtruck.example/support), not the agency's. | **TODO — customer** | Customer |

## Summary

Satisfied by the kit today: unique bundle ID (2), distinct name (3), distinct
icon (4), distinct store copy (6), privacy URL wired in-app (8, pending the
page going live).

Blocking before submission: customer Apple Developer account (1), Acme-branded
screenshots (5), documented customer-specific functionality — including
reconciling the ordering/map feature claims with what the app actually does
(7), live privacy page (8), real terms URL (9), support contact (10).
