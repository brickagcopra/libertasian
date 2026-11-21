/**
 * Email to platform moderators: a new report case opened, content was
 * auto-hidden, or the daily open-queue summary. The Terms promise review
 * within 24 hours, so these exist to make sure someone looks.
 */
export function moderationAlertTemplate(data: {
  fullName: string;
  heading: string;
  lines: string[];
  queueUrl: string;
  urgent: boolean;
}): { subject: string; html: string } {
  const color = data.urgent ? '#dc2626' : '#2563eb';
  const items = data.lines.map((l) => `<li style="margin: 4px 0;">${escapeHtml(l)}</li>`).join('');

  return {
    subject: `LIBERTASIAN moderation: ${data.heading}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid ${color}; padding-left: 16px; margin-bottom: 20px;">
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">${escapeHtml(data.heading)}</h2>
    <p style="color: #374151; margin: 0;">Reports must be reviewed within 24 hours.</p>
  </div>
  <p>Hi ${escapeHtml(data.fullName)},</p>
  <ul style="color: #374151; padding-left: 20px;">${items}</ul>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.queueUrl)}"
       style="background-color: ${color}; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Open the moderation queue
    </a>
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #9ca3af; font-size: 12px;">You receive this because you hold the community moderation permission on LIBERTASIAN.</p>
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
