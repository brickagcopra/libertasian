# App Review response — Guideline 2.1 Information Needed (iOS 1.0, build 16)

Apple rejected iOS **1.0 (16)** on 2026-08-15 under **Guideline 2.1 — Information Needed**.
Submission `f4b2ffe6-fd76-4c7d-b20b-1ea7e88b5c9a`, ASC app `6788971669`.

This is **not** a code or build defect. Build 16 is attached and valid, screenshots are real
captures, App Privacy is Published, the app is Philippines-only and Free. Apple asked seven
questions and wants a screen recording. Nothing here requires a new build.

Live ASC state read on 2026-08-15 via the App Store Connect API:

| Field | Value |
|---|---|
| App Store version | `eee8cc1e-0dd8-40a6-9725-a239402e82c5` — `1.0`, `appStoreState: REJECTED` (editable) |
| Attached build | `80ce1104-677a-48f8-b431-5b2ef322b8a4` — version `16`, `processingState: VALID`, `expired: false` |
| Review detail | `48204d2a-7cb1-443c-96ea-27f4a3e67f2c` |
| Demo account | `brickagcopra5871+test@gmail.com`, `demoAccountRequired: true`, password set |
| Contact | Brick Demanuel Agcopra, bma5871@gmail.com, +13472676406 |

Three paste-ready sections follow. Section (a) is pushed to ASC by the API; sections (b) and
(c) are manual — there is no public API for Resolution Center messages, and the recording is
shot on a physical device.

> **Credential note:** the demo account password is deliberately not written in this file. It
> already lives in the ASC *Sign-In Information* fields, which is where the notes point Apple.

---

## (a) App Review Information → Notes

Paste into **App Store Connect → App Review Information → Notes**, replacing the existing text.
Limit 4000 characters; this text is **3,923**. Everything between the fences, nothing else.
It is **already live on ASC** — pushed via `PATCH /v1/appStoreReviewDetails/48204d2a-…`. Re-paste
only if you edit it here.

> **One deviation from `PLAY_LISTING.md`, flagged deliberately.** Item 3 reuses the Play full
> description verbatim — WHAT'S INSIDE, WHO IT IS FOR and the DISCLAIMER block are untouched —
> except that the **PRIVATE BY DEFAULT** paragraph is omitted. The full block put the notes at
> 4,112 characters, 112 over Apple's hard limit. Privacy was the least responsive paragraph to
> item 3's actual question (core functionality and intended audience), and App Privacy is
> already Published on this listing, so it is the cheapest thing to drop. If you would rather
> keep it, cut roughly 220 characters from items 1, 4 and 5 instead — they are our own prose,
> not vetted listing copy.

<!-- ASC-NOTES-BEGIN -->
```
1) DEMONSTRATION VIDEO
A screen recording is attached to our Resolution Center reply: one continuous take on a physical iPhone, from cold launch to in-app account deletion.
Moderation in this build: any user can report another user's post, and delete their own posts. User-level blocking is not in build 16; it is implemented and ships in the next build, hiding blocked authors from the feed, post detail and comments, with an unblock list in Settings. We can submit that build now if you want to see blocking first.

2) DEVICES AND OS VERSIONS TESTED
Physical device: iPhone 16 Pro on iOS 18.5. Simulators: iPhone 16 Pro Max and iPad Pro 13-inch (M4) on iOS 18.x.

3) CORE FUNCTIONALITY AND INTENDED AUDIENCE
LIBERTASIAN is a Philippine legal research library for law students, bar reviewees, and practitioners.

WHAT'S INSIDE
• Past Bar Exams — 97 sittings, 1,500+ questions from 1953 to 2024 with AI-generated ALAC answers for paid users.
• Case Digests — Philippine Supreme Court cases with facts, issues, ruling, doctrine, and provenance, generated from authoritative sources only.
• Codal Reader — Republic Acts, the 1987 Constitution, and the Rules of Court, organized by bar subject with cross-references.
• AI Study Assistant — chat and Q&A grounded in what you are reading. Sourced answers only; the model abstains rather than fabricate.
• Camera Scan-to-Digest — point your camera at a pleading or case printout and get a structured digest with citations back to the source.
• Offline codal cache and cross-device sync between mobile and web.

WHO IT IS FOR
• Law students preparing for class recitations and exams.
• Bar reviewees drilling past Supreme Court questions.
• Practicing lawyers looking up jurisprudence and codal text on the go.

DISCLAIMER
LIBERTASIAN provides AI-powered legal research tools for informational purposes only. AI outputs are not legal advice and do not create an attorney-client relationship. Always consult a qualified Philippine lawyer for legal matters. The practice of law in the Philippines is reserved for members of the Philippine Bar.

4) ACCESS AND SAMPLE FILES
Demo account brickagcopra5871+test@gmail.com, password in the Sign-In Information fields above. Two-factor authentication is DISABLED - email and password are all that is needed, and no code is sent to any device. The account is Pro tier and sole owner of its organization, so every feature is reachable with no setup. No sample files are needed; the corpus is served from our backend. Searching "constitution" returns a high-confidence answer with 8 cited sources, and Camera Scan works on any printed page. Please do not delete this account; it carries the complimentary Pro entitlement later reviews depend on.

5) THIRD-PARTY AND EXTERNAL SERVICES
OpenAI (gpt-4o-mini) for AI answers, digests and ALAC bar answers; Sign in with Apple; Google Sign-In; Expo push via APNs. All other infrastructure is self-hosted: PostgreSQL, OpenSearch, MinIO, Tesseract OCR, Kokoro-82M text-to-speech, and our own embedding and reranking services.
The app contains no purchase, subscription or payment flow of any kind - no in-app purchase, no external purchase link, no checkout. Paid entitlements are bought on our website and carry over at sign-in.

6) REGIONAL DIFFERENCES
None. Single storefront (Philippines), free, one price tier, no regional differences in features, content or pricing.

7) REGULATED CONTENT AND THIRD-PARTY MATERIAL
The corpus is Philippine government edicts: Supreme Court decisions, Republic Acts, the 1987 Constitution, the Rules of Court, and past Bar Examination questions. Under Republic Act 8293 section 176.1, works of the Government of the Philippines carry no copyright. We republish decision and statute text only, with no third-party annotations, headnotes or editorial apparatus. The app is a research tool: it does not practise law, and every AI surface carries the disclaimer above.
```
<!-- ASC-NOTES-END -->

---

## (b) Resolution Center reply

There is no public API for App Review messages. Paste this into **App Store Connect →
Resolution Center**, on submission `f4b2ffe6-fd76-4c7d-b20b-1ea7e88b5c9a`, and attach the
screen recording from section (c) to the same message.

```
Hello, and thank you for the review.

We have answered all seven items in full in the App Review Information Notes field, which we have just updated, and attached a screen recording of the app running on a physical iPhone 16 Pro (iOS 18.5). The recording is a single continuous take from cold launch and covers registration, sign-in, the codal reader, a case digest, Search, the AI assistant returning a cited answer, the camera and notification permission prompts, the community feed with the Report Post flow, Settings, and in-app account deletion.

Three points we want to state plainly rather than leave you to infer:

1. Moderation. Build 16 lets any user report another user's post, and delete their own posts. User-level blocking is not in build 16. It is already implemented on our side and will ship in the next build, where blocked authors are removed from the feed, post detail and comments, with an unblock list under Settings. If you would prefer to review blocking before approving, tell us and we will upload that build immediately.

2. Payments. The iOS app contains no purchase, subscription or payment flow of any kind - no in-app purchase, no external purchase link, no checkout screen. Paid entitlements are purchased on our website and carry over when the user signs in.

3. Content rights. Our corpus is Philippine government edicts - Supreme Court decisions, Republic Acts, the 1987 Constitution, the Rules of Court, and past Bar Examination questions. Under Republic Act 8293 section 176.1, works of the Government of the Philippines carry no copyright. We republish decision and statute text only, with no third-party annotations or editorial apparatus.

The demo account is brickagcopra5871+test@gmail.com with the password in the Sign-In Information fields. Two-factor authentication is disabled on it, and it is on the Pro tier so every feature is reachable. We would be grateful if it is not deleted, as it carries the complimentary entitlement subsequent reviews rely on.

Please let us know if anything else would help.

Brick Demanuel Agcopra
LIBERTASIAN
```

---

## (c) Screen recording — shot list

**Shot by brick on a physical iPhone 16 Pro (iOS 18.5), not a simulator.** Apple can tell, and
a simulator capture invites a second 2.1. One continuous take, portrait, from a cold launch —
force-quit the app first. Target 3–5 minutes. iOS Screen Recording from Control Centre is fine;
enable the microphone only if you intend to narrate.

### Before you press record

- [ ] **Read the traps section first.** Three of them will cost you the whole take.
- [ ] **Delete and reinstall the app.** iOS shows each permission prompt once per install, and
      Apple asked to see them. A device that has already granted camera or notifications
      cannot produce this footage.
- [ ] **Create the throwaway account and get it through email verification and onboarding
      *before* you record.** Registration does not sign you in — it returns you to the login
      screen with an alert telling you to check your email for a 6-digit code
      (`(auth)/register.tsx:52-55`; `/auth/register` returns `{ user }` with no tokens). If you
      film yourself hunting for that email, the take is dead. Register it, verify it, sign in
      once, complete the 3-step onboarding carousel, then sign out and reinstall.
- [ ] Have both accounts to hand: the demo account for the walkthrough, the throwaway for
      deletion only.
- [ ] Pick a feed post the **demo account has never reported**. `feed_post_reports` is
      `@@unique([postId, reporterUserId])` and a repeat report throws *"You have already
      reported this post"* on camera. A rehearsal burns the post you rehearsed on.
- [ ] The post must be authored by **someone else** — Report only renders for non-owners
      (`post-options-sheet.tsx:53-70`).
- [ ] Silence notifications (Focus / Do Not Disturb) and charge above 30%.

### The take, in order

The ordering below is dictated by app behaviour, not preference. Read the "why" column before
resequencing anything.

| # | Segment | What must be visible | Why here |
|---|---|---|---|
| 1 | Cold launch | Tap the icon from the Home Screen, splash, unauthenticated landing | |
| 2 | Registration | Fill the sign-up form with the throwaway account, submit, show the "check your email for a 6-digit code" alert, then let it return you to Login | Do not wait for the email on camera |
| 3 | Login | Sign in as `brickagcopra5871+test@gmail.com`. Show that **no 2FA step appears** | There is no session to sign out of after segment 2 |
| 4 | **Notification permission** | The **iOS notification prompt fires here, by itself.** Grant it | `_layout.tsx:37` runs `usePushNotifications(isAuthenticated)`, so the prompt fires the moment auth flips true. It **cannot** be triggered later — there is no in-app re-prompt |
| 5 | Home | Scroll the home surface so the tab bar is legible | |
| 6 | Codal reader | Open the 1987 Constitution, scroll a section, show cross-references | |
| 7 | Case digest | Open a Supreme Court digest — facts / issues / ruling / doctrine and the provenance links | |
| 8 | Search | Type `constitution`, wait, scroll the **8 cited sources** | |
| 9 | AI assistant | From **inside the reader**, open the document chat sheet, ask a question, let it **stream**, scroll to the citations | This is the real AI surface (`features/ai-answers/components/document-chat-sheet.tsx`). See trap 3 |
| 10 | Scan tab | Tap Scan so the **camera permission prompt** fires. Grant it. Scan any printed page | |
| 11 | Feed — Report | **From the feed list, not post detail.** Tap the ⋯ on someone else's post card, open the options sheet, tap **Report Post**, pick a reason, submit | See trap 4 — the ⋯ on post detail is wired to a no-op |
| 12 | Settings | Settings screen and the account section | |
| 13 | Delete account | **Sign out, sign in as the throwaway account**, then Settings → Delete account, confirm | See trap 1 |
| 14 | Restore link | Open Mail, show the account-restore email | |

### Traps — read these before recording

1. **Never shoot Delete Account on `brickagcopra5871+test@gmail.com`.** This is the one that
   ends the whole submission. Deletion sets `status = pending_deletion`, revokes every session
   and soft-deletes solo orgs (`account-deletion.service.ts:113-136`), and `auth.service.ts:201`
   then rejects any non-active status with *"Account is suspended or deactivated."* The next
   reviewer would not hit paywalls — **they could not sign in at all**, which is a guaranteed
   repeat 2.1 and the worst outcome available. It also destroys comp subscription
   `6741e44f-7445-4347-869e-550b9845be3f`. (It is restorable for 30 days via the emailed token,
   but do not rely on that.) Sign out, sign in as the throwaway, delete **that**.

2. **Read every AI answer on screen before you keep the take.** Abstentions are real and they
   are not obvious in motion. On Search an abstention renders as client copy in a distinct
   **amber shield container** (`ai-summary-results.tsx:82-87` via `abstention-copy.ts`); in the
   reader chat it reads **"Not enough grounding in this document to answer that."**
   (`document-chat-sheet.tsx:205-212`). The server-side phrase *"the provided source passages
   do not contain…"* never reaches the screen, so do not scan for it. `constitution` is
   verified to return a real sourced answer with 8 sources. If an abstention appears, restart.

3. **Film the right assistant.** Settings → "Help & FAQ" advertises *"Chat with the LIBERTASIAN
   assistant"* but routes to `/help`, which is a **rule-based FAQ with no AI and no network
   calls** (`chat-knowledge-base.ts`). Putting a canned FAQ reply in front of the reviewer as
   our AI would be worse than showing nothing. Use the reader's document chat sheet.

4. **Do not film the ⋯ button on post detail — it is dead.** `feed/[postId].tsx:85-89` passes
   `onOptionsPress={() => {}}` and `onCommentPress={() => {}}`, so both buttons render and do
   nothing. Shoot Report from the feed list card, where the sheet is actually wired
   (`post-card.tsx:124-127`). **This is a real bug, not just a filming hazard — see the note
   below.**

5. **Do not stage a purchase flow.** There is none in the app, we have told Apple there is
   none, and inventing one creates a 3.1.1 problem that does not currently exist.

6. **Blocking is not in build 16.** Do not attempt to film it. Sections (a) and (b) tell Apple
   this in plain language; showing a half-built screen would contradict that.

7. **One continuous take.** Do not stitch clips. If a segment goes wrong, restart from the cold
   launch — a cut invites the question of what happened in the gap.

> **Open bug worth fixing before the next build.** Trap 4 is a live defect: the options and
> comment buttons on the post detail screen are visible and inert. A reviewer who taps ⋯ on a
> post detail sees a moderation control that does nothing — exactly the impression we are
> trying to correct. Wiring those two handlers is small and belongs with the block-user work,
> but it is a build decision, so it is called out here rather than folded in silently.

### After recording

Trim only the dead air at the head and tail. Export at device resolution, keep it under
Apple's attachment size limit, and attach it to the Resolution Center message from section (b).
