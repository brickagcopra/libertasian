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
- **Content rating:** ⚠️ **STALE — the questionnaire must be re-run before the next Play submission.** It was completed (category *Reference / All Other App Types*; UGC reporting = yes, **blocking = no**, chat moderation = no; online content = yes; news/educational = yes), generating **All ages / ESRB Everyone / PEGI 3 / ClassInd L**, and saved. **The "blocking = no" answer is now false.** #394 (`00c8c48`, *feat(feed): add user blocking to the community feed*) shipped user-level blocking: `apps/mobile/src/app/settings/blocked-users.tsx` lists blocked users and lifts a block, backed by `apps/api/src/modules/feed/feed-blocks.service.ts`. Android versionCode 10 is the first Play build to carry it. IARC treats the UGC moderation answers as material, so leaving a saved rating that contradicts the binary is a compliance risk in its own right — re-answer **blocking = yes** in Play Console → App content → Content rating and re-generate. Apple's side of the same fact is already corrected (`store/APP_REVIEW_2_1_RESPONSE.md`, #398).
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
- **Marketing screenshots** at `assets/store/screenshots/marketing/<platform>/<slug>.png` — Apple sizes only (`iphone-6-7` 1290×2796, `iphone-6-9` 1320×2868, `ipad-12-9` 2048×2732, `ipad-13` 2064×2752). Regenerate: `pnpm --filter mobile screenshots:marketing`.
  - ⚠️ These are **designed mockups, not captures of the running app** — App Store Guideline 2.3.3 and Play's equivalent. They are superseded by the real captures in `framed/` and must not be uploaded to either store.
  - The three `marketing/android-*` directories were **deleted** when the real Play captures landed. One of their six slides was `06-offline-sync`, a screen that does not exist in the app at all. Keeping them in the tree is how the wrong set gets re-uploaded.
- New web page for the required deletion URL: `apps/web/src/app/(public)/account-deletion/page.tsx` → serves at `https://libertasian.com/account-deletion`.

---

## PART 1 — Two environment gotchas that block browser automation (do these first)

1. **Disable the Adobe Acrobat Chrome extension** while working in Play Console. Its floating button sits in the bottom-right corner, directly over Play Console's **Save** and the media picker's **apply** buttons, and intercepts clicks there. `chrome://extensions` → toggle Adobe Acrobat off (or use an incognito/second profile without it).
2. The Play media picker ("Add assets") applies an image to a field only through its own in-drawer flow; there is no keyboard/paste shortcut. Steps below.

---

## PART 2 — Google Play store listing graphics — SCREENSHOTS MUST BE RE-UPLOADED

Icon and feature graphic are applied and saved (2026-07-17) and need no action:
- **App icon** (owl, 512×512) — `assets/store/play-icon-512.png`
- **Feature graphic** (1024×500) — `assets/store/feature-graphic-1024x500.png`

**The screenshots currently live on the listing are the synthetic `marketing/android-*` set and must be replaced.** They are designed mockups rather than captures of the running app — the same class of asset Apple rejected under Guideline 2.3.3 — and one of the six slides is `06-offline-sync`, a feature that **does not exist in the build**: settings has no such screen, and offline lives on codal cards and the reader's download control instead. Those three directories have been deleted from the repo so the wrong set cannot be re-uploaded by accident.

Upload these instead — real emulator captures, one pass per form factor:

| Play slot | Upload from | Size |
|---|---|---|
| Phone | `assets/store/screenshots/framed/android-phone/` | 1080×1920 |
| 7-inch tablet | `assets/store/screenshots/framed/android-tablet-7/` | 1200×1920 |
| 10-inch tablet | `assets/store/screenshots/framed/android-tablet-10/` | 1600×2560 |

Six slides each, `01`…`06`. **Upload one file at a time, in filename order, waiting for each to finish** — uploading a set at once orders them by upload-completion rather than filename, which scrambled the ASC set on 2026-08-07 and had to be redone.

Delete the old six from each slot after the new ones are applied.

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

1. Ensure the Play service account key exists at `apps/mobile/play-service-account.json` (Play Console → Setup → API access → create service-account key; gitignored). `eas.json` submit.production.android already points at it, track `alpha` (Play's default **Closed testing** track).
2. Build + submit: `eas build --profile production --platform android` then `eas submit --profile production --platform android` (versionCode auto-increments via EAS remote).
   - Or upload the `.aab` manually: Play Console → Test and release → Testing → **Closed testing** → create release → upload bundle.
3. Play requires a **closed test** before production access for new personal developer accounts — run **closed testing** specifically. Internal-track releases do **not** count toward it: the rule is ≥ 12 testers opted in continuously for 14 days on a *closed* track. See `SUBMISSION_CHECKLIST.md` § 5.3.
4. Play Console → **Publishing overview** → review the pending changes (all the declarations above + store listing + data safety) → **Send for review**.

> **⚠️ Closed-track submits fail until the app-content declarations are actually submitted.** `eas submit` to `alpha` returns
> `The app is missing the required metadata to submit the app to Google Play Store`
> until **Data safety is submitted (not left as a draft)**, **Target audience and content** is completed (Part 3), and **Sign in details** are filled (Part 3). The internal track waives these; closed tracks do not — so a submit that worked on `internal` can still fail on `alpha`.
>
> This is what happened to Android submission `1d1d1fe9-49dd-4089-ad05-d4f2baf40add` (versionCode 9, 2026-08-03): the track resolved correctly to `alpha`, but the release was rejected for missing metadata, so **no release reached testers and the 14-day clock did not start**.
>
> Do **not** work around it with `android.releaseStatus: "draft"`. A draft release is not distributed to testers, so it cannot advance the 12-tester / 14-day requirement — it burns calendar days while looking like progress, the same trap as submitting to `internal`.

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
