import {
  CheckSquare,
  FilePlus2,
  Nfc,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  ActiveTimer,
  Customer,
  NfcTask,
  Product,
  TaxRate,
  TimeEntry,
} from '../types';
import {
  createId,
  formatCurrency,
  formatDateTimeDE,
  formatDuration,
  formatHoursShort,
  toInputDate,
} from '../utils/format';

interface TimeTrackerViewProps {
  customers: Customer[];
  products: Product[];
  nfcTasks: NfcTask[];
  timeEntries: TimeEntry[];
  activeTimer: ActiveTimer | null;
  elapsedSeconds: number;
  onStartTimer: (payload: {
    customerId: string;
    productId: string;
    title: string;
    notes: string;
    nfcTaskId?: string | null;
    source?: 'timer' | 'nfc';
  }) => void;
  onStopTimer: () => void;
  onDiscardTimer: () => void;
  onAddManualEntry: (entry: TimeEntry) => void;
  onDeleteEntry: (id: string) => void;
  onToggleBillable: (id: string) => void;
  onCreateInvoiceFromEntries: (customerId: string, entryIds: string[]) => void;
  onNavigate: (section: 'customers' | 'products' | 'nfc') => void;
}

export function TimeTrackerView({
  customers,
  products,
  nfcTasks,
  timeEntries,
  activeTimer,
  elapsedSeconds,
  onStartTimer,
  onStopTimer,
  onDiscardTimer,
  onAddManualEntry,
  onDeleteEntry,
  onToggleBillable,
  onCreateInvoiceFromEntries,
  onNavigate,
}: TimeTrackerViewProps) {
  const serviceProducts = useMemo(
    () => products.filter((p) => p.type === 'service'),
    [products]
  );

  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? '');
  const [productId, setProductId] = useState<string>(
    serviceProducts[0]?.id ?? products[0]?.id ?? ''
  );
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDate, setManualDate] = useState(toInputDate());
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('11:00');
  const [manualTitle, setManualTitle] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualCustomerId, setManualCustomerId] = useState(customers[0]?.id ?? '');
  const [manualProductId, setManualProductId] = useState(
    serviceProducts[0]?.id ?? products[0]?.id ?? ''
  );
  const [manualError, setManualError] = useState('');

  const [filterCustomerId, setFilterCustomerId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'billed'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const effectiveCustomerId = customers.some((c) => c.id === customerId)
    ? customerId
    : customers[0]?.id ?? '';
  const effectiveProductId = products.some((p) => p.id === productId)
    ? productId
    : serviceProducts[0]?.id ?? products[0]?.id ?? '';

  const effectiveManualCustomerId = customers.some((c) => c.id === manualCustomerId)
    ? manualCustomerId
    : customers[0]?.id ?? '';
  const effectiveManualProductId = products.some((p) => p.id === manualProductId)
    ? manualProductId
    : serviceProducts[0]?.id ?? products[0]?.id ?? '';

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const filteredEntries = useMemo(() => {
    return [...timeEntries]
      .filter((entry) => {
        if (filterCustomerId !== 'all' && entry.customerId !== filterCustomerId) {
          return false;
        }
        if (filterStatus === 'open' && entry.billedInvoiceId !== null) {
          return false;
        }
        if (filterStatus === 'billed' && entry.billedInvoiceId === null) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [timeEntries, filterCustomerId, filterStatus]);

  const unbilledTotalSeconds = useMemo(
    () =>
      timeEntries
        .filter((e) => e.billable && !e.billedInvoiceId)
        .reduce((acc, e) => acc + e.durationSeconds, 0),
    [timeEntries]
  );

  const unbilledTotalNet = useMemo(
    () =>
      timeEntries
        .filter((e) => e.billable && !e.billedInvoiceId)
        .reduce((acc, e) => acc + (e.durationSeconds / 3600) * e.hourlyRateNet, 0),
    [timeEntries]
  );

  const selectedEntries = useMemo(
    () => timeEntries.filter((e) => selectedIds.includes(e.id)),
    [timeEntries, selectedIds]
  );

  const selectedCustomerIds = useMemo(
    () => Array.from(new Set(selectedEntries.map((e) => e.customerId))),
    [selectedEntries]
  );

  const handleStartClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveCustomerId || !effectiveProductId) return;
    const prod = productMap.get(effectiveProductId);
    onStartTimer({
      customerId: effectiveCustomerId,
      productId: effectiveProductId,
      title: title.trim() || prod?.name || 'Arbeitszeit',
      notes: notes.trim(),
      source: 'timer',
    });
    setTitle('');
    setNotes('');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError('');
    if (!effectiveManualCustomerId || !effectiveManualProductId) {
      setManualError('Bitte Kunde und Leistung auswählen.');
      return;
    }

    const startIso = new Date(`${manualDate}T${manualStart}:00`);
    const endIso = new Date(`${manualDate}T${manualEnd}:00`);
    if (Number.isNaN(startIso.getTime()) || Number.isNaN(endIso.getTime())) {
      setManualError('Bitte gültige Start- und Endzeiten eingeben.');
      return;
    }

    const diffSec = Math.floor((endIso.getTime() - startIso.getTime()) / 1000);
    if (diffSec <= 0) {
      setManualError('Die Endzeit muss nach der Startzeit liegen.');
      return;
    }

    const prod = productMap.get(effectiveManualProductId);
    const entry: TimeEntry = {
      id: createId('time'),
      customerId: effectiveManualCustomerId,
      productId: effectiveManualProductId,
      nfcTaskId: null,
      title: manualTitle.trim() || prod?.name || 'Manuelle Buchung',
      notes: manualNotes.trim(),
      startTime: startIso.toISOString(),
      endTime: endIso.toISOString(),
      durationSeconds: diffSec,
      hourlyRateNet: prod?.unitPriceNet ?? 0,
      taxRate: (prod?.taxRate ?? 19) as TaxRate,
      billable: true,
      billedInvoiceId: null,
      source: 'manual',
      createdAt: new Date().toISOString(),
    };

    onAddManualEntry(entry);
    setManualTitle('');
    setManualNotes('');
    setShowManualForm(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchInvoice = () => {
    if (selectedEntries.length === 0 || selectedCustomerIds.length !== 1) return;
    onCreateInvoiceFromEntries(selectedCustomerIds[0], selectedIds);
    setSelectedIds([]);
  };

  const missingMasterData = customers.length === 0 || products.length === 0;

  return (
    <div className="space-y-6">
      {/* Page Header + KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Zeiterfassung
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Laufende Aufgaben erfassen, Zeiten manuell nachtragen und direkt abrechnen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-200 pt-3 dark:border-[#2e2349] sm:border-t-0 sm:pt-0">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Offene Stunden</div>
            <div className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatHoursShort(unbilledTotalSeconds)}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-200 dark:bg-[#2e2349]" />
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Offener Nettobetrag</div>
            <div className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatCurrency(unbilledTotalNet)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowManualForm((prev) => !prev)}
            disabled={missingMasterData}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#211936] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Zeit nachtragen
          </button>
        </div>
      </div>

      {/* Onboarding hint if customers or products are missing */}
      {missingMasterData && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Für die Zeiterfassung werden mindestens ein Kunde und eine Leistung benötigt.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {customers.length === 0 && (
              <button
                type="button"
                onClick={() => onNavigate('customers')}
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Ersten Kunden anlegen
              </button>
            )}
            {products.length === 0 && (
              <button
                type="button"
                onClick={() => onNavigate('products')}
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Erste Leistung anlegen
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dominant Chronometer / Active Timer Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
        {activeTimer ? (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-blue-700 dark:text-violet-400">
                <span>
                  {activeTimer.source === 'nfc' ? 'Gestartet per NFC-Tag' : 'Timer läuft'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {customerMap.get(activeTimer.customerId)?.companyName ?? 'Kunde'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {productMap.get(activeTimer.productId)?.name ?? 'Leistung'}
                </span>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                {activeTimer.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gestartet am {formatDateTimeDE(activeTimer.startTime)} · Stundensatz{' '}
                <span className="font-mono tabular-nums">
                  {formatCurrency(activeTimer.hourlyRateNet)}/Std.
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="rounded-lg border border-slate-200 bg-slate-900 px-5 py-3 font-mono text-3xl font-bold tracking-tight text-white tabular-nums dark:border-[#3b2d5e] dark:bg-[#0e0a18]">
                {formatDuration(elapsedSeconds)}
              </div>
              <button
                type="button"
                onClick={onStopTimer}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="h-4 w-4 fill-current" />
                Stoppen &amp; Speichern
              </button>
              <button
                type="button"
                onClick={onDiscardTimer}
                className="rounded-lg border border-slate-200 px-3.5 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-red-700 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] dark:hover:text-red-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Verwerfen
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartClick} className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Kunde
              </label>
              <select
                value={effectiveCustomerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={customers.length === 0}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Leistung / Produkt
              </label>
              <select
                value={effectiveProductId}
                onChange={(e) => setProductId(e.target.value)}
                disabled={products.length === 0}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCurrency(p.unitPriceNet)}/{p.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-4">
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Aufgabe / Tätigkeit
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z. B. Serverwartung oder API-Anbindung..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-500"
              />
            </div>

            <div className="flex items-end lg:col-span-2">
              <button
                type="submit"
                disabled={missingMasterData}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current" />
                Timer starten
              </button>
            </div>
          </form>
        )}

        {/* Quick NFC shortcuts */}
        {nfcTasks.length > 0 && !activeTimer && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-[#2e2349]">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Nfc className="h-3.5 w-3.5 text-violet-400" />
              NFC-Schnellstart:
            </span>
            {nfcTasks.slice(0, 4).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() =>
                  onStartTimer({
                    customerId: task.customerId,
                    productId: task.productId,
                    title: task.title,
                    notes: task.description,
                    nfcTaskId: task.id,
                    source: 'nfc',
                  })
                }
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:border-violet-500 dark:hover:bg-[#2c2147] whitespace-nowrap shrink-0 cursor-pointer"
              >
                {task.title}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onNavigate('nfc')}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-violet-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Alle NFC-Tags verwalten
            </button>
          </div>
        )}
      </section>

      {/* Manual Time Entry Form */}
      {showManualForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Arbeitszeit manuell nachtragen
            </h2>
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
            >
              Schließen
            </button>
          </div>
          <form onSubmit={handleManualSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Kunde
              </label>
              <select
                value={effectiveManualCustomerId}
                onChange={(e) => setManualCustomerId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Leistung
              </label>
              <select
                value={effectiveManualProductId}
                onChange={(e) => setManualProductId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCurrency(p.unitPriceNet)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Datum
              </label>
              <input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Von
                </label>
                <input
                  type="time"
                  value={manualStart}
                  onChange={(e) => setManualStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Bis
                </label>
                <input
                  type="time"
                  value={manualEnd}
                  onChange={(e) => setManualEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                />
              </div>
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Tätigkeitsbeschreibung
              </label>
              <input
                type="text"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="z. B. Kundenworkshop & Dokumentation"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Notiz für Rechnung (optional)
              </label>
              <input
                type="text"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="Details zur erbrachten Leistung..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            {manualError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400 md:col-span-6">
                {manualError}
              </p>
            )}
            <div className="flex justify-end gap-2 md:col-span-6">
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Eintrag speichern
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Filter Bar + Batch Invoice Action */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={filterCustomerId}
              onChange={(e) => setFilterCustomerId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
            >
              <option value="all">Alle Kunden</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
              {(
                [
                  { id: 'all', label: 'Alle' },
                  { id: 'open', label: 'Offen' },
                  { id: 'billed', label: 'Abgerechnet' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterStatus(tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    filterStatus === tab.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-mono font-semibold tabular-nums">{selectedIds.length}</span>{' '}
                ausgewählt
              </span>
              {selectedCustomerIds.length > 1 ? (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Für eine Rechnung bitte nur Einträge eines Kunden wählen.
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleBatchInvoice}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Rechnung aus Auswahl erstellen
                </button>
              )}
            </div>
          )}
        </div>

        {/* Time Entries Table */}
        {filteredEntries.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Keine Zeiteinträge für diesen Filter vorhanden.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Starte oben den Live-Timer, scanne einen NFC-Tag oder trage Zeiten manuell nach.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
                  <th className="w-10 px-4 py-3">
                    <CheckSquare className="h-4 w-4 text-slate-400 dark:text-violet-400/60" />
                  </th>
                  <th className="px-4 py-3">Aufgabe &amp; Kunde</th>
                  <th className="px-4 py-3">Zeitraum</th>
                  <th className="px-4 py-3 text-right">Dauer</th>
                  <th className="px-4 py-3 text-right">Nettowert</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filteredEntries.map((entry) => {
                  const customer = customerMap.get(entry.customerId);
                  const product = productMap.get(entry.productId);
                  const netValue = (entry.durationSeconds / 3600) * entry.hourlyRateNet;
                  const canSelect = entry.billable && !entry.billedInvoiceId;
                  const isSelected = selectedIds.includes(entry.id);

                  return (
                    <tr
                      key={entry.id}
                      className="transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          disabled={!canSelect}
                          checked={isSelected}
                          onChange={() => toggleSelect(entry.id)}
                          aria-label={`Eintrag ${entry.title} auswählen`}
                          className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 focus:ring-violet-500 disabled:opacity-30 dark:border-[#3b2d5e] dark:bg-[#211936]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {entry.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <span>{customer?.companyName ?? 'Unbekannter Kunde'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{product?.name ?? 'Leistung'}</span>
                          {entry.source === 'nfc' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-blue-700 dark:text-violet-400">NFC</span>
                            </>
                          )}
                        </div>
                        {entry.notes && (
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {entry.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        {formatDateTimeDE(entry.startTime)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {formatDuration(entry.durationSeconds)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {entry.billable ? formatCurrency(netValue) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {entry.billedInvoiceId ? (
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Abgerechnet
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onToggleBillable(entry.id)}
                            className={`text-xs font-medium hover:underline cursor-pointer ${
                              entry.billable
                                ? 'text-blue-700 dark:text-violet-400'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {entry.billable ? 'Abrechenbar (Offen)' : 'Nicht abrechenbar'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeleteEntry(entry.id)}
                          disabled={Boolean(entry.billedInvoiceId)}
                          title={
                            entry.billedInvoiceId
                              ? 'Abgerechnete Einträge können nicht gelöscht werden'
                              : 'Eintrag löschen'
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
