import JSZip from 'jszip';
import type { AppDatabase, Expense, Invoice } from '../types';
import { trackActivity } from './activityProgress';
import {
  downloadOrShareBinaryFile,
  downloadOrShareTextFile,
} from './exportBackup';
import { formatCurrency, formatDateDE, formatNumber } from './format';

export type TaxPeriodType = 'year' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type TaxBasisMode = 'ist' | 'soll';

export interface TaxPeriodSummary {
  year: number;
  period: TaxPeriodType;
  periodLabel: string;
  basis: TaxBasisMode;
  isSmallBusinessCompany: boolean;
  invoicesIncluded: Invoice[];
  expensesIncluded: Expense[];
  // Betriebseinnahmen
  revenueNet19: number;
  revenueVat19: number;
  revenueNet7: number;
  revenueVat7: number;
  revenueNet0: number;
  revenueNetTotal: number;
  revenueVatTotal: number;
  revenueGrossTotal: number;
  // Betriebsausgaben
  expenseNet19: number;
  expenseInputVat19: number;
  expenseNet7: number;
  expenseInputVat7: number;
  expenseNet0: number;
  expenseNetTotal: number;
  expenseInputVatTotal: number;
  expenseGrossTotal: number;
  // Ergebnisse
  euerProfit: number; // Gewinn / Überschuss
  vatPayable: number; // Kz. 83 Zahllast (>0 zahlen, <0 Erstattung)
  expenseByCategory: { category: string; net: number; gross: number; count: number }[];
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function isDateInPeriod(isoDate: string | undefined | null, year: number, period: TaxPeriodType): boolean {
  if (!isoDate || isoDate.length < 7) return false;
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  if (y !== year || Number.isNaN(m)) return false;
  if (period === 'year') return true;
  if (period === 'Q1') return m >= 1 && m <= 3;
  if (period === 'Q2') return m >= 4 && m <= 6;
  if (period === 'Q3') return m >= 7 && m <= 9;
  return m >= 10 && m <= 12;
}

export function calculateTaxPeriodSummary(
  db: AppDatabase,
  year: number,
  period: TaxPeriodType,
  basis: TaxBasisMode = 'ist'
): TaxPeriodSummary {
  const isSmallBizCo = Boolean(db.company.smallBusinessMode);
  const periodLabel = period === 'year' ? `Gesamtjahr ${year}` : `${period} / ${year}`;

  const invoicesIncluded = db.invoices.filter((inv) => {
    if (inv.documentType === 'quote') return false;
    if (inv.status === 'Storniert') return false;
    if (basis === 'ist') {
      if (inv.status !== 'Bezahlt') return false;
    } else {
      if (inv.status === 'Entwurf') return false;
    }
    return isDateInPeriod(inv.issueDate, year, period);
  });

  const expensesIncluded = (db.expenses ?? []).filter((exp) =>
    isDateInPeriod(exp.date, year, period)
  );

  let revenueNet19 = 0;
  let revenueVat19 = 0;
  let revenueNet7 = 0;
  let revenueVat7 = 0;
  let revenueNet0 = 0;

  for (const inv of invoicesIncluded) {
    const smallBiz = inv.isSmallBusiness ?? isSmallBizCo;
    if (smallBiz) {
      revenueNet0 += inv.netTotal;
      continue;
    }
    const subtotalBefore = inv.lineItems.reduce((acc, i) => acc + i.netTotal, 0);
    const factor = subtotalBefore > 0 ? inv.netTotal / subtotalBefore : 1;

    let inv19 = 0;
    let inv7 = 0;
    let inv0 = 0;
    for (const li of inv.lineItems) {
      const effNet = li.netTotal * factor;
      if (li.taxRate === 19) inv19 += effNet;
      else if (li.taxRate === 7) inv7 += effNet;
      else inv0 += effNet;
    }
    const r19 = round2(inv19);
    const r7 = round2(inv7);
    const r0 = round2(inv0);
    revenueNet19 += r19;
    revenueVat19 += round2(r19 * 0.19);
    revenueNet7 += r7;
    revenueVat7 += round2(r7 * 0.07);
    revenueNet0 += r0;
  }

  revenueNet19 = round2(revenueNet19);
  revenueVat19 = round2(revenueVat19);
  revenueNet7 = round2(revenueNet7);
  revenueVat7 = round2(revenueVat7);
  revenueNet0 = round2(revenueNet0);

  const revenueNetTotal = round2(revenueNet19 + revenueNet7 + revenueNet0);
  const revenueVatTotal = round2(revenueVat19 + revenueVat7);
  const revenueGrossTotal = round2(revenueNetTotal + revenueVatTotal);

  let expenseNet19 = 0;
  let expenseInputVat19 = 0;
  let expenseNet7 = 0;
  let expenseInputVat7 = 0;
  let expenseNet0 = 0;
  const catMap = new Map<string, { category: string; net: number; gross: number; count: number }>();

  for (const exp of expensesIncluded) {
    const net = round2(exp.netAmount);
    const gross = round2(exp.grossAmount);
    const vat = round2(Math.max(0, gross - net));

    if (exp.taxRate === 19) {
      expenseNet19 += net;
      expenseInputVat19 += vat;
    } else if (exp.taxRate === 7) {
      expenseNet7 += net;
      expenseInputVat7 += vat;
    } else {
      expenseNet0 += net;
    }

    const cat = exp.category?.trim() || 'Sonstiges';
    const cur = catMap.get(cat) ?? { category: cat, net: 0, gross: 0, count: 0 };
    cur.net = round2(cur.net + net);
    cur.gross = round2(cur.gross + gross);
    cur.count += 1;
    catMap.set(cat, cur);
  }

  expenseNet19 = round2(expenseNet19);
  expenseInputVat19 = round2(expenseInputVat19);
  expenseNet7 = round2(expenseNet7);
  expenseInputVat7 = round2(expenseInputVat7);
  expenseNet0 = round2(expenseNet0);

  const expenseNetTotal = round2(expenseNet19 + expenseNet7 + expenseNet0);
  const expenseInputVatTotal = isSmallBizCo
    ? 0
    : round2(expenseInputVat19 + expenseInputVat7);
  const expenseGrossTotal = round2(expenseNetTotal + expenseInputVat19 + expenseInputVat7);

  // Bei Kleinunternehmer (§19 UStG) zählen Bruttobeträge als EÜR-Ausgaben (kein Vorsteuerabzug)
  const euerProfit = isSmallBizCo
    ? round2(revenueGrossTotal - expenseGrossTotal)
    : round2(revenueNetTotal - expenseNetTotal);

  const vatPayable = isSmallBizCo
    ? 0
    : round2(revenueVatTotal - expenseInputVatTotal);

  const expenseByCategory = Array.from(catMap.values()).sort((a, b) => b.net - a.net);

  return {
    year,
    period,
    periodLabel,
    basis,
    isSmallBusinessCompany: isSmallBizCo,
    invoicesIncluded,
    expensesIncluded,
    revenueNet19,
    revenueVat19,
    revenueNet7,
    revenueVat7,
    revenueNet0,
    revenueNetTotal,
    revenueVatTotal,
    revenueGrossTotal,
    expenseNet19,
    expenseInputVat19,
    expenseNet7,
    expenseInputVat7,
    expenseNet0,
    expenseNetTotal,
    expenseInputVatTotal,
    expenseGrossTotal,
    euerProfit,
    vatPayable,
    expenseByCategory,
  };
}

function mapExpenseCategoryToSkr03(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('miete') || c.includes('raum')) return '4210';
  if (c.includes('fahrt') || c.includes('kraftstoff') || c.includes('kfz')) return '4530';
  if (c.includes('hardware') || c.includes('material')) return '3400';
  if (c.includes('software') || c.includes('lizenz') || c.includes('cloud')) return '4964';
  if (c.includes('büro') || c.includes('porto')) return '4930';
  if (c.includes('reise') || c.includes('verpflegung')) return '4660';
  if (c.includes('strom') || c.includes('energie')) return '4240';
  if (c.includes('versicherung')) return '4360';
  if (c.includes('telefon') || c.includes('internet')) return '4920';
  if (c.includes('werbung') || c.includes('marketing')) return '4600';
  if (c.includes('fremdleistung')) return '3100';
  return '4980';
}

function csvCell(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function toDatevDayMonth(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return '';
  return `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}`;
}

export function buildDatevCsv(summary: TaxPeriodSummary): string {
  const headers = [
    'Umsatz (ohne Soll/Haben-Kz)',
    'Soll/Haben-Kennzeichen',
    'WKZ Umsatz',
    'Konto',
    'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel',
    'Belegdatum',
    'Belegfeld 1',
    'Buchungstext',
    'Steuersatz (%)',
    'Nettobetrag (EUR)',
    'USt/VSt (EUR)',
    'Datum (ISO)',
    'Typ',
  ];

  const rows: string[] = [];

  for (const inv of summary.invoicesIncluded) {
    const smallBiz = inv.isSmallBusiness ?? summary.isSmallBusinessCompany;
    const gross = smallBiz ? inv.netTotal : inv.grossTotal;
    const vat = smallBiz ? 0 : inv.taxTotal;
    const dominantRate = smallBiz
      ? 0
      : inv.lineItems.find((l) => l.taxRate === 19)
        ? 19
        : inv.lineItems.find((l) => l.taxRate === 7)
          ? 7
          : 0;
    const konto = smallBiz
      ? '8195'
      : dominantRate === 19
        ? '8400'
        : dominantRate === 7
          ? '8300'
          : '8120';
    const buKey = smallBiz ? '' : dominantRate === 19 ? '3' : dominantRate === 7 ? '2' : '';

    rows.push(
      [
        formatNumber(gross, 2),
        'H',
        'EUR',
        '1200',
        konto,
        buKey,
        toDatevDayMonth(inv.issueDate),
        inv.invoiceNumber,
        `Rechnung ${inv.invoiceNumber} ${inv.customerSnapshot.companyName}`.slice(0, 60),
        dominantRate,
        formatNumber(inv.netTotal, 2),
        formatNumber(vat, 2),
        inv.issueDate,
        'Einnahme',
      ]
        .map(csvCell)
        .join(';')
    );
  }

  for (const exp of summary.expensesIncluded) {
    const vat = round2(Math.max(0, exp.grossAmount - exp.netAmount));
    const konto = mapExpenseCategoryToSkr03(exp.category || '');
    const buKey = summary.isSmallBusinessCompany
      ? ''
      : exp.taxRate === 19
        ? '9'
        : exp.taxRate === 7
          ? '8'
          : '';

    rows.push(
      [
        formatNumber(exp.grossAmount, 2),
        'S',
        'EUR',
        konto,
        '1200',
        buKey,
        toDatevDayMonth(exp.date),
        exp.id.slice(-10).toUpperCase(),
        `${exp.vendor}${exp.description ? ` - ${exp.description}` : ''}`.slice(0, 60),
        exp.taxRate,
        formatNumber(exp.netAmount, 2),
        formatNumber(summary.isSmallBusinessCompany ? 0 : vat, 2),
        exp.date,
        'Ausgabe',
      ]
        .map(csvCell)
        .join(';')
    );
  }

  return `\uFEFF${headers.map(csvCell).join(';')}\r\n${rows.join('\r\n')}`;
}

export function buildTaxSummaryText(
  summary: TaxPeriodSummary,
  companyName: string
): string {
  const lines = [
    `TaktWerk – EÜR & UStVA Zusammenfassung`,
    `Unternehmen: ${companyName}`,
    `Zeitraum: ${summary.periodLabel}`,
    `Versteuerungsart: ${
      summary.basis === 'ist'
        ? 'Ist-Versteuerung (nur bezahlte Rechnungen)'
        : 'Soll-Versteuerung (alle gesendeten & bezahlten Rechnungen)'
    }`,
    `Kleinunternehmer (§ 19 UStG): ${summary.isSmallBusinessCompany ? 'Ja' : 'Nein'}`,
    `Erstellt am: ${formatDateDE(new Date().toISOString())}`,
    ``,
    `=== BETRIEBSEINNAHMEN (${summary.invoicesIncluded.length} Rechnungen) ===`,
    `Kz. 81 – Steuerpflichtige Umsätze 19 % Netto:  ${formatCurrency(summary.revenueNet19)}  (USt: ${formatCurrency(summary.revenueVat19)})`,
    `Kz. 86 – Steuerpflichtige Umsätze  7 % Netto:  ${formatCurrency(summary.revenueNet7)}  (USt: ${formatCurrency(summary.revenueVat7)})`,
    `Steuerfreie / §19 Umsätze (0 %):               ${formatCurrency(summary.revenueNet0)}`,
    `Summe Einnahmen Netto:                         ${formatCurrency(summary.revenueNetTotal)}`,
    `Vereinnahmte Umsatzsteuer gesamt:              ${formatCurrency(summary.revenueVatTotal)}`,
    `Summe Einnahmen Brutto:                        ${formatCurrency(summary.revenueGrossTotal)}`,
    ``,
    `=== BETRIEBSAUSGABEN (${summary.expensesIncluded.length} Belege) ===`,
    `Ausgaben 19 % Netto:                           ${formatCurrency(summary.expenseNet19)}  (VSt: ${formatCurrency(summary.expenseInputVat19)})`,
    `Ausgaben  7 % Netto:                           ${formatCurrency(summary.expenseNet7)}  (VSt: ${formatCurrency(summary.expenseInputVat7)})`,
    `Ausgaben  0 % Netto:                           ${formatCurrency(summary.expenseNet0)}`,
    `Summe Ausgaben Netto:                          ${formatCurrency(summary.expenseNetTotal)}`,
    `Kz. 66 – Abziehbare Vorsteuer gesamt:          ${formatCurrency(summary.expenseInputVatTotal)}`,
    `Summe Ausgaben Brutto:                         ${formatCurrency(summary.expenseGrossTotal)}`,
    ``,
    `=== ERGEBNIS ===`,
    `EÜR-Überschuss (Gewinn/Verlust):               ${formatCurrency(summary.euerProfit)}`,
    `Kz. 83 – USt-Zahllast (+Zahlen / -Erstattung): ${formatCurrency(summary.vatPayable)}`,
    ``,
    `Hinweis: Diese Auswertung dient als vorbereitende Buchführungshilfe und ersetzt keine individuelle Steuerberatung.`,
  ];
  return lines.join('\r\n');
}

export async function downloadDatevCsv(summary: TaxPeriodSummary): Promise<void> {
  const csv = buildDatevCsv(summary);
  const slug = `${summary.year}-${summary.period}`;
  await downloadOrShareTextFile(
    `TaktWerk-DATEV-Buchungen-${slug}.csv`,
    csv,
    'text/csv'
  );
}

export async function downloadTaxAdvisorZip(
  db: AppDatabase,
  summary: TaxPeriodSummary
): Promise<void> {
  const slug = `${summary.year}-${summary.period}`;
  await trackActivity(
    'Steuerberater-Paket (ZIP) wird erstellt…',
    async (update) => {
      const zip = new JSZip();
      zip.file(
        `DATEV-Buchungsstapel-${slug}.csv`,
        buildDatevCsv(summary)
      );
      zip.file(
        `EUER-UStVA-Bericht-${slug}.txt`,
        buildTaxSummaryText(summary, db.company.companyName || 'TaktWerk')
      );

      const invFolder = zip.folder('Rechnungen') || zip;
      const expFolder = zip.folder('Belege') || zip;

      const { getInvoicePdfBase64 } = await import('./pdfInvoice');
      const totalSteps =
        summary.invoicesIncluded.length + summary.expensesIncluded.length + 1;
      let done = 0;

      for (const inv of summary.invoicesIncluded) {
        done++;
        update(
          Math.min(88, Math.round((done / totalSteps) * 85)),
          `PDF ${inv.invoiceNumber}`
        );
        try {
          const pdfB64 = await getInvoicePdfBase64(inv, db.company);
          invFolder.file(`${inv.invoiceNumber}.pdf`, pdfB64, { base64: true });
        } catch {
          // Continue with remaining documents
        }
      }

      for (const exp of summary.expensesIncluded) {
        done++;
        update(
          Math.min(92, Math.round((done / totalSteps) * 85)),
          `Beleg ${exp.vendor}`
        );
        if (!exp.receiptImageDataUrl) continue;
        const m = exp.receiptImageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) continue;
        const mime = m[1].toLowerCase();
        const ext = mime.includes('pdf')
          ? 'pdf'
          : mime.includes('png')
            ? 'png'
            : 'jpg';
        const safeVendor = exp.vendor.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 24);
        expFolder.file(`${exp.date}_${safeVendor}_${exp.id.slice(-5)}.${ext}`, m[2], {
          base64: true,
        });
      }

      update(95, 'ZIP-Archiv wird komprimiert…');
      const base64 = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      update(100, 'Fertig');
      await downloadOrShareBinaryFile(
        `TaktWerk-Steuerberater-${slug}.zip`,
        base64,
        'application/zip'
      );
    },
    5,
    summary.periodLabel
  );
}
