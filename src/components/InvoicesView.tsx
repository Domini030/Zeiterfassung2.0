import {
  CloudUpload,
  Download,
  Eye,
  FilePlus2,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  CompanyProfile,
  Customer,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  NextcloudConfigInfo,
  Product,
  TaxRate,
  TimeEntry,
} from '../types';
import {
  INVOICE_ACCENT_STYLES,
  addDaysISO,
  createId,
  formatCurrency,
  formatDateDE,
  formatDuration,
  formatInvoiceNumber,
  formatNumber,
  toInputDate,
} from '../utils/format';
import { apiUploadInvoicePdf } from '../utils/apiClient';
import { downloadInvoicePdf, getInvoicePdfBase64 } from '../utils/pdfInvoice';

interface InvoicesViewProps {
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  timeEntries: TimeEntry[];
  invoices: Invoice[];
  nextcloud: NextcloudConfigInfo;
  preselectedDraft: { customerId: string; entryIds: string[] } | null;
  onClearPreselectedDraft: () => void;
  onCreateInvoice: (invoice: Invoice, billedEntryIds: string[]) => void;
  onUpdateInvoiceStatus: (invoiceId: string, status: InvoiceStatus) => void;
  onMarkInvoiceUploaded: (invoiceId: string, uploadedAt: string) => void;
  onDeleteInvoice: (invoiceId: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

interface ExtraProductDraft {
  id: string;
  productId: string;
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxRate: TaxRate;
}

export function InvoicesView({
  company,
  customers,
  products,
  timeEntries,
  invoices,
  nextcloud,
  preselectedDraft,
  onClearPreselectedDraft,
  onCreateInvoice,
  onUpdateInvoiceStatus,
  onMarkInvoiceUploaded,
  onDeleteInvoice,
  onNotify,
}: InvoicesViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [showBuilder, setShowBuilder] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? '');
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [groupByProduct, setGroupByProduct] = useState(true);
  const [extraItems, setExtraItems] = useState<ExtraProductDraft[]>([]);
  const [issueDate, setIssueDate] = useState(toInputDate());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const defaultIntro =
    company.invoiceDefaultIntroText ??
    'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Vereinbarungsgemäß berechnen wir Ihnen folgende erbrachte Leistungen:';
  const defaultOutro =
    company.invoiceDefaultOutroText ??
    'Bitte überweisen Sie den Rechnungsbetrag innerhalb der Zahlungsfrist unter Angabe der Rechnungsnummer auf das unten genannte Konto.';

  const [introText, setIntroText] = useState(defaultIntro);
  const [outroText, setOutroText] = useState(defaultOutro);
  const [isSmallBusiness, setIsSmallBusiness] = useState(
    Boolean(company.smallBusinessMode)
  );
  const [builderError, setBuilderError] = useState('');

  const defaultSmallBusinessNotice =
    company.smallBusinessNotice ||
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

  const nextSeqNumber = useMemo(
    () => formatInvoiceNumber(company, company.nextInvoiceSequence || invoices.length + 1),
    [company, invoices.length]
  );

  const accentStyle =
    INVOICE_ACCENT_STYLES[company.invoiceAccentColor ?? 'slate'] ??
    INVOICE_ACCENT_STYLES.slate;
  const headerTitle = (company.invoiceHeaderTitle || 'Rechnung').trim();

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  useEffect(() => {
    if (!preselectedDraft) return;
    setCustomerId(preselectedDraft.customerId);
    if (preselectedDraft.entryIds.length > 0) {
      setSelectedEntryIds(preselectedDraft.entryIds);
    } else {
      const openIds = timeEntries
        .filter(
          (t) =>
            t.customerId === preselectedDraft.customerId &&
            t.billable &&
            !t.billedInvoiceId
        )
        .map((t) => t.id);
      setSelectedEntryIds(openIds);
    }
    setExtraItems([]);
    setIssueDate(toInputDate());
    setInvoiceNumber(nextSeqNumber);
    setIntroText(defaultIntro);
    setOutroText(defaultOutro);
    setIsSmallBusiness(Boolean(company.smallBusinessMode));
    setBuilderError('');
    setShowBuilder(true);
    onClearPreselectedDraft();
  }, [
    preselectedDraft,
    timeEntries,
    nextSeqNumber,
    defaultIntro,
    defaultOutro,
    company.smallBusinessMode,
    onClearPreselectedDraft,
  ]);

  const openBuilderFresh = () => {
    const firstCust = customers[0]?.id ?? '';
    setCustomerId(firstCust);
    const openIds = timeEntries
      .filter((t) => t.customerId === firstCust && t.billable && !t.billedInvoiceId)
      .map((t) => t.id);
    setSelectedEntryIds(openIds);
    setExtraItems([]);
    setIssueDate(toInputDate());
    setInvoiceNumber(nextSeqNumber);
    setIntroText(defaultIntro);
    setOutroText(defaultOutro);
    setIsSmallBusiness(Boolean(company.smallBusinessMode));
    setBuilderError('');
    setShowBuilder(true);
  };

  const handleBuilderCustomerChange = (newCustId: string) => {
    setCustomerId(newCustId);
    const openIds = timeEntries
      .filter((t) => t.customerId === newCustId && t.billable && !t.billedInvoiceId)
      .map((t) => t.id);
    setSelectedEntryIds(openIds);
  };

  const unbilledForCustomer = useMemo(
    () =>
      timeEntries.filter(
        (t) => t.customerId === customerId && t.billable && !t.billedInvoiceId
      ),
    [timeEntries, customerId]
  );

  const toggleEntry = (id: string) => {
    setSelectedEntryIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const addExtraProductRow = () => {
    const defaultProd = products.find((p) => p.type === 'product') ?? products[0];
    if (!defaultProd) return;
    setExtraItems((prev) => [
      ...prev,
      {
        id: createId('ext'),
        productId: defaultProd.id,
        description: defaultProd.name,
        quantity: 1,
        unitPriceNet: defaultProd.unitPriceNet,
        taxRate: defaultProd.taxRate,
      },
    ]);
  };

  const updateExtraRow = (id: string, patch: Partial<ExtraProductDraft>) => {
    setExtraItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.productId) {
          const p = productMap.get(patch.productId);
          if (p) {
            next.description = p.name;
            next.unitPriceNet = p.unitPriceNet;
            next.taxRate = p.taxRate;
          }
        }
        return next;
      })
    );
  };

  const computedLineItems = useMemo((): InvoiceLineItem[] => {
    const selectedEntries = unbilledForCustomer.filter((e) =>
      selectedEntryIds.includes(e.id)
    );
    const items: InvoiceLineItem[] = [];

    if (groupByProduct) {
      const grouped = new Map<string, TimeEntry[]>();
      for (const e of selectedEntries) {
        const key = `${e.productId}::${e.hourlyRateNet}::${e.taxRate}`;
        const list = grouped.get(key) ?? [];
        list.push(e);
        grouped.set(key, list);
      }

      for (const [, group] of grouped.entries()) {
        const first = group[0];
        const prod = productMap.get(first.productId);
        const totalSeconds = group.reduce((acc, g) => acc + g.durationSeconds, 0);
        const hours = Math.round((totalSeconds / 3600) * 100) / 100;
        const net = Math.round(hours * first.hourlyRateNet * 100) / 100;
        const effectiveTaxRate: TaxRate = isSmallBusiness ? 0 : first.taxRate;
        const tax = Math.round(net * (effectiveTaxRate / 100) * 100) / 100;
        const taskTitles = Array.from(new Set(group.map((g) => g.title))).join(', ');

        items.push({
          id: createId('li'),
          description: prod?.name ?? first.title,
          detail: `${group.length} Zeiteinträge: ${taskTitles}`,
          quantity: hours,
          unit: 'Std.',
          unitPriceNet: first.hourlyRateNet,
          taxRate: effectiveTaxRate,
          netTotal: net,
          taxAmount: tax,
          grossTotal: Math.round((net + tax) * 100) / 100,
          timeEntryIds: group.map((g) => g.id),
          productId: first.productId,
        });
      }
    } else {
      for (const e of selectedEntries) {
        const prod = productMap.get(e.productId);
        const hours = Math.round((e.durationSeconds / 3600) * 100) / 100;
        const net = Math.round(hours * e.hourlyRateNet * 100) / 100;
        const effectiveTaxRate: TaxRate = isSmallBusiness ? 0 : e.taxRate;
        const tax = Math.round(net * (effectiveTaxRate / 100) * 100) / 100;
        items.push({
          id: createId('li'),
          description: `${prod?.name ?? 'Leistung'} — ${e.title}`,
          detail: `${formatDateDE(e.startTime)}${e.notes ? ` · ${e.notes}` : ''}`,
          quantity: hours,
          unit: 'Std.',
          unitPriceNet: e.hourlyRateNet,
          taxRate: effectiveTaxRate,
          netTotal: net,
          taxAmount: tax,
          grossTotal: Math.round((net + tax) * 100) / 100,
          timeEntryIds: [e.id],
          productId: e.productId,
        });
      }
    }

    for (const extra of extraItems) {
      const prod = productMap.get(extra.productId);
      const qty = Math.max(0, Number(extra.quantity) || 0);
      const net = Math.round(qty * extra.unitPriceNet * 100) / 100;
      const effectiveTaxRate: TaxRate = isSmallBusiness ? 0 : extra.taxRate;
      const tax = Math.round(net * (effectiveTaxRate / 100) * 100) / 100;
      items.push({
        id: createId('li'),
        description: extra.description || prod?.name || 'Position',
        detail: prod?.description ?? '',
        quantity: qty,
        unit: prod?.unit ?? 'Stk.',
        unitPriceNet: extra.unitPriceNet,
        taxRate: effectiveTaxRate,
        netTotal: net,
        taxAmount: tax,
        grossTotal: Math.round((net + tax) * 100) / 100,
        timeEntryIds: [],
        productId: extra.productId,
      });
    }

    return items;
  }, [
    unbilledForCustomer,
    selectedEntryIds,
    groupByProduct,
    extraItems,
    productMap,
    isSmallBusiness,
  ]);

  const builderTotals = useMemo(() => {
    const netTotal = computedLineItems.reduce((acc, i) => acc + i.netTotal, 0);
    const taxTotal = computedLineItems.reduce((acc, i) => acc + i.taxAmount, 0);
    const grossTotal = Math.round((netTotal + taxTotal) * 100) / 100;
    return {
      netTotal: Math.round(netTotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      grossTotal,
    };
  }, [computedLineItems]);

  const handleSaveInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    setBuilderError('');
    const cust = customerMap.get(customerId);
    if (!cust) {
      setBuilderError('Bitte einen Kunden auswählen.');
      return;
    }
    if (computedLineItems.length === 0) {
      setBuilderError('Bitte mindestens einen Zeiteintrag oder ein Produkt auswählen.');
      return;
    }

    const selectedEntries = unbilledForCustomer.filter((entry) =>
      selectedEntryIds.includes(entry.id)
    );
    const dates = selectedEntries
      .map((entry) => entry.startTime.slice(0, 10))
      .sort();
    const servicePeriodStart = dates[0] ?? issueDate;
    const servicePeriodEnd = dates[dates.length - 1] ?? issueDate;
    const dueDate = addDaysISO(
      issueDate,
      cust.paymentTermDays || company.defaultPaymentTermDays || 14
    );

    const invoice: Invoice = {
      id: createId('inv'),
      invoiceNumber: invoiceNumber.trim() || nextSeqNumber,
      customerId: cust.id,
      customerSnapshot: {
        companyName: cust.companyName,
        contactName: cust.contactName,
        street: cust.street,
        postalCode: cust.postalCode,
        city: cust.city,
        country: cust.country,
        vatId: cust.vatId,
        email: cust.email,
      },
      issueDate,
      servicePeriodStart,
      servicePeriodEnd,
      dueDate,
      status: 'Entwurf',
      lineItems: computedLineItems,
      netTotal: builderTotals.netTotal,
      taxTotal: builderTotals.taxTotal,
      grossTotal: builderTotals.grossTotal,
      introText: introText.trim(),
      outroText: outroText.trim(),
      isSmallBusiness,
      smallBusinessNotice: isSmallBusiness ? defaultSmallBusinessNotice : undefined,
      nextcloudUploadedAt: null,
      createdAt: new Date().toISOString(),
    };

    onCreateInvoice(invoice, selectedEntryIds);
    setShowBuilder(false);
    setPreviewInvoice(invoice);
  };

  const handleUploadToNextcloud = async (inv: Invoice) => {
    if (!nextcloud.configured) {
      onNotify(
        'Bitte konfiguriere zuerst deine Nextcloud-Verbindung unter "Nextcloud & Setup".',
        true
      );
      return;
    }
    setUploadingId(inv.id);
    try {
      const pdfBase64 = getInvoicePdfBase64(inv, company);
      const result = await apiUploadInvoicePdf(`${inv.invoiceNumber}.pdf`, pdfBase64);
      onMarkInvoiceUploaded(inv.id, result.uploadedAt);
      if (previewInvoice?.id === inv.id) {
        setPreviewInvoice({
          ...inv,
          nextcloudUploadedAt: result.uploadedAt,
        });
      }
      onNotify(`Rechnung als PDF nach Nextcloud (${result.path}) hochgeladen.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Nextcloud-Upload fehlgeschlagen.',
        true
      );
    } finally {
      setUploadingId(null);
    }
  };

  const filteredInvoices = useMemo(() => {
    return [...invoices]
      .filter((inv) => statusFilter === 'all' || inv.status === statusFilter)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invoices, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Rechnungen
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Aus offenen Arbeitszeiten und Zusatzprodukten rechtssichere PDF-Rechnungen erstellen und in Nextcloud archivieren.
          </p>
        </div>
        <button
          type="button"
          onClick={openBuilderFresh}
          disabled={customers.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FilePlus2 className="h-4 w-4" />
          Neue Rechnung erstellen
        </button>
      </div>

      {/* Invoice Builder */}
      {showBuilder && (
        <section className="no-print rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Rechnung aus Arbeitszeiten generieren
            </h2>
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
            >
              Schließen
            </button>
          </div>

          <form onSubmit={handleSaveInvoice} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Kunde
                </label>
                <select
                  value={customerId}
                  onChange={(e) => handleBuilderCustomerChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Rechnungsnummer
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Rechnungsdatum
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
            </div>

            {/* Unbilled time entries selection */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Offene abrechenbare Arbeitszeiten ({unbilledForCustomer.length})
                </h3>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={groupByProduct}
                    onChange={(e) => setGroupByProduct(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                  />
                  Gleichartige Leistungen auf der Rechnung zusammenfassen
                </label>
              </div>

              {unbilledForCustomer.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-400">
                  Für diesen Kunden liegen aktuell keine offenen Zeiteinträge vor. Du kannst trotzdem Produkte/Pauschalen unten hinzufügen.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-200 dark:border-[#2e2349] dark:divide-[#2e2349]">
                  {unbilledForCustomer.map((entry) => {
                    const prod = productMap.get(entry.productId);
                    const net = (entry.durationSeconds / 3600) * entry.hourlyRateNet;
                    return (
                      <label
                        key={entry.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-[#211936]/60 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedEntryIds.includes(entry.id)}
                            onChange={() => toggleEntry(entry.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                              {entry.title}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {formatDateDE(entry.startTime)} · {prod?.name ?? 'Leistung'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatCurrency(net)}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {formatDuration(entry.durationSeconds)}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Extra catalog items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Zusätzliche Produkte / Pauschalen
                </h3>
                <button
                  type="button"
                  onClick={addExtraProductRow}
                  disabled={products.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Position hinzufügen
                </button>
              </div>
              {extraItems.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#2e2349] dark:bg-[#211936]/50 sm:grid-cols-12"
                >
                  <div className="sm:col-span-5">
                    <select
                      value={row.productId}
                      onChange={(e) =>
                        updateExtraRow(row.id, { productId: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={row.quantity}
                      onChange={(e) =>
                        updateExtraRow(row.id, { quantity: Number(e.target.value) })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                      placeholder="Menge"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.unitPriceNet}
                      onChange={(e) =>
                        updateExtraRow(row.id, {
                          unitPriceNet: Number(e.target.value),
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                      placeholder="Netto €"
                    />
                  </div>
                  <div className="flex items-center justify-between sm:col-span-3">
                    <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatCurrency(row.quantity * row.unitPriceNet)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExtraItems((prev) => prev.filter((x) => x.id !== row.id))
                      }
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals summary */}
            <div className="flex flex-col justify-between gap-4 border-t border-slate-200 pt-4 dark:border-[#2e2349] sm:flex-row sm:items-end">
              <div className="flex-1 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Einleitungstext
                  </label>
                  <textarea
                    rows={2}
                    value={introText}
                    onChange={(e) => setIntroText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Schlusstext / Zahlungshinweis
                  </label>
                  <textarea
                    rows={2}
                    value={outroText}
                    onChange={(e) => setOutroText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                  />
                </div>
              </div>
              <div className="w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-[#2e2349] dark:bg-[#211936]/70 sm:w-80">
                <label className="flex items-center gap-2 pb-1.5 border-b border-slate-200 dark:border-[#3b2d5e] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSmallBusiness}
                    onChange={(e) => setIsSmallBusiness(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                  />
                  Kleinunternehmerregelung (§ 19 UStG)
                </label>

                {!isSmallBusiness ? (
                  <>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>Summe Netto</span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatCurrency(builderTotals.netTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>MwSt. gesamt</span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatCurrency(builderTotals.taxTotal)}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-violet-300/80">
                    {defaultSmallBusinessNotice}
                  </p>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900 dark:border-[#3b2d5e] dark:text-slate-100">
                  <span>{isSmallBusiness ? 'Rechnungsbetrag' : 'Gesamt Brutto'}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(builderTotals.grossTotal)}
                  </span>
                </div>
              </div>
            </div>

            {builderError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                {builderError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBuilder(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Rechnung erzeugen &amp; Zeiten verbuchen
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Invoices Table */}
      <section className="no-print rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-[#2e2349]">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
            {(['all', 'Entwurf', 'Gesendet', 'Bezahlt', 'Storniert'] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {st === 'all' ? 'Alle' : st}
                </button>
              )
            )}
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Noch keine Rechnungen erstellt.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Erfasse Arbeitszeiten für einen Kunden und erstelle daraus mit einem Klick eine Rechnung.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
                  <th className="px-4 py-3">Rechnungs-Nr.</th>
                  <th className="px-4 py-3">Kunde</th>
                  <th className="px-4 py-3">Datum / Fällig</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Betrag (Brutto)</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filteredInvoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50"
                  >
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {inv.customerSnapshot.companyName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {inv.lineItems.length} Positionen
                        {inv.nextcloudUploadedAt
                          ? ` · Nextcloud-PDF gesichert`
                          : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      <div>{formatDateDE(inv.issueDate)}</div>
                      <div className="text-slate-400 dark:text-slate-500">
                        Fällig {formatDateDE(inv.dueDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={inv.status}
                        onChange={(e) =>
                          onUpdateInvoiceStatus(inv.id, e.target.value as InvoiceStatus)
                        }
                        className={`rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] ${
                          inv.status === 'Bezahlt'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : inv.status === 'Storniert'
                              ? 'text-red-700 dark:text-red-400'
                              : inv.status === 'Gesendet'
                                ? 'text-blue-700 dark:text-violet-400'
                                : 'text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <option value="Entwurf">Entwurf</option>
                        <option value="Gesendet">Gesendet</option>
                        <option value="Bezahlt">Bezahlt</option>
                        <option value="Storniert">Storniert</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                      {formatCurrency(inv.grossTotal)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewInvoice(inv)}
                          title="Vorschau öffnen"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Vorschau
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadInvoicePdf(inv, company)}
                          title="PDF herunterladen"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUploadToNextcloud(inv)}
                          disabled={uploadingId === inv.id}
                          title="PDF in Nextcloud (/Rechnungen) speichern"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:text-violet-400 dark:hover:bg-[#231b38] cursor-pointer"
                        >
                          <CloudUpload className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteInvoice(inv.id)}
                          title="Rechnung löschen (Zeiten werden wieder freigegeben)"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Invoice Document Preview Modal */}
      {previewInvoice && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0e0a18]/75 p-4 sm:p-8">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-[#3b2d5e]">
            <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4 rounded-t-xl dark:border-[#2e2349] dark:bg-[#171126]">
              <div className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Rechnungsvorschau · {previewInvoice.invoiceNumber}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadInvoicePdf(previewInvoice, company)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-[#211936] dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  PDF herunterladen
                </button>
                <button
                  type="button"
                  onClick={() => handleUploadToNextcloud(previewInvoice)}
                  disabled={uploadingId === previewInvoice.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  {uploadingId === previewInvoice.id
                    ? 'Lade hoch...'
                    : 'In Nextcloud speichern'}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Drucken
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewInvoice(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#231b38] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* DIN-inspired Printable Sheet (always crisp white paper) */}
            <div className="p-8 sm:p-12 bg-white text-slate-900 rounded-b-xl">
              <div className="flex flex-col justify-between gap-6 sm:flex-row">
                <div>
                  <div className="text-[11px] text-slate-500 underline">
                    {company.companyName} · {company.street} · {company.postalCode}{' '}
                    {company.city}
                  </div>
                  <div className="mt-4 text-sm">
                    <div className="font-semibold">
                      {previewInvoice.customerSnapshot.companyName}
                    </div>
                    {previewInvoice.customerSnapshot.contactName && (
                      <div>{previewInvoice.customerSnapshot.contactName}</div>
                    )}
                    <div>{previewInvoice.customerSnapshot.street}</div>
                    <div>
                      {previewInvoice.customerSnapshot.postalCode}{' '}
                      {previewInvoice.customerSnapshot.city}
                    </div>
                    {previewInvoice.customerSnapshot.vatId && (
                      <div className="mt-1 text-xs text-slate-500">
                        USt-IdNr.: {previewInvoice.customerSnapshot.vatId}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  {company.logoDataUrl && company.invoiceShowLogo !== false && (
                    <div className="mb-3 flex sm:justify-end">
                      <img
                        src={company.logoDataUrl}
                        alt={`${company.companyName} Logo`}
                        className="max-h-14 max-w-[180px] object-contain"
                      />
                    </div>
                  )}
                  <div className={`font-display text-lg font-bold ${accentStyle.textClass}`}>
                    {company.companyName}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 space-y-0.5">
                    <div>{company.ownerName}</div>
                    <div>{company.street}</div>
                    <div>
                      {company.postalCode} {company.city}
                    </div>
                    <div>{company.email}</div>
                  </div>

                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1 text-left">
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Rechnungsnr.</span>
                      <span className="font-mono font-semibold">
                        {previewInvoice.invoiceNumber}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Datum</span>
                      <span className="font-mono tabular-nums">
                        {formatDateDE(previewInvoice.issueDate)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Leistungszeitraum</span>
                      <span className="font-mono tabular-nums">
                        {formatDateDE(previewInvoice.servicePeriodStart)} –{' '}
                        {formatDateDE(previewInvoice.servicePeriodEnd)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Fällig bis</span>
                      <span className="font-mono tabular-nums">
                        {formatDateDE(previewInvoice.dueDate)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <h2 className={`mt-8 font-display text-xl font-bold ${accentStyle.textClass}`}>
                {headerTitle} {previewInvoice.invoiceNumber}
              </h2>
              {previewInvoice.introText && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                  {previewInvoice.introText}
                </p>
              )}

              {(() => {
                const previewSmallBiz =
                  previewInvoice.isSmallBusiness ?? Boolean(company.smallBusinessMode);
                const smallBizText =
                  previewInvoice.smallBusinessNotice ||
                  company.smallBusinessNotice ||
                  'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

                return (
                  <>
                    <table className="mt-6 w-full text-left text-sm">
                      <thead>
                        <tr className={`border-b-2 ${accentStyle.borderClass} text-xs font-semibold text-slate-600`}>
                          <th className="py-2 pr-2">Pos.</th>
                          <th className="py-2 pr-2">Beschreibung</th>
                          <th className="py-2 px-2 text-right">Menge</th>
                          <th className="py-2 px-2 text-right">Einzelpreis</th>
                          {!previewSmallBiz && (
                            <th className="py-2 px-2 text-right">MwSt.</th>
                          )}
                          <th className="py-2 pl-2 text-right">
                            {previewSmallBiz ? 'Gesamt' : 'Netto'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {previewInvoice.lineItems.map((item, idx) => (
                          <tr key={item.id}>
                            <td className="py-3 pr-2 font-mono text-xs text-slate-500 align-top">
                              {idx + 1}
                            </td>
                            <td className="py-3 pr-2 align-top">
                              <div className="font-medium text-slate-900">
                                {item.description}
                              </div>
                              {item.detail && (
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {item.detail}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap">
                              {formatNumber(item.quantity, 2)} {item.unit}
                            </td>
                            <td className="py-3 px-2 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap">
                              {formatCurrency(item.unitPriceNet)}
                            </td>
                            {!previewSmallBiz && (
                              <td className="py-3 px-2 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap">
                                {item.taxRate} %
                              </td>
                            )}
                            <td className="py-3 pl-2 text-right font-mono text-sm font-medium tabular-nums align-top whitespace-nowrap">
                              {formatCurrency(item.netTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-6 flex justify-end">
                      <div className="w-full max-w-xs space-y-1.5 text-sm">
                        {!previewSmallBiz && (
                          <>
                            <div className="flex justify-between text-slate-600">
                              <span>Summe Netto</span>
                              <span className="font-mono tabular-nums">
                                {formatCurrency(previewInvoice.netTotal)}
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-600">
                              <span>Umsatzsteuer</span>
                              <span className="font-mono tabular-nums">
                                {formatCurrency(previewInvoice.taxTotal)}
                              </span>
                            </div>
                          </>
                        )}
                        <div className={`flex justify-between border-t-2 ${accentStyle.borderClass} pt-2 text-base font-bold ${accentStyle.textClass}`}>
                          <span>Rechnungsbetrag</span>
                          <span className="font-mono tabular-nums">
                            {formatCurrency(
                              previewSmallBiz
                                ? previewInvoice.netTotal
                                : previewInvoice.grossTotal
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {previewSmallBiz && (
                      <p className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-700">
                        {smallBizText}
                      </p>
                    )}
                  </>
                );
              })()}

              {previewInvoice.outroText && (
                <p className="mt-8 whitespace-pre-line text-xs text-slate-600">
                  {previewInvoice.outroText}
                </p>
              )}

              {company.invoiceFooterNote && (
                <p className="mt-3 whitespace-pre-line text-xs italic text-slate-500">
                  {company.invoiceFooterNote}
                </p>
              )}

              <div className="mt-10 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 text-[11px] text-slate-500 sm:grid-cols-3">
                <div>
                  <div className="font-semibold text-slate-700">{company.companyName}</div>
                  <div>
                    {company.street}, {company.postalCode} {company.city}
                  </div>
                </div>
                <div>
                  <div>Bank: {company.bankName}</div>
                  <div>IBAN: {company.iban}</div>
                  <div>BIC: {company.bic}</div>
                </div>
                <div>
                  <div>Steuernr.: {company.taxNumber}</div>
                  <div>USt-IdNr.: {company.vatId}</div>
                  <div>E-Mail: {company.email}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
