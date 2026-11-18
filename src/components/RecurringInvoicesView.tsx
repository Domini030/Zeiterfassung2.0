import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  Edit3,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CompanyProfile,
  Customer,
  DiscountType,
  Product,
  RecurringInterval,
  RecurringInvoiceTemplate,
  RecurringLineItemDraft,
  TaxRate,
  UnitType,
} from '../types';
import {
  calculateDocumentTotals,
  createId,
  formatCurrency,
  formatDateDE,
  toInputDate,
} from '../utils/format';
import { InfoHintPopup } from './InfoHintPopup';
import { ThemedSelect } from './ThemedSelect';

interface RecurringInvoicesViewProps {
  templates: RecurringInvoiceTemplate[];
  customers: Customer[];
  products: Product[];
  company: CompanyProfile;
  onSaveTemplate: (template: RecurringInvoiceTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onGenerateFromTemplate: (template: RecurringInvoiceTemplate) => void;
  onGenerateAllDue: () => void;
}

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  monthly: 'Monatlich',
  quarterly: 'Quartalsweise',
  yearly: 'Jährlich',
};

export function RecurringInvoicesView({
  templates,
  customers,
  products,
  company,
  onSaveTemplate,
  onDeleteTemplate,
  onGenerateFromTemplate,
  onGenerateAllDue,
}: RecurringInvoicesViewProps) {
  const todayIso = toInputDate();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [interval, setInterval] = useState<RecurringInterval>('monthly');
  const [nextRunDate, setNextRunDate] = useState(todayIso);
  const [active, setActive] = useState(true);
  const [autoMarkSent, setAutoMarkSent] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState(0);
  const [discountLabel, setDiscountLabel] = useState('');
  const [introText, setIntroText] = useState(company.invoiceDefaultIntroText || '');
  const [outroText, setOutroText] = useState(company.invoiceDefaultOutroText || '');
  const [lineItems, setLineItems] = useState<RecurringLineItemDraft[]>([]);
  const [pickProductId, setPickProductId] = useState('');

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );

  const dueTemplates = useMemo(
    () => templates.filter((t) => t.active && t.nextRunDate <= todayIso),
    [templates, todayIso]
  );

  const monthlyRecurringEquivalent = useMemo(() => {
    return templates
      .filter((t) => t.active)
      .reduce((acc, tpl) => {
        const netSum = tpl.lineItems.reduce(
          (sum, li) => sum + li.quantity * li.unitPriceNet,
          0
        );
        if (tpl.interval === 'monthly') return acc + netSum;
        if (tpl.interval === 'quarterly') return acc + netSum / 3;
        return acc + netSum / 12;
      }, 0);
  }, [templates]);

  const openNewModal = () => {
    setEditingId(null);
    setTitle('');
    setCustomerId(customers[0]?.id || '');
    setInterval('monthly');
    setNextRunDate(todayIso);
    setActive(true);
    setAutoMarkSent(false);
    setDiscountType('percent');
    setDiscountValue(0);
    setDiscountLabel('');
    setIntroText(company.invoiceDefaultIntroText || '');
    setOutroText(company.invoiceDefaultOutroText || '');
    setLineItems([
      {
        id: createId('rli'),
        productId: products[0]?.id || null,
        description: products[0]?.name || 'Monatliche Wartung & Service',
        detail: products[0]?.description || '',
        quantity: 1,
        unit: products[0]?.unit || 'Pauschal',
        unitPriceNet: products[0]?.unitPriceNet || 250,
        taxRate: products[0]?.taxRate ?? 19,
      },
    ]);
    setFormOpen(true);
  };

  const openEditModal = (tpl: RecurringInvoiceTemplate) => {
    setEditingId(tpl.id);
    setTitle(tpl.title);
    setCustomerId(tpl.customerId);
    setInterval(tpl.interval);
    setNextRunDate(tpl.nextRunDate);
    setActive(tpl.active);
    setAutoMarkSent(Boolean(tpl.autoMarkSent));
    setDiscountType(tpl.discountType || 'percent');
    setDiscountValue(tpl.discountValue || 0);
    setDiscountLabel(tpl.discountLabel || '');
    setIntroText(tpl.introText ?? company.invoiceDefaultIntroText ?? '');
    setOutroText(tpl.outroText ?? company.invoiceDefaultOutroText ?? '');
    setLineItems(tpl.lineItems.map((li) => ({ ...li })));
    setFormOpen(true);
  };

  const handleAddProductRow = () => {
    const prod = products.find((p) => p.id === pickProductId);
    setLineItems((prev) => [
      ...prev,
      {
        id: createId('rli'),
        productId: prod?.id || null,
        description: prod?.name || 'Wiederkehrende Leistung',
        detail: prod?.description || '',
        quantity: 1,
        unit: prod?.unit || 'Pauschal',
        unitPriceNet: prod?.unitPriceNet || 100,
        taxRate: prod?.taxRate ?? 19,
      },
    ]);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !customerId || lineItems.length === 0) return;

    const existing = editingId ? templates.find((t) => t.id === editingId) : undefined;
    onSaveTemplate({
      id: editingId || createId('rec'),
      title: title.trim(),
      customerId,
      interval,
      active,
      nextRunDate,
      lastRunDate: existing?.lastRunDate ?? null,
      generatedCount: existing?.generatedCount ?? 0,
      lineItems,
      discountType,
      discountValue,
      discountLabel: discountLabel.trim() || undefined,
      introText,
      outroText,
      isSmallBusiness: Boolean(company.smallBusinessMode),
      autoMarkSent,
      createdAt: existing?.createdAt || new Date().toISOString(),
    });
    setFormOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Wartungsverträge &amp; Abos
        </h1>
        <InfoHintPopup
          title="Wartungsverträge & Abos"
          text="Verwalte wiederkehrende Kundenverträge, Wartungspauschalen und Abo-Rechnungen mit automatischer Fälligkeitsprüfung und 1-Klick-Rechnungserstellung."
        />
      </div>

      {/* Due Alert Banner */}
      {dueTemplates.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/90 px-5 py-4 dark:border-amber-500/40 dark:bg-amber-500/15">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
                {dueTemplates.length} Wartungsvertrag / Abo-Rechnung(en) zur Abrechnung fällig
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200/80">
                Mit einem Klick direkt als vollwertige Rechnung im Archiv erzeugen.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerateAllDue}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 shadow-sm cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" />
            Alle fälligen ({dueTemplates.length}) erzeugen
          </button>
        </div>
      )}

      {/* KPIs + New Button */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Aktive Verträge / Abos
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
            {templates.filter((t) => t.active).length} / {templates.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monatlich wiederkehrend (MRR Netto)
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {formatCurrency(monthlyRecurringEquivalent)}
          </p>
        </div>
        <div className="flex items-center justify-end rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <button
            type="button"
            disabled={customers.length === 0}
            onClick={openNewModal}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl ui-accent-btn px-4 py-2.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Neuer Wartungsvertrag / Abo
          </button>
        </div>
      </div>

      {/* Contract List */}
      {templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-[#3b2d5e] dark:bg-[#19122c]">
          <Repeat className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Keine wiederkehrenden Verträge angelegt
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Legen Sie monatliche, quartalsweise oder jährliche Wartungs- und Retainer-Verträge an.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((tpl) => {
            const customer = customerMap.get(tpl.customerId);
            const isDue = tpl.active && tpl.nextRunDate <= todayIso;
            const isTplSmallBiz = tpl.isSmallBusiness ?? Boolean(company.smallBusinessMode);
            const computedLines = tpl.lineItems.map((li) => {
              const netTotal = Math.round(li.quantity * li.unitPriceNet * 100) / 100;
              const taxAmount = isTplSmallBiz
                ? 0
                : Math.round(netTotal * (li.taxRate / 100) * 100) / 100;
              return {
                ...li,
                detail: li.detail || '',
                netTotal,
                taxAmount,
                grossTotal: Math.round((netTotal + taxAmount) * 100) / 100,
                timeEntryIds: [],
                productId: li.productId || null,
              };
            });
            const totals = calculateDocumentTotals(
              computedLines,
              isTplSmallBiz,
              tpl.discountType || 'percent',
              tpl.discountValue || 0
            );

            return (
              <div
                key={tpl.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center dark:border-[#342653] dark:bg-[#19122c]"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-bold text-slate-900 dark:text-white">
                      {tpl.title}
                    </h4>
                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                      {INTERVAL_LABELS[tpl.interval]}
                    </span>
                    {!tpl.active ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700/40 dark:text-slate-300">
                        <PauseCircle className="h-3 w-3" /> Pausiert
                      </span>
                    ) : isDue ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                        <CalendarClock className="h-3 w-3" /> Fällig ({formatDateDE(tpl.nextRunDate)})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> Nächste: {formatDateDE(tpl.nextRunDate)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Kunde: <span className="font-semibold">{customer?.companyName || 'Unbekannt'}</span> ·{' '}
                    {tpl.lineItems.length} Position(en) · Bisher {tpl.generatedCount}x erzeugt
                    {tpl.lastRunDate ? ` (zuletzt ${formatDateDE(tpl.lastRunDate)})` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <div className="mr-2 text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Rechnungsbetrag</p>
                    <p className="text-base font-bold text-slate-900 dark:text-white">
                      {formatCurrency(
                        isTplSmallBiz ? totals.netTotal : totals.grossTotal
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onGenerateFromTemplate(tpl)}
                    className="inline-flex items-center gap-1.5 rounded-xl ui-accent-btn px-3 py-2 text-xs font-semibold text-white shadow-sm cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Rechnung erzeugen
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSaveTemplate({ ...tpl, active: !tpl.active })
                    }
                    title={tpl.active ? 'Pausieren' : 'Aktivieren'}
                    className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 cursor-pointer"
                  >
                    {tpl.active ? (
                      <PauseCircle className="h-4 w-4" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(tpl)}
                    className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 cursor-pointer"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteTemplate(tpl.id)}
                    className="rounded-xl border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Template Editor Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#342653] dark:bg-[#19122c]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-[#2e234a]">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingId ? 'Wartungsvertrag bearbeiten' : 'Neuen Wartungsvertrag anlegen'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Vertragstitel *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="z. B. Monatliche IT-Wartung"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kunde *
                  </label>
                  <ThemedSelect
                    value={customerId}
                    onChange={setCustomerId}
                    options={customers.map((c) => ({
                      value: c.id,
                      label: c.companyName,
                      hint: c.customerNumber,
                    }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Abrechnungsintervall
                  </label>
                  <ThemedSelect
                    value={interval}
                    onChange={(v) => setInterval(v as RecurringInterval)}
                    options={[
                      { value: 'monthly', label: 'Monatlich' },
                      { value: 'quarterly', label: 'Quartalsweise (alle 3 Monate)' },
                      { value: 'yearly', label: 'Jährlich' },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Nächste Fälligkeit
                  </label>
                  <input
                    type="date"
                    required
                    value={nextRunDate}
                    onChange={(e) => setNextRunDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="rounded border-slate-300 text-violet-600"
                    />
                    Vertrag aktiv (Fälligkeits-Hinweis)
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoMarkSent}
                      onChange={(e) => setAutoMarkSent(e.target.checked)}
                      className="rounded border-slate-300 text-violet-600"
                    />
                    Direkt als &quot;Gesendet&quot; anlegen
                  </label>
                </div>
              </div>

              {/* Line Items */}
              <div className="rounded-xl border border-slate-200 p-3.5 space-y-3 dark:border-[#342653]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Vertragspositionen ({lineItems.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <ThemedSelect
                      size="sm"
                      className="w-52"
                      value={pickProductId}
                      onChange={setPickProductId}
                      options={[
                        { value: '', label: 'Leere Position hinzufügen' },
                        ...products.map((p) => ({
                          value: p.id,
                          label: p.name,
                          hint: formatCurrency(p.unitPriceNet),
                        })),
                      ]}
                    />
                    <button
                      type="button"
                      onClick={handleAddProductRow}
                      className="inline-flex items-center gap-1 rounded-lg ui-accent-btn px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Position
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {lineItems.map((li, idx) => (
                    <div
                      key={li.id}
                      className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 sm:grid-cols-12 dark:border-[#3b2d5e] dark:bg-[#211936]/70"
                    >
                      <div className="sm:col-span-5">
                        <input
                          type="text"
                          value={li.description}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, description: e.target.value } : row
                              )
                            )
                          }
                          placeholder="Leistungsbeschreibung"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#19122c] dark:text-slate-100"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={li.quantity}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((row, i) =>
                                i === idx
                                  ? { ...row, quantity: Number(e.target.value) || 0 }
                                  : row
                              )
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#19122c] dark:text-slate-100"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <ThemedSelect
                          size="sm"
                          value={li.unit}
                          onChange={(v) =>
                            setLineItems((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, unit: v as UnitType } : row
                              )
                            )
                          }
                          options={[
                            { value: 'Pauschal', label: 'Pauschal' },
                            { value: 'Std.', label: 'Std.' },
                            { value: 'Stk.', label: 'Stk.' },
                            { value: 'Tag', label: 'Tag' },
                          ]}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={li.unitPriceNet}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((row, i) =>
                                i === idx
                                  ? { ...row, unitPriceNet: Number(e.target.value) || 0 }
                                  : row
                              )
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#19122c] dark:text-slate-100"
                        />
                      </div>
                      <div className="flex items-center justify-end sm:col-span-1">
                        <button
                          type="button"
                          disabled={lineItems.length <= 1}
                          onClick={() =>
                            setLineItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="sm:col-span-9">
                        <input
                          type="text"
                          value={li.detail || ''}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, detail: e.target.value } : row
                              )
                            )
                          }
                          placeholder="Detailtext (optional)"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 dark:border-[#3b2d5e] dark:bg-[#19122c] dark:text-slate-300"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <ThemedSelect
                          size="sm"
                          value={String(li.taxRate)}
                          onChange={(v) =>
                            setLineItems((prev) =>
                              prev.map((row, i) =>
                                i === idx
                                  ? { ...row, taxRate: Number(v) as TaxRate }
                                  : row
                              )
                            )
                          }
                          options={[
                            { value: '19', label: '19 % MwSt.' },
                            { value: '7', label: '7 % MwSt.' },
                            { value: '0', label: '0 % MwSt.' },
                          ]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Einleitungstext
                  </label>
                  <textarea
                    rows={2}
                    value={introText}
                    onChange={(e) => setIntroText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Schlusstext
                  </label>
                  <textarea
                    rows={2}
                    value={outroText}
                    onChange={(e) => setOutroText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4 dark:border-[#2e234a]">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg ui-accent-btn px-4 py-2 text-xs font-semibold text-white shadow-sm cursor-pointer"
                >
                  Vertrag speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
