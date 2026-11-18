import { jsPDF } from 'jspdf';
import type { AppDatabase, CompanyProfile, Customer, Invoice, TimeEntry } from '../types';
import { generateGiroCodeDataUrl } from './epcQr';
import {
  INVOICE_FONT_OPTIONS,
  calculateDocumentTotals,
  formatCurrency,
  formatDateDE,
  formatDateTimeDE,
  formatDuration,
  formatNumber,
  formatQuantity,
  getOverdueDays,
  resolveInvoiceAccentRgb,
  toInputDate,
  toInputTime,
} from './format';

function getPdfFont(company: CompanyProfile): 'helvetica' | 'times' | 'courier' {
  const family = company.invoiceFontFamily ?? 'sans';
  return INVOICE_FONT_OPTIONS[family]?.pdfFont ?? 'helvetica';
}

function drawCompanyHeader(
  doc: jsPDF,
  company: CompanyProfile,
  accentRgb: [number, number, number],
  font: 'helvetica' | 'times' | 'courier'
): { rightBottomY: number } {
  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;
  const layout = company.invoiceLayoutStyle ?? 'classic';

  if (layout === 'modern') {
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(0, 0, pageWidth, 8, 'F');
  }

  doc.setFont(font, 'normal');
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

  doc.setFont(font, 'bold');
  doc.setFontSize(14);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text(company.companyName || 'TaktWerk', pageWidth - marginRight, headerTopY, {
    align: 'right',
  });

  doc.setFont(font, 'normal');
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

function drawFooter(
  doc: jsPDF,
  company: CompanyProfile,
  font: 'helvetica' | 'times' | 'courier'
) {
  const pageWidth = 210;
  const marginLeft = 20;
  const marginRight = 20;
  const footerY = 274;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(marginLeft, footerY - 3, pageWidth - marginRight, footerY - 3);
  doc.setFont(font, 'normal');
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
  const accentRgb = resolveInvoiceAccentRgb(company);
  const [accentR, accentG, accentB] = accentRgb;
  const font = getPdfFont(company);
  const layout = company.invoiceLayoutStyle ?? 'classic';
  const isQuote = invoice.documentType === 'quote';
  const headerTitle = isQuote
    ? (company.quoteHeaderTitle || 'Angebot').trim()
    : (company.invoiceHeaderTitle || 'Rechnung').trim();

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb, font);

  // Recipient Address
  doc.setFont(font, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(invoice.customerSnapshot.companyName, marginLeft, ry);
  ry += 5;
  doc.setFont(font, 'normal');
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

  // Document Metadata Block (Right)
  const metaY = Math.max(cy + 6, 66);
  if (layout === 'minimal') {
    doc.setDrawColor(accentR, accentG, accentB);
    doc.setLineWidth(0.4);
    doc.line(122, metaY - 5, pageWidth - marginRight, metaY - 5);
  } else {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(122, metaY - 5, 68, 28, 1.5, 1.5, 'FD');
  }

  const metaRows: [string, string][] = isQuote
    ? [
        ['Angebotsnummer:', invoice.invoiceNumber],
        ['Angebotsdatum:', formatDateDE(invoice.issueDate)],
        ['Zeitraum:', `${formatDateDE(invoice.servicePeriodStart)} – ${formatDateDE(invoice.servicePeriodEnd)}`],
        ['Gültig bis:', formatDateDE(invoice.quoteValidUntil || invoice.dueDate)],
      ]
    : [
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
    doc.setFont(font, 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(label, 125, my);
    doc.setFont(font, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(value, pageWidth - marginRight - 3, my, { align: 'right' });
    my += 5.5;
  }

  // Title
  let y = Math.max(ry + 18, metaY + 32);
  doc.setFont(font, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(`${headerTitle} ${invoice.invoiceNumber}`, marginLeft, y);
  y += 8;

  // Intro text
  if (invoice.introText) {
    doc.setFont(font, 'normal');
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
    if (layout === 'minimal') {
      doc.setDrawColor(accentR, accentG, accentB);
      doc.setLineWidth(0.5);
      doc.line(marginLeft, startY + 7.5, pageWidth - marginRight, startY + 7.5);
      doc.setTextColor(accentR, accentG, accentB);
    } else {
      doc.setFillColor(accentR, accentG, accentB);
      doc.rect(marginLeft, startY, contentWidth, 8, 'F');
      doc.setTextColor(255, 255, 255);
    }
    doc.setFont(font, 'bold');
    doc.setFontSize(8.5);
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

    doc.setFont(font, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(index + 1), marginLeft + 2, y);

    const descMaxWidth = isSmallBiz ? 84 : 78;
    const descLines = doc.splitTextToSize(item.description, descMaxWidth);
    doc.text(descLines, marginLeft + 12, y);

    doc.setFont(font, 'normal');
    if (isSmallBiz) {
      doc.text(`${formatQuantity(item.quantity)} ${item.unit}`, marginLeft + 114, y, {
        align: 'right',
      });
      doc.text(formatCurrency(item.unitPriceNet), marginLeft + 142, y, { align: 'right' });
    } else {
      doc.text(`${formatQuantity(item.quantity)} ${item.unit}`, marginLeft + 108, y, {
        align: 'right',
      });
      doc.text(formatCurrency(item.unitPriceNet), marginLeft + 135, y, { align: 'right' });
      doc.text(`${item.taxRate} %`, marginLeft + 149, y, { align: 'right' });
    }
    doc.setFont(font, 'bold');
    doc.text(formatCurrency(item.netTotal), pageWidth - marginRight - 2, y, { align: 'right' });

    let rowHeight = descLines.length * 4.2;
    if (item.detail) {
      doc.setFont(font, 'normal');
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

  if (y > 215) {
    doc.addPage();
    y = 24;
  }

  y += 3;
  const totalsX = 114;
  const totals = calculateDocumentTotals(
    invoice.lineItems,
    isSmallBiz,
    invoice.discountType ?? 'percent',
    invoice.discountValue ?? 0
  );
  const discountAmount = invoice.discountNetAmount ?? totals.discountNetAmount;
  const subtotalBeforeDiscount =
    invoice.subtotalNetBeforeDiscount ?? totals.subtotalNetBeforeDiscount;

  doc.setFontSize(9.5);
  if (discountAmount > 0) {
    doc.setFont(font, 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(isSmallBiz ? 'Zwischensumme' : 'Zwischensumme Netto', totalsX, y);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(subtotalBeforeDiscount), pageWidth - marginRight - 2, y, {
      align: 'right',
    });
    y += 5.5;

    const discountText =
      invoice.discountLabel?.trim() ||
      (invoice.discountType === 'percent' && invoice.discountValue
        ? `Rabatt (${formatNumber(invoice.discountValue, 1)} %)`
        : 'Rabatt');
    doc.setTextColor(190, 18, 60);
    doc.text(discountText, totalsX, y);
    doc.text(`- ${formatCurrency(discountAmount)}`, pageWidth - marginRight - 2, y, {
      align: 'right',
    });
    y += 5.5;
  }

  if (!isSmallBiz) {
    doc.setFont(font, 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(discountAmount > 0 ? 'Summe Netto (nach Rabatt)' : 'Summe Netto', totalsX, y);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(invoice.netTotal), pageWidth - marginRight - 2, y, { align: 'right' });
    y += 5.5;

    for (const grp of totals.taxBreakdown) {
      doc.setTextColor(71, 85, 105);
      doc.text(`zzgl. ${grp.rate} % MwSt.`, totalsX, y);
      doc.setTextColor(15, 23, 42);
      doc.text(formatCurrency(grp.tax), pageWidth - marginRight - 2, y, { align: 'right' });
      y += 5.5;
    }
  }

  doc.setDrawColor(accentR, accentG, accentB);
  doc.setLineWidth(0.5);
  doc.line(totalsX, y - 1, pageWidth - marginRight, y - 1);
  y += 4.5;

  doc.setFont(font, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(isQuote ? 'Angebotssumme' : 'Rechnungsbetrag', totalsX, y);
  doc.text(
    formatCurrency(isSmallBiz ? invoice.netTotal : invoice.grossTotal),
    pageWidth - marginRight - 2,
    y,
    { align: 'right' }
  );

  if (isSmallBiz) {
    y += 10;
    doc.setFont(font, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const splitSmallBiz = doc.splitTextToSize(smallBizNotice, contentWidth);
    doc.text(splitSmallBiz, marginLeft, y);
    y += splitSmallBiz.length * 4.2;
  }

  // Outro + GiroCode QR block (Invoices only)
  y += isSmallBiz ? 8 : 12;
  const qrDataUrl = isQuote ? null : await generateGiroCodeDataUrl(invoice, company);
  if (qrDataUrl && y > 235) {
    doc.addPage();
    y = 24;
  }

  const textWidth = qrDataUrl ? contentWidth - 36 : contentWidth;
  let outroEndY = y;

  if (invoice.outroText) {
    doc.setFont(font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const splitOutro = doc.splitTextToSize(invoice.outroText, textWidth);
    doc.text(splitOutro, marginLeft, y);
    outroEndY = y + splitOutro.length * 4.2 + 4;
  }

  if (company.invoiceFooterNote) {
    doc.setFont(font, 'italic');
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
    doc.setFont(font, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text('GiroCode (EPC-QR)', qrX + qrSize / 2, qrY + qrSize + 4, { align: 'center' });
  }

  if (invoice.signature?.signatureDataUrl) {
    let sigY = Math.max(outroEndY + 6, qrDataUrl ? y + 36 : outroEndY + 6);
    if (sigY > 235) {
      doc.addPage();
      sigY = 24;
    }
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(marginLeft, sigY, 92, 28, 1.5, 1.5, 'FD');
    try {
      doc.addImage(invoice.signature.signatureDataUrl, 'PNG', marginLeft + 3, sigY + 2, 54, 17);
    } catch {
      // Ignore malformed signature image
    }
    doc.setFont(font, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Abnahme: ${invoice.signature.signedBy}${invoice.signature.signedRole ? ` (${invoice.signature.signedRole})` : ''}`,
      marginLeft + 3,
      sigY + 22
    );
    doc.setFont(font, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    const metaInfo = [
      `Unterzeichnet am ${formatDateTimeDE(invoice.signature.signedAt)}`,
      invoice.signature.locationAddress,
    ]
      .filter(Boolean)
      .join(' · ');
    doc.text(doc.splitTextToSize(metaInfo, 86)[0] || '', marginLeft + 3, sigY + 26);
  }

  drawFooter(doc, company, font);
  return doc;
}

export function buildAcceptanceProtocolPdf(
  invoice: Invoice,
  company: CompanyProfile
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
  const accentRgb = resolveInvoiceAccentRgb(company);
  const [accentR, accentG, accentB] = accentRgb;
  const font = getPdfFont(company);

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb, font);

  doc.setFont(font, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(invoice.customerSnapshot.companyName, marginLeft, ry);
  ry += 5;
  doc.setFont(font, 'normal');
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

  let y = Math.max(ry + 16, cy + 10);
  doc.setFont(font, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(`Abnahme- & Leistungsprotokoll (${invoice.invoiceNumber})`, marginLeft, y);
  y += 6;

  doc.setFont(font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Leistungszeitraum: ${formatDateDE(invoice.servicePeriodStart)} – ${formatDateDE(invoice.servicePeriodEnd)}   ·   Belegdatum: ${formatDateDE(invoice.issueDate)}`,
    marginLeft,
    y
  );
  y += 8;

  doc.setFillColor(accentR, accentG, accentB);
  doc.rect(marginLeft, y, contentWidth, 8, 'F');
  doc.setFont(font, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('Pos.', marginLeft + 2, y + 5.4);
  doc.text('Erbrachte Leistung / Lieferung', marginLeft + 12, y + 5.4);
  doc.text('Menge', pageWidth - marginRight - 2, y + 5.4, { align: 'right' });
  y += 11;

  invoice.lineItems.forEach((item, index) => {
    if (y > 235) {
      doc.addPage();
      y = 24;
    }
    doc.setFont(font, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(index + 1), marginLeft + 2, y);
    const descLines = doc.splitTextToSize(item.description, contentWidth - 40);
    doc.text(descLines, marginLeft + 12, y);
    doc.text(`${formatQuantity(item.quantity)} ${item.unit}`, pageWidth - marginRight - 2, y, {
      align: 'right',
    });
    let rowH = descLines.length * 4.2;
    if (item.detail) {
      doc.setFont(font, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const detLines = doc.splitTextToSize(item.detail, contentWidth - 40);
      doc.text(detLines, marginLeft + 12, y + rowH);
      rowH += detLines.length * 3.8;
    }
    y += Math.max(rowH, 5) + 3;
    doc.setDrawColor(226, 232, 240);
    doc.line(marginLeft, y - 1.5, pageWidth - marginRight, y - 1.5);
    y += 2.5;
  });

  if (y > 205) {
    doc.addPage();
    y = 24;
  }

  y += 6;
  doc.setFont(font, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  const confirmText =
    'Der Auftraggeber bestätigt hiermit die ordnungsgemäße, vollständige und mängelfreie Ausführung der oben aufgeführten Leistungen bzw. Lieferungen.';
  const confirmLines = doc.splitTextToSize(confirmText, contentWidth);
  doc.text(confirmLines, marginLeft, y);
  y += confirmLines.length * 4.5 + 6;

  const sig = invoice.signature;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginLeft, y, contentWidth, 46, 2, 2, 'FD');

  if (sig?.signatureDataUrl) {
    try {
      doc.addImage(sig.signatureDataUrl, 'PNG', marginLeft + 5, y + 4, 72, 24);
    } catch {
      // Ignore malformed signature image
    }
    doc.setFont(font, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Unterzeichnet von: ${sig.signedBy}${sig.signedRole ? ` (${sig.signedRole})` : ''}`,
      marginLeft + 5,
      y + 33
    );
    doc.setFont(font, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Zeitstempel: ${formatDateTimeDE(sig.signedAt)}${sig.locationAddress ? ` · Ort: ${sig.locationAddress}` : ''}`,
      marginLeft + 5,
      y + 38.5
    );
    if (sig.notes) {
      doc.text(doc.splitTextToSize(`Bemerkung: ${sig.notes}`, contentWidth - 10)[0] || '', marginLeft + 5, y + 43.5);
    }
  } else {
    doc.setDrawColor(148, 163, 184);
    doc.line(marginLeft + 6, y + 32, marginLeft + 76, y + 32);
    doc.line(marginLeft + 92, y + 32, pageWidth - marginRight - 6, y + 32);
    doc.setFont(font, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Ort, Datum', marginLeft + 6, y + 37);
    doc.text('Unterschrift Auftraggeber / Kunde', marginLeft + 92, y + 37);
  }

  drawFooter(doc, company, font);
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
  const accentRgb = resolveInvoiceAccentRgb(company);
  const [accentR, accentG, accentB] = accentRgb;
  const font = getPdfFont(company);

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb, font);

  doc.setFont(font, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(invoice.customerSnapshot.companyName, marginLeft, ry);
  ry += 5;
  doc.setFont(font, 'normal');
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
  doc.setFont(font, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(`Zahlungserinnerung zur Rechnung ${invoice.invoiceNumber}`, marginLeft, y);
  y += 6;

  doc.setFont(font, 'normal');
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
  doc.setFont(font, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Offener Rechnungsbetrag: ${formatCurrency(openAmount)}`, marginLeft + 4, y + 7);
  doc.setFont(font, 'normal');
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
    doc.setFont(font, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text('GiroCode (EPC-QR)', qrX + qrSize / 2, y + 32 + qrSize + 4, { align: 'center' });
  }

  drawFooter(doc, company, font);
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
  const accentRgb = resolveInvoiceAccentRgb(company);
  const [accentR, accentG, accentB] = accentRgb;
  const font = getPdfFont(company);

  const { rightBottomY: cy } = drawCompanyHeader(doc, company, accentRgb, font);

  doc.setFont(font, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  let ry = 42;
  doc.text(customer?.companyName || 'Kunde', marginLeft, ry);
  ry += 5;
  doc.setFont(font, 'normal');
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
  doc.setFont(font, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(accentR, accentG, accentB);
  doc.text(title, marginLeft, y);
  y += 6;

  if (subtitle) {
    doc.setFont(font, 'normal');
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
    doc.setFont(font, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text('Datum', marginLeft + 2, startY + 5.4);
    doc.text('Zeitraum', marginLeft + 26, startY + 5.4);
    doc.text('Tätigkeit / Notizen / Ort', marginLeft + 54, startY + 5.4);
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

    doc.setFont(font, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(formatDateDE(entry.startTime), marginLeft + 2, y);
    doc.text(`${toInputTime(entry.startTime)}–${toInputTime(entry.endTime)}`, marginLeft + 26, y);

    doc.setFont(font, 'bold');
    const titleLines = doc.splitTextToSize(entry.title, 88);
    doc.text(titleLines, marginLeft + 54, y);

    doc.setFont(font, 'bold');
    doc.text(formatDuration(entry.durationSeconds), pageWidth - marginRight - 2, y, {
      align: 'right',
    });

    let rowHeight = titleLines.length * 4.1;
    const detailText = [
      entry.notes,
      entry.location?.address ? `Ort: ${entry.location.address}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (detailText) {
      doc.setFont(font, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const noteLines = doc.splitTextToSize(detailText, 88);
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
  doc.setFont(font, 'bold');
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
  doc.setFont(font, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Ort, Datum', marginLeft, y + 4.5);
  doc.text('Unterschrift / Leistungsbestätigung Kunde', pageWidth - marginRight - 65, y + 4.5);

  // Attached work photo documentation (2-column grid)
  const photoItems: { entry: TimeEntry; dataUrl: string; caption?: string; capturedAt: string }[] = [];
  for (const entry of sorted) {
    if (entry.photos && entry.photos.length > 0) {
      for (const ph of entry.photos) {
        if (ph.dataUrl && ph.dataUrl.startsWith('data:image/')) {
          photoItems.push({
            entry,
            dataUrl: ph.dataUrl,
            caption: ph.caption,
            capturedAt: ph.capturedAt,
          });
        }
      }
    }
  }

  if (photoItems.length > 0) {
    doc.addPage();
    let py = 20;
    doc.setFont(font, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(accentR, accentG, accentB);
    doc.text(`Fotodokumentation der Einsätze (${photoItems.length})`, marginLeft, py);
    py += 8;

    const colGap = 8;
    const cardW = (contentWidth - colGap) / 2;
    const imgH = 52;
    const cardH = imgH + 18;

    photoItems.forEach((item, idx) => {
      const col = idx % 2;
      if (col === 0 && py + cardH > 272) {
        doc.addPage();
        py = 20;
      }
      const x = marginLeft + col * (cardW + colGap);

      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, py, cardW, cardH, 2, 2, 'FD');

      try {
        const format = item.dataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        doc.addImage(item.dataUrl, format, x + 2, py + 2, cardW - 4, imgH, undefined, 'FAST');
      } catch {
        doc.setFont(font, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text('Foto konnte nicht eingebettet werden', x + 4, py + imgH / 2);
      }

      doc.setFont(font, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      const headerTxt = doc.splitTextToSize(
        `${formatDateDE(item.entry.startTime)} · ${item.entry.title}`,
        cardW - 6
      )[0];
      doc.text(headerTxt || '', x + 3, py + imgH + 6.5);

      doc.setFont(font, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      const subText = [item.caption, item.entry.location?.address]
        .filter(Boolean)
        .join(' · ');
      if (subText) {
        const subLine = doc.splitTextToSize(subText, cardW - 6)[0];
        doc.text(subLine || '', x + 3, py + imgH + 11.5);
      }

      if (col === 1 || idx === photoItems.length - 1) {
        py += cardH + 6;
      }
    });
  }

  drawFooter(doc, company, font);
  return doc;
}

export function buildFullBackupSummaryPdf(db: AppDatabase): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const company = db.company;
  const font = getPdfFont(company);
  const [r, g, b] = resolveInvoiceAccentRgb(company);
  const marginLeft = 18;
  const pageWidth = 210;
  const contentWidth = pageWidth - marginLeft * 2;

  doc.setFillColor(r, g, b);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setFont(font, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(`${company.companyName || 'TaktWerk'} — Gesamtsicherung (PDF)`, marginLeft, 12);
  doc.setFont(font, 'normal');
  doc.setFontSize(9);
  doc.text(`Stand: ${formatDateDE(new Date().toISOString())} · Alle Kunden, Zeiten & Dokumente`, marginLeft, 18.5);

  let y = 34;
  const totalSec = db.timeEntries.reduce((a, e) => a + e.durationSeconds, 0);
  const openSec = db.timeEntries
    .filter((e) => e.billable && !e.billedInvoiceId)
    .reduce((a, e) => a + e.durationSeconds, 0);
  const totalInvNet = db.invoices
    .filter((i) => i.documentType !== 'quote' && i.status !== 'Storniert')
    .reduce((a, i) => a + i.netTotal, 0);

  doc.setFont(font, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Kennzahlen-Übersicht', marginLeft, y);
  y += 6;
  doc.setFont(font, 'normal');
  doc.setFontSize(9);
  const stats = [
    `Kunden: ${db.customers.length}   |   Produkte & Leistungen: ${db.products.length}   |   NFC-Aufgaben: ${db.nfcTasks.length}`,
    `Zeiteinträge: ${db.timeEntries.length} (${formatNumber(totalSec / 3600, 2)} Std. gesamt, ${formatNumber(openSec / 3600, 2)} Std. offen)`,
    `Dokumente (Rechnungen & Angebote): ${db.invoices.length}   |   Rechnungsumsatz Netto: ${formatCurrency(totalInvNet)}`,
  ];
  for (const s of stats) {
    doc.text(s, marginLeft, y);
    y += 5;
  }

  y += 4;
  doc.setFont(font, 'bold');
  doc.setFontSize(11);
  doc.text('2. Letzte Zeiteinträge (Top 25)', marginLeft, y);
  y += 5;

  const custMap = new Map(db.customers.map((c) => [c.id, c.companyName]));
  const recentEntries = [...db.timeEntries]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 25);

  doc.setFontSize(8);
  for (const entry of recentEntries) {
    if (y > 265) {
      doc.addPage();
      y = 20;
    }
    doc.setFont(font, 'bold');
    doc.setTextColor(15, 23, 42);
    const lineTitle = `${formatDateDE(entry.startTime)} · ${entry.title} (${custMap.get(entry.customerId) ?? '—'})`;
    doc.text(doc.splitTextToSize(lineTitle, contentWidth - 28)[0], marginLeft, y);
    doc.text(formatDuration(entry.durationSeconds), pageWidth - marginLeft, y, {
      align: 'right',
    });
    y += 4;
    if (entry.notes || entry.location?.address) {
      doc.setFont(font, 'normal');
      doc.setTextColor(100, 116, 139);
      const sub = [entry.notes, entry.location?.address].filter(Boolean).join(' · ');
      doc.text(doc.splitTextToSize(sub, contentWidth)[0], marginLeft + 2, y);
      y += 4;
    }
    y += 1.2;
  }

  y += 5;
  if (y > 240) {
    doc.addPage();
    y = 20;
  }
  doc.setFont(font, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Rechnungen & Angebote', marginLeft, y);
  y += 6;
  doc.setFontSize(8.5);
  for (const inv of db.invoices.slice(0, 30)) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    const kind = inv.documentType === 'quote' ? 'Angebot' : 'Rechnung';
    doc.setFont(font, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${inv.invoiceNumber} (${kind}) · ${inv.customerSnapshot.companyName} · ${inv.status}`,
      marginLeft,
      y
    );
    doc.text(formatCurrency(inv.grossTotal), pageWidth - marginLeft, y, {
      align: 'right',
    });
    y += 5;
  }

  return doc;
}

export function docToBase64(doc: jsPDF): string {
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

export function getFullBackupPdfBase64(db: AppDatabase): string {
  const doc = buildFullBackupSummaryPdf(db);
  return docToBase64(doc);
}

export async function downloadFullBackupPdf(db: AppDatabase): Promise<void> {
  const doc = buildFullBackupSummaryPdf(db);
  await openOrSavePdfDoc(doc, `TaktWerk-Gesamtbericht-${toInputDate()}.pdf`);
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

export async function getPaymentReminderPdfBase64(
  invoice: Invoice,
  company: CompanyProfile
): Promise<string> {
  const doc = await buildPaymentReminderPdf(invoice, company);
  return docToBase64(doc);
}

export function getAcceptanceProtocolPdfBase64(
  invoice: Invoice,
  company: CompanyProfile
): string {
  const doc = buildAcceptanceProtocolPdf(invoice, company);
  return docToBase64(doc);
}

export async function downloadAcceptanceProtocolPdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<void> {
  const doc = buildAcceptanceProtocolPdf(invoice, company);
  await openOrSavePdfDoc(doc, `Abnahme-${invoice.invoiceNumber}.pdf`);
}

export async function shareAcceptanceProtocolPdf(
  invoice: Invoice,
  company: CompanyProfile
): Promise<void> {
  const doc = buildAcceptanceProtocolPdf(invoice, company);
  await shareOrSavePdfDoc(doc, `Abnahme-${invoice.invoiceNumber}.pdf`);
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
      await TaktWerkNative.printWebView({ jobName: `Dokument-${invoiceNumber}` });
      return;
    }
  }
  window.print();
}

export interface FilteredReportOptions {
  title?: string;
  startDate?: string;
  endDate?: string;
  customerId?: string; // 'all' or specific id or 'internal_only'
  productId?: string; // 'all' or specific id
  taskTitle?: string; // 'all' or specific task title
  entryType?: 'all' | 'project' | 'internal';
  billableFilter?: 'all' | 'billable_only' | 'unbillable_only';
}

export function buildFilteredReportPdf(
  db: AppDatabase,
  options: FilteredReportOptions = {}
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginLeft = 18;
  const marginRight = 18;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const company = db.company;
  const font = getPdfFont(company);
  const accentRgb = resolveInvoiceAccentRgb(company);
  const [accentR, accentG, accentB] = accentRgb;

  const customerMap = new Map(db.customers.map((c) => [c.id, c]));
  const productMap = new Map(db.products.map((p) => [p.id, p]));

  // 1. Filter entries
  const filtered = db.timeEntries.filter((e) => {
    const dateStr = e.startTime.slice(0, 10);
    if (options.startDate && dateStr < options.startDate) return false;
    if (options.endDate && dateStr > options.endDate) return false;

    const isInternal = e.entryType === 'internal' || !e.customerId;
    if (options.entryType === 'internal' && !isInternal) return false;
    if (options.entryType === 'project' && isInternal) return false;

    if (options.customerId === 'internal_only' && !isInternal) return false;
    if (
      options.customerId &&
      options.customerId !== 'all' &&
      options.customerId !== 'internal_only' &&
      e.customerId !== options.customerId
    ) {
      return false;
    }

    if (options.productId && options.productId !== 'all' && e.productId !== options.productId) {
      return false;
    }

    if (options.taskTitle && options.taskTitle !== 'all' && e.title !== options.taskTitle) {
      return false;
    }

    if (options.billableFilter === 'billable_only' && !e.billable) return false;
    if (options.billableFilter === 'unbillable_only' && e.billable) return false;

    return true;
  });

  filtered.sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  );

  // 2. Metrics
  const totalSec = filtered.reduce((acc, e) => acc + e.durationSeconds, 0);
  const billableSec = filtered.reduce((acc, e) => acc + (e.billable ? e.durationSeconds : 0), 0);
  const internalSec = filtered.reduce(
    (acc, e) => acc + (e.entryType === 'internal' || !e.billable ? e.durationSeconds : 0),
    0
  );
  const totalNet = filtered.reduce(
    (acc, e) => acc + (e.billable ? (e.durationSeconds / 3600) * e.hourlyRateNet : 0),
    0
  );
  const billablePct = totalSec > 0 ? (billableSec / totalSec) * 100 : 0;
  const internalPct = totalSec > 0 ? (internalSec / totalSec) * 100 : 0;

  // Header Bar
  doc.setFillColor(accentR, accentG, accentB);
  doc.rect(0, 0, pageWidth, 5.5, 'F');

  let y = 16;
  doc.setFont(font, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(options.title || 'Grafischer Tätigkeits- & Auswertungsbericht', marginLeft, y);

  doc.setFont(font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(company.companyName, pageWidth - marginRight, y, { align: 'right' });

  y += 5.5;
  const filterDescParts = [
    options.startDate || options.endDate
      ? `Zeitraum: ${options.startDate ? formatDateDE(options.startDate) : 'Beginn'} bis ${options.endDate ? formatDateDE(options.endDate) : 'Heute'}`
      : 'Zeitraum: Gesamte Historie',
    options.customerId && options.customerId !== 'all'
      ? options.customerId === 'internal_only'
        ? 'Filter: Nur interne Tätigkeiten'
        : `Kunde: ${customerMap.get(options.customerId)?.companyName ?? options.customerId}`
      : 'Kunden: Alle',
    options.productId && options.productId !== 'all'
      ? `Leistung: ${productMap.get(options.productId)?.name ?? options.productId}`
      : null,
    options.taskTitle && options.taskTitle !== 'all'
      ? `Auftrag: ${options.taskTitle}`
      : null,
    options.billableFilter === 'billable_only'
      ? 'Nur verrechenbar'
      : options.billableFilter === 'unbillable_only'
        ? 'Nur interne / nicht verrechenbare Zeiten'
        : null,
    `Erstellt am ${formatDateTimeDE(new Date().toISOString())}`,
  ].filter(Boolean);

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const filterDescLines = doc.splitTextToSize(filterDescParts.join('  ·  '), contentWidth);
  doc.text(filterDescLines, marginLeft, y);
  if (filterDescLines.length > 1) {
    y += (filterDescLines.length - 1) * 3.5;
  }

  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 5;

  // 4 KPI Cards
  const cardGap = 3.5;
  const cardW = (contentWidth - cardGap * 3) / 4;
  const cardH = 17;

  const kpis = [
    {
      label: 'Gesamte Arbeitszeit',
      value: `${formatNumber(totalSec / 3600, 2)} Std.`,
      sub: `${filtered.length} Zeiteintrag(-e)`,
      bg: [248, 250, 252],
    },
    {
      label: 'Verrechenbare Projektzeit',
      value: `${formatNumber(billableSec / 3600, 2)} Std.`,
      sub: `${formatNumber(billablePct, 1)} % Quote`,
      bg: [241, 245, 249],
    },
    {
      label: 'Interne Tätigkeiten',
      value: `${formatNumber(internalSec / 3600, 2)} Std.`,
      sub: `${formatNumber(internalPct, 1)} % der Zeit`,
      bg: [248, 250, 252],
    },
    {
      label: 'Nettoumsatz (Erwirtschaftet)',
      value: formatCurrency(totalNet),
      sub: billableSec > 0 ? `Ø ${formatCurrency(totalNet / (billableSec / 3600))}/Std.` : '—',
      bg: [241, 245, 249],
    },
  ];

  kpis.forEach((kpi, idx) => {
    const cx = marginLeft + idx * (cardW + cardGap);
    doc.setFillColor(kpi.bg[0], kpi.bg[1], kpi.bg[2]);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, y, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFont(font, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, cx + 2.5, y + 4);

    doc.setFont(font, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, cx + 2.5, y + 10.5);

    doc.setFont(font, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(kpi.sub, cx + 2.5, y + 14.5);
  });

  y += cardH + 7;

  // Visual Graphic: Distribution Bar
  doc.setFont(font, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('Grafische Auswertung: Zeitverteilung & Verhältnis', marginLeft, y);
  y += 4;

  const barHeight = 6.5;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(marginLeft, y, contentWidth, barHeight, 1.2, 1.2, 'F');

  if (totalSec > 0) {
    const billableW = Math.max(1, (billableSec / totalSec) * contentWidth);
    doc.setFillColor(accentR, accentG, accentB);
    doc.roundedRect(marginLeft, y, billableW, barHeight, 1.2, 1.2, 'F');
  }

  y += barHeight + 4;
  doc.setFont(font, 'normal');
  doc.setFontSize(7.5);

  // Legend
  doc.setFillColor(accentR, accentG, accentB);
  doc.rect(marginLeft, y - 2.5, 3, 3, 'F');
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Verrechenbare Projektzeit: ${formatNumber(billableSec / 3600, 2)} Std. (${formatNumber(billablePct, 1)} %)`,
    marginLeft + 4.5,
    y
  );

  doc.setFillColor(148, 163, 184);
  doc.rect(marginLeft + 75, y - 2.5, 3, 3, 'F');
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Interne / Nicht verrechenbare Zeit: ${formatNumber(internalSec / 3600, 2)} Std. (${formatNumber(internalPct, 1)} %)`,
    marginLeft + 79.5,
    y
  );

  y += 7;

  // Breakdown by Customer & Internal Activities (Top 5 horizontal bars)
  const groupHours = new Map<string, { label: string; hours: number; net: number; isInternal: boolean }>();
  for (const e of filtered) {
    const isInt = e.entryType === 'internal' || !e.customerId;
    const key = isInt ? `int:${e.internalCategory || 'Interne Arbeit'}` : `cust:${e.customerId}`;
    const cur = groupHours.get(key) || {
      label: isInt
        ? `[Intern] ${e.internalCategory || 'Interne Tätigkeit'}`
        : (customerMap.get(e.customerId)?.companyName ?? 'Kunde'),
      hours: 0,
      net: 0,
      isInternal: isInt,
    };
    cur.hours += e.durationSeconds / 3600;
    if (e.billable) cur.net += (e.durationSeconds / 3600) * e.hourlyRateNet;
    groupHours.set(key, cur);
  }

  const topGroups = Array.from(groupHours.values())
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  if (topGroups.length > 0) {
    doc.setFont(font, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Top Schwerpunkte nach Arbeitsstunden', marginLeft, y);
    y += 4;

    const maxH = Math.max(...topGroups.map((g) => g.hours), 0.1);
    const chartBarMaxW = 85;

    for (const grp of topGroups) {
      doc.setFont(font, grp.isInternal ? 'normal' : 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(grp.isInternal ? 71 : 15, grp.isInternal ? 85 : 23, grp.isInternal ? 105 : 42);
      doc.text(doc.splitTextToSize(grp.label, 50)[0], marginLeft, y + 2.8);

      const bw = Math.max(2, (grp.hours / maxH) * chartBarMaxW);
      if (grp.isInternal) {
        doc.setFillColor(203, 213, 225);
      } else {
        doc.setFillColor(accentR, accentG, accentB);
      }
      doc.roundedRect(marginLeft + 52, y, bw, 3.8, 0.8, 0.8, 'F');

      doc.setFont(font, 'bold');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      const valStr = grp.net > 0
        ? `${formatNumber(grp.hours, 2)} Std.  ·  ${formatCurrency(grp.net)}`
        : `${formatNumber(grp.hours, 2)} Std.`;
      doc.text(valStr, marginLeft + 54 + bw + 2, y + 2.8);

      y += 5.2;
    }
    y += 4;
  }

  // Table of entries
  const drawTableHeader = (startY: number): number => {
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(marginLeft, startY, contentWidth, 6, 1, 1, 'F');
    doc.setFont(font, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);

    doc.text('Datum / Zeit', marginLeft + 2, startY + 4.2);
    doc.text('Typ / Kunde / Tätigkeit', marginLeft + 32, startY + 4.2);
    doc.text('Dauer', marginLeft + 115, startY + 4.2, { align: 'right' });
    doc.text('Status', marginLeft + 140, startY + 4.2);
    doc.text('Netto (€)', pageWidth - marginRight - 2, startY + 4.2, { align: 'right' });
    return startY + 8;
  };

  doc.setFont(font, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Einzelaufstellung der Tätigkeiten (${filtered.length} Einträge)`, marginLeft, y);
  y += 4;

  y = drawTableHeader(y);

  for (const entry of filtered) {
    if (y > pageHeight - 22) {
      doc.addPage();
      // mini top bar on new pages
      doc.setFillColor(accentR, accentG, accentB);
      doc.rect(0, 0, pageWidth, 3, 'F');
      y = drawTableHeader(14);
    }

    const isInt = entry.entryType === 'internal' || !entry.customerId;
    const custName = isInt
      ? `[Intern] ${entry.internalCategory || 'Tätigkeit'}`
      : (customerMap.get(entry.customerId)?.companyName ?? 'Kunde');
    const netVal = entry.billable
      ? (entry.durationSeconds / 3600) * entry.hourlyRateNet
      : 0;

    doc.setFont(font, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${formatDateDE(entry.startTime).slice(0, 5)} ${toInputTime(entry.startTime)}`,
      marginLeft + 2,
      y
    );

    doc.setFont(font, isInt ? 'normal' : 'bold');
    const labelLine = `${custName} · ${entry.title}`;
    doc.text(doc.splitTextToSize(labelLine, 76)[0], marginLeft + 32, y);

    doc.setFont(font, 'bold');
    doc.text(formatDuration(entry.durationSeconds), marginLeft + 115, y, { align: 'right' });

    doc.setFont(font, 'normal');
    doc.setFontSize(6.5);
    if (isInt) {
      doc.setTextColor(100, 116, 139);
      doc.text('Nicht abrechenbar', marginLeft + 125, y);
    } else if (entry.billedInvoiceId) {
      doc.setTextColor(16, 185, 129);
      doc.text('Abgerechnet', marginLeft + 125, y);
    } else {
      doc.setTextColor(accentR, accentG, accentB);
      doc.text('Offen', marginLeft + 125, y);
    }

    doc.setFont(font, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(entry.billable ? formatCurrency(netVal) : '—', pageWidth - marginRight - 2, y, {
      align: 'right',
    });

    let extraHeight = 0;
    if (entry.notes || entry.location?.address) {
      doc.setFont(font, 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      const noteLine = [entry.notes, entry.location?.address ? `Ort: ${entry.location.address}` : null]
        .filter(Boolean)
        .join(' · ');
      doc.text(doc.splitTextToSize(noteLine, 80)[0], marginLeft + 32, y + 3.2);
      extraHeight = 3.6;
    }

    y += 4.5 + extraHeight;
    doc.setDrawColor(241, 245, 249);
    doc.line(marginLeft, y - 1, pageWidth - marginRight, y - 1);
  }

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont(font, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `TaktWerk Auswertung · ${company.companyName} · Seite ${i} von ${totalPages}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  return doc;
}

export function getFilteredReportPdfBase64(
  db: AppDatabase,
  options: FilteredReportOptions = {}
): string {
  const doc = buildFilteredReportPdf(db, options);
  return docToBase64(doc);
}

export async function downloadFilteredReportPdf(
  db: AppDatabase,
  options: FilteredReportOptions = {}
): Promise<void> {
  const doc = buildFilteredReportPdf(db, options);
  await openOrSavePdfDoc(doc, `TaktWerk-Auswertung-${toInputDate()}.pdf`);
}

export async function shareFilteredReportPdf(
  db: AppDatabase,
  options: FilteredReportOptions = {}
): Promise<void> {
  const doc = buildFilteredReportPdf(db, options);
  await shareOrSavePdfDoc(doc, `TaktWerk-Auswertung-${toInputDate()}.pdf`);
}
