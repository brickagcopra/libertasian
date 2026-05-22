# LIBERTASIAN Mobile — Submission Checklist

What `brick` needs to gather before the next mobile submission PR. Nothing here blocks the current **preview** smoke build — these are required only when we wire production submission.

---

## 1. Apple — iOS App Store

These four values go into `apps/mobile/eas.json` under `submit.production.ios`:

| Field | Where to find it |
|---|---|
| **`appleId`** | The Apple ID email used to sign in to App Store Connect. Use the same email registered to the Apple Developer Program account. |
| **`appleTeamId`** | [developer.apple.com](https://developer.apple.com) → Account → Membership details → "Team ID" (10-character alphanumeric, e.g. `AB12CD34EF`). Requires an active Apple Developer Program membership (USD 99/year). |
| **`ascAppId`** | Created when the app is first registered in [App Store Connect](https://appstoreconnect.apple.com) → My Apps → `+` → New App. After creation it appears in the app's **App Information** page as "Apple ID" (numeric, e.g. `1234567890`). Bundle identifier when registering: `com.libertasian.app`. |
| App-specific password (if running `eas submit` manually) | [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords. EAS will prompt for it on first submit. |

**Prerequisites before the iOS submission PR:**
- Active Apple Developer Program membership.
- App registered in App Store Connect with bundle id `com.libertasian.app`.
- iOS distribution certificate + provisioning profile (EAS can manage these automatically — pick "let EAS handle credentials" on first `eas build --platform ios`).

---

## 2. Google — Play Store

| Field | Where to find it |
|---|---|
| **Service account JSON** | [Play Console](https://play.google.com/console) → Setup → API access → "Create new service account" → follow the link to Google Cloud Console → IAM & Admin → Service Accounts → Keys → Add Key → JSON. Download the file and save as `apps/mobile/google-services.json`. Then back in Play Console, grant the service account "Release manager" role on the LIBERTASIAN app. **This file must be gitignored.** |

**Prerequisites before the Android submission PR:**
- Google Play Developer account (one-time USD 25 fee).
- App created in Play Console with package name `com.libertasian.app`.
- First release uploaded manually to internal testing track (Play requires at least one manual upload before API submission is allowed).

---

## 3. Branded Icon + Splash Assets

The current files in `apps/mobile/assets/` are Expo defaults:

- `icon.png` — 1024×1024, 6.4 KB (default white "E" icon).
- `adaptive-icon.png` — 1024×1024, 6.4 KB (identical bytes to `icon.png` — default).
- `splash-icon.png` — 200×200, 593 bytes (default).

**Brick needs to provide:**

| Asset | Required size | Notes |
|---|---|---|
| `icon.png` | **1024×1024** PNG, no transparency, no rounded corners | iOS/Android master icon. Apple rejects icons with alpha channel or pre-rounded corners. |
| `adaptive-icon.png` | **1024×1024** PNG with transparent background | Android adaptive icon foreground. Keep the logo within the inner ~66% safe zone (Android may crop a circle or squircle around it). |
| `splash-icon.png` | **1024×1024** PNG (square) | Expo SDK 52 splash. The image is centered and scaled with `resizeMode: contain`. |

These do **not** block the current preview build — Expo defaults still produce a working APK. Replace before the first store-track submission.

---

## 4. Other Pre-Submission TODOs (out of scope for this PR)

- Privacy policy URL + Terms URL hosted on libertasian.com (required by both stores).
- App Store Connect: screenshots (6.7" + 6.5" iPhone, 12.9" iPad), app description, keywords, support URL, age rating questionnaire.
- Play Console: screenshots (phone + 7" + 10" tablet), feature graphic, short + full description, content rating, target audience, data safety form.
- Decide MFA UX before submission — Apple's review team needs working test credentials for an account with MFA disabled (or pre-shared TOTP secret).
- Confirm `NSCameraUsageDescription` copy matches actual in-app behavior at the point of permission prompt (App Store reviewers check this).

---

## 5. After Credentials Are Gathered

1. Save `google-services.json` at `apps/mobile/google-services.json` (gitignored).
2. Replace the three `YOUR_*` placeholders in `apps/mobile/eas.json` with real values.
3. Run `eas build --profile production --platform all` once credentials are in place.
4. Run `eas submit --profile production --platform android` (then `--platform ios`).
