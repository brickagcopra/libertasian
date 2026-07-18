# LIBERTASIAN — App Store & Google Play Submission Guide

Status snapshot written 2026-07-17. This guide records what has been completed and gives the exact remaining steps to finish both store submissions.

Package / bundle id: `com.libertasian.app` · Play app id `4972935521557273777` · ASC app id `6788971669` · Apple Team `V2W2BY5P8D`

---

## PART 0 — What is already done (no action needed)

**Google Play Console — App content declarations (all saved):**
- **Ads:** No, the app does not contain ads.
- **Government apps:** No.
- **Financial features:** "My app doesn't provide any financial features."
- **Health apps:** "My app does not have any health features."
- **Content rating:** IARC questionnaire completed (category *Reference / All Other App Types*; UGC reporting = yes, blocking = no, chat moderation = no; online content = yes; news/educational = yes). Generated rating: **All ages / ESRB Everyone / PEGI 3 / ClassInd L.** Saved.
- **Data safety:** Full questionnaire completed and saved as draft — collection = Yes, encrypted in transit = Yes, account-creation methods = Username+password and OAuth, delete-account URL = `https://libertasian.com/account-deletion`. All 13 collected data types declared with purposes and required/optional exactly per `store/DATA_SAFETY.md`:
  - Personal info: Name (opt), Email (req), User IDs (req), Phone (opt)
  - Financial info: Purchase history (opt)
  - Photos and videos: Photos (opt)
  - Files and docs: Files and docs (opt)
  - App activity: App interactions (opt), In-app search history (opt), Other user-generated content (opt)
  - App info and performance: Crash logs (req), Diagnostics (req), Other app performance data (req)
  - Everything else (location, contacts, calendar, messages, audio, web history, device IDs) declared **not collected**.

**Store listing text (verified present in Play Console → Main store listing):**
- App name: **LIBERTASIAN** · Short description (79/80) · Full description (1607/4000). Source of truth: `store/PLAY_LISTING.md`.

**Repo assets generated / created:**
- App icon 512×512: `assets/store/play-icon-512.png` (no alpha — Play-compliant).
- Feature graphic 1024×500: `assets/store/feature-graphic-1024x500.png`.
- **30 marketing screenshots** (6 screens × 5 sizes) at `assets/store/screenshots/marketing/<platform>/<slug>.png`:
  - `iphone-6-7` 1290×2796, `ipad-12-9` 2048×2732, `android-phone` 1080×1920, `android-tablet-7` 1200×1920, `android-tablet-10` 1600×2560.
  - Regenerate anytime: `pnpm --filter mobile screenshots:marketing`.
- New web page for the required deletion URL: `apps/web/src/app/(public)/account-deletion/page.tsx` → serves at `https://libertasian.com/account-deletion`.

---

## PART 1 — Two environment gotchas that block browser automation (do these first)

1. **Disable the Adobe Acrobat Chrome extension** while working in Play Console. Its floating button sits in the bottom-right corner, directly over Play Console's **Save** and the media picker's **apply** buttons, and intercepts clicks there. `chrome://extensions` → toggle Adobe Acrobat off (or use an incognito/second profile without it).
2. The Play media picker ("Add assets") applies an image to a field only through its own in-drawer flow; there is no keyboard/paste shortcut. Steps below.

---

## PART 2 — Google Play store listing graphics — DONE

All listing graphics are applied and saved (2026-07-17):
- **App icon** (owl, 512×512) — `assets/store/play-icon-512.png`
- **Feature graphic** (1024×500) — `assets/store/feature-graphic-1024x500.png`
- **Phone screenshots** ×6 — `assets/store/screenshots/marketing/android-phone/`
- **7-inch tablet screenshots** ×6 — `.../android-tablet-7/`
- **10-inch tablet screenshots** ×6 — `.../android-tablet-10/`

The store listing saved with no validation errors. Nothing to do here.

> How it was done (for future reference, since the picker is non-obvious): open the field's **Add assets** → **Upload** the file(s). For a single-image field (icon, feature graphic) open the uploaded asset's detail view (the **→** on the tile) and click **Add** in the detail bottom bar. For a multi-image field (screenshots) the uploaded files auto-select; click **Add** in the drawer's bottom action bar to apply them all at once. The Adobe Acrobat browser extension's floating button overlaps that **Add** button in a small window — widen the window or disable the extension.

---

## PART 3 — Sign-in details + Target audience (needs a reviewer test account)

Play Console → App content → **Sign in details** ("App access"). The app requires login, so Google needs working credentials. **Google reviewers cannot use social login and cannot create accounts**, so you must supply a dedicated **email + password** test account:
1. In your own system, create a normal test user (e.g. `play-review@libertasian.com`) with a paid plan enabled so the reviewer can see gated features (bar-exam answers, digest generation).
2. Play Console → Sign in details → **Yes** → **Add details** → Name "Reviewer account", enter the username/email and password. Add a note that login is email+password (not Google/Apple). Save.
3. Then App content → **Target audience and content** → target age **18+** (the app is not directed to children; see `store/DATA_SAFETY.md`). Complete and save.

> I set "Yes" on Sign in details but could not enter the password — that must come from you and never be handled in plain text by the assistant.

---

## PART 4 — Deploy the account-deletion page BEFORE submitting

`https://libertasian.com/account-deletion` must be live before Data safety review, or Google may reject it.
- The page exists in code (`apps/web/src/app/(public)/account-deletion/page.tsx`). Merge to `main` → staging auto-deploys; tag a release for production.
- Verify it loads publicly, then in Play Console Data safety the URL is already set.

---

## PART 5 — Upload the Android build & send for review

1. Ensure the Play service account key exists at `apps/mobile/play-service-account.json` (Play Console → Setup → API access → create service-account key; gitignored). `eas.json` submit.production.android already points at it, track `internal`.
2. Build + submit: `eas build --profile production --platform android` then `eas submit --profile production --platform android` (versionCode auto-increments via EAS remote).
   - Or upload the `.aab` manually: Play Console → Test and release → Testing → **Internal testing** → create release → upload bundle.
3. Play requires a **closed test** before production access for new personal developer accounts — run internal/closed testing first.
4. Play Console → **Publishing overview** → review the pending changes (all the declarations above + store listing + data safety) → **Send for review**.

---

## PART 6 — Apple App Store Connect (parallel track)

iOS is already on TestFlight (build submitted 2026-07-08; smoke-test the latest build). To ship to the App Store:

1. **Metadata** (already in `store.config.json`): push with `eas metadata push` — title, subtitle, description, keywords, privacy URL `https://libertasian.com/privacy`, categories Reference + Education.
2. **App Privacy** (App Store Connect → your app → App Privacy → Edit): mirror `store/DATA_SAFETY.md` §2 — Data Linked to You: Email, Name, Phone, Photos/Videos, Other User Content, Search History, User ID, Product Interaction, Crash/Performance/Other Diagnostics, Purchase History, Payment Info. No tracking. No data used to track.
3. **Screenshots** (App Store Connect → your app → the version → App Previews and Screenshots):
   - iPhone 6.7": upload `assets/store/screenshots/marketing/iphone-6-7/` 01…06.
   - iPad 12.9": upload `assets/store/screenshots/marketing/ipad-12-9/` 01…06.
4. **Sign-in for review**: App Store Connect → App Review Information → provide the same email+password test account from Part 3, and note it's not social login.
5. **Build**: `eas build --profile production --platform ios` → `eas submit --profile production --platform ios` (appleId/ascAppId/appleTeamId already in `eas.json`). Attach the build to the version, answer export-compliance (`ITSAppUsesNonExemptEncryption=false` is already set), then **Submit for Review**. Phased release is on (`store.config.json`), automatic release off.

---

## PART 7 — Pre-submit checklist (both stores)

- [x] Play: App icon + Feature graphic + phone/7"/10" tablet screenshots applied; listing saved with no errors. **DONE**
- [ ] Play: Sign-in details test account entered; Target audience = 18+.
- [ ] `https://libertasian.com/account-deletion` and `/privacy` live.
- [ ] Play: Android bundle uploaded to a track; closed test run; **Send for review** in Publishing overview.
- [ ] Apple: App Privacy answers submitted; iPhone 6.7" + iPad 12.9" screenshots uploaded; test account in App Review Information; build attached; **Submit for Review**.
- [ ] Keep `store/PLAY_LISTING.md`, `store/DATA_SAFETY.md`, `store.config.json` as the source of truth — re-paste/re-push if copy changes.
