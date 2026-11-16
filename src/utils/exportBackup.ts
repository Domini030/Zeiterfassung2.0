import type { AppDatabase, Customer, Invoice, Product, TimeEntry } from '../types';
import { formatDateDE, formatDateTimeDE, formatNumber } from './format';

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
      return [
        csvCell(formatDateTimeDE(e.startTime)),
        csvCell(formatDateTimeDE(e.endTime)),
        csvCell(formatNumber(hours, 2)),
        csvCell(cust),
        csvCell(prod),
        csvCell(e.title),
        csvCell(e.notes),
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
    'Rechnungsnummer',
    'Rechnungsdatum',
    'Leistungszeitraum Start',
    'Leistungszeitraum Ende',
    'Zahlungsziel',
    'Kunde',
    'Status',
    'Kleinunternehmer (§ 19 UStG)',
    'Netto (EUR)',
    'MwSt. (EUR)',
    'Brutto (EUR)',
    'Nextcloud-PDF gesichert',
  ];

  const rows = [...invoices]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .map((inv) => [
      csvCell(inv.invoiceNumber),
      csvCell(formatDateDE(inv.issueDate)),
      csvCell(formatDateDE(inv.servicePeriodStart)),
      csvCell(formatDateDE(inv.servicePeriodEnd)),
      csvCell(formatDateDE(inv.dueDate)),
      csvCell(inv.customerSnapshot.companyName),
      csvCell(inv.status),
      csvCell(inv.isSmallBusiness ? 'Ja' : 'Nein'),
      csvCell(formatNumber(inv.netTotal, 2)),
      csvCell(formatNumber(inv.isSmallBusiness ? 0 : inv.taxTotal, 2)),
      csvCell(formatNumber(inv.isSmallBusiness ? inv.netTotal : inv.grossTotal, 2)),
      csvCell(inv.nextcloudUploadedAt ? formatDateTimeDE(inv.nextcloudUploadedAt) : 'Nein'),
    ].join(';'));

  return `\uFEFF${headers.map(csvCell).join(';')}\r\n${rows.join('\r\n')}`;
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
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    updatedAt: new Date().toISOString(),
    company: parsed.company,
    customers: parsed.customers,
    products: parsed.products,
    nfcTasks: parsed.nfcTasks,
    timeEntries: parsed.timeEntries,
    activeTimer: parsed.activeTimer ?? null,
    invoices: parsed.invoices,
  };
}
