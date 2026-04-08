export function verifyEmailTemplate(data: {
  fullName: string;
  code: string;
}): { subject: string; html: string } {
  const digits = data.code.split('');

  return {
    subject: 'Verify your LIBERTASIAN account',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Welcome to LIBERTASIAN</h2>
  <p>Hi ${escapeHtml(data.fullName)},</p>
  <p>Thank you for registering. Use the verification code below to confirm your email address:</p>
  <div style="text-align: center; margin: 30px 0;">
    <div style="display: inline-block; background-color: #f3f4f6; border-radius: 8px; padding: 20px 24px;">
      ${digits.map((d) => `<span style="font-size: 32px; font-weight: 700; letter-spacing: 4px; color: #1a1a1a; font-family: 'Courier New', monospace; padding: 0 6px;">${escapeHtml(d)}</span>`).join('')}
    </div>
  </div>
  <p style="color: #666; font-size: 14px; text-align: center;">
    Enter this code on the verification page to complete your registration.
  </p>
  <p style="color: #666; font-size: 14px;">This code expires in 15 minutes. If you did not create an account, you can safely ignore this email.</p>
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
