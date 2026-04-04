export function resetPasswordTemplate(data: {
  fullName: string;
  resetUrl: string;
}): { subject: string; html: string } {
  return {
    subject: 'Reset your LIBERTASIAN password',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Password Reset Request</h2>
  <p>Hi ${escapeHtml(data.fullName)},</p>
  <p>We received a request to reset your password. Click the button below to choose a new one:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.resetUrl)}"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Reset Password
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${escapeHtml(data.resetUrl)}">${escapeHtml(data.resetUrl)}</a>
  </p>
  <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
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
