# LIBERTASIAN Mobile — Store Submission Runbook

End-to-end ordered runbook for shipping `apps/mobile` (bundle id `com.libertasian.app`) to **App Store / TestFlight** and **Play Store / closed (`alpha`) track**. Walk it top-to-bottom on the first submission. Nothing here is required for the current **preview** smoke build — these steps gate the **production** profile.

The work splits into two lanes:

- **Lane A (manual, out of repo):** account creation, credentials, store-asset uploads, demo reviewer account. Cannot be automated from CI without secrets.
- **Lane B (in repo):** `app.json`, `eas.json`, `store.config.json`, `store/PLAY_LISTING.md`, `store/DATA_SAFETY.md`. Already in place — Lane A unblocks the actual submit.

> **🛑 Safety rule (read before any submit command):**
> **Never pass `--track production` (Play) or skip TestFlight (Apple) until the build has been tested on a testing track / TestFlight by a human.** Submissions go to the **closed `alpha` track** (Play) or to TestFlight internal testing (Apple). Promote to production only after smoke-testing the actual signed binary on a real device.

---

## 1. Lane A prerequisites — gather these before any submission PR

### 1.1 Apple — Developer Program account

- Active **Apple Developer Program** membership (USD 99/year).
- Apple ID email used to sign in to App Store Connect (this becomes `appleId` in `eas.json`).
- **Apple Team ID** — 10-character alphanumeric, e.g. `AB12CD34EF`. Find at [developer.apple.com](https://developer.apple.com) → Account → Membership details. This becomes `appleTeamId` in `eas.json`.
- App-specific password (only if running `eas submit` manually outside of EAS-managed credentials) — generate at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords. EAS prompts for it on first submit.

> **✅ Done:** enrollment is complete (Team ID `V2W2BY5P8D`) and `apps/web/public/.well-known/apple-app-site-association` carries the real Team ID. Universal Links (`https://libertasian.com/shared/*`) start working once the web app is redeployed and Apple's CDN fetches the file.

### 1.2 Apple — register the app

Order matters: register in ASC first, then run any EAS submit/metadata command.

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → My Apps → **+** → New App.
2. Bundle ID: `com.libertasian.app`. Platform: iOS (+ iPadOS).
3. Primary language: English (U.S.).
4. SKU: any internal slug (e.g. `libertasian-ios-001`).
5. After creation, the **Apple ID** (numeric, e.g. `1234567890`) appears in the app's **App Information** page. This becomes `ascAppId` in `eas.json`.

> **✅ Done:** the ASC app was created by the first `eas submit` run (2026-07-08) rather than by hand — `ascAppId` is `6788971669`, already wired into `eas.json`. First build submitted to TestFlight the same day.

### 1.3 Apple — review test account (MFA disabled)

App Store reviewers must be able to sign in without TOTP/SMS friction.

- Create a dedicated reviewer account in production: email `appstore-review@libertasian.com` (or similar).
- **Disable MFA on this account** specifically. `/CLAUDE.md` § Security mandates MFA for admin/editor/reviewer roles — the reviewer account must therefore be on a plain user role with MFA optional or off.
- Seed the account with realistic, non-PII data so reviewers see the real product (a few digests, a few bookmarks, one fake matter).
- Hand the credentials to the human running the first submit; **do not commit them** to `store.config.json` or anywhere else in the repo.
- In App Store Connect → App Privacy / App Review Information, enter `demoUsername`, `demoPassword`, and reviewer contact name/email/phone in the **App Review Information** block at submission time (or, optionally, by hand in a non-committed copy of `store.config.json` under `apple.review`).

### 1.4 Apple — distribution credentials

EAS can manage iOS certs + provisioning profiles automatically. On first `eas build --platform ios`, accept "Let EAS handle credentials." If you bring your own:

- iOS distribution certificate (.p12).
- App Store provisioning profile for `com.libertasian.app`.
- AuthKey .p8 for App Store Connect API key (saved at `apps/mobile/AuthKey_*.p8`, **gitignored**).

### 1.5 Google — Play Developer account

- One-time USD 25 fee at [Play Console](https://play.google.com/console).
- Personal accounts created **after 13 Nov 2023** are subject to the **12-tester / 14-day closed-test rule** before production access is granted (see § 6.3). Organization accounts are exempt.

### 1.6 Google — Play Console app

1. Play Console → Create app.
2. App name: `LIBERTASIAN`. Default language: English (United States).
3. App or game: App. Free or paid: Free (in-app purchases handled separately).
4. Declarations: Developer Program Policies, US export laws — accept.
5. **Package name: `com.libertasian.app`** (must match `app.json` → `android.package`).

### 1.7 Google — Play service account JSON (for `eas submit`)

1. Play Console → Setup → API access → "Create new service account" → link to Google Cloud Console → IAM & Admin → Service Accounts → Keys → Add Key → JSON. Download.
2. Save as `apps/mobile/play-service-account.json` (matches `submit.production.android.serviceAccountKeyPath` in `eas.json`; gitignored — verify with `git check-ignore apps/mobile/play-service-account.json`).
3. Back in Play Console → grant the service account **Release manager** role on the LIBERTASIAN app.

> **Not to be confused with** `apps/mobile/google-services.json` — that file is the Firebase **client** config for FCM push (public identifiers, safe to commit, referenced by `app.json`). The Play service-account key above is a real secret and never gets committed.

### 1.8 Branded icons + splash

Currently `apps/mobile/assets/` ships the default Expo "E" icons. Replace before first store-track submission:

| Asset | Required size | Notes |
|---|---|---|
| `icon.png` | **1024×1024** PNG, **no alpha**, no pre-rounded corners | Apple rejects icons with an alpha channel. **No-alpha** requirement is non-negotiable. |
| `adaptive-icon.png` | **1024×1024** PNG with transparent background | Android adaptive icon foreground. Keep logo within inner ~66% safe zone. |
| `splash-icon.png` | **1024×1024** square PNG | Expo SDK 52 splash (`resizeMode: contain`). |

These do **not** block preview builds — Expo defaults still produce a working APK.

### 1.9 Store screenshots + graphics (uploaded directly in store consoles)

Do not commit binary assets. Required sizes:

- **App Store**: 6.7" iPhone, 6.5" iPhone, 12.9" iPad screenshots; up to 10 each.
- **Play Store**: 512×512 app icon (no alpha), 1024×500 feature graphic, ≥ 2 phone screenshots; 7" + 10" tablet screenshots recommended.

---

## 2. Wire credentials into `eas.json`

`apps/mobile/eas.json` already has the structure with `YOUR_*` placeholders under `submit.production.ios` and a `serviceAccountKeyPath` under `submit.production.android`. Replace by hand at submission time:

```jsonc
"ios": {
  "appleId": "<the Apple ID email from § 1.1>",
  "ascAppId": "<the numeric App Store Connect Apple ID from § 1.2>",
  "appleTeamId": "<the 10-char team id from § 1.1>"
}
```

`submit.production.android.serviceAccountKeyPath` → `./play-service-account.json` is already wired. Drop the file from § 1.7 in place.

`submit.production.android.track` is set to `"alpha"` — **leave it on `alpha`**, Play's default **Closed testing** track. Closed testing is what feeds the 12-tester / 14-day production-access rule (§ 5.3); **`internal` does NOT count toward it**, so an internal-track submit silently burns days without advancing the clock. Promotion to `production` happens later from the Play Console UI (see § 5.4 safety rule).

---

## 3. Build the production binaries

From repo root:

```bash
pnpm install
eas login
eas build --profile production --platform all
```

What this does:

- Reads `apps/mobile/eas.json` → `build.production` (autoIncrement on, pinned `node 22.13.0` / `pnpm 10.30.3`, `API_URL=https://libertasian.com/api/v1`).
- Produces a signed **.aab** for Android and a signed **.ipa** for iOS in EAS' build infrastructure.
- Bumps `buildNumber` (iOS) and `versionCode` (Android) automatically.

When the build finishes, EAS prints download URLs and assigns each build an ID. Note both IDs.

---

## 4. Apple — TestFlight first, never straight to App Store

### 4.1 Submit to TestFlight

```bash
eas submit --profile production --platform ios
```

EAS uploads the .ipa to App Store Connect. Processing takes 5–30 minutes. Once Apple finishes encoding, the build appears in App Store Connect → TestFlight.

### 4.2 TestFlight — internal testing

- App Store Connect → TestFlight → **Internal Testing** → add your dev team (up to 100 internal testers, no Beta App Review needed).
- Internal testers receive an email + the TestFlight app shows the build immediately.
- **Smoke-test on at least one real iPhone and one iPad.** Verify sign-in (using the reviewer account from § 1.3 once), camera scan flow, codal reader, and AI answer flow.

### 4.3 TestFlight — external testing

- TestFlight → External Testing → create a new group (e.g. "Beta — Bar Reviewees").
- Add testers by email (up to 10,000) or generate a public link.
- **First external build requires Beta App Review** (~24–48 hrs). Provide reviewer the demo account from § 1.3 and a one-paragraph "what's new" note.
- Once approved, the same group rolls forward to the next builds without re-review unless you change major functionality.

### 4.4 Push App Store metadata (en-US listing + advisory + categories)

```bash
eas metadata push
```

Reads `apps/mobile/store.config.json`. Pushes en-US title, subtitle, description, keywords, release notes, marketing/support/privacy URLs, categories (REFERENCE + EDUCATION), and the age-rating advisory.

> The first `eas metadata push` requires the app to already exist in ASC (§ 1.2) and credentials to be in place (§ 2). Without those, the command errors out before touching ASC.

The reviewer contact + demo account (`apple.review` block) is **not** in `store.config.json` to keep credentials out of git. Add by hand in App Store Connect → App Information → App Review Information at submission time, **or** add a local-only `apple.review` block to a non-committed copy of `store.config.json` and push from there.

### 4.5 Submit for App Store review

- App Store Connect → App Store → **+ Version or Platform** (or pick the TestFlight build) → Save → Submit for Review.
- Apple review SLA: typically 24–48 hrs, occasionally longer.
- After approval, release behaviour is governed by `apple.release.automaticRelease` in `store.config.json` (currently **`false`** — manual release after approval, with `phasedRelease: true` to roll out over 7 days).

---

## 5. Google — Play closed (`alpha`) track

### 5.1 First AAB upload **must** be manual

Play Console will not accept `eas submit --platform android` until at least one AAB has been uploaded by hand to a testing track. This is a one-time Play platform bootstrap constraint, not an EAS one — and it is the **only** step in this runbook that touches the internal track. Every ongoing submit targets the closed `alpha` track (§ 5.2).

1. Download the `.aab` artifact from the EAS build in § 3.
2. Play Console → LIBERTASIAN → Test and release → **Testing → Internal testing** → Create new release → upload the .aab → fill release notes → Review release → Roll out to internal.
3. Add internal testers via an email list or Google group on the same screen.

After this first manual release, subsequent uploads go through EAS.

### 5.2 Subsequent submits via EAS

```bash
eas submit --profile production --platform android
```

Reads `apps/mobile/eas.json` → `submit.production.android`. Uses the service-account JSON from § 1.7 to upload the .aab and push it to the **closed** track (per `track: "alpha"` in `eas.json` — `alpha` is Play's default Closed testing track). This must not be `internal`: internal-track releases do not count toward the 12-tester rule in § 5.3.

### 5.3 12-tester / 14-day closed-test rule (personal accounts only)

If your Play Developer account was created **after 13 Nov 2023** as a personal account, Play requires:

- A **Closed testing** track release (separate from Internal testing) with **at least 12 testers opted in** continuously for **14 days** before you can apply for production access.
- `eas submit` now lands releases directly on the closed track (`alpha`), so no promotion step is needed. If a build predates that change and sits on internal, promote it: Play Console → Testing → Closed testing → create track → promote release.
- Track tester opt-ins from Play Console → Testing → Closed testing → Manage testers. **The requirement is ≥ 12 testers opted in _continuously_ for a 14-day window — a rolling check across the whole track, not a per-tester clock and not a cumulative count.** If the opted-in count drops below 12 at any point, the window restarts from zero. Uninstalling the app does **not** break opt-in; opting out does.
- **Pushing new versions to the closed track during the window does _not_ reset the clock.** Ship fixes freely while it runs.
- The production-access application itself asks how you recruited your testers and what feedback you acted on — keep notes as you go rather than reconstructing them at the end.
- After ≥ 14 days with ≥ 12 testers, Play Console surfaces an **"Apply for production access"** button.

Organization accounts are exempt from this rule — they can promote to production directly from internal.

### 5.4 Promote to production — **only after the safety rule is satisfied**

> 🛑 **Never promote a release to production until a human has installed and exercised the signed binary on a real device from the internal or closed track.** This is the single most common cause of broken store releases — preview builds and production builds differ in signing, env, and minification, and a clean preview does not guarantee a clean prod.

Promotion from the Play Console UI:

- Testing → Internal (or Closed) testing → pick the release → Promote release → Production → fill production release notes → Review release → Start rollout to production.
- Use staged rollout (5% → 20% → 100%) for the first production release.

---

## 6. Per-release ritual (every subsequent version)

1. Bump nothing by hand — `autoIncrement: true` handles iOS `buildNumber` and Android `versionCode`.
2. Bump `app.json` → `expo.version` if the user-visible version string changes (e.g. `1.0.0` → `1.1.0`).
3. Update `releaseNotes` in `store.config.json` (iOS) and the "What's new" block in `store/PLAY_LISTING.md` (Android).
4. Update `store/DATA_SAFETY.md` **if** any data collection changed.
5. `eas build --profile production --platform all`.
6. `eas submit --profile production --platform ios` → TestFlight → internal smoke → external review → App Store submit.
7. `eas submit --profile production --platform android` → Play closed (`alpha`) track → smoke → promote.
8. `eas metadata push` if any field in `store.config.json` changed.
9. Paste Play Console fields from `store/PLAY_LISTING.md` if any field there changed.

---

## 7. Reference — what lives where

| Concern | File | Notes |
|---|---|---|
| Expo app config (bundle id, plugins, permissions copy) | `apps/mobile/app.json` | `com.libertasian.app` on both platforms |
| EAS build + submit profiles | `apps/mobile/eas.json` | JSONC; `YOUR_*` placeholders under `submit.production.ios` filled at submission time |
| Apple metadata (en-US + advisory + categories + release) | `apps/mobile/store.config.json` | JSONC; pushed by `eas metadata push` |
| Play listing copy | `apps/mobile/store/PLAY_LISTING.md` | Paste-ready, manually mirrored into Play Console |
| Apple + Play data-collection answers | `apps/mobile/store/DATA_SAFETY.md` | Source of truth for App Privacy + Data Safety forms |
| Privacy Policy (live) | https://libertasian.com/privacy | Source: `apps/web/src/app/(public)/privacy/page.tsx` |
| Terms of Service (live) | https://libertasian.com/terms | Source: `apps/web/src/app/(public)/terms/page.tsx` |
| Secrets never committed | `apps/mobile/play-service-account.json`, `apps/mobile/AuthKey_*.p8`, `*.keystore`, `*.jks`, `*.p12`, `*.mobileprovision` | Enforced via root `.gitignore`. (`google-services.json` is Firebase client config — committed, not a secret.) |
