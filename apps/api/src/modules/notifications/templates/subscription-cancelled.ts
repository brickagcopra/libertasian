export function subscriptionCancelledTemplate(data: {
  userName: string;
  planName: string;
  endDate: string;
  isImmediate: boolean;
  billingUrl: string;
}): { subject: string; html: string } {
  const immediateMessage = `
    <p>Your <strong>${escapeHtml(data.planName)}</strong> subscription has been cancelled and your account has been downgraded to the Free plan.</p>
    <p>You can re-subscribe at any time to regain access to premium features.</p>`;

  const endOfPeriodMessage = `
    <p>Your <strong>${escapeHtml(data.planName)}</strong> subscription has been scheduled for cancellation.</p>
    <p>You will retain full access to all features until <strong>${escapeHtml(data.endDate)}</strong>. After that date, your account will be downgraded to the Free plan.</p>
    <p>Changed your mind? You can undo the cancellation from your billing settings before the end of your billing period.</p>`;

  return {
    subject: data.isImmediate
      ? 'Your Subscription Has Been Cancelled'
      : `Your Subscription Will End on ${data.endDate}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #92400e;">Subscription Cancelled</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  ${data.isImmediate ? immediateMessage : endOfPeriodMessage}
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.billingUrl)}"
       style="background-color: #1a56db; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      ${data.isImmediate ? 'Re-subscribe' : 'Manage Subscription'}
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">Thank you for being a LIBERTASIAN subscriber. We hope to see you back soon.</p>
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
