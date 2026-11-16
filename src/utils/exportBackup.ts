import * as XLSX from 'xlsx';
import type {
  AppDatabase,
  AutoBackupFormat,
  Customer,
  Invoice,
  Product,
  TimeEntry,
} from '../types';
import { formatDateDE, formatDateTimeDE, formatNumber, toInputDate } from './format';
import { normalizeDatabase } from './sampleData';

function csvCell(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function timeEntriesToCsv(
  entries: TimeEntry[],
  customers: Customer[],
  products: Product[]
): string {
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));

  const headers = [
    'Datum / Start',
    'Ende',
    'Dauer (Std.)',
    'Kunde',
    'Leistung',
    'Tätigkeit',
    'Notizen',
    'Ort / Adresse',
    'Quelle',
    'Abrechenbar',
    'Status',
    'Stundensatz Netto (EUR)',
    'Nettowert (EUR)',
  ];

  const rows = [...entries]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .map((e) => {
      const cust = customerMap.get(e.customerId)?.companyName ?? '';
      const prod = productMap.get(e.productId)?.name ?? '';
      const hours = e.durationSeconds / 3600;
      const net = hours * e.hourlyRateNet;
      const locStr = e.location?.address
        ? e.location.address
        : e.location
          ? `${e.location.lat.toFixed(5)}, ${e.location.lng.toFixed(5)}`
          : '';
      return [
        csvCell(formatDateTimeDE(e.startTime)),
        csvCell(formatDateTimeDE(e.endTime)),
        csvCell(formatNumber(hours, 2)),
        csvCell(cust),
        csvCell(prod),
        csvCell(e.title),
        csvCell(e.notes),
        csvCell(locStr),
        csvCell(e.source),
        csvCell(e.billable ? 'Ja' : 'Nein'),
        csvCell(e.billedInvoiceId ? 'Abgerechnet' : 'Offen'),
        csvCell(formatNumber(e.hourlyRateNet, 2)),
        csvCell(formatNumber(e.billable ? net : 0, 2)),
      ].join(';');
    });

  return `\uFEFF${headers.map(csvCell).join(';')}\r\n${rows.join('\r\n')}`;
}

export function invoicesToCsv(invoices: Invoice[]): string {
  const headers = [
    'Dokumenttyp',
    'Nummer',
    'Datum',
    'Leistungszeitraum Start',
    'Leistungszeitraum Ende',
    'Zahlungsziel / Gültig bis',
    'Kunde',
    'Status',
    'Kleinunternehmer (§ 19 UStG)',
    'Rabatt Netto (EUR)',
    'Netto (EUR)',
    'MwSt. (EUR)',
    'Brutto (EUR)',
    'Nextcloud-PDF gesichert',
  ];

  const rows = [...invoices]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .map((inv) => [
      csvCell(inv.documentType === 'quote' ? 'Angebot' : 'Rechnung'),
      csvCell(inv.invoiceNumber),
      csvCell(formatDateDE(inv.issueDate)),
      csvCell(formatDateDE(inv.servicePeriodStart)),
      csvCell(formatDateDE(inv.servicePeriodEnd)),
      csvCell(formatDateDE(inv.quoteValidUntil || inv.dueDate)),
      csvCell(inv.customerSnapshot.companyName),
      csvCell(inv.status),
      csvCell(inv.isSmallBusiness ? 'Ja' : 'Nein'),
      csvCell(formatNumber(inv.discountNetAmount ?? 0, 2)),
      csvCell(formatNumber(inv.netTotal, 2)),
      csvCell(formatNumber(inv.isSmallBusiness ? 0 : inv.taxTotal, 2)),
      csvCell(formatNumber(inv.isSmallBusiness ? inv.netTotal : inv.grossTotal, 2)),
      csvCell(inv.nextcloudUploadedAt ? formatDateTimeDE(inv.nextcloudUploadedAt) : 'Nein'),
    ].join(';'));

  return `\uFEFF${headers.map(csvCell).join(';')}\r\n${rows.join('\r\n')}`;
}

export function buildExcelWorkbookBase64(db: AppDatabase): string {
  const wb = XLSX.utils.book_new();
  const custMap = new Map(db.customers.map((c) => [c.id, c.companyName]));
  const prodMap = new Map(db.products.map((p) => [p.id, p.name]));

  const timeRows = [...db.timeEntries]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .map((e) => ({
      Start: formatDateTimeDE(e.startTime),
      Ende: formatDateTimeDE(e.endTime),
      Stunden: Number((e.durationSeconds / 3600).toFixed(2)),
      Kunde: custMap.get(e.customerId) ?? '',
      Leistung: prodMap.get(e.productId) ?? '',
      Tätigkeit: e.title,
      Notizen: e.notes,
      Ort: e.location?.address ?? '',
      Quelle: e.source,
      Abrechenbar: e.billable ? 'Ja' : 'Nein',
      Abgerechnet: e.billedInvoiceId ? 'Ja' : 'Nein',
      Stundensatz_Netto_EUR: e.hourlyRateNet,
      Nettowert_EUR: Number((((e.durationSeconds / 3600) * e.hourlyRateNet) || 0).toFixed(2)),
    }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      timeRows.length > 0 ? timeRows : [{ Hinweis: 'Keine Zeiteinträge vorhanden' }]
    ),
    'Arbeitszeiten'
  );

  const invoiceRows = db.invoices.map((inv) => ({
    Typ: inv.documentType === 'quote' ? 'Angebot' : 'Rechnung',
    Nummer: inv.invoiceNumber,
    Datum: formatDateDE(inv.issueDate),
    Fällig_Gültig_Bis: formatDateDE(inv.quoteValidUntil || inv.dueDate),
    Kunde: inv.customerSnapshot.companyName,
    Status: inv.status,
    Rabatt_Netto_EUR: inv.discountNetAmount ?? 0,
    Netto_EUR: inv.netTotal,
    MwSt_EUR: inv.isSmallBusiness ? 0 : inv.taxTotal,
    Brutto_EUR: inv.isSmallBusiness ? inv.netTotal : inv.grossTotal,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      invoiceRows.length > 0 ? invoiceRows : [{ Hinweis: 'Keine Dokumente vorhanden' }]
    ),
    'Rechnungen & Angebote'
  );

  const customerRows = db.customers.map((c) => ({
    Kundennummer: c.customerNumber,
    Kategorie: c.category ?? '',
    Firma: c.companyName,
    Ansprechpartner: c.contactName,
    EMail: c.email,
    Telefon: c.phone,
    Straße: c.street,
    PLZ: c.postalCode,
    Ort: c.city,
    Zahlungsziel_Tage: c.paymentTermDays,
    USt_IdNr: c.vatId,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      customerRows.length > 0 ? customerRows : [{ Hinweis: 'Keine Kunden vorhanden' }]
    ),
    'Kunden'
  );

  const productRows = db.products.map((p) => ({
    Nummer: p.sku,
    Kategorie: p.category ?? '',
    Bezeichnung: p.name,
    Typ: p.type === 'service' ? 'Dienstleistung' : 'Produkt',
    Einheit: p.unit,
    Netto_Preis_EUR: p.unitPriceNet,
    MwSt_Prozent: p.taxRate,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      productRows.length > 0 ? productRows : [{ Hinweis: 'Keine Produkte vorhanden' }]
    ),
    'Produkte & Leistungen'
  );

  const expenseRows = (db.expenses ?? []).map((exp) => ({
    Datum: formatDateDE(exp.date),
    Anbieter: exp.vendor,
    Beschreibung: exp.description,
    Kategorie: exp.category,
    Kunde: exp.customerId ? custMap.get(exp.customerId) ?? '' : '',
    Weiterberechenbar: exp.billableToCustomer ? 'Ja' : 'Nein',
    Abgerechnet: exp.billedInvoiceId ? 'Ja' : 'Nein',
    Netto_EUR: exp.netAmount,
    MwSt_Prozent: exp.taxRate,
    Brutto_EUR: exp.grossAmount,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      expenseRows.length > 0 ? expenseRows : [{ Hinweis: 'Keine Belege vorhanden' }]
    ),
    'Belege & Ausgaben'
  );

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
}

export async function downloadOrShareBinaryFile(
  filename: string,
  base64: string,
  mimeType: string
): Promise<void> {
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      await TaktWerkNative.shareBinaryFile({ filename, mimeType, base64 });
      return;
    }
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadExcelBackup(db: AppDatabase): Promise<void> {
  const base64 = buildExcelWorkbookBase64(db);
  await downloadOrShareBinaryFile(
    `TaktWerk-Komplett-${toInputDate()}.xlsx`,
    base64,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

export async function downloadOrShareTextFile(
  filename: string,
  content: string,
  mimeType: string
): Promise<void> {
  if (typeof window !== 'undefined') {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { TaktWerkNative } = await import('./taktwerkNative');
      await TaktWerkNative.shareTextFile({ filename, mimeType, content });
      return;
    }
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validateImportedDatabase(rawText: string): AppDatabase {
  const parsed = JSON.parse(rawText) as Partial<AppDatabase>;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.company ||
    !Array.isArray(parsed.customers) ||
    !Array.isArray(parsed.products) ||
    !Array.isArray(parsed.nfcTasks) ||
    !Array.isArray(parsed.timeEntries) ||
    !Array.isArray(parsed.invoices)
  ) {
    throw new Error('Die Datei enthält keine gültige TaktWerk-Datenbanksicherung.');
  }
  return normalizeDatabase({
    version: typeof parsed.version === 'number' ? parsed.version : 2,
    updatedAt: new Date().toISOString(),
    company: parsed.company,
    customers: parsed.customers,
    products: parsed.products,
    nfcTasks: parsed.nfcTasks,
    geoFenceRules: Array.isArray(parsed.geoFenceRules) ? parsed.geoFenceRules : [],
    timeEntries: parsed.timeEntries,
    activeTimer: parsed.activeTimer ?? null,
    invoices: parsed.invoices,
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    recurringInvoices: Array.isArray(parsed.recurringInvoices) ? parsed.recurringInvoices : [],
    calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : [],
  });
}

export function isBackupDue(db: AppDatabase): boolean {
  const cfg = db.company.autoBackup;
  if (!cfg?.enabled || !cfg.formats?.length) return false;
  if (!cfg.lastRunAt) return true;
  const lastMs = new Date(cfg.lastRunAt).getTime();
  if (Number.isNaN(lastMs)) return true;
  const ageDays = (Date.now() - lastMs) / (1000 * 86400);
  if (cfg.frequency === 'daily') return ageDays >= 1;
  if (cfg.frequency === 'monthly') return ageDays >= 28;
  return ageDays >= 7;
}

export async function generateBackupArtifacts(
  db: AppDatabase,
  formats: AutoBackupFormat[]
): Promise<{
  filename: string;
  mimeType: string;
  isBinary: boolean;
  data: string;
}[]> {
  const stamp = toInputDate();
  const files: {
    filename: string;
    mimeType: string;
    isBinary: boolean;
    data: string;
  }[] = [];

  if (formats.includes('json')) {
    files.push({
      filename: `taktwerk-backup-${stamp}.json`,
      mimeType: 'application/json; charset=utf-8',
      isBinary: false,
      data: JSON.stringify(db, null, 2),
    });
  }
  if (formats.includes('csv')) {
    files.push({
      filename: `taktwerk-arbeitszeiten-${stamp}.csv`,
      mimeType: 'text/csv; charset=utf-8',
      isBinary: false,
      data: timeEntriesToCsv(db.timeEntries, db.customers, db.products),
    });
    files.push({
      filename: `taktwerk-rechnungen-${stamp}.csv`,
      mimeType: 'text/csv; charset=utf-8',
      isBinary: false,
      data: invoicesToCsv(db.invoices),
    });
  }
  if (formats.includes('excel')) {
    files.push({
      filename: `taktwerk-komplett-${stamp}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      isBinary: true,
      data: buildExcelWorkbookBase64(db),
    });
  }
  if (formats.includes('pdf')) {
    const { getFullBackupPdfBase64 } = await import('./pdfInvoice');
    files.push({
      filename: `taktwerk-gesamtbericht-${stamp}.pdf`,
      mimeType: 'application/pdf',
      isBinary: true,
      data: getFullBackupPdfBase64(db),
    });
  }
  return files;
}
