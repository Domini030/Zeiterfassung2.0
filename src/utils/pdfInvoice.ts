import { jsPDF } from 'jspdf';
import type { CompanyProfile, Invoice } from '../types';
import {
  INVOICE_ACCENT_STYLES,
  formatCurrency,
  formatDateDE,
  formatNumber,
} from './format';

export function buildInvoicePdf(invoice: Invoice, company: CompanyProfile): jsPDF {
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
  const [accentR, accentG, accentB] =
    INVOICE_ACCENT_STYLES[accentPreset]?.rgb ?? [15, 23, 42];
  const headerTitle = (company.invoiceHeaderTitle || 'Rechnung').trim();

  // Sender return line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const senderOneLine = `${company.companyName} · ${company.street} · ${company.postalCode} ${company.city}`;
  doc.text(senderOneLine, marginLeft, 34);

  // Optional Logo (Top Right)
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
      // Ignore malformed logo image gracefully
    }
  }

  // Company Header (Right side)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(accentR, accentG, accentB);
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

  // Table Header
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

  // Table Rows
  invoice.lineItems.forEach((item, index) => {
    if (y > 245) {
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

  // Totals block
  if (y > 230) {
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

    // Group taxes by rate
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

  // Small business notice (§ 19 UStG)
  if (isSmallBiz) {
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const splitSmallBiz = doc.splitTextToSize(smallBizNotice, contentWidth);
    doc.text(splitSmallBiz, marginLeft, y);
    y += splitSmallBiz.length * 4.2;
  }

  // Outro text & optional footer note
  y += isSmallBiz ? 8 : 12;
  if (invoice.outroText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const splitOutro = doc.splitTextToSize(invoice.outroText, contentWidth);
    doc.text(splitOutro, marginLeft, y);
    y += splitOutro.length * 4.2 + 4;
  }

  if (company.invoiceFooterNote) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const splitNote = doc.splitTextToSize(company.invoiceFooterNote, contentWidth);
    doc.text(splitNote, marginLeft, y);
  }

  // Footer with bank & tax info
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

  return doc;
}

export function getInvoicePdfBase64(invoice: Invoice, company: CompanyProfile): string {
  const doc = buildInvoicePdf(invoice, company);
  const dataUri = doc.output('datauristring');
  const commaIdx = dataUri.indexOf(',');
  return commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
}

export async function downloadInvoicePdf(invoice: Invoice, company: CompanyProfile): Promise<void> {
  const filename = `${invoice.invoiceNumber}.pdf`;
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      const base64 = getInvoicePdfBase64(invoice, company);
      await TaktWerkNative.openPdf({ filename, base64 });
      return;
    }
  }
  const doc = buildInvoicePdf(invoice, company);
  doc.save(filename);
}

export async function shareInvoicePdf(invoice: Invoice, company: CompanyProfile): Promise<void> {
  const filename = `${invoice.invoiceNumber}.pdf`;
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      const base64 = getInvoicePdfBase64(invoice, company);
      await TaktWerkNative.sharePdf({ filename, base64 });
      return;
    }
  }
  const doc = buildInvoicePdf(invoice, company);
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
