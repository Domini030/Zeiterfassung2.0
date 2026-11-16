import QRCode from 'qrcode';
import type { CompanyProfile, Invoice } from '../types';

export function cleanIban(rawIban: string | undefined): string {
  return (rawIban || '').replace(/\s+/g, '').toUpperCase();
}

export function buildEpcQrPayload(invoice: Invoice, company: CompanyProfile): string | null {
  const iban = cleanIban(company.iban);
  if (!iban || iban.length < 15) return null;

  const isSmallBiz = invoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
  const amount = isSmallBiz ? invoice.netTotal : invoice.grossTotal;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const recipient = (company.companyName || company.ownerName || 'Zahlungsempfaenger')
    .trim()
    .slice(0, 70);
  const bic = (company.bic || '').replace(/\s+/g, '').toUpperCase().slice(0, 11);
  const formattedAmount = `EUR${amount.toFixed(2)}`;
  const reference = `Rechnung ${invoice.invoiceNumber}`.slice(0, 140);

  return [
    'BCD',
    '002',
    '1',
    'SCT',
    bic,
    recipient,
    iban,
    formattedAmount,
    '',
    '',
    reference,
  ].join('\n');
}

export async function generateGiroCodeDataUrl(
  invoice: Invoice,
  company: CompanyProfile
): Promise<string | null> {
  const payload = buildEpcQrPayload(invoice, company);
  if (!payload) return null;

  try {
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  } catch {
    return null;
  }
}
