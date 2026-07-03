export function paymentReceiptTemplate(data: {
  userName: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  invoiceNumber: string;
  date: string;
  planName: string;
  billingUrl: string;
  /** Billing period covered by this charge, e.g. "July 6 – August 6, 2026". */
  billingPeriodLabel?: string;
  /** Next scheduled billing date for recurring plans. */
  nextBillingDate?: string;
}): { subject: string; html: string } {
  const billingPeriodRow = data.billingPeriodLabel
    ? `
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Billing Period</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.billingPeriodLabel)}</td>
    </tr>`
    : '';
  const nextBillingRow = data.nextBillingDate
    ? `
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Next Billing Date</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.nextBillingDate)}</td>
    </tr>`
    : '';

  return {
    subject: 'Payment Receipt — LIBERTASIAN',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Payment Receipt</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <p>Thank you for your payment. Here is your receipt:</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Invoice</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.invoiceNumber)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Date</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.date)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Plan</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.planName)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Amount</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 18px; font-weight: 700;">${escapeHtml(data.currency)} ${escapeHtml(data.amount)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600;">Payment Method</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${escapeHtml(data.paymentMethod)}</td>
    </tr>${billingPeriodRow}${nextBillingRow}
  </table>
  <p style="color: #666; font-size: 14px;">This charge appears on your statement as <strong>LIBERTASIAN</strong>.</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.billingUrl)}"
       style="background-color: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      View Billing Details
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">If you have any questions about this charge, please contact our support team.</p>
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
