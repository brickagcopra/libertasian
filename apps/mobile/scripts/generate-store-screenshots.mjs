#!/usr/bin/env node
/**
 * generate-store-screenshots.mjs — generate polished MARKETING store
 * screenshots (designed promo mockups, NOT literal device captures) for the
 * LIBERTASIAN mobile app, for both Apple and Google Play, at each store's
 * exact required pixel dimensions.
 *
 * Approach: each screenshot is authored as one self-contained SVG at the
 * target pixel size (cream brand background + serif caption band with an
 * amber rule + a stylized white phone/tablet device mock containing an
 * abstract UI for one screen). The SVG is rasterized to PNG with sharp using
 * the density-oversample trick reused from generate-assets.mjs. No puppeteer /
 * resvg / canvas — sharp (librsvg) only.
 *
 * Output:
 *   assets/store/screenshots/marketing/<platformKey>/<slug>.png
 *
 * Run: `pnpm --filter mobile screenshots:marketing`
 *  or: `cd apps/mobile && node scripts/generate-store-screenshots.mjs`
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(
  MOBILE_ROOT, 'assets', 'store', 'screenshots', 'marketing',
);

// ---------------------------------------------------------------------------
// Brand system (verbatim from the project brand spec).
// ---------------------------------------------------------------------------
const CREAM = '#f6f1e8';
const INK = '#1c1a14';
const SOFT = '#5c5448';
const FAINT = '#9a8f7c';
const AMBER = '#d87b2a';
const DEEP = '#b65e13';
const SOFTACC = '#fbe7cf';
const SURFACE = '#ffffff';
const MUTED = '#efe7d7';
const SYNC_GREEN = '#5a9e7a';

const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
const SANS = "Inter, -apple-system, 'Segoe UI', sans-serif";

// Non-ASCII glyphs expressed as JS escapes so the source file stays pure ASCII.
const EMDASH = '—'; // em dash
const MIDDOT = '·'; // middle dot

// ---------------------------------------------------------------------------
// Tiny SVG string helpers.
// ---------------------------------------------------------------------------
function f(n, d = 2) {
  return Number(n.toFixed(d));
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function r(x, y, w, h, rx, fill, opts = '') {
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${fill}" ${opts}/>`;
}
function circle(cx, cy, rad, fill, opts = '') {
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="${fill}" ${opts}/>`;
}
function t(x, y, size, fill, anchor, family, weight, content) {
  return `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" fill="${fill}" text-anchor="${anchor}" font-family="${family}" font-weight="${weight}">${content}</text>`;
}
function chevron(x, y, size, color, sw) {
  return `<path d="M ${f(x)} ${f(y - size)} L ${f(x + size * 0.7)} ${f(y)} L ${f(x)} ${f(y + size)}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ---------------------------------------------------------------------------
// Brand owl mark (copied verbatim from assets/store/src/owl-mark.svg, 1024
// viewBox) scaled + centred at (cx, cy) with the given pixel size.
// ---------------------------------------------------------------------------
function owl(cx, cy, size) {
  const s = size / 1024;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return `<g transform="translate(${f(tx)},${f(ty)}) scale(${f(s, 5)})">`
    + `<path d="M 220 460 C 220 360, 252 280, 304 232 L 332 188 Q 348 178, 358 196 L 368 264 Q 432 224, 512 224 Q 592 224, 656 264 L 666 196 Q 676 178, 692 188 L 720 232 C 772 280, 804 360, 804 460 C 804 600, 778 720, 700 788 Q 620 836, 512 836 Q 404 836, 324 788 C 246 720, 220 600, 220 460 Z" fill="#1c1a14"/>`
    + circle(424, 436, 92, '#d87b2a') + circle(424, 436, 72, '#faefd9') + circle(424, 436, 34, '#1c1a14') + circle(412, 424, 10, '#ffffff')
    + circle(600, 436, 92, '#d87b2a') + circle(600, 436, 72, '#faefd9') + circle(600, 436, 34, '#1c1a14') + circle(588, 424, 10, '#ffffff')
    + `<path d="M 512 552 L 488 510 L 536 510 Z" fill="#b65e13"/>`
    + `<path d="M 452 660 L 572 660" stroke="#d87b2a" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M 452 696 L 572 696" stroke="#d87b2a" stroke-width="10" stroke-linecap="round"/>`
    + `<path d="M 452 732 L 572 732" stroke="#d87b2a" stroke-width="10" stroke-linecap="round"/>`
    + `</g>`;
}

// Status bar + app bar chrome inside a device screen. Returns { svg, top }
// where top is the y of the hairline under the app bar.
function chrome(S, title) {
  let s = '';
  const statusH = S.h * 0.03;
  s += t(S.x + S.w * 0.06, S.y + statusH * 0.72, statusH * 0.6, SOFT, 'start', SANS, '600', '9:41');
  s += r(S.x + S.w - S.w * 0.13, S.y + statusH * 0.3, S.w * 0.075, statusH * 0.4, statusH * 0.2, SOFT);
  const abTop = S.y + statusH;
  const abH = S.h * 0.085;
  const owlS = abH * 0.66;
  const ocx = S.x + S.w * 0.11;
  const ocy = abTop + abH / 2;
  s += owl(ocx, ocy, owlS);
  s += t(ocx + owlS * 0.72, ocy + abH * 0.13, abH * 0.36, INK, 'start', SERIF, '600', esc(title));
  const hairY = abTop + abH;
  s += r(S.x, hairY, S.w, Math.max(1.5, S.w * 0.0022), 0, INK, 'fill-opacity="0.10"');
  return { svg: s, top: hairY };
}

// ---------------------------------------------------------------------------
// Per-screen UI mock builders. Each receives the screen rect S = {x,y,w,h}
// and the content-area top (below the app bar) and returns an SVG fragment.
// ---------------------------------------------------------------------------
function s1PastBar(S, ct) {
  let s = '';
  const pad = S.w * 0.06;
  const x0 = S.x + pad;
  const cw = S.w - 2 * pad;
  const searchH = S.h * 0.055;
  const sy = ct;
  s += r(x0, sy, cw, searchH, searchH / 2, MUTED);
  const mcx = x0 + searchH * 0.62;
  const mcy = sy + searchH / 2;
  const mr = searchH * 0.2;
  s += `<circle cx="${f(mcx)}" cy="${f(mcy)}" r="${f(mr)}" fill="none" stroke="${FAINT}" stroke-width="${f(searchH * 0.05)}"/>`;
  s += `<path d="M ${f(mcx + mr * 0.7)} ${f(mcy + mr * 0.7)} L ${f(mcx + mr * 1.5)} ${f(mcy + mr * 1.5)}" stroke="${FAINT}" stroke-width="${f(searchH * 0.05)}" stroke-linecap="round"/>`;
  s += t(x0 + searchH * 1.1, mcy + searchH * 0.13, searchH * 0.36, FAINT, 'start', SANS, '400', 'Search year or subject');
  const rowsTop = sy + searchH + S.h * 0.03;
  const bottom = S.y + S.h - pad;
  const rows = [
    ['2024', 'Political Law'], ['2019', 'Civil Law'], ['2016', 'Remedial Law'],
    ['2010', 'Labor Law'], ['2005', 'Criminal Law'], ['1998', 'Legal Ethics'],
  ];
  const gap = S.h * 0.018;
  const rowH = (bottom - rowsTop - gap * (rows.length - 1)) / rows.length;
  rows.forEach((rw, i) => {
    const ry = rowsTop + i * (rowH + gap);
    s += r(x0, ry, cw, rowH, rowH * 0.22, SURFACE, `stroke="${INK}" stroke-opacity="0.10" stroke-width="${f(S.w * 0.0025)}"`);
    const tx = x0 + rowH * 0.42;
    const tcy = ry + rowH / 2;
    const fsz = rowH * 0.34;
    s += `<text x="${f(tx)}" y="${f(tcy + fsz * 0.35)}" font-size="${f(fsz)}" font-family="${SANS}" text-anchor="start"><tspan font-weight="700" fill="${INK}">${rw[0]}</tspan><tspan fill="${SOFT}">  ${MIDDOT}  ${esc(rw[1])}</tspan></text>`;
    s += chevron(x0 + cw - rowH * 0.5, tcy, rowH * 0.16, FAINT, S.w * 0.006);
  });
  return s;
}

function s2CaseDigest(S, ct) {
  let s = '';
  const pad = S.w * 0.06;
  const x0 = S.x + pad;
  const cw = S.w - 2 * pad;
  let y = ct;
  const titleF = S.w * 0.058;
  s += t(x0, y + titleF, titleF, INK, 'start', SERIF, '700', 'People v. Dela Cruz');
  y += titleF + S.h * 0.012;
  const subF = S.w * 0.034;
  s += t(x0, y + subF, subF, SOFT, 'start', SANS, '500', 'G.R. No. 213216');
  y += subF + S.h * 0.03;
  const labels = ['FACTS', 'ISSUES', 'RULING', 'DOCTRINE'];
  let chipF = S.w * 0.028;
  let hpad = S.w * 0.028;
  let cgap = S.w * 0.022;
  const chipH = S.h * 0.05;
  const wOf = () => labels.map((l) => l.length * chipF * 0.62 + hpad * 2);
  let widths = wOf();
  let total = widths.reduce((a, b) => a + b, 0) + cgap * (labels.length - 1);
  if (total > cw) {
    const k = cw / total;
    chipF *= k; hpad *= k; cgap *= k;
    widths = wOf();
    total = widths.reduce((a, b) => a + b, 0) + cgap * (labels.length - 1);
  }
  let cx = x0;
  labels.forEach((l, i) => {
    const w = widths[i];
    const active = i === 0;
    s += r(cx, y, w, chipH, chipH / 2, active ? AMBER : SOFTACC);
    s += t(cx + w / 2, y + chipH / 2 + chipF * 0.35, chipF, active ? CREAM : DEEP, 'middle', SANS, '700', l);
    cx += w + cgap;
  });
  y += chipH + S.h * 0.035;
  s += t(x0, y, S.w * 0.03, SOFT, 'start', SANS, '700', 'FACTS');
  y += S.h * 0.026;
  const provY = S.y + S.h - pad;
  const barBottom = provY - S.h * 0.06;
  const barGap = S.h * 0.028;
  const barH = S.h * 0.018;
  const ws = [1, 0.96, 0.99, 0.9, 0.94, 0.68];
  let by = y;
  let i = 0;
  while (by + barH <= barBottom && i < ws.length) {
    s += r(x0, by, cw * ws[i], barH, barH / 2, MUTED);
    by += barH + barGap;
    i += 1;
  }
  // provenance footer with a tiny document glyph.
  const docH = S.h * 0.03;
  const docW = S.w * 0.028;
  s += r(x0, provY - docH, docW, docH, S.w * 0.005, SOFTACC, `stroke="${DEEP}" stroke-opacity="0.5" stroke-width="${f(S.w * 0.002)}"`);
  s += t(x0 + docW + S.w * 0.02, provY - docH * 0.22, S.w * 0.03, FAINT, 'start', SANS, '500', 'Source: SC E-Library');
  return s;
}

function s3Codal(S, ct) {
  let s = '';
  const railW = S.w * 0.17;
  const railX = S.x;
  const railTop = ct - S.h * 0.01;
  const railBottom = S.y + S.h - S.h * 0.02;
  s += r(railX, railTop, railW, railBottom - railTop, 0, MUTED);
  const arts = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const rgap = (railBottom - railTop) / (arts.length + 1);
  arts.forEach((a, i) => {
    const ay = railTop + rgap * (i + 1);
    const active = a === 'III';
    if (active) {
      const pw = railW * 0.62;
      const ph = rgap * 0.72;
      s += r(railX + (railW - pw) / 2, ay - ph / 2, pw, ph, ph / 2, AMBER);
    }
    s += t(railX + railW / 2, ay + S.w * 0.012, S.w * 0.03, active ? CREAM : SOFT, 'middle', SERIF, '600', a);
  });
  const mx = railX + railW + S.w * 0.05;
  const mw = S.x + S.w - mx - S.w * 0.05;
  let y = ct;
  const hF = S.w * 0.042;
  s += t(mx, y + hF, hF, INK, 'start', SERIF, '700', `ARTICLE III ${EMDASH} Bill of Rights`);
  y += hF + S.h * 0.04;
  ['Section 1.', 'Section 2.'].forEach((sec) => {
    s += t(mx, y + S.w * 0.036, S.w * 0.036, DEEP, 'start', SANS, '700', sec);
    y += S.h * 0.045;
    for (let k = 0; k < 3; k += 1) {
      s += r(mx, y, mw * (k === 2 ? 0.7 : 1), S.h * 0.016, S.h * 0.008, MUTED);
      y += S.h * 0.032;
    }
    y += S.h * 0.02;
  });
  return s;
}

function s4Ai(S, ct) {
  let s = '';
  const pad = S.w * 0.06;
  const x0 = S.x + pad;
  const cw = S.w - 2 * pad;
  let y = ct;
  const ubW = cw * 0.72;
  const ubH = S.h * 0.06;
  const ubX = x0 + cw - ubW;
  s += r(ubX, y, ubW, ubH, ubH * 0.4, AMBER);
  s += t(ubX + ubW - ubH * 0.4, y + ubH / 2 + S.w * 0.014, S.w * 0.032, CREAM, 'end', SANS, '500', 'What is the exclusionary rule?');
  y += ubH + S.h * 0.03;
  const abW = cw * 0.92;
  const abX = x0;
  const abH = S.h * 0.32;
  s += r(abX, y, abW, abH, S.w * 0.03, MUTED);
  const ix = abX + S.w * 0.04;
  let iy = y + S.h * 0.05;
  const iw = abW - S.w * 0.08;
  [1, 0.95, 0.98, 0.72].forEach((w) => {
    s += r(ix, iy, iw * w, S.h * 0.016, S.h * 0.008, FAINT, 'fill-opacity="0.55"');
    iy += S.h * 0.032;
  });
  iy += S.h * 0.015;
  const cites = [`[1] Stonehill v. Diokno`, `[2] Art. III Sec. 3(2)`];
  const chF = S.w * 0.026;
  const chH = S.h * 0.042;
  const cgap = S.w * 0.025;
  let ccx = ix;
  cites.forEach((c) => {
    const w = c.length * chF * 0.56 + S.w * 0.04;
    if (ccx + w > ix + iw) {
      ccx = ix;
      iy += chH + S.h * 0.015;
    }
    s += r(ccx, iy, w, chH, chH / 2, INK);
    s += t(ccx + w / 2, iy + chH / 2 + chF * 0.35, chF, CREAM, 'middle', SANS, '600', esc(c));
    ccx += w + cgap;
  });
  return s;
}

function s5Camera(S, ct) {
  let s = '';
  const pad = S.w * 0.06;
  const x0 = S.x + pad;
  const cw = S.w - 2 * pad;
  const vfTop = ct;
  const vfBottom = S.y + S.h - S.h * 0.14;
  const vfX = x0;
  const vfW = cw;
  const vfH = vfBottom - vfTop;
  s += r(vfX, vfTop, vfW, vfH, S.w * 0.03, INK, 'fill-opacity="0.06"');
  const docW = vfW * 0.62;
  const docH = vfH * 0.72;
  const docX = vfX + (vfW - docW) / 2;
  const docY = vfTop + (vfH - docH) / 2;
  s += r(docX, docY, docW, docH, S.w * 0.01, SURFACE, 'fill-opacity="0.9"');
  let dy = docY + docH * 0.12;
  const dgap = docH * 0.09;
  for (let k = 0; k < 6; k += 1) {
    s += r(docX + docW * 0.12, dy, docW * (k % 3 === 2 ? 0.4 : 0.76), docH * 0.03, docH * 0.015, FAINT, 'fill-opacity="0.5"');
    dy += dgap;
  }
  const bl = Math.min(vfW, vfH) * 0.1;
  const bw2 = S.w * 0.01;
  const off = S.w * 0.02;
  const br = (bx, byy, dx, dyy) => `<path d="M ${f(bx)} ${f(byy + dyy * bl)} L ${f(bx)} ${f(byy)} L ${f(bx + dx * bl)} ${f(byy)}" fill="none" stroke="${AMBER}" stroke-width="${f(bw2)}" stroke-linecap="round"/>`;
  s += br(vfX + off, vfTop + off, 1, 1);
  s += br(vfX + vfW - off, vfTop + off, -1, 1);
  s += br(vfX + off, vfBottom - off, 1, -1);
  s += br(vfX + vfW - off, vfBottom - off, -1, -1);
  const shcx = S.x + S.w / 2;
  const shcy = S.y + S.h - S.h * 0.075;
  const shr = S.h * 0.045;
  s += `<circle cx="${f(shcx)}" cy="${f(shcy)}" r="${f(shr)}" fill="none" stroke="${INK}" stroke-width="${f(S.w * 0.01)}"/>`;
  s += circle(shcx, shcy, shr * 0.72, AMBER);
  const cardW = cw * 0.8;
  const cardH = S.h * 0.09;
  const cardX = S.x + S.w / 2 - cardW / 2;
  const cardY = shcy - shr - S.h * 0.02 - cardH;
  s += r(cardX, cardY, cardW, cardH, cardH * 0.22, SURFACE, `stroke="${INK}" stroke-opacity="0.10" stroke-width="${f(S.w * 0.0025)}"`);
  const chkc = cardX + cardH * 0.6;
  const chkcy = cardY + cardH / 2;
  const chkr = cardH * 0.28;
  s += circle(chkc, chkcy, chkr, AMBER);
  s += `<path d="M ${f(chkc - chkr * 0.45)} ${f(chkcy)} L ${f(chkc - chkr * 0.1)} ${f(chkcy + chkr * 0.4)} L ${f(chkc + chkr * 0.5)} ${f(chkcy - chkr * 0.4)}" fill="none" stroke="${CREAM}" stroke-width="${f(cardH * 0.06)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += t(cardX + cardH * 1.05, cardY + cardH * 0.44, cardH * 0.26, INK, 'start', SANS, '700', 'Digest generated');
  s += t(cardX + cardH * 1.05, cardY + cardH * 0.74, cardH * 0.22, SOFT, 'start', SANS, '400', 'Tap to review');
  return s;
}

function cloud(cx, cy, rad) {
  let s = '';
  s += circle(cx - rad * 0.5, cy + rad * 0.1, rad * 0.45, AMBER);
  s += circle(cx + rad * 0.4, cy + rad * 0.1, rad * 0.5, AMBER);
  s += circle(cx, cy - rad * 0.25, rad * 0.55, AMBER);
  s += r(cx - rad * 0.8, cy + rad * 0.1, rad * 1.6, rad * 0.45, rad * 0.22, AMBER);
  s += `<path d="M ${f(cx - rad * 0.28)} ${f(cy - rad * 0.02)} A ${f(rad * 0.3)} ${f(rad * 0.3)} 0 1 1 ${f(cx - rad * 0.36)} ${f(cy + rad * 0.26)}" fill="none" stroke="${CREAM}" stroke-width="${f(rad * 0.1)}" stroke-linecap="round"/>`;
  s += `<path d="M ${f(cx - rad * 0.36)} ${f(cy + rad * 0.05)} L ${f(cx - rad * 0.28)} ${f(cy - rad * 0.02)} L ${f(cx - rad * 0.2)} ${f(cy + rad * 0.1)}" fill="none" stroke="${CREAM}" stroke-width="${f(rad * 0.1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

function s6Sync(S, ct) {
  let s = '';
  const pad = S.w * 0.06;
  const x0 = S.x + pad;
  const cw = S.w - 2 * pad;
  let y = ct;
  const iconCx = S.x + S.w / 2;
  const iconCy = y + S.h * 0.075;
  const iconR = S.h * 0.065;
  s += circle(iconCx, iconCy, iconR, SOFTACC);
  s += cloud(iconCx, iconCy, iconR * 0.85);
  y = iconCy + iconR + S.h * 0.045;
  s += t(x0, y, S.w * 0.028, FAINT, 'start', SANS, '700', 'SYNC');
  y += S.h * 0.03;
  const rowH = S.h * 0.07;
  const rowStroke = `stroke="${INK}" stroke-opacity="0.08" stroke-width="${f(S.w * 0.0022)}"`;
  // Offline codals toggle row (ON).
  s += r(x0, y, cw, rowH, rowH * 0.2, SURFACE, rowStroke);
  s += t(x0 + rowH * 0.4, y + rowH / 2 + S.w * 0.014, S.w * 0.032, INK, 'start', SANS, '600', 'Offline codals');
  const tgW = S.w * 0.13;
  const tgH = S.h * 0.036;
  const tgX = x0 + cw - tgW - rowH * 0.4;
  const tgY = y + rowH / 2 - tgH / 2;
  s += r(tgX, tgY, tgW, tgH, tgH / 2, AMBER);
  s += circle(tgX + tgW - tgH / 2, tgY + tgH / 2, tgH * 0.38, SURFACE);
  y += rowH + S.h * 0.02;
  s += t(x0 + rowH * 0.1, y + S.w * 0.028, S.w * 0.03, SOFT, 'start', SANS, '400', 'Last synced 2 min ago');
  y += S.h * 0.05;
  [['Mobile', 'Synced'], ['Web (libertasian.com)', 'Synced']].forEach(([lab, st]) => {
    s += r(x0, y, cw, rowH, rowH * 0.2, SURFACE, rowStroke);
    s += t(x0 + rowH * 0.4, y + rowH / 2 + S.w * 0.014, S.w * 0.032, INK, 'start', SANS, '600', esc(lab));
    s += circle(x0 + cw - rowH * 1.7, y + rowH / 2, S.w * 0.012, SYNC_GREEN);
    s += t(x0 + cw - rowH * 1.45, y + rowH / 2 + S.w * 0.012, S.w * 0.028, SOFT, 'start', SANS, '500', st);
    y += rowH + S.h * 0.02;
  });
  return s;
}

// ---------------------------------------------------------------------------
// Screens + platforms.
// ---------------------------------------------------------------------------
const SCREENS = [
  { slug: '01-past-bar-exams', title: 'Past Bar Exams', caption: '1,500+ Philippine Bar questions, 1953 to 2024.', draw: s1PastBar },
  { slug: '02-case-digests', title: 'Case Digest', caption: 'Supreme Court digests with provenance to the source.', draw: s2CaseDigest },
  { slug: '03-codal-reader', title: 'Codal Reader', caption: '1987 Constitution, Rules of Court, Republic Acts.', draw: s3Codal },
  { slug: '04-ai-assistant', title: 'AI Assistant', caption: `Grounded answers with citations ${EMDASH} never fabricated.`, draw: s4Ai },
  { slug: '05-camera-scan', title: 'Scan', caption: 'Scan a printout. Get a structured digest.', draw: s5Camera },
  { slug: '06-offline-sync', title: 'Sync', caption: 'Offline codal cache. Syncs with libertasian.com on web.', draw: s6Sync },
];

const PLATFORMS = [
  { key: 'iphone-6-7', label: 'iPhone 6.7"', width: 1290, height: 2796, topPad: 380, captionFont: 64 },
  { key: 'ipad-12-9', label: 'iPad 12.9"', width: 2048, height: 2732, topPad: 400, captionFont: 78 },
  // App Store Connect requires a 6.9" iPhone and a 13" iPad set for a NEW
  // app listing; the 6.7"/12.9" sets above no longer satisfy it on their own.
  { key: 'iphone-6-9', label: 'iPhone 6.9"', width: 1320, height: 2868, topPad: 390, captionFont: 66 },
  { key: 'ipad-13', label: 'iPad 13"', width: 2064, height: 2752, topPad: 400, captionFont: 78 },
  { key: 'android-phone', label: 'Android phone', width: 1080, height: 1920, topPad: 320, captionFont: 56 },
  { key: 'android-tablet-7', label: 'Android 7" tablet', width: 1200, height: 1920, topPad: 320, captionFont: 60 },
  { key: 'android-tablet-10', label: 'Android 10" tablet', width: 1600, height: 2560, topPad: 380, captionFont: 72 },
];

function wrapCaption(text, cpl) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= cpl || !cur) {
      cur = cand;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildSvg(platform, screen) {
  const { key, width, height, topPad, captionFont } = platform;

  // Caption band (top area).
  const cpl = Math.floor((width * 0.9) / (captionFont * 0.5));
  const lines = wrapCaption(screen.caption, cpl);
  const lh = captionFont * 1.15;
  const totalH = lines.length * lh;
  const baseY = (topPad - totalH) / 2 + captionFont;
  let cap = '';
  lines.forEach((ln, i) => {
    cap += t(width / 2, baseY + i * lh, captionFont, INK, 'middle', SERIF, '700', esc(ln));
  });
  const ruleY = baseY + (lines.length - 1) * lh + captionFont * 0.55;
  cap += r(width / 2 - 60, ruleY, 120, 4, 2, AMBER);

  // Device geometry.
  const deviceTop = topPad + height * 0.015;
  const bottomMargin = height * 0.05;
  const sideMargin = width * 0.09;
  const dX = sideMargin;
  const dW = width - 2 * sideMargin;
  const dBottom = height - bottomMargin;
  const dH = dBottom - deviceTop;
  const rad = Math.min(dW, dH) * 0.06;

  let dev = '';
  // Subtle drop shadow (two soft offset rounded rects; no filters needed).
  dev += r(dX, deviceTop + dH * 0.012, dW, dH, rad, INK, 'fill-opacity="0.10"');
  dev += r(dX, deviceTop + dH * 0.022, dW, dH, rad, INK, 'fill-opacity="0.05"');
  // Device body: white surface with a hairline edge.
  dev += r(dX, deviceTop, dW, dH, rad, SURFACE, `stroke="${INK}" stroke-opacity="0.08" stroke-width="${f(width * 0.0015)}"`);

  // Inset screen.
  const bez = dW * 0.015;
  const sX = dX + bez;
  const sY = deviceTop + bez;
  const sW = dW - 2 * bez;
  const sH = dH - 2 * bez;
  const sRad = Math.max(0, rad - bez);

  const S = { x: sX, y: sY, w: sW, h: sH };
  const chr = chrome(S, screen.title);
  const contentTop = chr.top + sH * 0.03;
  const content = screen.draw(S, contentTop);

  const clipId = `clip_${key}_${screen.slug.replace(/[^a-z0-9]/gi, '')}`;
  const body = `<clipPath id="${clipId}"><rect x="${f(sX)}" y="${f(sY)}" width="${f(sW)}" height="${f(sH)}" rx="${f(sRad)}"/></clipPath>`
    + `<g clip-path="url(#${clipId})">`
    + `<rect x="${f(sX)}" y="${f(sY)}" width="${f(sW)}" height="${f(sH)}" fill="${SURFACE}"/>`
    + chr.svg + content
    + `</g>`;

  const footerH = Math.max(8, Math.round(height * 0.005));
  const footer = r(0, height - footerH, width, footerH, 0, AMBER);

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="${CREAM}"/>`
    + cap + dev + body + footer
    + `</svg>`;
}

// ---------------------------------------------------------------------------
// Rasterize (density-oversample trick, from generate-assets.mjs).
// ---------------------------------------------------------------------------
async function rasterize(svgString, outPath, width, height) {
  const svg = Buffer.from(svgString);
  const probe = await sharp(svg).metadata();
  const intrinsicMax = Math.max(probe.width || width, probe.height || height);
  const density = Math.ceil((Math.max(width, height) / intrinsicMax) * 72 * 4);
  await sharp(Buffer.from(svgString), { density })
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: CREAM })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  const m = await sharp(outPath).metadata();
  if (m.width !== width || m.height !== height) {
    throw new Error(`dim mismatch ${outPath}: ${m.width}x${m.height} want ${width}x${height}`);
  }
  // App Store Connect REJECTS screenshots with an alpha channel. `.flatten()`
  // above removes it, but assert rather than assume: a silent regression here
  // is a rejected submission, discovered days later.
  if (m.hasAlpha || m.channels !== 3) {
    throw new Error(
      `alpha channel in ${outPath}: channels=${m.channels} hasAlpha=${m.hasAlpha}`,
    );
  }
}

async function main() {
  const started = Date.now();
  const written = [];

  for (const platform of PLATFORMS) {
    const outDir = path.join(OUT_ROOT, platform.key);
    await fs.mkdir(outDir, { recursive: true });
    for (const screen of SCREENS) {
      const svg = buildSvg(platform, screen);
      const outPath = path.join(outDir, `${screen.slug}.png`);
      await rasterize(svg, outPath, platform.width, platform.height);
      const rel = path.relative(MOBILE_ROOT, outPath).replace(/\\/g, '/');
      written.push({ rel, w: platform.width, h: platform.height });
      console.log(`  ok ${rel.padEnd(58)} ${platform.width}x${platform.height}`);
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nWrote ${written.length} PNG(s) to ${OUT_ROOT} in ${secs}s`);
}

main().catch((err) => {
  console.error('generate-store-screenshots failed:', err);
  process.exit(1);
});
