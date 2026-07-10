import { emailColors, emailFontStack, emailLayout, escapeHtml } from './email-layout';

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
  const detailRow = (label: string, value: string) => `
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid ${emailColors.hairline}; font-family: ${emailFontStack}; font-size: 13px; color: ${emailColors.muted};">${label}</td>
                  <td align="right" style="padding: 12px 0; border-bottom: 1px solid ${emailColors.hairline}; font-family: ${emailFontStack}; font-size: 14px; font-weight: 600; color: ${emailColors.ink};">${value}</td>
                </tr>`;

  const detailRows = [
    detailRow('Invoice', escapeHtml(data.invoiceNumber)),
    detailRow('Plan', escapeHtml(data.planName)),
    detailRow('Payment Method', escapeHtml(data.paymentMethod)),
    data.billingPeriodLabel ? detailRow('Billing Period', escapeHtml(data.billingPeriodLabel)) : '',
    data.nextBillingDate ? detailRow('Next Billing Date', escapeHtml(data.nextBillingDate)) : '',
  ].join('');

  const body = `
              <h1 style="margin: 0 0 4px; font-family: ${emailFontStack}; font-size: 22px; line-height: 30px; font-weight: 700; color: ${emailColors.ink};">Payment Receipt</h1>
              <p style="margin: 0 0 24px; font-family: ${emailFontStack}; font-size: 14px; line-height: 20px; color: ${emailColors.muted};">${escapeHtml(data.date)}</p>
              <p style="margin: 0 0 24px; font-family: ${emailFontStack}; font-size: 15px; line-height: 22px; color: ${emailColors.ink};">Hi ${escapeHtml(data.userName)}, thank you for your payment. Here is your receipt.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${emailColors.page}" style="background-color: ${emailColors.page}; border-radius: 10px; padding: 24px 20px;">
                    <p style="margin: 0 0 10px; font-family: ${emailFontStack}; font-size: 36px; line-height: 40px; font-weight: 800; color: ${emailColors.ink};">${escapeHtml(data.currency)}&nbsp;${escapeHtml(data.amount)}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td bgcolor="${emailColors.successBg}" style="background-color: ${emailColors.successBg}; border-radius: 999px; padding: 4px 14px; font-family: ${emailFontStack}; font-size: 11px; font-weight: 700; letter-spacing: 1px; color: ${emailColors.successText};">PAID</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 0;">${detailRows}
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 32px auto 0;">
                <tr>
                  <td align="center" bgcolor="${emailColors.primary}" style="background-color: ${emailColors.primary}; border-radius: 8px;">
                    <a href="${escapeHtml(data.billingUrl)}" style="display: inline-block; padding: 13px 32px; font-family: ${emailFontStack}; font-size: 14px; font-weight: 600; color: #FFFFFF; text-decoration: none;">View Billing Details</a>
                  </td>
                </tr>
              </table>`;

  return {
    subject: 'Payment Receipt — LIBERTASIAN',
    html: emailLayout({
      body,
      preheader: `Receipt for ${data.currency} ${data.amount} — ${data.planName}`,
      footerNote: 'This charge appears on your statement as <strong>LIBERTASIAN</strong>.',
    }),
  };
}
