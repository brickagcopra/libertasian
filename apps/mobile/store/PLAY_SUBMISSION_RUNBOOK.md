# LIBERTASIAN — Play Console submission runbook

> Written 2026-08-16 for **brick**, to be worked through by hand in Play Console.
> **Android is code-complete.** Everything left is console clicking.
>
> Every value you need is inlined below. **You should not have to open another
> file while you click.**

---

## The build you are submitting

| | |
|---|---|
| EAS build id | `fc383de9-fdac-47eb-8c33-69f8913c234e` |
| versionCode | **11** |
| Version name | `1.0.0` |
| gitCommitHash | `2c41074` |
| Artifact (.aab) | https://expo.dev/artifacts/eas/qDtzxtpaiXZb1CR8GEOqypuzPrpkqCRzD4FHMsrmng0.aab |
| Package | `com.libertasian.app` |
| Play app id | `4972935521557273777` |
| Track | **Closed testing → `alpha`** (never `internal`, never `production`) |

**Entry point / dashboard:**
https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-dashboard

Developer id `8499737484299150451`, app id `4972935521557273777`.

### Deep links — every step, in order

| Step | Page | Link |
|---|---|---|
| — | App content (hub) | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content |
| 1 | Content rating | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/content-rating |
| 2 | Data safety | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/data-privacy-security |
| 3 | App access | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/app-access |
| 4 | Target audience | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/target-audience |
| 5 / 7 | Closed testing | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/tracks/closed-testing |
| 5A | Main store listing | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/main-store-listing |
| 6 | Publishing overview | https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/publishing |

> **Confidence, stated honestly.** The base
> (`/u/0/developers/8499737484299150451/app/4972935521557273777/`) and
> `app-dashboard` are confirmed — they came from the URL in your address bar.
> The leaf segments (`app-content/...`, `tracks/closed-testing`,
> `main-store-listing`, `publishing`) follow Play Console's documented URL scheme
> but I could not load them to check, because I have no browser access.
> **If one 404s or lands somewhere unexpected, use the left-nav path given in the
> step — every step below still carries it — then paste me the real URL and I
> will correct this table.** The `/u/0/` segment assumes Play Console is on your
> first signed-in Google account; if you are multi-signed-in it may be `/u/1/`
> or higher.

---

## What I can and cannot do for you

I checked the full tool surface — deferred tools, installed plugins, and skills.
**Browser automation is NOT available in this session.** There is no
claude-in-chrome, no "cowork" browser tool, no installed plugins, and the
available skills are all authoring/config ones. The only web tool is `WebFetch`,
which explicitly fails on authenticated pages, so it cannot reach Play Console
even though you are signed in — your browser session is not something it can
borrow. I have no tool that can open, read, or click a Play Console page.

| | |
|---|---|
| **I can** | Read repo state, verify URLs return 200, check EAS build/artifact facts, regenerate this runbook with deep links from a URL you paste, and cross-check anything you type back to me against the source-of-truth tables below. |
| **I cannot** | See your screen, click anything, or confirm a Play Console page saved. |

**Even if browser automation were available, I would not click steps 1, 2 or 4.**
Content rating, Data safety and Target audience are **binding legal
declarations** about what the app does. They are yours to click and yours to
attest. The most I would ever do there is navigate to the page and read the
state back to you for verification.

**The fastest way to use me here:** after each step, paste me what the screen
says. I will diff it against the tables below and tell you if it disagrees.

---

## Two traps that have already cost time

1. **Disable the Adobe Acrobat Chrome extension before you start.** Its floating
   button sits bottom-right, directly over Play Console's **Save** button and
   the media picker's **Add** button, and silently eats clicks there.
   `chrome://extensions` → toggle Adobe Acrobat off, or use an Incognito/second
   profile without it. Widening the window sometimes clears it; disabling always
   does.

2. **Play declarations have not persisted reliably on this app.** More than once
   a form has read as saved and later come back blank or reverted. **After every
   Save, navigate away and come back, and confirm the value is still there.**
   Do not trust a green toast. There is a re-verification checklist at the end.

---

## Why this submission failed last time

Submission `1d1d1fe9-49dd-4089-ad05-d4f2baf40add` (versionCode 9, 2026-08-03)
was rejected with:

> The app is missing the required metadata to submit the app to Google Play Store

The closed (`alpha`) track does **not** waive the App content declarations the
way `internal` does. Two things were missing, and **step 2 and step 3 below are
exactly those two things**:

- **Data safety was complete but left as a DRAFT** — never submitted.
- **App access (Sign in details)** had no credentials entered.

The release never reached testers, so **the 14-day clock never started.**

---

## Step 1 — Content rating: re-run the IARC questionnaire

**Left nav:** **Policy and programmes** → **App content** → **Content rating** →
**Start questionnaire** (or **Manage**, if it already shows a saved rating).
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/content-rating

**Why you are redoing this.** The saved answers recorded **UGC reporting = yes,
blocking = NO**. PR **#394** (`00c8c48`, *feat(feed): add user blocking to the
community feed*) shipped user-level blocking —
`apps/mobile/src/app/settings/blocked-users.tsx` plus
`apps/api/src/modules/feed/feed-blocks.service.ts` — and **versionCode 11 is the
first Play build carrying it.** The saved answer is now false, and a content
rating that contradicts the binary is its own compliance problem.

1.1 Click **App content** in the left nav.
1.2 Click **Content rating**.
1.3 Click **Manage** (or **Start questionnaire**).
1.4 Confirm the email address on the first screen. Category stays
    **Reference, News, or Educational** → the app type previously chosen was
    **All Other App Types**. Do not change the category.
1.5 Work through to the **user-generated content** section.
1.6 Confirm **"Does your app allow users to report or flag content?"** → **Yes**
    (unchanged — reporting has always shipped).
1.7 **Change "Does your app allow users to block other users?" → YES.**
    ← *this is the whole point of step 1*
1.8 Leave **"Does your app have chat/moderation features?"** → **No** (unchanged).
1.9 **"Does your app allow users to interact or exchange content with other
    users online?"** → **Yes** (unchanged).
1.10 News / educational content questions → **Yes** (unchanged).
1.11 Click **Save** → **Submit**.

> **The generated rating may change.** It was previously
> **All ages / ESRB Everyone / PEGI 3 / ClassInd L**. Answering "blocking = yes"
> can shift the outcome. **That is fine and expected — accept whatever it
> generates.** Do not try to steer the answers back to the old rating. An honest
> questionnaire that produces a different badge is correct; a flattering one that
> contradicts the binary is not.

1.12 Navigate away, come back to **Content rating**, and confirm the new rating
     is showing and the status reads **submitted**, not draft.

---

## Step 2 — Data safety: it is COMPLETE but saved as a DRAFT. Submit it.

**Left nav:** **App content** → **Data safety**.
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/data-privacy-security

This is **half of why `1d1d1fe9` was rejected.** Every answer is already filled
in. The form was simply never walked to the end and submitted. **Do not re-enter
anything unless it disagrees with the tables below — just walk to the end and
press Submit.**

2.1 Click **App content** → **Data safety** → **Manage** / **Start**.
2.2 **Data collection and security** screen:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data be deleted? | **Yes** |
| Data deletion URL | `https://libertasian.com/account-deletion` |

> I verified that URL returns **200** and renders "Delete Your Account and Data —
> LIBERTASIAN", with the in-app path *Settings → Delete account* and a fallback
> contact of `libertasianphilippines@gmail.com`. It is live; you do not need to
> check it.

2.3 **Data types** screen. Diff what is on screen against this table. It is the
    complete set — **13 collected types, nothing shared with third parties.**

| Play category | Data type | Collected | Shared | Purposes | Required / Optional |
|---|---|---|---|---|---|
| Personal info | **Name** | Yes | No | Account management, App functionality | **Optional** |
| Personal info | **Email address** | Yes | No | Account management, App functionality, Developer communications | **Required** |
| Personal info | **Phone number** | Yes | No | App functionality | **Optional** |
| Personal info | **User IDs** | Yes | No | Account management, App functionality | **Required** |
| Financial info | **Purchase history** | Yes | No | App functionality | **Optional** |
| Financial info | Payment info | **No** | No | — | — |
| Photos and videos | **Photos** | Yes | No | App functionality | **Optional** |
| Files and docs | **Files and docs** | Yes | No | App functionality | **Optional** |
| App activity | **App interactions** | Yes | No | Analytics, App functionality | **Optional** |
| App activity | **In-app search history** | Yes | No | App functionality, Personalisation | **Optional** |
| App activity | **Other user-generated content** | Yes | No | App functionality | **Optional** |
| App info and performance | **Crash logs** | Yes | No | Analytics, App functionality | **Required** |
| App info and performance | **Diagnostics** | Yes | No | Analytics, App functionality | **Required** |
| App info and performance | **Other app performance data** | Yes | No | Analytics | **Required** |

**Declared NOT collected** — leave every one of these unticked:

> Device or other IDs · Approximate location · Precise location · Contacts ·
> Calendar events · Health and fitness · Messages · Audio · Web browsing history

Two notes if a screen makes you hesitate:

- **Payment info is "not collected" on purpose.** Card numbers and CVCs go
  straight to Xendit's PCI widget; the app only ever receives a billing token.
  (Apple's form declares Payment Info as *Linked* because we hold that token —
  the two stores legitimately differ here. Do not "fix" one to match the other.)
- **Device or other IDs is "not collected" on purpose.** We store an IP *prefix*
  for refresh-token reuse detection and rate limiting. There is no advertising ID
  anywhere in the app.

2.4 **Security practices** screen:

| Question | Answer |
|---|---|
| Data encrypted in transit | **Yes** |
| Users can request data deletion | **Yes** |
| Committed to Play Families Policy | **N/A** — app is not for children |
| Independent security review | **Leave blank** |

2.5 Click through to the **summary / preview** screen.
2.6 **Click SUBMIT.** Not "Save draft". **Save draft is what broke the last
    submission.**
2.7 Navigate away, come back, and confirm the status chip reads
    **Submitted / Complete**, not **Draft**.

---

## Step 3 — App access (Sign in details)

**Left nav:** **App content** → **App access**.
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/app-access

This is the other half of why `1d1d1fe9` was rejected. The app requires login,
and **Google reviewers cannot use social sign-in and cannot create accounts**, so
they need working email + password credentials.

3.1 Click **App content** → **App access**.
3.2 Select **All or some functionality is restricted**.
3.3 Click **Add new instructions**.
3.4 **Name:** `Reviewer account`
3.5 **Username:** `brickagcopra5871+test@gmail.com`
3.6 **Password:** `<paste password here>`

> 🔐 **The password is deliberately not in this file.** It is not in this
> runbook, not in the commit, and not in the PR. I did not ask for it and will
> not. Type it straight into Play Console from wherever you keep it. If you ever
> paste it into a chat with me, rotate it.

3.7 **Any other instructions** — paste this verbatim:

```
Sign in with the email and password above. Login is email + password only —
do NOT use the Google or Apple sign-in buttons on the sign-in screen, they
are for end users with existing linked accounts and will not work for a
reviewer account.

This account carries a paid plan, so gated features (bar-exam model answers,
digest generation, AI assistant) are all reachable.

Account deletion is in-app: Settings > Delete account.
```

3.8 Click **Add** → **Save**.
3.9 Navigate away, come back, confirm the instructions are still listed.

> ⚠️ `brickagcopra5871+test@gmail.com` is the **same account currently in front
> of Apple** as the App Store demo reviewer. Do not delete it, rename it, or
> change its password while either review is open — and do not sign into it
> yourself to poke around, because the comp Pro subscription attached to it is
> what reviewers depend on.

---

## Step 4 — Target audience and content

**Left nav:** **App content** → **Target audience and content**.
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/app-content/target-audience

4.1 Click **App content** → **Target audience and content**.
4.2 **Target age groups:** tick **18 and over** ONLY. Untick everything else.
4.3 **"Is your app designed for children?"** → **No**.
4.4 Continue through the remaining screens (store presence / ads appeal to
    children) → answer **No** to appealing to children.
4.5 Click **Save**.
4.6 Navigate away, come back, confirm **18+** is still selected.

> The app is not directed to users under 18 — Privacy Policy § 11 says so and
> the Apple age rating is already overridden to 18+. Keep the two stores
> consistent.

---

## Step 5 — Upload versionCode 11 to Closed testing (`alpha`)

**Left nav:** **Test and release** → **Testing** → **Closed testing**.
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/tracks/closed-testing

> 🛑 **Closed testing, track `alpha`. Never Internal testing, never Production.**
> Internal-track releases do **not** count toward the 12-tester / 14-day rule —
> an internal submit silently burns days without advancing the clock.

### Option A — manual upload (no service-account key needed)

5.1 Click **Test and release** → **Testing** → **Closed testing**.
5.2 Find the **alpha** track → **Manage track**.
5.3 Click **Create new release**.
5.4 Download the .aab first:
    https://expo.dev/artifacts/eas/qDtzxtpaiXZb1CR8GEOqypuzPrpkqCRzD4FHMsrmng0.aab
5.5 Drag it into **App bundles** (or **Upload** → pick the file).
5.6 Confirm the parsed values read **versionCode 11**, **version name 1.0.0**,
    package `com.libertasian.app`. If versionCode reads anything other than 11,
    stop — you have the wrong artifact.
5.7 **Release name:** `11 (1.0.0)` — Play prefills this; leave it.
5.8 **Release notes**, paste verbatim into the `en-US` block:

```
Initial release.

• Browse Philippine Supreme Court case digests with provenance back to the source.
• Read the 1987 Constitution, Rules of Court, and Republic Acts in the codal reader.
• Drill 1,500+ past bar exam questions with AI-generated ALAC answers for paid users.
• Scan a printout with your camera to generate a structured digest.
• Offline codal cache and sync with libertasian.com on the web.
```

5.9 Click **Next** → review the release → **Save**. (Do **not** press
    *Start rollout* yet if you still have step 5A pending — see below.)

### Option B — `eas submit` instead of the manual upload

Requires the Play service-account JSON at `apps/mobile/play-service-account.json`
(gitignored). If that file is not there, use Option A.

**Run from `apps/mobile`, never the repo root** — `eas` drops a `{"expo":{}}`
stub `app.json` at the root when run from there, which breaks later `eas`
commands. (The stub path is now gitignored so it cannot dirty the tree, but the
command still misbehaves.)

```bash
cd apps/mobile
eas submit --profile production --platform android --id fc383de9-fdac-47eb-8c33-69f8913c234e
```

`--id` is required for a non-interactive submit; without it EAS prompts you to
pick a build. The `submit.production.android` profile already targets
`track: "alpha"`.

---

## Step 5A — Replace the store listing screenshots ⚠️ *added, not in the original brief*

**Left nav:** **Grow users** → **Store presence** → **Main store listing**.
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/main-store-listing

**Do this before Send for review.** The listing currently serves the synthetic
`marketing/android-*` set: designed mockups rather than captures of the running
app — the same class of asset Apple rejected under Guideline 2.3.3 — and **one of
the six slides is `06-offline-sync`, a feature that does not exist in the build.**
PR #403 replaced them with real emulator captures and deleted the synthetic
directories from the repo, but **Play Console still has the old images until you
upload the new ones.**

Upload from your local checkout of `main`:

| Play field | Upload from | Size |
|---|---|---|
| Phone screenshots | `apps/mobile/assets/store/screenshots/framed/android-phone/` | 1080×1920 |
| 7-inch tablet screenshots | `apps/mobile/assets/store/screenshots/framed/android-tablet-7/` | 1200×1920 |
| 10-inch tablet screenshots | `apps/mobile/assets/store/screenshots/framed/android-tablet-10/` | 1600×2560 |

Six files each: `01-past-bar-exams.png` … `06-search.png`.

5A.1 **Main store listing** → scroll to **Phone screenshots**.
5A.2 **Upload one file at a time, in filename order, waiting for each to
     finish.** Uploading a set at once orders them by upload-completion rather
     than filename — this scrambled the App Store set on 2026-08-07 and had to
     be deleted and redone.
5A.3 Delete the six old images from the slot once the new ones are applied.
5A.4 Repeat for **7-inch tablet** and **10-inch tablet**.
5A.5 Click **Save**.

App icon (`assets/store/play-icon-512.png`) and feature graphic
(`assets/store/feature-graphic-1024x500.png`) are already applied and correct —
leave them alone.

> Media picker mechanics, because it is non-obvious: **Add assets** → **Upload**
> the file. For a single-image field, open the uploaded asset's detail view (the
> **→** on the tile) and click **Add** in the detail bottom bar. For a
> multi-image field the uploads auto-select; click **Add** in the drawer's bottom
> action bar. *This is the exact button the Adobe extension covers.*

---

## Step 6 — Send for review

**Left nav:** **Publishing overview** (top of the left nav).
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/publishing

6.1 Click **Publishing overview**.
6.2 Review the list of pending changes. You should see, at minimum: content
    rating, data safety, app access, target audience, the store listing
    screenshots, and the closed-testing release.
6.3 If anything you did in steps 1–5A is **missing from this list, it did not
    save.** Go back and redo it. This is the persistence trap.
6.4 Click **Send N changes for review**.
6.5 Back on **Closed testing → alpha**, click **Start rollout to Closed
    testing** if you saved the release without rolling out in 5.9.

> Google reviews the first closed-testing release. **That review sits IN FRONT
> of the 14-day clock** — the clock does not start until the release is actually
> live to testers. This is why step 7 starts now, not after.

---

## Step 7 — Recruit testers. Start this NOW, in parallel — not after step 6

**Left nav:** **Test and release** → **Testing** → **Closed testing** →
**alpha** → **Testers** tab.
**Direct link:** https://play.google.com/console/u/0/developers/8499737484299150451/app/4972935521557273777/tracks/closed-testing
(then open the **alpha** track and switch to the **Testers** tab)

Your Play developer account is a personal account created after 13 Nov 2023, so
production access is gated on:

> **≥ 12 testers opted in CONTINUOUSLY for 14 days.**

Read those words precisely, because each one has bitten someone:

- **Continuously, not cumulatively.** It is a rolling check across the whole
  track. If the opted-in count drops below 12 at *any* point, **the window
  restarts from zero.**
- **It is a track-level count, not a per-tester clock.** Twelve people for
  fourteen days — not one person for twelve days plus another for two.
- **Uninstalling does NOT break opt-in. Opting out DOES.** Tell your testers
  they can delete the app and still count; they must not click the opt-out link.
- **Pushing new builds during the window does NOT reset it.** Ship fixes freely
  while it runs.
- **Google's review of the first closed release happens before the clock
  starts.** Recruit while you wait.

### Create the group and attach it

7.1 Go to https://groups.google.com → **Create group**.
7.2 Name it something like `libertasian-alpha-testers`. Note the group email
    address, e.g. `libertasian-alpha-testers@googlegroups.com`.
7.3 **Who can join group:** set to **Invited users only** (you add members
    yourself — an open group is an abuse vector).
7.4 Add your testers as members. **Aim for 15+, not exactly 12** — you need
    headroom, because one person opting out drops you below the line and
    restarts fourteen days.
7.5 In Play Console: **Closed testing** → **alpha** → **Testers** tab.
7.6 Under **Email lists**, click **Create email list** / **Add email list** and
    enter the Google Group address from 7.2.
7.7 Click **Save**.
7.8 Copy the **opt-in URL** Play shows on that page and send it to every tester.
    **They are not testers until they open that link and accept.** Being in the
    Google Group is not opt-in.

### Tell your testers this, verbatim

```
1. Open this link and click "Become a tester": <paste opt-in URL>
2. Install LIBERTASIAN from the Play Store link on that page.
3. Please do NOT click "Leave the programme" / opt out for the next 3 weeks —
   that resets a 14-day counter for the whole app.
4. You CAN uninstall the app if you need the space. That does not affect
   anything. Only opting out does.
```

7.9 Keep notes as you go on **how you recruited testers and what feedback you
    acted on**. The production-access application asks both questions
    explicitly, and reconstructing it three weeks later is miserable.
7.10 After ≥14 days at ≥12 testers, Play Console surfaces an **"Apply for
     production access"** button.

---

## Re-verify everything after saving — the persistence checklist

Declarations on this app have reverted before. Work through this list in one
pass, **after** step 6, navigating to each page fresh:

- [ ] **Content rating** — questionnaire submitted, blocking = **Yes**, a rating is generated
- [ ] **Data safety** — status is **Submitted**, NOT Draft
- [ ] **Data safety** — deletion URL still `https://libertasian.com/account-deletion`
- [ ] **Data safety** — 13 collected types present; Payment info and Device IDs still **not** collected
- [ ] **App access** — reviewer credentials present, note text intact
- [ ] **Target audience** — **18+** only
- [ ] **Ads** — still "No, my app does not contain ads"
- [ ] **Government apps** — still No
- [ ] **Financial features** — still "My app doesn't provide any financial features"
- [ ] **Health apps** — still "My app does not have any health features"
- [ ] **Main store listing** — new screenshots in all three slots, old ones deleted
- [ ] **Closed testing → alpha** — release **11 (1.0.0)** present and rolled out
- [ ] **Testers** — email list attached, opt-in URL copied
- [ ] **Publishing overview** — no unexpected leftover pending changes

---

## Do NOT

- **Do not promote to Production.** Closed `alpha` only, until a human has
  installed the signed .aab from the track on a real device and exercised
  sign-in, the codal reader, camera scan and an AI answer.
- **Do not use the Internal testing track.** It does not count toward the
  14-day rule.
- **Do not run `eas` from the repo root.** Always `cd apps/mobile` first.
- **Do not delete or sign into `brickagcopra5871+test@gmail.com`.** Apple review
  is using it right now.
- **Do not re-upload the `marketing/android-*` screenshots.** They are deleted
  from the repo for a reason; if you find them in an old checkout, ignore them.
- **Do not put the reviewer password in a file, a commit, or a chat.**

---

## Already done — no action needed

Recorded here so you do not redo them. All verified saved as of 2026-08-16.

| Item | State |
|---|---|
| **Ads** | No, the app does not contain ads |
| **Government apps** | No |
| **Financial features** | "My app doesn't provide any financial features" |
| **Health apps** | "My app does not have any health features" |
| **App name** | `LIBERTASIAN` (11/30 chars) |
| **Short description** | 80/80 chars — see `store/PLAY_LISTING.md` |
| **Full description** | 1607/4000 chars — see `store/PLAY_LISTING.md` |
| **App category** | Education |
| **Contact email** | support@libertasian.com |
| **Website** | https://libertasian.com |
| **Privacy policy URL** | https://libertasian.com/privacy |
| **App icon** | `assets/store/play-icon-512.png` (512×512, no alpha) — applied |
| **Feature graphic** | `assets/store/feature-graphic-1024x500.png` — applied |
| **Account deletion page** | `https://libertasian.com/account-deletion` — live, verified 200 |

---

## If something goes wrong

Paste me the exact error text and the page you were on. The two failures I would
bet on:

1. **"The app is missing the required metadata to submit"** on a submit —
   step 2 (Data safety still Draft) or step 3 (App access empty). Same failure
   as `1d1d1fe9`.
2. **A form you filled reads blank when you come back** — the persistence trap.
   Redo it, save, and re-check before moving on.

And paste me a Play Console URL any time — I will turn every left-nav path in
this document into a real deep link.
