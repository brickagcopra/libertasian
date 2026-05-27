#!/usr/bin/env node
/**
 * capture-screenshots.mjs — drive an attached emulator/simulator to capture
 * raw store screenshots, one per screen entry in screenshots.config.json.
 *
 * Usage:
 *   pnpm filter=mobile screenshots:capture -- --platform android
 *   pnpm filter=mobile screenshots:capture -- --platform ios
 *   pnpm filter=mobile screenshots:capture -- --platform android --only 01-past-bar-exams
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

function parseArgs(argv) {
  const args = { platform: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') args.platform = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: capture-screenshots.mjs --platform <android|ios> [--only <slug>]

Captures raw screenshots from an attached emulator/simulator. The user is
prompted to navigate to each screen before pressing Enter to capture.

Options:
  --platform <android|ios>   which device to capture from (required)
  --only <slug>              capture a single screen by slug (e.g. 01-past-bar-exams)
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

async function captureAndroid(outPath) {
  // `adb exec-out screencap -p` streams a PNG to stdout — capture to file.
  return new Promise((resolve, reject) => {
    const out = [];
    const child = spawn('adb', ['exec-out', 'screencap', '-p']);
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
  if (!args.platform || !['android', 'ios'].includes(args.platform)) {
    printHelp();
    process.exit(2);
  }

  if (args.platform === 'android' && !which('adb')) {
    console.error('adb not found on PATH. Install Android platform-tools.');
    process.exit(3);
  }
  if (args.platform === 'ios' && !which('xcrun')) {
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
      if (args.platform === 'android') await captureAndroid(outPath);
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
