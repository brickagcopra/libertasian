# Maestro E2E — apps/mobile

Black-box UI smoke tests driven by [Maestro](https://maestro.mobile.dev/). The
LIBERTASIAN mobile app uses `react-native-mmkv` and `expo-camera`, both of
which require a native build — **Expo Go cannot run these flows**. Maestro
drives a real installed APK (Android) or IPA (iOS).

## Layout

```
.maestro/
├── auth/login.yaml      # cold launch → assert login screen → sign in → assert authed
└── nav/tabs.yaml        # signs in, then taps through every bottom tab and asserts it loads
```

Both flows target `appId: com.libertasian.app` (the value set in
[`app.json`](../app.json) under `ios.bundleIdentifier` / `android.package`).

## testIDs the flows depend on

Wired in [`LoginScreen.tsx`](../src/components/screens/LoginScreen.tsx) and
[`(tabs)/_layout.tsx`](../src/app/(tabs)/_layout.tsx):

| testID            | Where                              | What it identifies            |
| ----------------- | ---------------------------------- | ----------------------------- |
| `login-email`     | `<Input label="Email" …>`          | Email field on the login form |
| `login-password`  | `<Input label="Password" …>`       | Password field                |
| `login-submit`    | `<Button label="Sign in" …>`       | Submit button                 |
| `tab-home`        | `Tabs.Screen name="index"`         | Home tab button               |
| `tab-search`      | `Tabs.Screen name="search"`        | Search tab button             |
| `tab-digests`     | `Tabs.Screen name="digests"`       | Digests tab button            |
| `tab-library`     | `Tabs.Screen name="library"`       | Library tab button            |
| `tab-study`       | `Tabs.Screen name="study"`         | Study tab button              |
| `tab-scan`        | `Tabs.Screen name="scan"`          | Scan tab button               |
| `tab-feed`        | `Tabs.Screen name="feed"`          | Feed tab button               |
| `tab-workspace`   | `Tabs.Screen name="workspace"`     | Workspace tab button          |

For tab buttons we use React Navigation's `tabBarButtonTestID` screen option,
which sets the `testID` on the underlying `PlatformPressable`.

## Credentials

Flows pull credentials from Maestro `${MAESTRO_TEST_EMAIL}` and
`${MAESTRO_TEST_PASSWORD}` env vars. **Never commit secrets** — neither this
repo, the `.maestro/` directory, nor `eas.json` should contain a real test
account password. Acceptable storage:

- Developer's shell (`export MAESTRO_TEST_EMAIL=…`) for ad-hoc runs.
- 1Password / Bitwarden / GitHub Actions secret store for CI.
- Maestro Cloud's encrypted env-var UI for cloud runs.

The test account must be a dedicated, low-privilege user on the **staging**
environment. Do not point E2E at production.

## Run locally — Android emulator

```bash
# 1. Build the e2e APK (requires EAS login + a configured Android emulator).
cd apps/mobile
eas build --profile e2e --platform android --local --output ./build/libertasian-e2e.apk

# 2. Install on a running emulator (or device with USB debugging on).
adb install -r ./build/libertasian-e2e.apk

# 3. Run the flows.
export MAESTRO_TEST_EMAIL='e2e+ci@libertasian.com'
export MAESTRO_TEST_PASSWORD='…from-secret-store…'

maestro test .maestro \
  -e MAESTRO_TEST_EMAIL="$MAESTRO_TEST_EMAIL" \
  -e MAESTRO_TEST_PASSWORD="$MAESTRO_TEST_PASSWORD"

# Or a single flow:
maestro test .maestro/auth/login.yaml \
  -e MAESTRO_TEST_EMAIL="$MAESTRO_TEST_EMAIL" \
  -e MAESTRO_TEST_PASSWORD="$MAESTRO_TEST_PASSWORD"
```

Sanity check the YAML without an emulator running:

```bash
maestro test --dry-run .maestro
```

## Run on iOS via Maestro Cloud

Maestro Cloud is the path of least resistance for iOS — running locally needs
an Apple Developer account, a signed `.ipa`, and a booted simulator on macOS.
Same flows, same testIDs, same `appId`.

```bash
# 1. Build an iOS Simulator-targeted .ipa.
eas build --profile e2e --platform ios --local --output ./build/libertasian-e2e.tar.gz
# (For Maestro Cloud iOS you want a simulator build, not a device IPA.)

# 2. Upload + run the suite on Maestro Cloud.
maestro cloud \
  --app-file ./build/libertasian-e2e.tar.gz \
  --env MAESTRO_TEST_EMAIL="$MAESTRO_TEST_EMAIL" \
  --env MAESTRO_TEST_PASSWORD="$MAESTRO_TEST_PASSWORD" \
  .maestro
```

Set the same env vars in the Maestro Cloud project settings if you wire this
into a recurring run.

## Notes & gotchas

- **`clearState: true`** in `auth/login.yaml` wipes app storage on every run,
  so MMKV-cached tokens never leak between runs.
- The `e2e` EAS profile sets `EXPO_PUBLIC_API_URL` to the staging API. Update
  that placeholder in [`eas.json`](../eas.json) when a stable staging/tunnel
  host is provisioned (see the `# TODO` comment in the file).
- The flows are deliberately tolerant of the auth landing screen — if the
  app boots straight to `(auth)/login`, the "Sign in" tap is skipped; if it
  boots to the marketing landing, the tap runs first.
- CI integration (GitHub Actions + Maestro Cloud) lands in a separate PR.
