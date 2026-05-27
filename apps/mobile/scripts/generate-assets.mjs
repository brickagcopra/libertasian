#!/usr/bin/env node
/**
 * generate-assets.mjs — rasterize the owl SVG sources into the PNGs Expo
 * and the App Store / Play Store consume.
 *
 * Inputs  (apps/mobile/assets/store/src/*.svg):
 *   icon-master.svg          — owl on warm-cream, used for iOS master + Play hi-res
 *   adaptive-foreground.svg  — owl scaled to inner 66% safe zone, transparent bg
 *   splash.svg               — transparent owl for Expo splash composite
 *   feature-graphic.svg      — 1024x500 Play feature graphic
 *
 * Outputs (apps/mobile/assets/*.png and apps/mobile/assets/store/*.png):
 *   icon.png                          1024x1024, NO alpha (iOS master + Expo source)
 *   adaptive-icon.png                 1024x1024, alpha (Android adaptive foreground)
 *   splash-icon.png                   1024x1024, alpha (Expo splash composite)
 *   store/play-icon-512.png            512x512, NO alpha (Play hi-res listing icon)
 *   store/feature-graphic-1024x500.png 1024x500, NO alpha (Play feature graphic)
 *
 * Run: `pnpm --filter mobile generate:assets`
 *
 * Implementation notes:
 *  - sharp is added as an apps/mobile devDependency. It pulls in libvips,
 *    which renders SVG via librsvg + pango. The feature graphic relies on
 *    librsvg's text rendering for the wordmark — see feature-graphic.svg
 *    for the host-font fallback behaviour.
 *  - "NO alpha" outputs go through `.flatten({ background: '#f6f1e8' })`
 *    then `.png({ palette: false })` and the alpha channel is asserted
 *    absent at the end.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(MOBILE_ROOT, 'assets', 'store', 'src');
const ASSETS_DIR = path.join(MOBILE_ROOT, 'assets');
const STORE_DIR = path.join(MOBILE_ROOT, 'assets', 'store');

const BRAND_CREAM = '#f6f1e8';

/**
 * Rasterize an SVG file to a PNG at a target size.
 *
 * Density math: sharp's SVG renderer uses `density` (DPI) to control
 * rasterization precision. We compute the density that maps the SVG's
 * intrinsic dimensions to the desired output pixel size, then resize to
 * be exact in case of rounding.
 */
async function rasterize({ svgPath, outPath, width, height, flatten }) {
  const svg = await fs.readFile(svgPath);
  // Probe intrinsic size of the SVG to scale density correctly.
  const probe = await sharp(svg).metadata();
  const intrinsicW = probe.width ?? width;
  // Use the larger ratio so neither dimension is starved when aspect
  // ratios differ (e.g. the feature graphic).
  const targetMax = Math.max(width, height);
  const intrinsicMax = Math.max(probe.width ?? width, probe.height ?? height);
  const density = Math.ceil((targetMax / intrinsicMax) * 72 * 4); // 4x oversample

  let pipeline = sharp(svg, { density })
    .resize(width, height, { fit: 'fill' });

  if (flatten) {
    pipeline = pipeline.flatten({ background: BRAND_CREAM });
  }

  await pipeline
    .png({ compressionLevel: 9, palette: false })
    .toFile(outPath);

  // Verify dimensions + alpha post-write so a regression here fails the
  // script rather than landing a wrong-sized icon in the store.
  const meta = await sharp(outPath).metadata();
  if (meta.width !== width || meta.height !== height) {
    throw new Error(
      `dimension mismatch for ${path.basename(outPath)}: ` +
      `got ${meta.width}x${meta.height}, expected ${width}x${height}`,
    );
  }
  if (flatten && meta.hasAlpha) {
    throw new Error(
      `${path.basename(outPath)} must NOT have an alpha channel ` +
      `(Apple/Play reject icons with alpha)`,
    );
  }
  return meta;
}

async function main() {
  const targets = [
    {
      label: 'iOS master + Expo icon',
      svgPath: path.join(SRC_DIR, 'icon-master.svg'),
      outPath: path.join(ASSETS_DIR, 'icon.png'),
      width: 1024,
      height: 1024,
      flatten: true,
    },
    {
      label: 'Android adaptive foreground',
      svgPath: path.join(SRC_DIR, 'adaptive-foreground.svg'),
      outPath: path.join(ASSETS_DIR, 'adaptive-icon.png'),
      width: 1024,
      height: 1024,
      flatten: false,
    },
    {
      label: 'Expo splash mark',
      svgPath: path.join(SRC_DIR, 'splash.svg'),
      outPath: path.join(ASSETS_DIR, 'splash-icon.png'),
      width: 1024,
      height: 1024,
      flatten: false,
    },
    {
      label: 'Play hi-res listing icon',
      svgPath: path.join(SRC_DIR, 'icon-master.svg'),
      outPath: path.join(STORE_DIR, 'play-icon-512.png'),
      width: 512,
      height: 512,
      flatten: true,
    },
    {
      label: 'Play feature graphic',
      svgPath: path.join(SRC_DIR, 'feature-graphic.svg'),
      outPath: path.join(STORE_DIR, 'feature-graphic-1024x500.png'),
      width: 1024,
      height: 500,
      flatten: true,
    },
  ];

  await fs.mkdir(STORE_DIR, { recursive: true });

  console.log('Generating store assets...');
  for (const target of targets) {
    const meta = await rasterize(target);
    const alphaNote = meta.hasAlpha ? 'alpha=Y' : 'alpha=N';
    const rel = path.relative(MOBILE_ROOT, target.outPath).replace(/\\/g, '/');
    console.log(`  ✓ ${rel.padEnd(46)} ${meta.width}x${meta.height} ${alphaNote}  (${target.label})`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('generate-assets failed:', err);
  process.exit(1);
});
