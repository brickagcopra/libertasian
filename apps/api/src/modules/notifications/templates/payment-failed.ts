export function paymentFailedTemplate(data: {
  userName: string;
  amount: string;
  retryDate: string;
  updatePaymentUrl: string;
}): { subject: string; html: string } {
  return {
    subject: 'Payment Failed — Action Required',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #dc2626;">Payment Failed</h2>
  <p>Hi ${escapeHtml(data.userName)},</p>
  <p>We were unable to process your payment of <strong>${escapeHtml(data.amount)}</strong>. This may be due to insufficient funds, an expired card, or a temporary issue with your payment provider.</p>
  <p>We will automatically retry the payment on <strong>${escapeHtml(data.retryDate)}</strong>. To avoid service interruption, please update your payment method before then.</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="${escapeHtml(data.updatePaymentUrl)}"
       style="background-color: #dc2626; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Update Payment Method
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">If you believe this is an error, please contact our support team for assistance.</p>
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
