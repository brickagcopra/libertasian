export function subscriptionConfirmationTemplate(data: {
  userName: string;
  planName: string;
  billingPeriod: string;
  features: string[];
  nextBillingDate: string;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const featuresList = data.features
    .map((f) => `<li style="padding: 4px 0; color: #374151;">${escapeHtml(f)}</li>`)
    .join('');

  return {
    subject: `Welcome to LIBERTASIAN ${escapeHtml(data.planName)}!`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Welcome to ${escapeHtml(data.planName)}!</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <p>Your subscription has been activated. Here are your plan details:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Plan</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.planName)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Billing Period</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.billingPeriod)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Next Billing Date</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.nextBillingDate)}</td>
    </tr>
  </table>
  <p style="font-weight: 600;">Features included:</p>
  <ul style="list-style: none; padding: 0; margin: 0 0 20px 0;">
    ${featuresList}
  </ul>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.dashboardUrl)}"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Go to Dashboard
    </a>
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
