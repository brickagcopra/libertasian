export function announcementTemplate(data: {
  userName: string;
  title: string;
  content: string; // Already sanitized HTML from server-side sanitize-html
  ctaText?: string;
  ctaUrl?: string;
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  const ctaButton = data.ctaText && data.ctaUrl
    ? `<p style="text-align: center; margin: 30px 0;">
        <a href="${escapeHtml(data.ctaUrl)}"
           style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          ${escapeHtml(data.ctaText)}
        </a>
      </p>`
    : '';

  return {
    // Subject is set dynamically by the caller
    subject: escapeHtml(data.title),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">${escapeHtml(data.title)}</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <div style="margin: 20px 0; line-height: 1.6; color: #374151;">
    ${data.content}
  </div>
  ${ctaButton}
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">LIBERTASIAN — Philippine Legal AI Platform</p>
  <p style="color: #999; font-size: 11px;">
    <a href="${escapeHtml(data.unsubscribeUrl)}" style="color: #999; text-decoration: underline;">
      Unsubscribe from announcements
    </a>
  </p>
</body>
</html>`.trim(),
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
