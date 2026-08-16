#!/usr/bin/env node
/**
 * capture-screenshots.mjs — drive an attached emulator/simulator to capture
 * raw store screenshots, one per screen entry in screenshots.config.json.
 *
 * Usage (from apps/mobile — `pnpm filter=mobile ...` is not valid pnpm):
 *   pnpm screenshots:capture -- --platform android-phone
 *   pnpm screenshots:capture -- --platform ios
 *   pnpm screenshots:capture -- --platform android-tablet-10 --only 01-past-bar-exams
 *   pnpm screenshots:capture -- --platform android-phone --serial emulator-5554
 *
 * --platform doubles as the raw-file suffix, so each Play form factor writes to
 * its own raw/<slug>.<platform>.png and frame-screenshots.mjs picks it up via
 * that platform's `rawSource`. Capturing one phone pass and framing it into the
 * tablet canvases letterboxes phone UI into a tablet slot — the exact
 * misrepresentation these real captures exist to fix. Do a pass per form factor.
 *
 * --serial pins adb to one device. With several emulators attached adb aborts
 * on ambiguity; worse, the iOS side of this script hit the silent version of
 * that bug (`simctl io booted` picked the wrong simulator and framed an iPad
 * into the iPhone canvas — see store/IOS_SCREENSHOT_CAPTURE.md §8a note 4).
 *
 * Tooling required on PATH:
 *   - android: adb (Android platform-tools)
 *   - ios:     xcrun simctl  (macOS + Xcode command-line tools)
 *
 * Workflow per screen:
 *   1. Print the screen's navHint.
 *   2. Wait for the user to press Enter once they have navigated.
 *   3. Run platform screenshot command, save to
 *      assets/store/screenshots/raw/<slug>.<platform>.png.
 *   4. Move on to the next screen.
 *
 * The raw frames live under raw/ and are not committed by this PR — the
 * follow-up commit captures them against the live emulator and then runs
 * `screenshots:frame` to produce store-ready images.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(MOBILE_ROOT, 'assets', 'store', 'screenshots.config.json');
const RAW_DIR = path.join(MOBILE_ROOT, 'assets', 'store', 'screenshots', 'raw');

// Every accepted --platform value, mapped to the device family it drives. The
// key is also the raw-file suffix, which is what keeps the three Play form
// factors in separate files. "android" is kept for backwards compatibility with
// the original single-pass invocation.
const PLATFORMS = {
  'ios': 'ios',
  'android': 'android',
  'android-phone': 'android',
  'android-tablet-7': 'android',
  'android-tablet-10': 'android',
};

function parseArgs(argv) {
  const args = { platform: null, only: null, serial: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') args.platform = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--serial') args.serial = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: capture-screenshots.mjs --platform <${Object.keys(PLATFORMS).join('|')}> [--only <slug>] [--serial <id>]

Captures raw screenshots from an attached emulator/simulator. The user is
prompted to navigate to each screen before pressing Enter to capture.

Raw frames are written to raw/<slug>.<platform>.png, so each Play form factor
gets its own pass — do NOT frame a phone capture into a tablet canvas.

Options:
  --platform <name>          which device to capture from (required)
  --only <slug>              capture a single screen by slug (e.g. 01-past-bar-exams)
  --serial <id>              adb device serial (android only; required when
                             more than one emulator is attached)
`);
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

function which(cmd) {
  // Cross-platform `which` for friendlier error messages.
  const probe = process.platform === 'win32'
    ? spawnSync('where', [cmd], { encoding: 'utf8' })
    : spawnSync('command', ['-v', cmd], { encoding: 'utf8', shell: true });
  return probe.status === 0;
}

async function captureAndroid(outPath, serial) {
  // `adb exec-out screencap -p` streams a PNG to stdout — capture to file.
  return new Promise((resolve, reject) => {
    const out = [];
    const argv = serial ? ['-s', serial] : [];
    const child = spawn('adb', [...argv, 'exec-out', 'screencap', '-p']);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`adb exited ${code}`));
      try {
        await fs.writeFile(outPath, Buffer.concat(out));
        resolve();
      } catch (e) { reject(e); }
    });
  });
}

async function captureIos(outPath) {
  // `xcrun simctl io booted screenshot <path>` writes a PNG directly.
  return new Promise((resolve, reject) => {
    const child = spawn('xcrun', ['simctl', 'io', 'booted', 'screenshot', outPath]);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`xcrun simctl exited ${code}`));
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  const family = PLATFORMS[args.platform];
  if (!family) {
    printHelp();
    process.exit(2);
  }

  if (family === 'android' && !which('adb')) {
    console.error('adb not found on PATH. Install Android platform-tools.');
    process.exit(3);
  }
  if (family === 'ios' && !which('xcrun')) {
    console.error('xcrun not found on PATH. iOS capture requires macOS + Xcode.');
    process.exit(3);
  }

  await fs.mkdir(RAW_DIR, { recursive: true });

  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const screens = args.only
    ? config.screens.filter((s) => s.slug === args.only)
    : config.screens;

  if (screens.length === 0) {
    console.error(`No screens to capture${args.only ? ` (--only ${args.only} matched nothing)` : ''}.`);
    process.exit(4);
  }

  console.log(`Capturing ${screens.length} screen(s) for ${args.platform}.`);
  console.log(`Raw frames will be written to: ${path.relative(MOBILE_ROOT, RAW_DIR).replace(/\\/g, '/')}/`);
  console.log('');

  for (const screen of screens) {
    console.log(`— ${screen.title} (${screen.slug})`);
    console.log(`  Navigate: ${screen.navHint}`);
    await prompt('  Press Enter when the screen is ready (or Ctrl+C to abort)... ');

    const outName = `${screen.slug}.${args.platform}.png`;
    const outPath = path.join(RAW_DIR, outName);
    try {
      if (family === 'android') await captureAndroid(outPath, args.serial);
      else await captureIos(outPath);
      console.log(`  ✓ saved ${path.relative(MOBILE_ROOT, outPath).replace(/\\/g, '/')}`);
    } catch (e) {
      console.error(`  ✗ capture failed: ${e.message}`);
      const cont = await prompt('  Continue with the next screen? [y/N] ');
      if (cont.trim().toLowerCase() !== 'y') process.exit(5);
    }
    console.log('');
  }

  console.log('Done. Next: pnpm filter=mobile screenshots:frame');
}

main().catch((err) => {
  console.error('capture-screenshots failed:', err);
  process.exit(1);
});
