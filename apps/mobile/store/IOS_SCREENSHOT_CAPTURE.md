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

## 8a. What actually happened on the Mac (2026-08-12/13)

Session ran on macOS 25.5.0, Xcode 26 / iOS 26.3 runtime. **4 of 6 iPhone
screens captured and framed. Nothing uploaded to ASC. Submit for Review still
unpressed.** Two screens are blocked by product defects, not by tooling.

### Corrections to this document

1. **`pnpm filter=mobile screenshots:capture` is not valid pnpm** and fails.
   Correct form, from `apps/mobile`:
   `pnpm screenshots:capture -- --platform ios [--only <slug>]`
   (same for `screenshots:frame -- --platform iphone-6-9`). Every command block
   in §4 and the `screenshots/README.md` is wrong the same way.
2. **§4 says sign in as the demo reviewer account; §8 says never do that. §8
   wins.** Captured signed in as brick's own account
   (`programmingfiles5871@gmail.com`). The reviewer account was never touched.
3. **§5's "real status bar, not 9:41-with-nothing" misreads the 2.3.3 problem.**
   The violation was fake *content*, not the time. 9:41 is fine as long as the
   bar is complete. Run before each pass, and again after any boot:
   `xcrun simctl status_bar booted override --time 9:41 --cellularBars 4 --wifiBars 3 --batteryState charged --batteryLevel 100`
4. **NEW — `booted` is ambiguous with two simulators up.** `capture-screenshots.mjs`
   hardcodes `xcrun simctl io booted screenshot`. With both the iPhone and the
   iPad booted, simctl picks one arbitrarily; a smoke run captured the *iPad*
   and framed it into the iPhone canvas — a fresh 2.3.3 violation of exactly the
   kind the two-pass rule exists to prevent. **Boot one device at a time.**

### Setup notes

- node 22.13.0 via `fnm`, pnpm 10.30.3 via `corepack` (system default was
  node 25 / pnpm 9.15.4 and does not match `packageManager`).
- `pnpm --filter @libertasian/types build` is required — confirmed, `dist/` is
  gitignored and `main` points into it.
- The simulator already had a local Release build (`CFBundleVersion 14`,
  `main.jsbundle` embedded, no Metro needed) built from current `main`, so it
  contains #355 and #354 — the two fixes that separate build 15 from build 14.
  The number differs only because `app.json` pins `buildNumber: 14` and EAS
  autoincrements. No new build was cut.
- `app.json` `extra.apiUrl` already points at `https://libertasian.com/api/v1`,
  so no `EXPO_PUBLIC_API_URL` override was needed. Prod `/health` was 200.

### Driving the app

Deep links (`xcrun simctl openurl booted libertasian://<route>`) reach tab and
list screens but **cannot do everything**: they can't type, can't scroll, and
`study/codals` silently no-ops when the Study tab is already focused. Detail
routes need IDs that aren't knowable up front.

Taps/scrolls/typing were driven with CGEvents (`pyobjc-framework-Quartz`) after
granting **Terminal** Accessibility. Two traps worth recording:

- `CGEventKeyboardSetUnicodeString` **does not work against the Simulator** — it
  honours the virtual keycode and ignores the unicode string, so every character
  arrives as the keycode's default (`aaaaaa…`). Type with real US-layout keycodes.
- RN's controlled `TextInput` round-trips each keystroke through the JS bridge.
  At 30 ms/char, "constitution" arrived as "cnstitutiono". 120 ms/char is clean.

The device-screen rect is readable from the Simulator's AX tree (the `AXGroup`
child of window 1), which maps device pixels to screen points exactly.

### Per-screen outcome

| # | slug | status | note |
|---|---|---|---|
| 1 | `01-past-bar-exams` | **captured** | Real year browser, 2022→2008 with subject/question counts. The chevron collision from §1 is gone. |
| 2 | `02-case-digests` | **captured, substituted** | Shot the digests **list**, not the detail screen — see "Blockers" below. |
| 3 | `03-codal-reader` | **captured, with a defect** | 1987 Constitution, official-source banner, Article I. Reached via Search → "constitution", not the Codals tab. Carries a visible button-wrap collision — see below. |
| 4 | `04-ai-assistant` | **BLOCKED** | Feature errors against prod. |
| 5 | `05-camera-scan` | **captured, substituted** | Scan landing screen (Start Scan + real Recent Scans) instead of a viewfinder — the simulator has no camera, and faking one would itself be 2.3.3. |
| 6 | `06-offline-sync` | **BLOCKED** | The screen the navHint describes does not exist. |

### Blockers found (all pre-existing; none introduced here)

1. **AI answers are broken on iOS against prod.** The AI Summary tab renders
   `Request failed with status 201`, reproducibly, on every query. Root cause is
   `src/features/ai-answers/stream-ai-answer.ts:152` — the guard is
   `!response.ok || !response.body`. A 201 passes `.ok`, so the branch is taken
   because **`response.body` is undefined**: React Native's `fetch` does not
   expose a readable stream body, so the SSE reader can never attach. The error
   message then misattributes the failure to the status code. This affects the
   search AI summary and, on the same code path, the document-scoped reader
   assistant from #371. **A reviewer following the listing will hit this.**
2. **The digest detail screen renders a placeholder hero with a visible
   placeholder label.** `DigestDetailScreen.tsx:182` draws
   `<Photo … label="hero · digest" />`, and `components/ui/Photo.tsx` is an
   explicit placeholder ("Replace with real images later"). The hero is
   `position:absolute, top:0, height:320, zIndex:0`, so it never scrolls: the
   label is visible at every offset, and scrolled body text renders illegibly
   across the gradient. There is no clean frame on that screen — hence the
   substitution for screen 02.
3. **The codal reader wraps its "Listen" pill into `Liste`/`n` across long
   section headings** (visible on `ARTICLE II DECLARATION OF PRINCIPLES…`). It
   is in the captured `03` frame and is a genuine layout collision against §5.
4. **Codal section segmentation is off by one.** Every `Section N.` heading is
   paired with `Section N+1.`'s body text, and many sentences are duplicated
   verbatim. Clearly visible anywhere in Articles II–IV.
5. **`study/codals/[subject]` shows "Nothing here yet"** for Political law while
   the Codal Reader index claims 229 documents for the same subject.
6. **No sync/offline settings screen exists.** The settings list is Digests,
   Study, Feed, Workspace, Subscription, Your plan, Usage & quotas, API keys,
   Security, Notifications, Help & FAQ, Sign out, Delete account. Offline lives
   on codal cards and the reader's download control instead. Screen 06's navHint
   and caption describe a screen that was never built.
7. **`libertasian://settings` lands on the Me tab, which renders the account
   holder's full name and email.** Any screenshot of that screen ships PII.
8. Minor: the Study screen prints a literal `·` escape instead of `·`
   ("0% readiness · 0/289 topics").

### Not done

- **iPad pass not run.** No `ipad-13` frames exist. `supportsTablet: true` means
  ASC will require at least one iPad screenshot, so this is mandatory before
  submission. The app is already installed on the iPad Pro 13" (M4) simulator
  (2064×2752, genuine iPad UI confirmed, not a letterboxed phone layout).
- **Nothing uploaded to App Store Connect.** This session had no browser
  automation available and no ASC API key / fastlane on the machine.
- **The 6.9" dimension was not confirmed against ASC.** Apple's help page and
  current third-party references disagree (1260×2736 vs 1320×2868). We capture
  1320×2868 natively. **Read the accepted sizes off the 6.9" upload slot before
  uploading**; if it rejects 1320×2868, change `screenshots.config.json` to
  1290×2796 and re-run the framing step.

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
