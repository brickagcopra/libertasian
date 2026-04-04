export function memberInviteTemplate(data: {
  inviteeName: string;
  organizationName: string;
  inviterName: string;
  acceptUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `You've been invited to ${escapeHtml(data.organizationName)} on LIBERTASIAN`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">You've been invited!</h2>
  <p>Hi ${escapeHtml(data.inviteeName)},</p>
  <p><strong>${escapeHtml(data.inviterName)}</strong> has invited you to join <strong>${escapeHtml(data.organizationName)}</strong> on LIBERTASIAN.</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.acceptUrl)}"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Accept Invitation
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${escapeHtml(data.acceptUrl)}">${escapeHtml(data.acceptUrl)}</a>
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">LIBERTASIAN — Philippine Legal AI Platform</p>
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
