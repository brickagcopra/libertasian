/**
 * Shared transactional-email shell: warm cream page background, centered 600px
 * white card with a dark slate-teal header band carrying the LIBERTASIAN
 * wordmark, and a standard footer.
 *
 * Email-client constraints: nested tables only (no flex/grid), all styles
 * inline, bgcolor attribute fallbacks, no webfont loading (Gmail strips it).
 * Colors are hex conversions of the web design tokens in
 * apps/web/src/app/globals.css.
 */

export const emailColors = {
  /** --background oklch(0.985 0.005 85) */
  page: '#FCFAF6',
  /** --card oklch(1 0 0) */
  card: '#FFFFFF',
  /** --primary oklch(0.32 0.04 220) — header band + buttons */
  primary: '#193841',
  /** --foreground oklch(0.18 0 0) */
  ink: '#121212',
  /** --muted-foreground oklch(0.5 0 0) */
  muted: '#636363',
  /** --border oklch(0.92 0.003 85) — hairline row separators */
  hairline: '#E5E4E2',
  /** "PAID" pill text */
  successText: '#15803D',
  /** "PAID" pill background */
  successBg: '#DCFCE7',
} as const;

export const emailFontStack =
  "'Inter', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const LOGO_URL = 'https://libertasian.com/email/logo.png';

export interface EmailLayoutContent {
  /** Inner HTML for the white card, below the header band. Interpolated values must already be escaped. */
  body: string;
  /** Optional extra footer line (pre-escaped HTML) rendered above the standard footer lines. */
  footerNote?: string;
  /** Hidden preview text shown next to the subject in inbox list views. */
  preheader?: string;
}

export function emailLayout(content: EmailLayoutContent): string {
  const preheader = content.preheader
    ? `
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(content.preheader)}</div>`
    : '';
  const footerNote = content.footerNote
    ? `
          <p style="margin: 0 0 8px; font-family: ${emailFontStack}; font-size: 12px; line-height: 18px; color: ${emailColors.muted};">${content.footerNote}</p>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: ${emailColors.page};" bgcolor="${emailColors.page}">${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${emailColors.page}" style="background-color: ${emailColors.page};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 600px; max-width: 100%;">
          <tr>
            <td align="center" bgcolor="${emailColors.primary}" style="background-color: ${emailColors.primary}; border-radius: 12px 12px 0 0; padding: 26px 40px;">
              <img src="${LOGO_URL}" width="240" alt="LIBERTASIAN" style="display: block; width: 240px; height: auto; border: 0; outline: none;">
            </td>
          </tr>
          <tr>
            <td bgcolor="${emailColors.card}" style="background-color: ${emailColors.card}; border-radius: 0 0 12px 12px; padding: 36px 40px;">
              ${content.body}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 24px 40px 0;">${footerNote}
              <p style="margin: 0 0 8px; font-family: ${emailFontStack}; font-size: 12px; line-height: 18px; color: ${emailColors.muted};">Questions? Contact <a href="mailto:info.libertasian@gmail.com" style="color: ${emailColors.primary}; text-decoration: underline;">info.libertasian@gmail.com</a></p>
              <p style="margin: 0; font-family: ${emailFontStack}; font-size: 12px; line-height: 18px; color: ${emailColors.muted};">LIBERTASIAN &mdash; Philippine Legal AI Platform</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
