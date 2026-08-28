/**
 * The live App Store listing. Verified 200 on 2026-08-28 across ph/us/ca/au/nz/
 * sg/hk/jp/kr/tw/ae/sa.
 *
 * Colocated with the QR below on purpose: the SVG path encodes this exact
 * string and cannot be hand-edited, so the two have to change together.
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/libertasian/id6788971669';

/**
 * App Store QR code for {@link APP_STORE_URL}, committed as inline SVG.
 *
 * Generated once, not at runtime:
 *   npx -y qrcode -t svg -o qr.svg "https://apps.apple.com/app/libertasian/id6788971669"
 *
 * Two things this deliberately avoids. A runtime QR dependency would ship an
 * encoder to every visitor just to redraw one constant image. A file under
 * apps/web/public/ would need both PUBLIC_PREFIXES and the middleware matcher
 * lookahead updated in middleware.ts, or the asset 307s an anonymous visitor
 * to /login.
 *
 * The viewBox keeps the generator's 4-module quiet zone, and the caller adds
 * padding on a white panel so that zone survives against the dark footer. Dark
 * modules on white is not a style choice — inverted codes fail on many
 * scanners — so do NOT recolor this to the cream-on-dark footer theme.
 *
 * If APP_STORE_URL ever changes this SVG must be regenerated with the command
 * above. public-footer.test.tsx pins the link href to the constant, but no test
 * can assert that these pixels still decode to it.
 */
export function AppStoreQr({ size = 112 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 41 41"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path fill="#ffffff" d="M0 0h41v41H0z" />
      <path
        stroke="#000000"
        d="M4 4.5h7m9 0h1m1 0h4m1 0h1m2 0h7M4 5.5h1m5 0h1m2 0h2m1 0h1m2 0h2m1 0h1m1 0h2m2 0h1m1 0h1m5 0h1M4 6.5h1m1 0h3m1 0h1m1 0h3m3 0h2m3 0h3m1 0h1m2 0h1m1 0h3m1 0h1M4 7.5h1m1 0h3m1 0h1m1 0h1m1 0h2m6 0h2m1 0h4m1 0h1m1 0h3m1 0h1M4 8.5h1m1 0h3m1 0h1m1 0h1m2 0h1m2 0h4m2 0h2m1 0h1m2 0h1m1 0h3m1 0h1M4 9.5h1m5 0h1m1 0h6m5 0h1m1 0h1m1 0h2m1 0h1m5 0h1M4 10.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M12 11.5h1m3 0h1m3 0h1m2 0h5M4 12.5h1m1 0h5m3 0h1m2 0h2m2 0h3m2 0h1m1 0h1m1 0h5M5 13.5h2m8 0h3m2 0h5m1 0h3m1 0h2m1 0h2m1 0h1M4 14.5h4m2 0h4m1 0h5m1 0h1m2 0h1m4 0h2m1 0h1m1 0h2M4 15.5h2m3 0h1m1 0h2m2 0h1m1 0h1m1 0h5m1 0h1m1 0h4m1 0h3M5 16.5h1m2 0h3m1 0h1m2 0h2m1 0h1m1 0h1m3 0h1m1 0h1m1 0h2m1 0h3m1 0h1M4 17.5h1m1 0h2m1 0h1m1 0h2m2 0h1m3 0h1m1 0h2m2 0h1m1 0h2m1 0h2m2 0h3M4 18.5h3m2 0h3m2 0h4m1 0h3m2 0h2m1 0h9M4 19.5h3m1 0h2m1 0h4m1 0h2m1 0h1m5 0h1m1 0h4m1 0h3M6 20.5h3m1 0h1m4 0h1m3 0h1m1 0h1m4 0h2m1 0h1m1 0h3m2 0h1M5 21.5h3m1 0h1m1 0h2m1 0h1m1 0h3m1 0h1m1 0h3m1 0h2m2 0h2m1 0h4M4 22.5h1m2 0h1m2 0h2m4 0h1m2 0h2m1 0h1m2 0h1m2 0h1m1 0h3m1 0h2M6 23.5h2m5 0h2m5 0h1m2 0h4m1 0h2m1 0h4m1 0h1M10 24.5h2m1 0h1m1 0h1m1 0h2m3 0h2m1 0h1m2 0h2m1 0h3M4 25.5h2m1 0h3m2 0h2m1 0h6m3 0h2m1 0h2m1 0h1m3 0h1m1 0h1M4 26.5h1m1 0h1m3 0h3m4 0h2m3 0h2m1 0h1m2 0h1m4 0h1m1 0h1M4 27.5h1m1 0h2m3 0h1m1 0h1m2 0h1m3 0h1m2 0h3m2 0h2m1 0h1m1 0h3M4 28.5h1m1 0h2m2 0h1m2 0h1m1 0h1m1 0h2m2 0h1m1 0h1m2 0h1m1 0h5m3 0h1M12 29.5h1m1 0h5m2 0h1m1 0h1m3 0h2m3 0h1m1 0h3M4 30.5h7m4 0h1m1 0h1m1 0h1m1 0h1m2 0h1m1 0h3m1 0h1m1 0h1m1 0h2M4 31.5h1m5 0h1m1 0h3m1 0h1m2 0h1m1 0h2m1 0h1m2 0h2m3 0h4M4 32.5h1m1 0h3m1 0h1m1 0h2m1 0h1m1 0h1m1 0h2m3 0h3m1 0h6m1 0h1M4 33.5h1m1 0h3m1 0h1m1 0h2m2 0h4m2 0h1m5 0h2m2 0h1m3 0h1M4 34.5h1m1 0h3m1 0h1m1 0h1m3 0h1m2 0h2m1 0h1m1 0h3m1 0h4m1 0h2M4 35.5h1m5 0h1m3 0h1m1 0h4m2 0h1m2 0h1m1 0h3m2 0h3M4 36.5h7m1 0h1m1 0h4m1 0h3m4 0h1m1 0h1m2 0h1m3 0h1"
      />
    </svg>
  );
}
