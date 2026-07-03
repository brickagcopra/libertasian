/**
 * Upcoming-renewal reminder, sent 3 days before a recurring charge.
 *
 * Card-network best practice for recurring billing: state the plan, the exact
 * VAT-inclusive amount, the charge date, the instrument that will be charged,
 * and give a direct manage/cancel path. Tone is factual — no urgency theatrics.
 */
export function renewalReminderTemplate(data: {
  userName: string;
  planName: string;
  intervalLabel: string; // "Monthly" | "Annual"
  amount: string; // formatted, e.g. "1,999.00" (VAT-inclusive)
  chargeDate: string; // e.g. "July 6, 2026"
  paymentMethod: string; // e.g. "Visa •••• 4242"
  manageUrl: string;
  supportEmail: string;
}): { subject: string; html: string } {
  return {
    subject: `Your LIBERTASIAN ${data.planName} plan renews on ${data.chargeDate} — ₱${data.amount}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Upcoming Renewal</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <p>This is a reminder that your LIBERTASIAN subscription will renew automatically. No action is needed if you would like to continue your plan.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Plan</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.planName)} — ${escapeHtml(data.intervalLabel)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Amount</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 18px; font-weight: 700;">₱${escapeHtml(data.amount)} <span style="font-size: 12px; font-weight: 400; color: #666;">(VAT-inclusive)</span></td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Charge Date</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.chargeDate)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Payment Method</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.paymentMethod)}</td>
    </tr>
  </table>
  <p>To review your plan, change your payment method, or cancel before the renewal, visit your billing settings:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.manageUrl)}"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Manage Subscription
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">Questions about this renewal? Contact us at <a href="mailto:${escapeHtml(data.supportEmail)}" style="color: #2563eb;">${escapeHtml(data.supportEmail)}</a>.</p>
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
