import { Capacitor } from '@capacitor/core';
import type { CompanyProfile, EmailTemplatesConfig, Invoice } from '../types';
import { formatCurrency, formatDateDE } from './format';
import {
  downloadInvoicePdf,
  downloadPaymentReminderPdf,
  getInvoicePdfBase64,
  getPaymentReminderPdfBase64,
} from './pdfInvoice';
import { TaktWerkNative } from './taktwerkNative';

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplatesConfig = {
  invoiceSubject: 'Rechnung {Nummer} – {Firma}',
  invoiceBody:
    'Sehr geehrte(r) {Ansprechpartner},\n\nanbei erhalten Sie unsere Rechnung {Nummer} vom {Datum} über {Betrag}.\n\nBitte überweisen Sie den Betrag bis zum {Fällig} unter Angabe der Rechnungsnummer.\n\nVielen Dank für Ihren Auftrag!\n\nMit freundlichen Grüßen\n{Inhaber}\n{Firma}',
  quoteSubject: 'Angebot {Nummer} – {Firma}',
  quoteBody:
    'Sehr geehrte(r) {Ansprechpartner},\n\nvielen Dank für Ihre Anfrage. Anbei übersenden wir Ihnen unser unverbindliches Angebot {Nummer} über {Betrag} (gültig bis {Fällig}).\n\nBei Rückfragen oder zur Beauftragung stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{Inhaber}\n{Firma}',
  reminderSubject: 'Zahlungserinnerung zu Rechnung {Nummer} – {Firma}',
  reminderBody:
    'Sehr geehrte(r) {Ansprechpartner},\n\nsicherlich ist es in der Hektik des Alltags untergegangen: Unsere Rechnung {Nummer} vom {Datum} über {Betrag} war am {Fällig} fällig.\n\nSollte sich Ihre Zahlung mit dieser Nachricht überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\n\nMit freundlichen Grüßen\n{Inhaber}\n{Firma}',
};

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  { token: '{Kunde}', desc: 'Firmenname des Kunden' },
  { token: '{Ansprechpartner}', desc: 'Ansprechpartner (Fallback: Damen und Herren)' },
  { token: '{Nummer}', desc: 'Rechnungs- / Angebotsnummer' },
  { token: '{Betrag}', desc: 'Endbetrag (Brutto bzw. Netto bei §19)' },
  { token: '{Datum}', desc: 'Belegdatum' },
  { token: '{Fällig}', desc: 'Fälligkeitsdatum / Gültig bis' },
  { token: '{Firma}', desc: 'Eigener Firmenname' },
  { token: '{Inhaber}', desc: 'Eigener Name / Inhaber' },
];

export type EmailDocumentMode = 'invoice' | 'quote' | 'reminder';

export function getEffectiveEmailTemplates(company: CompanyProfile): EmailTemplatesConfig {
  return {
    invoiceSubject:
      company.emailTemplates?.invoiceSubject?.trim() ||
      DEFAULT_EMAIL_TEMPLATES.invoiceSubject,
    invoiceBody:
      company.emailTemplates?.invoiceBody?.trim() || DEFAULT_EMAIL_TEMPLATES.invoiceBody,
    quoteSubject:
      company.emailTemplates?.quoteSubject?.trim() || DEFAULT_EMAIL_TEMPLATES.quoteSubject,
    quoteBody:
      company.emailTemplates?.quoteBody?.trim() || DEFAULT_EMAIL_TEMPLATES.quoteBody,
    reminderSubject:
      company.emailTemplates?.reminderSubject?.trim() ||
      DEFAULT_EMAIL_TEMPLATES.reminderSubject,
    reminderBody:
      company.emailTemplates?.reminderBody?.trim() || DEFAULT_EMAIL_TEMPLATES.reminderBody,
  };
}

export function renderEmailForInvoice(
  invoice: Invoice,
  company: CompanyProfile,
  mode?: EmailDocumentMode
): { to: string; subject: string; body: string } {
  const resolvedMode: EmailDocumentMode =
    mode ?? (invoice.documentType === 'quote' ? 'quote' : 'invoice');
  const templates = getEffectiveEmailTemplates(company);

  const isSmallBiz = invoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
  const payable = isSmallBiz ? invoice.netTotal : invoice.grossTotal;
  const contact =
    invoice.customerSnapshot.contactName?.trim() || 'Damen und Herren';

  const replacements: Record<string, string> = {
    '{Kunde}': invoice.customerSnapshot.companyName || '',
    '{Ansprechpartner}': contact,
    '{Nummer}': invoice.invoiceNumber || '',
    '{Betrag}': formatCurrency(payable),
    '{Datum}': formatDateDE(invoice.issueDate),
    '{Fällig}': formatDateDE(
      resolvedMode === 'quote'
        ? invoice.quoteValidUntil || invoice.dueDate
        : invoice.dueDate
    ),
    '{Firma}': company.companyName || 'TaktWerk',
    '{Inhaber}': company.ownerName || company.companyName || '',
  };

  const apply = (tpl: string) =>
    Object.entries(replacements).reduce(
      (acc, [token, val]) => acc.split(token).join(val),
      tpl
    );

  const rawSubject =
    resolvedMode === 'reminder'
      ? templates.reminderSubject
      : resolvedMode === 'quote'
        ? templates.quoteSubject
        : templates.invoiceSubject;

  const rawBody =
    resolvedMode === 'reminder'
      ? templates.reminderBody
      : resolvedMode === 'quote'
        ? templates.quoteBody
        : templates.invoiceBody;

  return {
    to: (invoice.customerSnapshot.email || '').trim(),
    subject: apply(rawSubject),
    body: apply(rawBody),
  };
}

export async function sendDocumentByEmail(
  invoice: Invoice,
  company: CompanyProfile,
  mode?: EmailDocumentMode
): Promise<{ nativeShared: boolean; message: string }> {
  const resolvedMode: EmailDocumentMode =
    mode ?? (invoice.documentType === 'quote' ? 'quote' : 'invoice');
  const emailData = renderEmailForInvoice(invoice, company, resolvedMode);
  const filename =
    resolvedMode === 'reminder'
      ? `Zahlungserinnerung-${invoice.invoiceNumber}.pdf`
      : `${invoice.invoiceNumber}.pdf`;

  if (Capacitor.isNativePlatform()) {
    const base64 =
      resolvedMode === 'reminder'
        ? await getPaymentReminderPdfBase64(invoice, company)
        : await getInvoicePdfBase64(invoice, company);
    await TaktWerkNative.sharePdfWithEmail({
      filename,
      base64,
      to: emailData.to,
      subject: emailData.subject,
      body: emailData.body,
    });
    return {
      nativeShared: true,
      message: 'E-Mail-App mit Empfänger, Vorlagentext & PDF-Anhang geöffnet.',
    };
  }

  // Web: download PDF + open mailto with prefilled subject & body
  if (resolvedMode === 'reminder') {
    await downloadPaymentReminderPdf(invoice, company);
  } else {
    await downloadInvoicePdf(invoice, company);
  }

  const mailtoUrl = `mailto:${encodeURIComponent(emailData.to)}?subject=${encodeURIComponent(
    emailData.subject
  )}&body=${encodeURIComponent(emailData.body)}`;
  const a = document.createElement('a');
  a.href = mailtoUrl;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return {
    nativeShared: false,
    message:
      'E-Mail-Vorlage geöffnet & PDF heruntergeladen — bitte PDF als Anhang hinzufügen.',
  };
}
