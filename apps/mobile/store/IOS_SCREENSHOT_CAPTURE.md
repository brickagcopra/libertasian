# iOS App Store screenshots — capture handoff (run this on a Mac)

> Written 2026-08-08 from a Windows session that took the 1.0 submission to
> "Ready for Review" and then could not finish one step. Everything else is
> done. **This document is the whole remaining task.**

---

## TL;DR

The screenshots currently uploaded to App Store Connect are **designed
mockups, not captures of the running app**. That is App Store Review
Guideline 2.3.3 and it is the single most likely rejection cause on this
submission. They must be replaced with real device captures before anyone
presses **Submit for Review**.

The capture step needs `xcrun simctl`, which is macOS-only. That is why this
is being handed to a Mac.

Nothing else is outstanding. Build 15 is attached, the listing is populated,
App Privacy is published, age rating / content rights / pricing / availability
/ review info are all set and verified. **Do not press Submit for Review**
until the screenshots are replaced — and then only on brick's explicit say-so.

---

## 1. Why the current screenshots fail 2.3.3

Apple: *"Screenshots should show the app in use."*

The images live in `apps/mobile/assets/store/screenshots/marketing/` and were
uploaded to ASC on 2026-08-07. The evidence they are mockups:

| Evidence | Detail |
|---|---|
| The documented pipeline never ran | `screenshots/README.md` specifies `raw/` → `framed/`. **Both are empty** — `raw/` holds only `.gitkeep`, `framed/` is empty. |
| `marketing/` is undocumented | It appears nowhere in `screenshots/README.md`. It is a separate set of unknown provenance. |
| Placeholder content | `02-case-digests` renders the FACTS body as **grey skeleton bars** instead of digest text. |
| Mockup status bar | Every frame shows **9:41** with no carrier, wifi or battery — Apple's canonical marketing time. |
| Layout artefacts | In `01-past-bar-exams`, row text collides with the chevrons on "Remedial Law" and "Criminal Law". |

The repo's own README already warned against exactly this: *"Do not commit
screenshots that show real PII, debug overlays, or in-progress placeholder
data."*

The same provenance problem applies to `marketing/android-*` when Play is
submitted. Out of scope here, but do not reuse them either.

---

## 2. What is already done (do not redo)

Verified directly in App Store Connect on 2026-08-08 after the build swap.

| Item | State |
|---|---|
| App | LIBERTASIAN, ASC app id `6788971669`, bundle `com.libertasian.app`, team `V2W2BY5P8D` |
| Version | 1.0, state **Ready for Review** |
| Build attached | **15** (`1.0.0`), built from `main` @ `bd8d669` |
| Draft submission | 1 item — `iOS App 1.0`, build `1.0.0 (15)` |
| **Submit for Review** | **NOT pressed** |
| Listing | description, keywords (89/100), promo text, copyright, release notes — all pushed via `eas metadata:push` |
| Categories | Reference / Education |
| App Privacy | **Published**, 12 data types, all "Linked to you", none used for tracking, Payment Info deliberately omitted |
| Age rating | Calculated 13+, **overridden to 18+** (173 regions; A18 Brazil, 19+ Korea) |
| Content Rights | "Yes, this app has the necessary rights to its third-party content" |
| Price | Free — $0.00 across all 175 storefronts |
| Availability | **Philippines only** (1 available / 174 not) |
| Support URL | `https://libertasian.com/contact` |
| Review sign-in | `brickagcopra5871+test@gmail.com` + password saved, MFA disabled |
| Review contact | Brick Demanuel Agcopra / +13472676406 / bma5871@gmail.com |
| Release | Manual release + 7-day phased release |
| Export compliance | Resolved in-binary; build 15 reads "Ready to Submit", no Missing Compliance |
| DSA trader info | **Deliberately unset** — EU storefronts excluded, revisit before EU launch |

### Build 15 vs build 14

Build 14 was swapped out because it predated two fixes:

- **#355** (`a0e6592`) — the floating pill nav vanished on Study, Feed,
  Workspace and Library, and reachable destinations varied by which screen you
  stood on. Directly relevant here: a reviewer following the "Settings →
  Delete account" instruction in the review notes could have had a bad time.
- **#354** (`7ecb165`) — mobile case-digest search.

Build 15 was smoke-tested on device and passed.

---

## 3. Why this could not be finished on Windows

`apps/mobile/scripts/capture-screenshots.mjs`, iOS branch:

```js
spawn('xcrun', ['simctl', 'io', 'booted', 'screenshot', outPath]);
```

guarded by:

```js
if (args.platform === 'ios' && !which('xcrun')) { /* exit */ }
```

The Windows box reports `MINGW64_NT-10.0-26200` and `which xcrun` → not found.
The iOS Simulator is macOS-only; there is no Windows path to it.

Android tooling *was* present (`adb` on the Android SDK path) and that branch
runs fine — but Android frames cannot be uploaded as iPhone screenshots, and
Expo-web renders are not the native UI. Both would repeat the misrepresentation
being fixed. **Do not substitute either.**

---

## 4. What to run on the Mac

### Prerequisites

- Xcode + command-line tools (`xcrun simctl list devices` works)
- `pnpm install` at the repo root
- A dev build of LIBERTASIAN installed on the booted simulator
- Signed in as the **demo reviewer account** so every screen has real content:
  `brickagcopra5871+test@gmail.com` (ask brick for the password; it is also in
  ASC → App Review Information, stored in plaintext there)

### ⚠️ The two-pass gotcha — read before running

`frame-screenshots.mjs` maps **all four Apple platforms from the same
`raw/<slug>.ios.png`**:

```
apple platforms (iphone-6-7, iphone-6-9, ipad-12-9, ipad-13) → raw/<slug>.ios.png
play  platforms (android-*)                                  → raw/<slug>.android.png
```

Run it once from an iPhone capture and the **iPad frames will contain a
letterboxed iPhone screenshot** — a fresh 2.3.3 problem, because iPad
screenshots must show the iPad UI. You must capture twice and frame in between,
because the second capture overwrites `raw/<slug>.ios.png`.

### Pass 1 — iPhone

```bash
# Boot an iPhone 16 Pro Max (1320×2868) or 15/14 Pro Max (1290×2796).
# The 6.9" ASC slot accepts either.
xcrun simctl list devices booted

cd apps/mobile
pnpm filter=mobile screenshots:capture -- --platform ios
# The script prints each screen's navHint and waits for Enter.
# Navigate the app to that screen, then press Enter.

pnpm filter=mobile screenshots:frame -- --platform iphone-6-9
pnpm filter=mobile screenshots:frame -- --platform iphone-6-7   # optional

# Preserve the iPhone raws before pass 2 overwrites them:
mkdir -p /tmp/raw-iphone && cp assets/store/screenshots/raw/*.ios.png /tmp/raw-iphone/
```

### Pass 2 — iPad

```bash
# Boot an iPad Pro 13" (2064×2752) or 12.9" (2048×2732). Slot accepts either.
pnpm filter=mobile screenshots:capture -- --platform ios

pnpm filter=mobile screenshots:frame -- --platform ipad-13
pnpm filter=mobile screenshots:frame -- --platform ipad-12-9    # optional
```

Output lands in `assets/store/screenshots/framed/<platform>/<slug>.png` at the
platform's exact pixel size.

### The six screens (order matters)

From `assets/store/screenshots.config.json`. **Only the first 3 appear on App
Store install sheets**, so the order is not cosmetic.

| # | slug | navHint |
|---|---|---|
| 1 | `01-past-bar-exams` | Bar Exams tab → year/subject browser |
| 2 | `02-case-digests` | Open a case digest → scroll to facts |
| 3 | `03-codal-reader` | Codals tab → 1987 Constitution, Article III |
| 4 | `04-ai-assistant` | AI chat → send a query, wait for the cited answer |
| 5 | `05-camera-scan` | Camera scanner → frame a sample printout |
| 6 | `06-offline-sync` | Settings → Sync (last-synced + offline toggle) |

---

## 5. Acceptance criteria — check before uploading

Compare against the failures in §1. Each framed image must show:

- [ ] **Real content, not skeleton bars.** If a screen is still loading, wait.
- [ ] **A real status bar** — actual time, carrier/wifi, battery. Not 9:41-with-nothing.
- [ ] **No layout collisions** (the chevron overlap in the old `01`).
- [ ] **No PII, no debug overlays, no placeholder/lorem data.**
- [ ] Exact dimensions: iPhone 6.9" = **1320×2868** or **1290×2796**;
      iPad 13" = **2064×2752** or **2048×2732**.
- [ ] iPad frames genuinely show **iPad UI**, not a letterboxed phone shot.

---

## 6. Uploading to App Store Connect

The framing step is platform-agnostic (`sharp`), so if you'd rather hand the
raws back to a Windows session for framing + upload, that works — push `raw/`
and say so.

To upload from the Mac:

1. ASC → LIBERTASIAN → Distribution → iOS App 1.0 → **Previews and Screenshots**.
2. The version is currently **Ready for Review**. Metadata fields were still
   editable in that state, but if the screenshot slots are locked: open the
   **Draft Submissions (1)** panel, hover the `iOS App 1.0` row, click the red
   **−** to remove it, then reload. The version drops to "Prepare for
   Submission" and everything unlocks. **Re-add for review afterwards.**
3. Media Manager → iPhone tab → expand **6.9" Display** → upload 6 files.
4. Media Manager → iPad tab → **13" Display** → upload 6 files.

**Upload one file at a time, in filename order, waiting for each to finish.**
Uploading all six at once orders them by upload-completion, not filename — this
happened on 2026-08-07 and the set came out scrambled (AI Assistant first, Past
Bar Exams last) and had to be deleted and redone.

Then delete the old mockup set from both slots if it is still present.

---

## 7. After upload — re-verify, do not assume

Swapping a build silently resets things. After re-adding for review, confirm
each of these individually:

- [ ] Screenshots: 6 in iPhone 6.9", 6 in iPad 13", filename order
- [ ] Build still **15**
- [ ] App Privacy still **Published**
- [ ] Age rating still **18+** (override intact)
- [ ] Content Rights still set
- [ ] Price still Free, availability still Philippines-only
- [ ] Review info: sign-in username + password, contact fields, notes
- [ ] **Manually release this version** selected
- [ ] **Release update over 7-day period using phased release** selected
- [ ] Support URL still `https://libertasian.com/contact`

Pressing **Add for Review** runs Apple's server-side validation and is the
cheapest way to surface anything missing. It is reversible. It caught a missing
price tier on 2026-08-07 that was invisible from every ASC page.

---

## 8. Do not

- **Do not press Submit for Review** without brick's explicit go-ahead.
- **Do not cut a new build.** Build 15 is what is being submitted. Attaching a
  different build means removing the item from the draft submission and
  re-validating.
- **Do not sign in as, or delete, `brickagcopra5871+test@gmail.com`.** It
  carries a comp Pro subscription (row `6741e44f`) that reviewers depend on.
- **Do not upload Android captures or Expo-web renders** into the Apple slots.
- **Do not enable the ad system.** `apps/mobile/src/features/ads/` exists but
  nothing outside that directory imports it, so it is dead code in build 15 —
  which is what makes the age-rating "Advertising = No" answer and the "no
  Advertising Data" App Privacy declaration true. Wiring it in makes both false
  and they must be updated in the same release. There is no `expo-updates`, so
  it cannot be switched on without a new review.

---

## 9. Related open PRs

- **#366** `fix/store-config-eas-metadata-push` — 2 commits. `store.config.json`
  could never be pushed as committed (missing `apple.version`, keywords as a
  string, keywords 104/100 chars, legacy `advisory` block) plus the supportUrl
  fix. Independent of the screenshot work.
- **This branch** `docs/ios-screenshot-capture-handoff` — this document.

## 10. Also worth knowing

- **Phased release does nothing for 1.0.** It governs updates to users with
  auto-update on. A first release has no install base, so on Release the app
  goes live to everyone in the PH storefront at once. It matters from 1.1.
- **The ASC review password is stored in plaintext** and visible on the version
  page. Mind screen shares.
- The comment-stripping "CI JSON-validity check" referenced in
  `store.config.json`'s header **does not exist** — `grep -rn "store.config"
  .github/` returns nothing. Flagged in #366 as a follow-up.
