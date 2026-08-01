export function accountRestoreTemplate(data: {
  fullName: string;
  restoreUrl: string;
  restoreWindowDays: number;
}): { subject: string; html: string } {
  return {
    subject: 'Your LIBERTASIAN account is scheduled for deletion',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Your account has been deactivated</h2>
  <p>Hi ${escapeHtml(data.fullName)},</p>
  <p>
    We received a request to delete your LIBERTASIAN account. It has been
    deactivated immediately and you can no longer sign in.
  </p>
  <p>
    <strong>If this was a mistake, you have ${data.restoreWindowDays} days to undo it.</strong>
    Use the link below to restore your account and everything in it.
  </p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.restoreUrl)}"
       style="background-color: #d87b2a; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Restore My Account
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">
    If the button doesn't work, copy and paste this link into your browser:<br>
    <a href="${escapeHtml(data.restoreUrl)}">${escapeHtml(data.restoreUrl)}</a>
  </p>
  <p style="color: #666; font-size: 14px;">
    This link can be used once and expires in ${data.restoreWindowDays} days. After that your
    account and its private content — notes, bookmarks, annotations, uploads,
    scans, private digests and matters — are permanently deleted and cannot be
    recovered.
  </p>
  <p style="color: #666; font-size: 14px;">
    If you did not request this, restore your account with the link above and
    change your password, then contact us at dpo@libertasian.com.
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
