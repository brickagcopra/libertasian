export function budgetAlertTemplate(data: {
  userName: string;
  utilizationPercent: number;
  currentSpend: string;
  budgetLimit: string;
  isPaused: boolean;
}): { subject: string; html: string } {
  const statusMessage = data.isPaused
    ? 'AI features have been <strong>paused</strong> because the spending limit has been reached.'
    : `AI budget utilization is at <strong>${data.utilizationPercent.toFixed(0)}%</strong>. ` +
      'Consider adjusting the limit or reviewing usage patterns.';

  const urgencyColor = data.isPaused ? '#dc2626' : data.utilizationPercent >= 90 ? '#f59e0b' : '#2563eb';

  return {
    subject: data.isPaused
      ? 'LIBERTASIAN: AI budget limit reached — features paused'
      : `LIBERTASIAN: AI budget at ${data.utilizationPercent.toFixed(0)}%`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid ${urgencyColor}; padding-left: 16px; margin-bottom: 20px;">
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">AI Budget Alert</h2>
    <p style="color: #374151; margin: 0;">${statusMessage}</p>
  </div>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Current Spend</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.currentSpend)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Monthly Limit</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.budgetLimit)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-weight: 600;">Utilization</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${data.utilizationPercent.toFixed(1)}%</td>
    </tr>
  </table>
  ${data.isPaused ? '<p style="color: #dc2626; font-weight: 600;">To resume AI features, increase the budget limit in Admin &gt; AI Settings.</p>' : ''}
  <p style="text-align: center; margin: 30px 0;">
    <a href="/admin/ai-settings"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Manage AI Settings
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
