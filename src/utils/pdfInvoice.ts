import { jsPDF } from 'jspdf';
import type { CompanyProfile, Customer, Invoice, TimeEntry } from '../types';
import { generateGiroCodeDataUrl } from './epcQr';
import {
  INVOICE_ACCENT_STYLES,
  formatCurrency,
  formatDateDE,
  formatDuration,
  formatNumber,
  getOverdueDays,
  toInputDate,
  toInputTime,
} from './format';

function drawCompanyHeader(
  doc: jsPDF,
  company: CompanyProfile,
  accentRgb: [number, number, number]
): { rightBottomY: number } {
  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const senderOneLine = `${company.companyName} · ${company.street} · ${company.postalCode} ${company.city}`;
  doc.text(senderOneLine, marginLeft, 34);

  let headerTopY = 24;
  if (company.logoDataUrl && company.invoiceShowLogo !== false) {
    try {
      const props = doc.getImageProperties(company.logoDataUrl);
      const maxW = 46;
      const maxH = 18;
      const ratio = props.width && props.height ? props.width / props.height : 2.5;
      let drawW = maxW;
      let drawH = drawW / ratio;
      if (drawH > maxH) {
        drawH = maxH;
        drawW = drawH * ratio;
      }
      doc.addImage(
        company.logoDataUrl,
        'PNG',
        pageWidth - marginRight - drawW,
        14,
        drawW,
        drawH
      );
      headerTopY = 14 + drawH + 6;
    } catch {
      // Ignore malformed logo image
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text(company.companyName || 'TaktWerk', pageWidth - marginRight, headerTopY, {
    align: 'right',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const companyLines = [
    company.ownerName,
    company.street,
    `${company.postalCode} ${company.city}`.trim(),
    company.email,
    company.phone,
  ].filter(Boolean);
  let cy = headerTopY + 5.5;
  for (const line of companyLines) {
    doc.text(line, pageWidth - marginRight, cy, { align: 'right' });
    cy += 4.2;
  }

  return { rightBottomY: cy };
}

function drawFooter(doc: jsPDF, company: CompanyProfile) {
  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;
  const footerY = 274;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(marginLeft, footerY - 3, pageWidth - marginRight, footerY - 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);

  const col1 = [
    company.companyName,
    `${company.street}, ${company.postalCode} ${company.city}`,
    company.website,
  ].filter(Boolean);
  const col2 = [
    company.bankName ? `Bank: ${company.bankName}` : '',
    company.iban ? `IBAN: ${company.iban}` : '',
    company.bic ? `BIC: ${company.bic}` : '',
  ].filter(Boolean);
  const col3 = [
    company.taxNumber ? `Steuernr.: ${company.taxNumber}` : '',
    company.vatId ? `USt-IdNr.: ${company.vatId}` : '',
    company.email ? `E-Mail: ${company.email}` : '',
  ].filter(Boolean);

  col1.forEach((line, i) => doc.text(line, marginLeft, footerY + i * 3.8));
  col2.forEach((line, i) => doc.text(line, marginLeft + 62, footerY + i * 3.8));
  col3.forEach((line, i) => doc.text(line, marginLeft + 125, footerY + i * 3.8));
}

export async function buildInvoicePdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const accentPreset = company.invoiceAccentColor ?? 'slate';
  const accentRgb = INVOICE_ACCENT_STYLES[accentPreset]?.rgb ?? [15, 23, 42];
  const [accentR, accentG, accentB] = accentRgb;
  const headerTitle = (company.invoiceHeaderTitle || 'Rechnung').trim();

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb);

  // Recipient Address
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(invoice.customerSnapshot.companyName, marginLeft, ry);
  ry += 5;
  doc.setFont('helvetica', 'normal');
  if (invoice.customerSnapshot.contactName) {
    doc.text(invoice.customerSnapshot.contactName, marginLeft, ry);
    ry += 5;
  }
  if (invoice.customerSnapshot.street) {
    doc.text(invoice.customerSnapshot.street, marginLeft, ry);
    ry += 5;
  }
  const cityLine = `${invoice.customerSnapshot.postalCode} ${invoice.customerSnapshot.city}`.trim();
  if (cityLine) {
    doc.text(cityLine, marginLeft, ry);
    ry += 5;
  }
  if (invoice.customerSnapshot.country && invoice.customerSnapshot.country !== 'Deutschland') {
    doc.text(invoice.customerSnapshot.country, marginLeft, ry);
    ry += 5;
  }
  if (invoice.customerSnapshot.vatId) {
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`USt-IdNr.: ${invoice.customerSnapshot.vatId}`, marginLeft, ry + 1);
  }

  // Invoice Metadata Block (Right)
  const metaY = Math.max(cy + 6, 66);
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(122, metaY - 5, 68, 28, 1.5, 1.5, 'FD');

  const metaRows: [string, string][] = [
    ['Rechnungsnummer:', invoice.invoiceNumber],
    ['Rechnungsdatum:', formatDateDE(invoice.issueDate)],
    [
      'Leistungszeitraum:',
      `${formatDateDE(invoice.servicePeriodStart)} – ${formatDateDE(invoice.servicePeriodEnd)}`,
    ],
    ['Zahlungsziel:', formatDateDE(invoice.dueDate)],
  ];
  let my = metaY;
  doc.setFontSize(8.5);
  for (const [label, value] of metaRows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(label, 125, my);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(value, pageWidth - marginRight - 3, my, { align: 'right' });
    my += 5.5;
  }

  // Title
  let y = Math.max(ry + 18, metaY + 32);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(`${headerTitle} ${invoice.invoiceNumber}`, marginLeft, y);
  y += 8;

  // Intro text
  if (invoice.introText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const splitIntro = doc.splitTextToSize(invoice.introText, contentWidth);
    doc.text(splitIntro, marginLeft, y);
    y += splitIntro.length * 4.5 + 6;
  }

  const isSmallBiz =
    invoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
  const smallBizNotice =
    invoice.smallBusinessNotice ||
    company.smallBusinessNotice ||
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

  const drawTableHeader = (startY: number) => {
    doc.setFillColor(accentR, accentG, accentB);
    doc.rect(marginLeft, startY, contentWidth, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text('Pos.', marginLeft + 2, startY + 5.4);
    doc.text('Beschreibung', marginLeft + 12, startY + 5.4);
    if (isSmallBiz) {
      doc.text('Menge', marginLeft + 114, startY + 5.4, { align: 'right' });
      doc.text('Einzelpreis', marginLeft + 142, startY + 5.4, { align: 'right' });
      doc.text('Gesamt', pageWidth - marginRight - 2, startY + 5.4, { align: 'right' });
    } else {
      doc.text('Menge', marginLeft + 108, startY + 5.4, { align: 'right' });
      doc.text('Einzelpreis', marginLeft + 135, startY + 5.4, { align: 'right' });
      doc.text('MwSt.', marginLeft + 149, startY + 5.4, { align: 'right' });
      doc.text('Gesamt (Netto)', pageWidth - marginRight - 2, startY + 5.4, { align: 'right' });
    }
    return startY + 11;
  };

  y = drawTableHeader(y);

  invoice.lineItems.forEach((item, index) => {
    if (y > 240) {
      doc.addPage();
      y = drawTableHeader(20);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(index + 1), marginLeft + 2, y);

    const descMaxWidth = isSmallBiz ? 84 : 78;
    const descLines = doc.splitTextToSize(item.description, descMaxWidth);
    doc.text(descLines, marginLeft + 12, y);

    doc.setFont('helvetica', 'normal');
    if (isSmallBiz) {
      doc.text(`${formatNumber(item.quantity, 2)} ${item.unit}`, marginLeft + 114, y, {
        align: 'right',
      });
      doc.text(formatCurrency(item.unitPriceNet), marginLeft + 142, y, { align: 'right' });
    } else {
      doc.text(`${formatNumber(item.quantity, 2)} ${item.unit}`, marginLeft + 108, y, {
        align: 'right',
      });
      doc.text(formatCurrency(item.unitPriceNet), marginLeft + 135, y, { align: 'right' });
      doc.text(`${item.taxRate} %`, marginLeft + 149, y, { align: 'right' });
    }
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(item.netTotal), pageWidth - marginRight - 2, y, { align: 'right' });

    let rowHeight = descLines.length * 4.2;
    if (item.detail) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const detailLines = doc.splitTextToSize(item.detail, descMaxWidth);
      doc.text(detailLines, marginLeft + 12, y + rowHeight);
      rowHeight += detailLines.length * 3.8;
    }

    y += Math.max(rowHeight, 5) + 3;
    doc.setDrawColor(226, 232, 240);
    doc.line(marginLeft, y - 1.5, pageWidth - marginRight, y - 1.5);
    y += 2.5;
  });

  if (y > 220) {
    doc.addPage();
    y = 24;
  }

  y += 3;
  const totalsX = 122;
  if (!isSmallBiz) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Summe Netto', totalsX, y);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(invoice.netTotal), pageWidth - marginRight - 2, y, { align: 'right' });
    y += 5.5;

    const taxGroups = new Map<number, number>();
    for (const item of invoice.lineItems) {
      taxGroups.set(item.taxRate, (taxGroups.get(item.taxRate) ?? 0) + item.taxAmount);
    }
    for (const [rate, amount] of Array.from(taxGroups.entries()).sort((a, b) => b[0] - a[0])) {
      doc.setTextColor(71, 85, 105);
      doc.text(`zzgl. ${rate} % MwSt.`, totalsX, y);
      doc.setTextColor(15, 23, 42);
      doc.text(formatCurrency(amount), pageWidth - marginRight - 2, y, { align: 'right' });
      y += 5.5;
    }
  }

  doc.setDrawColor(accentR, accentG, accentB);
  doc.setLineWidth(0.5);
  doc.line(totalsX, y - 1, pageWidth - marginRight, y - 1);
  y += 4.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text('Rechnungsbetrag', totalsX, y);
  doc.text(
    formatCurrency(isSmallBiz ? invoice.netTotal : invoice.grossTotal),
    pageWidth - marginRight - 2,
    y,
    { align: 'right' }
  );

  if (isSmallBiz) {
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const splitSmallBiz = doc.splitTextToSize(smallBizNotice, contentWidth);
    doc.text(splitSmallBiz, marginLeft, y);
    y += splitSmallBiz.length * 4.2;
  }

  // Outro + GiroCode QR block
  y += isSmallBiz ? 8 : 12;
  const qrDataUrl = await generateGiroCodeDataUrl(invoice, company);
  if (qrDataUrl && y > 235) {
    doc.addPage();
    y = 24;
  }

  const textWidth = qrDataUrl ? contentWidth - 36 : contentWidth;
  let outroEndY = y;

  if (invoice.outroText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const splitOutro = doc.splitTextToSize(invoice.outroText, textWidth);
    doc.text(splitOutro, marginLeft, y);
    outroEndY = y + splitOutro.length * 4.2 + 4;
  }

  if (company.invoiceFooterNote) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const splitNote = doc.splitTextToSize(company.invoiceFooterNote, textWidth);
    doc.text(splitNote, marginLeft, outroEndY);
    outroEndY += splitNote.length * 4;
  }

  if (qrDataUrl) {
    const qrSize = 27;
    const qrX = pageWidth - marginRight - qrSize;
    const qrY = Math.min(y - 2, 236);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 9, 1.5, 1.5, 'FD');
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text('GiroCode (EPC-QR)', qrX + qrSize / 2, qrY + qrSize + 4, { align: 'center' });
  }

  drawFooter(doc, company);
  return doc;
}

export async function buildPaymentReminderPdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const accentPreset = company.invoiceAccentColor ?? 'slate';
  const accentRgb = INVOICE_ACCENT_STYLES[accentPreset]?.rgb ?? [15, 23, 42];
  const [accentR, accentG, accentB] = accentRgb;

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(invoice.customerSnapshot.companyName, marginLeft, ry);
  ry += 5;
  doc.setFont('helvetica', 'normal');
  if (invoice.customerSnapshot.contactName) {
    doc.text(invoice.customerSnapshot.contactName, marginLeft, ry);
    ry += 5;
  }
  if (invoice.customerSnapshot.street) {
    doc.text(invoice.customerSnapshot.street, marginLeft, ry);
    ry += 5;
  }
  const cityLine = `${invoice.customerSnapshot.postalCode} ${invoice.customerSnapshot.city}`.trim();
  if (cityLine) {
    doc.text(cityLine, marginLeft, ry);
    ry += 5;
  }

  const today = toInputDate();
  const overdueDays = getOverdueDays(invoice, today);
  const newDueDate = toInputDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const isSmallBiz = invoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
  const openAmount = isSmallBiz ? invoice.netTotal : invoice.grossTotal;

  let y = Math.max(ry + 18, cy + 16);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(`Zahlungserinnerung zur Rechnung ${invoice.invoiceNumber}`, marginLeft, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Datum: ${formatDateDE(today)}`, marginLeft, y);
  y += 10;

  const bodyText =
    `Sehr geehrte Damen und Herren,\n\n` +
    `bei der Prüfung unserer Buchhaltung haben wir festgestellt, dass die Rechnung ${invoice.invoiceNumber} vom ${formatDateDE(invoice.issueDate)} über ${formatCurrency(openAmount)} seit dem ${formatDateDE(invoice.dueDate)} (${overdueDays} ${overdueDays === 1 ? 'Tag' : 'Tage'} überfällig) noch offen ist.\n\n` +
    `Sicherlich handelt es sich hierbei um ein Versehen. Wir bitten Sie freundlich, den offenen Betrag bis spätestens ${formatDateDE(newDueDate)} unter Angabe der Rechnungsnummer auf das unten genannte Konto zu überweisen.\n\n` +
    `Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie diese Erinnerung bitte als gegenstandslos.\n\n` +
    `Mit freundlichen Grüßen\n${company.ownerName || company.companyName}`;

  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  const lines = doc.splitTextToSize(bodyText, contentWidth);
  doc.text(lines, marginLeft, y);
  y += lines.length * 4.8 + 10;

  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginLeft, y, contentWidth, 24, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Offener Rechnungsbetrag: ${formatCurrency(openAmount)}`, marginLeft + 4, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Verwendungszweck: ${invoice.invoiceNumber}`, marginLeft + 4, y + 13);
  if (company.iban) {
    doc.text(`IBAN: ${company.iban}${company.bic ? ` · BIC: ${company.bic}` : ''}`, marginLeft + 4, y + 19);
  }

  const qrDataUrl = await generateGiroCodeDataUrl(invoice, company);
  if (qrDataUrl) {
    const qrSize = 27;
    const qrX = pageWidth - marginRight - qrSize;
    doc.addImage(qrDataUrl, 'PNG', qrX, y + 32, qrSize, qrSize);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text('GiroCode (EPC-QR)', qrX + qrSize / 2, y + 32 + qrSize + 4, { align: 'center' });
  }

  drawFooter(doc, company);
  return doc;
}

export function buildTimesheetPdf(
  title: string,
  customer: Customer | undefined,
  entries: TimeEntry[],
  company: CompanyProfile,
  subtitle?: string
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const accentPreset = company.invoiceAccentColor ?? 'slate';
  const accentRgb = INVOICE_ACCENT_STYLES[accentPreset]?.rgb ?? [15, 23, 42];
  const [accentR, accentG, accentB] = accentRgb;

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(customer?.companyName || 'Kunde', marginLeft, ry);
  ry += 5;
  doc.setFont('helvetica', 'normal');
  if (customer?.contactName) {
    doc.text(customer.contactName, marginLeft, ry);
    ry += 5;
  }
  if (customer?.street) {
    doc.text(customer.street, marginLeft, ry);
    ry += 5;
  }
  const cityLine = `${customer?.postalCode || ''} ${customer?.city || ''}`.trim();
  if (cityLine) {
    doc.text(cityLine, marginLeft, ry);
    ry += 5;
  }

  let y = Math.max(ry + 16, cy + 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(title, marginLeft, y);
  y += 6;

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, marginLeft, y);
    y += 8;
  } else {
    y += 4;
  }

  const drawHeader = (startY: number) => {
    doc.setFillColor(accentR, accentG, accentB);
    doc.rect(marginLeft, startY, contentWidth, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text('Datum', marginLeft + 2, startY + 5.4);
    doc.text('Zeitraum', marginLeft + 26, startY + 5.4);
    doc.text('Tätigkeit / Notizen', marginLeft + 54, startY + 5.4);
    doc.text('Dauer', pageWidth - marginRight - 2, startY + 5.4, { align: 'right' });
    return startY + 11;
  };

  y = drawHeader(y);

  const sorted = [...entries].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  let totalSeconds = 0;
  for (const entry of sorted) {
    totalSeconds += entry.durationSeconds;
    if (y > 246) {
      doc.addPage();
      y = drawHeader(20);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(formatDateDE(entry.startTime), marginLeft + 2, y);
    doc.text(`${toInputTime(entry.startTime)}–${toInputTime(entry.endTime)}`, marginLeft + 26, y);

    doc.setFont('helvetica', 'bold');
    const titleLines = doc.splitTextToSize(entry.title, 88);
    doc.text(titleLines, marginLeft + 54, y);

    doc.setFont('helvetica', 'bold');
    doc.text(formatDuration(entry.durationSeconds), pageWidth - marginRight - 2, y, {
      align: 'right',
    });

    let rowHeight = titleLines.length * 4.1;
    if (entry.notes) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const noteLines = doc.splitTextToSize(entry.notes, 88);
      doc.text(noteLines, marginLeft + 54, y + rowHeight);
      rowHeight += noteLines.length * 3.8;
    }

    y += Math.max(rowHeight, 5) + 2.5;
    doc.setDrawColor(226, 232, 240);
    doc.line(marginLeft, y - 1, pageWidth - marginRight, y - 1);
    y += 2;
  }

  if (y > 235) {
    doc.addPage();
    y = 24;
  }

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(accentR, accentG, accentB);
  const totalHours = totalSeconds / 3600;
  doc.text(
    `Gesamtarbeitszeit (${sorted.length} Einträge): ${formatDuration(totalSeconds)} (${formatNumber(totalHours, 2)} Std.)`,
    pageWidth - marginRight - 2,
    y,
    { align: 'right' }
  );

  // Customer signature block
  y += 18;
  doc.setDrawColor(148, 163, 184);
  doc.line(marginLeft, y, marginLeft + 65, y);
  doc.line(pageWidth - marginRight - 65, y, pageWidth - marginRight, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Ort, Datum', marginLeft, y + 4.5);
  doc.text('Unterschrift / Leistungsbestätigung Kunde', pageWidth - marginRight - 65, y + 4.5);

  drawFooter(doc, company);
  return doc;
}

function docToBase64(doc: jsPDF): string {
  const dataUri = doc.output('datauristring');
  const commaIdx = dataUri.indexOf(',');
  return commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
}

async function openOrSavePdfDoc(doc: jsPDF, filename: string): Promise<void> {
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      await TaktWerkNative.openPdf({ filename, base64: docToBase64(doc) });
      return;
    }
  }
  doc.save(filename);
}

async function shareOrSavePdfDoc(doc: jsPDF, filename: string): Promise<void> {
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      await TaktWerkNative.sharePdf({ filename, base64: docToBase64(doc) });
      return;
    }
  }
  const blob = doc.output('blob');
  if (typeof navigator !== 'undefined' && navigator.share) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: filename, files: [file] });
      return;
    }
  }
  doc.save(filename);
}

export async function getInvoicePdfBase64(
  invoice: Invoice,
  company: CompanyProfile
): Promise<string> {
  const doc = await buildInvoicePdf(invoice, company);
  return docToBase64(doc);
}

export async function downloadInvoicePdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<void> {
  const doc = await buildInvoicePdf(invoice, company);
  await openOrSavePdfDoc(doc, `${invoice.invoiceNumber}.pdf`);
}

export async function shareInvoicePdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<void> {
  const doc = await buildInvoicePdf(invoice, company);
  await shareOrSavePdfDoc(doc, `${invoice.invoiceNumber}.pdf`);
}

export async function downloadPaymentReminderPdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<void> {
  const doc = await buildPaymentReminderPdf(invoice, company);
  await openOrSavePdfDoc(doc, `Zahlungserinnerung-${invoice.invoiceNumber}.pdf`);
}

export async function downloadTimesheetPdf(
  title: string,
  filename: string,
  customer: Customer | undefined,
  entries: TimeEntry[],
  company: CompanyProfile,
  subtitle?: string
): Promise<void> {
  const doc = buildTimesheetPdf(title, customer, entries, company, subtitle);
  await openOrSavePdfDoc(doc, filename);
}

export async function shareTimesheetPdf(
  title: string,
  filename: string,
  customer: Customer | undefined,
  entries: TimeEntry[],
  company: CompanyProfile,
  subtitle?: string
): Promise<void> {
  const doc = buildTimesheetPdf(title, customer, entries, company, subtitle);
  await shareOrSavePdfDoc(doc, filename);
}

export async function printInvoiceView(invoiceNumber: string): Promise<void> {
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      await TaktWerkNative.printWebView({ jobName: `Rechnung-${invoiceNumber}` });
      return;
    }
  }
  window.print();
}
