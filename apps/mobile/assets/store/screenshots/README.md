# LIBERTASIAN — store screenshot toolkit

This directory holds the screenshot pipeline for App Store + Play Console submission.

```
screenshots/
├── README.md              ← you are here
├── raw/                   ← raw device captures (not committed in PR #to-be-filed;
│                            populated by `screenshots:capture`)
└── framed/                ← store-ready framed images (committed by brick AFTER
                             capture, not in this groundwork PR)
```

Captions, slugs, and platform sizes live in `apps/mobile/assets/store/screenshots.config.json`.

---

## What you need before you start

| Target                  | Required? | Tooling                            | Source emulator/sim |
| ----------------------- | --------- | ---------------------------------- | ------------------- |
| iPhone 6.7" 1290×2796   | Yes (Apple) | `xcrun simctl` (macOS + Xcode)    | iPhone 15 Pro Max   |
| iPad 12.9" 2048×2732    | Yes (Apple — app `supportsTablet: true`) | `xcrun simctl` | iPad Pro 12.9"   |
| Android phone 1080×1920 | Yes (Play, ≥2 phone images) | `adb` (Android platform-tools) | Pixel 5 / Pixel 7 |
| Android 7" tablet 1200×1920 | Optional | `adb` | Nexus 7-class AVD |
| Android 10" tablet 1600×2560 | Optional | `adb` | Pixel Tablet AVD |

Apple minimum: ≥1 screenshot per required device size. Play minimum: ≥2 phone screenshots, with tablet sizes recommended for the tablet visibility checkbox in Play Console.

---

## Capture workflow

1. Boot the target emulator or simulator and confirm it is attached:
   - Android: `adb devices` should list one device.
   - iOS:     `xcrun simctl list devices booted` should list one booted simulator.
2. Launch a dev build of LIBERTASIAN on the device. Sign in with the demo reviewer account or a seeded account that has visible data on every screen.
3. Run the capture script:

   ```bash
   # Android
   pnpm filter=mobile screenshots:capture -- --platform android

   # iOS
   pnpm filter=mobile screenshots:capture -- --platform ios

   # One screen only (re-shoot a single slug)
   pnpm filter=mobile screenshots:capture -- --platform android --only 02-case-digests
   ```

4. For each screen, the script prints the `navHint` from `screenshots.config.json` and waits for Enter. Navigate the app to that screen, then press Enter — the script writes `raw/<slug>.<platform>.png`.

The six screens (drafted from the listing copy in `apps/mobile/store.config.json` and `apps/mobile/store/PLAY_LISTING.md`) are:

1. `01-past-bar-exams` — Past Bar Exams browser
2. `02-case-digests` — Supreme Court case digest reader
3. `03-codal-reader` — Codal reader (Constitution)
4. `04-ai-assistant` — AI Study Assistant with citations
5. `05-camera-scan` — Camera scan-to-digest
6. `06-offline-sync` — Settings: offline + sync status

---

## Framing workflow

Once `raw/` has the frames, render the store-ready images:

```bash
# All platforms
pnpm filter=mobile screenshots:frame

# Single platform
pnpm filter=mobile screenshots:frame -- --platform iphone-6-7
```

Output lands in `framed/<platform>/<slug>.png` at the platform's exact pixel size. Each framed image has:

- Warm-cream background.
- Caption from `screenshots.config.json` in serif bold, centred at the top.
- The raw screenshot scaled to fit the inner frame area, centred.
- A 12 px deep-amber accent strip at the bottom (matches the feature graphic).

The framing is **lossless of layout**: the raw screenshot is only resized (preserve aspect ratio, `fit: 'inside'`); nothing is cropped.

---

## Apple platform mapping

Apple accepts the **iPhone 6.7"** image for 6.9" and 6.5" device groups (iPhone 16 Pro Max + iPhone 14 Pro Max all upload the same 1290×2796). The **iPad 12.9"** image satisfies the iPad Pro 6th-gen and 5th-gen requirements because the app declares `supportsTablet: true`.

Play accepts a wide range of phone screenshots (320 px to 3840 px on the longest edge); we standardise on 1080×1920 for the phone size and 1200×1920 / 1600×2560 for the optional tablet sizes.

---

## Committing the framed output

This groundwork PR commits the **toolkit and raw-frame directories** only. The framed PNGs are committed in a follow-up commit after brick runs the capture against a live emulator and confirms the resulting images look correct:

```bash
git add apps/mobile/assets/store/screenshots/raw/
git add apps/mobile/assets/store/screenshots/framed/
git commit -m "feat(mobile): committed store screenshots (capture + frame)"
```

Do **not** commit screenshots that show real PII, debug overlays, or in-progress placeholder data. Use the demo reviewer account and seeded fixtures.
