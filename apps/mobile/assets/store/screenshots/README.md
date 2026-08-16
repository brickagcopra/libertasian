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
| Android phone 1080×1920 | Yes (Play, ≥2 phone images) | `adb` (Android platform-tools) | `Pixel_9` AVD (1080×2424) |
| Android 7" tablet 1200×1920 | Optional | `adb` | `libertasian_tab7` AVD (Nexus 7 2013, 1200×1920) |
| Android 10" tablet 1600×2560 | Optional | `adb` | `libertasian_tab10` AVD (Nexus 10, 1600×2560 portrait) |

Each platform in `screenshots.config.json` names the AVD it was captured from
in `captureAvd`. The two tablet AVDs are not stock — recreate them with:

```bash
avdmanager create avd -n libertasian_tab7  -k "system-images;android-36;google_apis_playstore;x86_64" -d "Nexus 7 2013"
avdmanager create avd -n libertasian_tab10 -k "system-images;android-36;google_apis_playstore;x86_64" -d "Nexus 10"
# Nexus 10 is landscape-native. Swap the two lines in its config.ini so the
# panel itself is portrait — hw.initialOrientation alone leaves `wm size`
# reporting 2560x1600 and the capture comes out landscape:
#   hw.lcd.width=1600
#   hw.lcd.height=2560
```

Apple minimum: ≥1 screenshot per required device size. Play minimum: ≥2 phone screenshots, with tablet sizes recommended for the tablet visibility checkbox in Play Console.

---

## Capture workflow

> **`pnpm filter=mobile …` is not valid pnpm and fails.** Every command below runs
> from `apps/mobile` as `pnpm screenshots:capture -- …`. The old form is wrong
> everywhere it appears in the older store docs too.

1. Boot the target emulator or simulator and confirm it is attached:
   - Android: `adb devices`. If more than one device is listed, pass `--serial <id>`.
   - iOS:     `xcrun simctl list devices booted` should list **exactly one** booted
     simulator — `simctl io booted` picks arbitrarily otherwise, and has already
     framed an iPad capture into the iPhone canvas once.
2. Install a **release-configuration** build and sign in to an account with visible
   data on every screen. Use a real account you own — **not** the App Store demo
   reviewer account, which carries a comp Pro subscription reviewers depend on
   (`store/IOS_SCREENSHOT_CAPTURE.md` §8). An EAS `preview` APK is the easy route:
   it is release-mode and already points at prod.
   ```bash
   eas build --profile preview --platform android      # run from apps/mobile
   curl -L -o app.apk "<artifact url>" && adb -s <serial> install -r app.apk
   ```
3. Run the capture script, **once per form factor**:

   ```bash
   # Android — one pass per form factor, each writing its own raw file
   pnpm screenshots:capture -- --platform android-phone      --serial emulator-5554
   pnpm screenshots:capture -- --platform android-tablet-7   --serial emulator-5556
   pnpm screenshots:capture -- --platform android-tablet-10  --serial emulator-5558

   # iOS
   pnpm screenshots:capture -- --platform ios

   # One screen only (re-shoot a single slug)
   pnpm screenshots:capture -- --platform android-phone --only 02-case-digests
   ```

4. For each screen, the script prints the `navHint` from `screenshots.config.json` and waits for Enter. Navigate the app to that screen, then press Enter — the script writes `raw/<slug>.<platform>.png`.

> **Never derive a tablet slide from a phone capture.** Framing a 1080×2424 phone
> shot into the 1600×2560 tablet canvas letterboxes phone UI into a tablet slot,
> which misrepresents the app the same way the synthetic `marketing/` set did.
> That is why each Play form factor has its own `rawSource` and its own AVD.

The six screens (drafted from the listing copy in `apps/mobile/store.config.json` and `apps/mobile/store/PLAY_LISTING.md`) are:

1. `01-past-bar-exams` — Past Bar Exams browser
2. `02-case-digests` — Case digests **list** (not the detail screen — its hero is a `<Photo label="hero · digest" />` placeholder)
3. `03-codal-reader` — Codal reader (1987 Constitution), reached via Search; the Codals-tab route does not work
4. `04-ai-assistant` — AI assistant answering **with citations**. Read the answer before capturing: most substantive queries currently abstain ("The provided source passages do not contain…") and an abstention looks almost identical to an answer at a glance
5. `05-camera-scan` — Scan **landing** screen (Start Scan + real Recent Scans), not a staged viewfinder
6. `06-search` — Search results across mixed result types

> `06-offline-sync` used to be listed here and still exists under `marketing/`.
> **There is no offline-sync screen in the app** — settings has no such entry;
> offline lives on codal cards and the reader's download control. Do not ship it.

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
