/**
 * Platform-staff security alert (e.g. possible account sharing). Plain list of
 * lines plus a link to the admin page that holds the details. Lines must not
 * carry raw emails or IPs: the email leaves the platform.
 */
export function securityAlertTemplate(data: {
  fullName: string;
  heading: string;
  lines: string[];
  reviewUrl: string;
}): { subject: string; html: string } {
  const items = data.lines.map((l) => `<li style="margin: 4px 0;">${escapeHtml(l)}</li>`).join('');

  return {
    subject: `LIBERTASIAN security: ${data.heading}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid #d97706; padding-left: 16px; margin-bottom: 20px;">
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">${escapeHtml(data.heading)}</h2>
    <p style="color: #374151; margin: 0;">Advisory only. No account has been changed.</p>
  </div>
  <p>Hi ${escapeHtml(data.fullName)},</p>
  <ul style="color: #374151; padding-left: 20px;">${items}</ul>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.reviewUrl)}"
       style="background-color: #d97706; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Review in admin
    </a>
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #9ca3af; font-size: 12px;">You receive this because you hold the user administration permission on LIBERTASIAN.</p>
</body>
</html>`,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
