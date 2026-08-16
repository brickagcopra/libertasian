#!/usr/bin/env node
/**
 * frame-screenshots.mjs — composite raw device screenshots into store-ready
 * framed images at the exact pixel dimensions Apple and Play expect.
 *
 * Usage:
 *   pnpm filter=mobile screenshots:frame
 *   pnpm filter=mobile screenshots:frame -- --platform iphone-6-7
 *
 * Inputs:
 *   - raw/<slug>.<rawSource>.png  (from capture-screenshots.mjs;
 *                                  rawSource is "android" or "ios")
 *   - screenshots.config.json     (screens + per-platform dimensions, captions)
 *
 * Outputs:
 *   framed/<platform>/<slug>.png  at the platform's exact width x height,
 *                                 with the warm-cream brand band, caption,
 *                                 and the raw screenshot composited and
 *                                 scaled to fit the framing area.
 *
 * Frame layout (top to bottom):
 *   - Brand band: warm-cream, caption rendered as SVG <text>, centred.
 *   - Screenshot: raw frame resized into the frameArea (config padding
 *                 subtracted from the platform canvas), centred, with a
 *                 subtle rounded corner mask and 1 px ink hairline.
 *   - Footer band: 12 px deep amber accent strip (matches feature graphic).
 *
 * Platform-to-source mapping:
 *   Each platform may declare its own `rawSource` in screenshots.config.json;
 *   the raw it frames is raw/<slug>.<rawSource>.png. Platforms that omit it
 *   fall back to the historical default — "ios" for apple, "android" for play.
 *
 *   A shared rawSource across canvases of DIFFERENT form factors is a store
 *   rejection waiting to happen: framing one 1080x2424 phone capture into the
 *   1600x2560 tablet canvas letterboxes phone UI into a tablet slot, which is
 *   the same misrepresentation (Apple 2.3.3 / Play's equivalent) that the real
 *   captures exist to fix. The three android platforms therefore each declare a
 *   distinct rawSource and need a separate emulator pass per form factor.
 *
 *   The four apple platforms still share "ios" — that is deliberate, and the
 *   two-pass procedure in store/IOS_SCREENSHOT_CAPTURE.md §4 is what keeps the
 *   iPhone and iPad sets honest: capture, frame, re-capture, frame again.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(MOBILE_ROOT, 'assets', 'store', 'screenshots.config.json');
const RAW_DIR = path.join(MOBILE_ROOT, 'assets', 'store', 'screenshots', 'raw');
const FRAMED_ROOT = path.join(MOBILE_ROOT, 'assets', 'store', 'screenshots', 'framed');

const BRAND_CREAM = '#f6f1e8';
const BRAND_INK = '#1c1a14';
const BRAND_AMBER = '#d87b2a';

function parseArgs(argv) {
  const args = { platform: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform') args.platform = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

/**
 * Build the framed SVG: brand-coloured background, caption text, owl-mark
 * watermark (small), footer accent strip. The raw screenshot is composited
 * over this SVG by sharp after rasterization.
 */
// SVG <text> does not wrap — a single long caption silently runs off both
// edges of the canvas. Every caption in screenshots.config.json is wide enough
// to do that (measured 1346-1826px against 1200px of usable width on
// iphone-6-9), so captions are wrapped into tspans here instead.
//
// Ratio is the mean advance width per character, as a fraction of font-size,
// measured by rasterising each real caption in Georgia bold and trimming:
// observed 0.497-0.532, so 0.54 is a deliberately pessimistic round-up. Erring
// high wraps a borderline caption one word early; erring low clips it.
const CAPTION_CHAR_WIDTH_RATIO = 0.54;
const CAPTION_MAX_LINES = 2;

function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * CAPTION_CHAR_WIDTH_RATIO;
}

/** Greedy word wrap against an estimated pixel width. */
function wrapCaption(text, fontSize, maxWidth) {
  const lines = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    // `!current` keeps a single over-long word on its own line rather than
    // looping forever trying to fit it.
    if (!current || estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Wrap to at most CAPTION_MAX_LINES, shrinking the font a step at a time if
 * the caption still will not fit. Returns the size actually used.
 */
function fitCaption(text, fontSize, maxWidth) {
  let size = fontSize;
  while (size > 12) {
    const lines = wrapCaption(text, size, maxWidth);
    const fits = lines.length <= CAPTION_MAX_LINES
      && lines.every((l) => estimateTextWidth(l, size) <= maxWidth);
    if (fits) return { size, lines };
    size -= 2;
  }
  return { size, lines: wrapCaption(text, size, maxWidth) };
}

function buildFrameSvg({ width, height, padding, captionFontSize, caption }) {
  // Escape caption for safe embedding in XML.
  const safeCaption = caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Keep the caption inside the same side margin the screenshot below it uses.
  const maxWidth = width - padding.left - padding.right;
  const { size, lines } = fitCaption(safeCaption, captionFontSize, maxWidth);

  // Centre the wrapped block vertically in the top band. `size * 0.36` shifts
  // from block-centre to the first line's baseline (cap height, not em box).
  const lineHeight = Math.round(size * 1.2);
  const blockTop = padding.top / 2 - (lineHeight * lines.length) / 2;
  const firstBaseline = Math.round(blockTop + size * 0.36 + lineHeight / 2);
  const tspans = lines
    .map((line, i) => `<tspan x="${width / 2}" y="${firstBaseline + i * lineHeight}">${line}</tspan>`)
    .join('\n    ');

  // Footer amber strip height — matches feature graphic proportion.
  const footerH = Math.max(10, Math.round(height * 0.006));

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_CREAM}" />
  <rect x="0" y="${height - footerH}" width="${width}" height="${footerH}" fill="${BRAND_AMBER}" />
  <text
    text-anchor="middle"
    font-family="Georgia, 'Times New Roman', 'DejaVu Serif', serif"
    font-weight="700"
    font-size="${size}"
    fill="${BRAND_INK}"
  >
    ${tspans}
  </text>
</svg>`);
}

/**
 * Resize the raw screenshot so it fits the inner frame area while preserving
 * aspect ratio (`fit: 'inside'`). Returns the resized buffer + its actual
 * rendered dimensions so we can centre it precisely.
 */
async function resizeRaw(rawPath, areaW, areaH) {
  const meta = await sharp(rawPath).metadata();
  const scale = Math.min(areaW / meta.width, areaH / meta.height);
  const renderedW = Math.floor(meta.width * scale);
  const renderedH = Math.floor(meta.height * scale);
  const buf = await sharp(rawPath).resize(renderedW, renderedH, { fit: 'inside' }).png().toBuffer();
  return { buf, width: renderedW, height: renderedH };
}

async function frameOne({ rawPath, outPath, platform, screen }) {
  const { width, height, framePadding, captionFontSize } = platform;
  const areaW = width - framePadding.left - framePadding.right;
  const areaH = height - framePadding.top - framePadding.bottom;

  const frameSvg = buildFrameSvg({
    width, height, padding: framePadding, captionFontSize, caption: screen.caption,
  });
  const raw = await resizeRaw(rawPath, areaW, areaH);

  const left = Math.round(framePadding.left + (areaW - raw.width) / 2);
  const top = Math.round(framePadding.top + (areaH - raw.height) / 2);

  // Two passes, deliberately. sharp applies `flatten` to the *input* image
  // before `composite` runs, regardless of chaining order — so flattening here
  // only touches the SVG base, and the RGBA overlay (simctl and adb both emit
  // RGBA) puts the alpha channel straight back. Compositing to a buffer and
  // then flattening + dropping alpha in a second pass is what actually lands a
  // 3-channel PNG, which is what the assertion below (and ASC) requires.
  const composited = await sharp(frameSvg)
    .composite([{ input: raw.buf, left, top }])
    .png()
    .toBuffer();

  await sharp(composited)
    .flatten({ background: BRAND_CREAM })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  if (meta.width !== width || meta.height !== height) {
    throw new Error(
      `dimension mismatch for ${path.basename(outPath)}: ` +
      `got ${meta.width}x${meta.height}, expected ${width}x${height}`,
    );
  }
  // App Store Connect REJECTS screenshots with an alpha channel. .flatten()
  // above removes it; assert rather than assume, because the failure surfaces
  // days later as a rejected submission.
  if (meta.hasAlpha || meta.channels !== 3) {
    throw new Error(
      `alpha channel in ${path.basename(outPath)}: ` +
      `channels=${meta.channels} hasAlpha=${meta.hasAlpha}`,
    );
  }
  return meta;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: frame-screenshots.mjs [--platform <name>]');
    console.log('Frames every raw screenshot in raw/ for every platform in screenshots.config.json.');
    return;
  }

  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const platforms = Object.entries(config.platforms).filter(([k]) => !args.platform || k === args.platform);
  if (platforms.length === 0) {
    console.error(`No platforms matched --platform ${args.platform}.`);
    process.exit(2);
  }

  await fs.mkdir(FRAMED_ROOT, { recursive: true });

  let framed = 0;
  let skipped = 0;
  for (const [platformKey, platform] of platforms) {
    const rawSource = platform.rawSource ?? (platform.store === 'apple' ? 'ios' : 'android');
    const outDir = path.join(FRAMED_ROOT, platformKey);
    await fs.mkdir(outDir, { recursive: true });

    console.log(`\n${platform.label} (${platformKey}) — ${platform.width}x${platform.height}, raw source: ${rawSource}`);

    for (const screen of config.screens) {
      const rawPath = path.join(RAW_DIR, `${screen.slug}.${rawSource}.png`);
      const exists = await fs.access(rawPath).then(() => true).catch(() => false);
      if (!exists) {
        console.log(`  - ${screen.slug}: SKIP (missing ${path.basename(rawPath)})`);
        skipped++;
        continue;
      }
      const outPath = path.join(outDir, `${screen.slug}.png`);
      try {
        const meta = await frameOne({ rawPath, outPath, platform, screen });
        const rel = path.relative(MOBILE_ROOT, outPath).replace(/\\/g, '/');
        console.log(`  ✓ ${screen.slug.padEnd(20)} → ${rel} (${meta.width}x${meta.height})`);
        framed++;
      } catch (e) {
        console.error(`  ✗ ${screen.slug}: ${e.message}`);
      }
    }
  }

  console.log(`\nFramed ${framed} image(s); skipped ${skipped} (missing raw).`);
  if (framed === 0) {
    console.log('Hint: run pnpm filter=mobile screenshots:capture first to produce raw/ frames.');
  }
}

main().catch((err) => {
  console.error('frame-screenshots failed:', err);
  process.exit(1);
});
