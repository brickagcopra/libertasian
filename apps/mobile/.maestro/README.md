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

The test account must be a dedicated, low-privilege user on the **isolated
e2e** backend (see next section). Do not point E2E at dev or production.

## E2E backend via ngrok

The Maestro flows create CRUD data on the way through (sign in writes a refresh
token; tab nav primes per-user state). That data **must not** land in the dev
or prod database. The repeatable setup is: spin up a throwaway Postgres DB,
seed exactly one test account, run the API locally, and expose port `3001`
through a reserved ngrok static domain so the installed APK can reach it.

`EXPO_PUBLIC_API_URL` is **baked into the APK at build time** (Metro inlines
`process.env.EXPO_PUBLIC_*`), so the ngrok hostname has to be stable across
runs — use a reserved static domain, not the rotating free URL.

Minimum services for the login + tab-nav flows: **api + postgres + redis**.
opensearch / minio / the Python services only matter once a flow exercises
search results or scan ingestion.

### 1. Create an isolated test database

```bash
# From the repo root, against the docker-compose Postgres instance.
docker compose exec postgres createdb -U postgres libertasian_e2e
```

(Adjust the role/host if your local Postgres lives elsewhere. Any empty
Postgres 16 database the API can connect to works.)

### 2. Migrate + seed the test account

```bash
# Export DATABASE_URL in this shell so it overrides the .env loaded by the
# pnpm scripts. The trailing component (libertasian_e2e) is the new DB.
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/libertasian_e2e'

# Apply migrations to the empty DB.
pnpm --filter api prisma migrate deploy

# Seed the lone E2E account. The script throws if either env var is missing.
export E2E_TEST_EMAIL='e2e+maestro@libertasian.test'
export E2E_TEST_PASSWORD='…from-secret-store…'
pnpm --filter api seed:e2e
```

The seed (`apps/api/prisma/seed-e2e.ts`) is idempotent and upserts:

- One `Organization` (slug `libertasian-e2e`)
- One `User` (bcrypt cost 12, `emailVerified: true`)
- One `OrganizationMember` (role `member`, status `active`) — mandatory for
  tenant scoping
- A `MemberRole` row linking to the system `member` `RoleDefinition` **if**
  it exists in this DB. If RBAC-permission-gated endpoints later 403,
  run `pnpm --filter api seed:rbac` against the same DB first, then re-seed.

### 3. Start the API against the test DB

```bash
# DATABASE_URL from step 2 is still exported in this shell.
pnpm --filter api dev
# API listens on http://localhost:3001 with global prefix /api/v1.
```

### 4. Expose port 3001 via your reserved ngrok static domain

```bash
ngrok http 3001 --domain=<your-static>.ngrok-free.app
```

Then update `apps/mobile/eas.json` → the `e2e` profile's `EXPO_PUBLIC_API_URL`
(and `API_URL`) by replacing the `CHANGEME.ngrok-free.app` placeholder with
your reserved domain. Keep this change local — do **not** commit the real
hostname.

### 5. Build, install, and run

```bash
cd apps/mobile

# Rebuild the APK so the new EXPO_PUBLIC_API_URL is baked in.
eas build --profile e2e --platform android --local --output ./build/libertasian-e2e.apk
adb install -r ./build/libertasian-e2e.apk

# Flows pick up creds from the same env vars used by seed:e2e.
maestro test .maestro \
  -e MAESTRO_TEST_EMAIL="$E2E_TEST_EMAIL" \
  -e MAESTRO_TEST_PASSWORD="$E2E_TEST_PASSWORD"
```

### Gotcha: ngrok browser-warning interstitial

On the free tier, ngrok serves an HTML interstitial on the first browser-like
request to a tunnel. Mobile API calls don't trigger it on every request, but
they do hit it occasionally — manifesting as JSON parse errors against an HTML
body. The mobile API client (`apps/mobile/src/lib/api-client.ts`) detects an
ngrok hostname in `EXPO_PUBLIC_API_URL` and automatically attaches the header
`ngrok-skip-browser-warning: 1` to every request (and multipart upload). No
manual flag toggling is required — pointing the e2e profile at an
`*.ngrok-free.app` URL is enough.

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
- The `e2e` EAS profile sets `EXPO_PUBLIC_API_URL` to an ngrok static-domain
  placeholder (`CHANGEME.ngrok-free.app`). Swap in your reserved domain in
  [`eas.json`](../eas.json) before building. See "E2E backend via ngrok"
  above for the full runbook.
- The flows are deliberately tolerant of the auth landing screen — if the
  app boots straight to `(auth)/login`, the "Sign in" tap is skipped; if it
  boots to the marketing landing, the tap runs first.
- CI integration (GitHub Actions + Maestro Cloud) lands in a separate PR.
