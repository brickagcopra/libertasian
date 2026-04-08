export function blogNotificationTemplate(data: {
  userName: string;
  postTitle: string;
  excerpt: string;
  authorName: string;
  publishDate: string;
  postUrl: string;
  unsubscribeUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `New on LIBERTASIAN: ${escapeHtml(data.postTitle)}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">New on LIBERTASIAN</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <p>We just published something new that you might find interesting:</p>
  <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h3 style="color: #1a1a1a; margin: 0 0 8px 0;">${escapeHtml(data.postTitle)}</h3>
    <p style="color: #6b7280; font-size: 13px; margin: 0 0 12px 0;">
      By ${escapeHtml(data.authorName)} &middot; ${escapeHtml(data.publishDate)}
    </p>
    <p style="color: #374151; margin: 0; line-height: 1.5;">${escapeHtml(data.excerpt)}</p>
  </div>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.postUrl)}"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Read More
    </a>
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">LIBERTASIAN — Philippine Legal AI Platform</p>
  <p style="color: #999; font-size: 11px;">
    <a href="${escapeHtml(data.unsubscribeUrl)}" style="color: #999; text-decoration: underline;">
      Unsubscribe from blog notifications
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
