import {
  Bell,
  BellRing,
  Calendar as CalendarIcon,
  Car,
  CheckSquare,
  Compass,
  Download,
  FilePlus2,
  FileText,
  LocateFixed,
  MapPin,
  Nfc,
  Pause,
  Pencil,
  Play,
  Plus,
  Settings,
  Square,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ActiveTimer,
  CalendarAppointment,
  CompanyProfile,
  Customer,
  Invoice,
  LocationSnapshot,
  NfcTask,
  Product,
  TaxRate,
  TimeEntry,
} from '../types';
import { captureCurrentLocation, computeTravelFromBase } from '../utils/geolocation';
import type { NativeNotificationStatus } from '../utils/taktwerkNative';
import { downloadOrShareTextFile, timeEntriesToCsv } from '../utils/exportBackup';
import {
  createId,
  formatCurrency,
  formatDateTimeDE,
  formatDuration,
  formatHoursShort,
  formatNumber,
  isInvoiceOverdue,
  toInputDate,
  toInputTime,
} from '../utils/format';
import { downloadTimesheetPdf } from '../utils/pdfInvoice';
import { ThemedSelect } from './ThemedSelect';

interface TimeTrackerViewProps {
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  nfcTasks: NfcTask[];
  timeEntries: TimeEntry[];
  invoices?: Invoice[];
  calendarEvents?: CalendarAppointment[];
  activeTimer: ActiveTimer | null;
  elapsedSeconds: number;
  onStartTimer: (payload: {
    customerId: string;
    productId: string;
    title: string;
    notes: string;
    nfcTaskId?: string | null;
    source?: 'timer' | 'nfc' | 'geo';
    location?: LocationSnapshot | null;
    entryType?: 'project' | 'internal';
    internalCategory?: string;
  }) => void;
  onUpdateActiveTimerNotes?: (notes: string) => void;
  onUpdateActiveTimerLocation?: (location: LocationSnapshot | null) => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onStopTimer: () => void;
  onDiscardTimer: () => void;
  onAddManualEntry: (entry: TimeEntry) => void;
  onUpdateEntry: (entry: TimeEntry) => void;
  onDeleteEntry: (id: string) => void;
  onToggleBillable: (id: string) => void;
  onCreateInvoiceFromEntries: (customerId: string, entryIds: string[]) => void;
  onNavigate: (
    section: 'customers' | 'products' | 'nfc' | 'invoices' | 'calendar'
  ) => void;
  onNotify: (msg: string, isError?: boolean) => void;
  notificationStatus?: NativeNotificationStatus | null;
  onRequestNotificationPermission?: () => void;
  onOpenNotificationSettings?: () => void;
  onCheckGeoFenceNow?: () => void;
  checkingGeoFence?: boolean;
  geoFenceRuleCount?: number;
}

export function TimeTrackerView({
  company,
  customers,
  products,
  nfcTasks,
  timeEntries,
  invoices = [],
  calendarEvents = [],
  activeTimer,
  elapsedSeconds,
  onStartTimer,
  onUpdateActiveTimerNotes,
  onUpdateActiveTimerLocation,
  onPauseTimer,
  onResumeTimer,
  onStopTimer,
  onDiscardTimer,
  onAddManualEntry,
  onUpdateEntry,
  onDeleteEntry,
  onToggleBillable,
  onCreateInvoiceFromEntries,
  onNavigate,
  onNotify,
  notificationStatus,
  onRequestNotificationPermission,
  onOpenNotificationSettings,
  onCheckGeoFenceNow,
  checkingGeoFence = false,
  geoFenceRuleCount = 0,
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
  const [draftLocation, setDraftLocation] = useState<LocationSnapshot | null>(null);
  const [locating, setLocating] = useState(false);

  const [liveNotes, setLiveNotes] = useState(activeTimer?.notes ?? '');
  useEffect(() => {
    setLiveNotes(activeTimer?.notes ?? '');
  }, [activeTimer?.id, activeTimer?.notes]);

  const [startMode, setStartMode] = useState<'project' | 'internal'>('project');
  const [internalCategory, setInternalCategory] = useState<string>(
    company.internalCategories?.[0] ?? 'Kundenakquise'
  );

  const [showManualForm, setShowManualForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [manualEntryType, setManualEntryType] = useState<'project' | 'internal'>('project');
  const [manualInternalCat, setManualInternalCat] = useState<string>(
    company.internalCategories?.[0] ?? 'Kundenakquise'
  );
  const [manualDate, setManualDate] = useState(toInputDate());
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('11:00');
  const [manualTitle, setManualTitle] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualCustomerId, setManualCustomerId] = useState(customers[0]?.id ?? '');
  const [manualProductId, setManualProductId] = useState(
    serviceProducts[0]?.id ?? products[0]?.id ?? ''
  );
  const [manualBillable, setManualBillable] = useState(true);
  const [manualError, setManualError] = useState('');

  const [filterCustomerId, setFilterCustomerId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'billed'>('all');
  const [filterActivityType, setFilterActivityType] = useState<'all' | 'project' | 'internal'>('all');
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
        if (filterActivityType === 'project' && (entry.entryType === 'internal' || !entry.customerId)) {
          return false;
        }
        if (filterActivityType === 'internal' && entry.entryType !== 'internal' && entry.customerId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [timeEntries, filterCustomerId, filterStatus, filterActivityType]);

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

  const todayTotalSeconds = useMemo(() => {
    const todayStr = toInputDate();
    const booked = timeEntries
      .filter((e) => e.startTime.slice(0, 10) === todayStr)
      .reduce((acc, e) => acc + e.durationSeconds, 0);
    return booked + (activeTimer ? elapsedSeconds : 0);
  }, [timeEntries, activeTimer, elapsedSeconds]);

  const overdueInvoicesCount = useMemo(
    () => invoices.filter((inv) => isInvoiceOverdue(inv)).length,
    [invoices]
  );

  const nextAppointment = useMemo(() => {
    const nowMs = Date.now() - 15 * 60 * 1000;
    return [...calendarEvents]
      .filter((ev) => new Date(ev.startTime).getTime() >= nowMs)
      .sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      )[0];
  }, [calendarEvents]);

  const handleCaptureLocationForStart = async () => {
    setLocating(true);
    try {
      const snap = await captureCurrentLocation();
      setDraftLocation(snap);
      onNotify(`Standort erfasst: ${snap.address || 'Koordinaten gespeichert'}`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Standort konnte nicht ermittelt werden.',
        true
      );
    } finally {
      setLocating(false);
    }
  };

  const handleCaptureLocationForActive = async () => {
    if (!onUpdateActiveTimerLocation) return;
    setLocating(true);
    try {
      const snap = await captureCurrentLocation();
      onUpdateActiveTimerLocation(snap);
      onNotify(`Standort zur laufenden Aufgabe gespeichert: ${snap.address || ''}`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Standort konnte nicht ermittelt werden.',
        true
      );
    } finally {
      setLocating(false);
    }
  };

  const handleStartClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (startMode === 'internal') {
      const cat = internalCategory.trim() || 'Sonstiges';
      onStartTimer({
        customerId: '',
        productId: '',
        title: title.trim() || cat,
        notes: notes.trim(),
        source: 'timer',
        location: draftLocation,
        entryType: 'internal',
        internalCategory: cat,
      });
      setTitle('');
      setNotes('');
      setDraftLocation(null);
      return;
    }

    if (!effectiveCustomerId || !effectiveProductId) return;
    const prod = productMap.get(effectiveProductId);
    onStartTimer({
      customerId: effectiveCustomerId,
      productId: effectiveProductId,
      title: title.trim() || prod?.name || 'Arbeitszeit',
      notes: notes.trim(),
      source: 'timer',
      location: draftLocation,
      entryType: 'project',
    });
    setTitle('');
    setNotes('');
    setDraftLocation(null);
  };

  const openCreateManualForm = () => {
    setEditingEntry(null);
    setManualEntryType('project');
    setManualInternalCat(company.internalCategories?.[0] ?? 'Kundenakquise');
    setManualDate(toInputDate());
    setManualStart('09:00');
    setManualEnd('11:00');
    setManualTitle('');
    setManualNotes('');
    setManualCustomerId(customers[0]?.id ?? '');
    setManualProductId(serviceProducts[0]?.id ?? products[0]?.id ?? '');
    setManualBillable(true);
    setManualError('');
    setShowManualForm(true);
  };

  const openEditEntryForm = (entry: TimeEntry) => {
    setEditingEntry(entry);
    const isInt = entry.entryType === 'internal' || !entry.customerId;
    setManualEntryType(isInt ? 'internal' : 'project');
    setManualInternalCat(entry.internalCategory || company.internalCategories?.[0] || 'Kundenakquise');
    setManualDate(toInputDate(new Date(entry.startTime)));
    setManualStart(toInputTime(entry.startTime));
    setManualEnd(toInputTime(entry.endTime));
    setManualTitle(entry.title);
    setManualNotes(entry.notes);
    setManualCustomerId(entry.customerId);
    setManualProductId(entry.productId);
    setManualBillable(entry.billable);
    setManualError('');
    setShowManualForm(true);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError('');

    const isInt = manualEntryType === 'internal';
    if (!isInt && (!effectiveManualCustomerId || !effectiveManualProductId)) {
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

    const prod = isInt ? undefined : productMap.get(effectiveManualProductId);

    if (editingEntry) {
      const productChanged = !isInt && editingEntry.productId !== effectiveManualProductId;
      const updated: TimeEntry = {
        ...editingEntry,
        entryType: isInt ? 'internal' : 'project',
        internalCategory: isInt ? manualInternalCat : undefined,
        customerId: isInt ? '' : effectiveManualCustomerId,
        productId: isInt ? '' : effectiveManualProductId,
        title: manualTitle.trim() || (isInt ? manualInternalCat : (prod?.name || 'Arbeitszeit')),
        notes: manualNotes.trim(),
        startTime: startIso.toISOString(),
        endTime: endIso.toISOString(),
        durationSeconds: diffSec,
        hourlyRateNet: isInt
          ? 0
          : productChanged
            ? prod?.unitPriceNet ?? editingEntry.hourlyRateNet
            : editingEntry.hourlyRateNet,
        taxRate: isInt
          ? 19
          : productChanged
            ? ((prod?.taxRate ?? editingEntry.taxRate) as TaxRate)
            : editingEntry.taxRate,
        billable: isInt ? false : manualBillable,
      };
      onUpdateEntry(updated);
    } else {
      const entry: TimeEntry = {
        id: createId('time'),
        entryType: isInt ? 'internal' : 'project',
        internalCategory: isInt ? manualInternalCat : undefined,
        customerId: isInt ? '' : effectiveManualCustomerId,
        productId: isInt ? '' : effectiveManualProductId,
        nfcTaskId: null,
        title: manualTitle.trim() || (isInt ? manualInternalCat : (prod?.name || 'Manuelle Buchung')),
        notes: manualNotes.trim(),
        startTime: startIso.toISOString(),
        endTime: endIso.toISOString(),
        durationSeconds: diffSec,
        hourlyRateNet: isInt ? 0 : (prod?.unitPriceNet ?? 0),
        taxRate: (prod?.taxRate ?? 19) as TaxRate,
        billable: isInt ? false : manualBillable,
        billedInvoiceId: null,
        source: 'manual',
        createdAt: new Date().toISOString(),
      };
      onAddManualEntry(entry);
    }

    setEditingEntry(null);
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

  const handleExportCsv = async () => {
    const target = selectedEntries.length > 0 ? selectedEntries : filteredEntries;
    if (target.length === 0) {
      onNotify('Keine Zeiteinträge für den Export vorhanden.', true);
      return;
    }
    try {
      const csv = timeEntriesToCsv(target, customers, products);
      await downloadOrShareTextFile(
        `taktwerk-zeiten-${toInputDate()}.csv`,
        csv,
        'text/csv'
      );
      onNotify('Zeiten als CSV-Datei exportiert.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'CSV-Export fehlgeschlagen.',
        true
      );
    }
  };

  const handleExportTimesheetPdf = async () => {
    const target = selectedEntries.length > 0 ? selectedEntries : filteredEntries;
    if (target.length === 0) {
      onNotify('Keine Zeiteinträge für den Stundennachweis vorhanden.', true);
      return;
    }
    const custIds = Array.from(new Set(target.map((e) => e.customerId)));
    const customer = custIds.length === 1 ? customerMap.get(custIds[0]) : undefined;
    try {
      await downloadTimesheetPdf(
        'Stundennachweis / Tätigkeitsbericht',
        `Stundennachweis-${toInputDate()}.pdf`,
        customer,
        target,
        company,
        customer
          ? `Kunde: ${customer.companyName}`
          : `${target.length} Zeiteinträge`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Stundennachweis konnte nicht erstellt werden.',
        true
      );
    }
  };

  const missingMasterData = customers.length === 0 || products.length === 0;
  const internalCategoryOptions =
    company.internalCategories && company.internalCategories.length > 0
      ? company.internalCategories
      : [
          'Kundenakquise',
          'Studio-Reinigung & Pflege',
          'Buchhaltung & Administration',
          'Weiterbildung',
          'Marketing & Social Media',
          'Werkstatt & Materialpflege',
          'Sonstiges',
        ];
  const isActiveInternal =
    activeTimer?.entryType === 'internal' || (activeTimer ? !activeTimer.customerId : false);

  return (
    <div className="space-y-6">
      {/* Page Header + KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Zeiterfassung
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kundenaufträge und interne Tätigkeiten live erfassen, nachtragen und auswerten.
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
            onClick={() => {
              if (showManualForm && !editingEntry) {
                setShowManualForm(false);
              } else {
                openCreateManualForm();
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#211936] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Zeit nachtragen
          </button>
        </div>
      </div>

      {/* Manual / Edit Time Entry Form (right beneath header button when toggled) */}
      {showManualForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingEntry ? 'Zeiteintrag bearbeiten' : 'Arbeitszeit manuell nachtragen'}
              </h2>
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
                <button
                  type="button"
                  onClick={() => {
                    setManualEntryType('project');
                    setManualBillable(true);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    manualEntryType === 'project'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  Kundenauftrag
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setManualEntryType('internal');
                    setManualBillable(false);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    manualEntryType === 'internal'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  Interne Tätigkeit (ohne Kunde)
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowManualForm(false);
                setEditingEntry(null);
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
            >
              Schließen
            </button>
          </div>
          <form onSubmit={handleManualSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-6">
            {manualEntryType === 'internal' ? (
              <div className="md:col-span-4">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Interne Kategorie (ohne Kunden &amp; ohne Rechnung)
                </label>
                <ThemedSelect
                  value={manualInternalCat}
                  onChange={setManualInternalCat}
                  ariaLabel="Interne Kategorie"
                  options={internalCategoryOptions.map((cat) => ({
                    value: cat,
                    label: cat,
                  }))}
                />
              </div>
            ) : (
              <>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kunde
                  </label>
                  <ThemedSelect
                    value={effectiveManualCustomerId}
                    onChange={setManualCustomerId}
                    disabled={customers.length === 0}
                    options={customers.map((c) => ({
                      value: c.id,
                      label: c.companyName,
                      hint: c.customerNumber,
                    }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Leistung
                  </label>
                  <ThemedSelect
                    value={effectiveManualProductId}
                    onChange={setManualProductId}
                    disabled={products.length === 0}
                    options={products.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${formatCurrency(p.unitPriceNet)})`,
                    }))}
                  />
                </div>
              </>
            )}
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
                placeholder={
                  manualEntryType === 'internal'
                    ? 'z. B. Studio reinigen, Kaltakquise, Belege sortieren...'
                    : 'z. B. Kundenworkshop & Dokumentation'
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {manualEntryType === 'internal'
                  ? 'Notiz zur internen Aufgabe (optional)'
                  : 'Notiz für Auswertung / Rechnung (optional)'}
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
            <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-6">
              {manualEntryType === 'internal' ? (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  Interne Aufgaben sind nicht abrechenbar und erscheinen in Auswertungen &amp; PDF-Berichten.
                </span>
              ) : (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualBillable}
                    onChange={(e) => setManualBillable(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                  />
                  Abrechenbar (für Rechnungen verfügbar)
                </label>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowManualForm(false);
                    setEditingEntry(null);
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  {editingEntry ? 'Änderungen speichern' : 'Eintrag speichern'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {/* Dominant Chronometer / Start-Aufgabe Section (directly under header / Zeit nachtragen) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
        {activeTimer ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-blue-700 dark:text-violet-400">
                  <span>
                    {activeTimer.pausedAt
                      ? 'Timer pausiert'
                      : isActiveInternal
                        ? 'Interne Aufgabe läuft'
                        : activeTimer.source === 'nfc'
                          ? 'Gestartet per NFC-Tag'
                          : activeTimer.source === 'geo'
                            ? 'Gestartet per Ortsregel'
                            : 'Timer läuft'}
                  </span>
                  <span aria-hidden="true">·</span>
                  {isActiveInternal ? (
                    <>
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        {activeTimer.internalCategory || 'Interne Tätigkeit'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        Nicht verrechenbar
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-600 dark:text-slate-300">
                        {customerMap.get(activeTimer.customerId)?.companyName ?? 'Kunde'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {productMap.get(activeTimer.productId)?.name ?? 'Leistung'}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                    {activeTimer.title}
                  </h2>
                  {isActiveInternal && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      Intern
                    </span>
                  )}
                  {notificationStatus?.enabled && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-800 dark:bg-[#231b3b] dark:text-violet-300">
                      <Bell className="h-3 w-3 text-violet-500" />
                      Statusleiste aktiv
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    Gestartet am {formatDateTimeDE(activeTimer.startTime)}
                    {!isActiveInternal && (
                      <>
                        {' · '}
                        <span className="font-mono tabular-nums">
                          {formatCurrency(activeTimer.hourlyRateNet)}/Std.
                        </span>
                      </>
                    )}
                  </span>
                  {activeTimer.location && (
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                      <MapPin className="h-3.5 w-3.5" />
                      {activeTimer.location.address ||
                        `${activeTimer.location.lat.toFixed(4)}, ${activeTimer.location.lng.toFixed(4)}`}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`rounded-lg border px-5 py-3 font-mono text-3xl font-bold tracking-tight tabular-nums ${
                    activeTimer.pausedAt
                      ? 'border-amber-300 bg-amber-950/80 text-amber-200 dark:border-amber-700'
                      : 'border-slate-200 bg-slate-900 text-white dark:border-[#3b2d5e] dark:bg-[#0e0a18]'
                  }`}
                >
                  {formatDuration(elapsedSeconds)}
                </div>
                {activeTimer.pausedAt ? (
                  <button
                    type="button"
                    onClick={onResumeTimer}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-950 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Fortsetzen
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPauseTimer}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Pause className="h-4 w-4" />
                    Pausieren
                  </button>
                )}
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

            {/* Live Notes & GPS Capture while timer is running */}
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 dark:border-[#2e2349] lg:grid-cols-12">
              <div className="lg:col-span-9">
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <StickyNote className="h-3.5 w-3.5 text-violet-500" />
                  {isActiveInternal
                    ? 'Notizen während der laufenden internen Aufgabe'
                    : 'Notizen während der laufenden Aufgabe (optional auf Rechnung ausgebbar)'}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <textarea
                    rows={2}
                    value={liveNotes}
                    onChange={(e) => setLiveNotes(e.target.value)}
                    onBlur={() => {
                      if (
                        onUpdateActiveTimerNotes &&
                        liveNotes.trim() !== (activeTimer.notes ?? '').trim()
                      ) {
                        onUpdateActiveTimerNotes(liveNotes.trim());
                      }
                    }}
                    placeholder="Zwischenstand, verwendetes Material oder Hinweis festhalten..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                  />
                  {onUpdateActiveTimerNotes &&
                    liveNotes.trim() !== (activeTimer.notes ?? '').trim() && (
                      <button
                        type="button"
                        onClick={() => onUpdateActiveTimerNotes(liveNotes.trim())}
                        className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 self-end cursor-pointer"
                      >
                        Notiz sichern
                      </button>
                    )}
                </div>
              </div>
              <div className="flex flex-col justify-end lg:col-span-3">
                <button
                  type="button"
                  onClick={() => void handleCaptureLocationForActive()}
                  disabled={locating}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <LocateFixed className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`} />
                  {locating
                    ? 'Ermittle GPS...'
                    : activeTimer.location
                      ? 'Standort aktualisieren'
                      : 'Standort erfassen (GPS)'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartClick} className="space-y-3.5">
            {/* Mode Switcher: Kundenauftrag vs. Interne Tätigkeit */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
                <button
                  type="button"
                  onClick={() => setStartMode('project')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    startMode === 'project'
                      ? 'ui-accent-active text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  Kundenauftrag
                </button>
                <button
                  type="button"
                  onClick={() => setStartMode('internal')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    startMode === 'internal'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  Interne Tätigkeit (ohne Kunde)
                </button>
              </div>
              {startMode === 'internal' && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  Ohne Kunden &amp; ohne Rechnung · z. B. Kundenakquise oder Studio-Reinigung
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {startMode === 'internal' ? (
                <div className="lg:col-span-5">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kategorie (Interne Arbeit)
                  </label>
                  <ThemedSelect
                    value={internalCategory}
                    onChange={setInternalCategory}
                    ariaLabel="Interne Kategorie wählen"
                    options={internalCategoryOptions.map((cat) => ({
                      value: cat,
                      label: cat,
                    }))}
                  />
                </div>
              ) : (
                <>
                  <div className="lg:col-span-3">
                    <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Kunde
                    </label>
                    <ThemedSelect
                      value={effectiveCustomerId}
                      onChange={setCustomerId}
                      disabled={customers.length === 0}
                      options={customers.map((c) => ({
                        value: c.id,
                        label: c.companyName,
                        hint: c.customerNumber,
                      }))}
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Leistung / Produkt
                    </label>
                    <ThemedSelect
                      value={effectiveProductId}
                      onChange={setProductId}
                      disabled={products.length === 0}
                      options={products.map((p) => ({
                        value: p.id,
                        label: `${p.name} (${formatCurrency(p.unitPriceNet)}/${p.unit})`,
                        hint: p.sku,
                      }))}
                    />
                  </div>
                </>
              )}

              <div className={startMode === 'internal' ? 'lg:col-span-5' : 'lg:col-span-4'}>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Aufgabe / Tätigkeit
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    startMode === 'internal'
                      ? `z. B. ${internalCategory} — Details (optional)...`
                      : 'z. B. Serverwartung oder API-Anbindung...'
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-500"
                />
              </div>

              <div className="flex items-end lg:col-span-2">
                <button
                  type="submit"
                  disabled={startMode === 'project' && missingMasterData}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer ${
                    startMode === 'internal'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'ui-accent-active'
                  }`}
                >
                  <Play className="h-4 w-4 fill-current" />
                  Timer starten
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Startnotiz (optional — kann auch während der Aufgabe bearbeitet werden)..."
                className="min-w-0 w-full flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936]/70 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void handleCaptureLocationForStart()}
                disabled={locating}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                  draftLocation
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045]'
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {locating
                    ? 'Ermittle Ort...'
                    : draftLocation
                      ? draftLocation.address || 'Ort erfasst'
                      : company.autoCaptureLocation
                        ? 'Auto-Ortung aktiv (manuell prüfen)'
                        : 'Standort beim Start erfassen'}
                </span>
              </button>
              {onCheckGeoFenceNow &&
                (company.autoLocationStartEnabled || geoFenceRuleCount > 0) && (
                  <button
                    type="button"
                    onClick={onCheckGeoFenceNow}
                    disabled={checkingGeoFence}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Compass
                      className={`h-3.5 w-3.5 ${checkingGeoFence ? 'animate-spin' : ''}`}
                    />
                    {checkingGeoFence ? 'Prüfe Ortsregeln...' : 'Ortsregeln prüfen'}
                  </button>
                )}
            </div>
          </form>
        )}

        {/* Quick-Start Widgets (NFC tasks + quick internal shortcuts) */}
        {!activeTimer && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-[#2e2349]">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Nfc className="h-3.5 w-3.5 text-violet-400" />
              Schnellstart:
            </span>
            {nfcTasks.length > 0
              ? nfcTasks.slice(0, 3).map((task) => (
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
                        entryType: 'project',
                      })
                    }
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:border-violet-500 dark:hover:bg-[#2c2147] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ▶ {task.title}
                  </button>
                ))
              : customers.length > 0 &&
                serviceProducts.slice(0, 2).map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() =>
                      onStartTimer({
                        customerId: effectiveCustomerId,
                        productId: prod.id,
                        title: prod.name,
                        notes: '',
                        source: 'timer',
                        entryType: 'project',
                      })
                    }
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:border-violet-500 dark:hover:bg-[#2c2147] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ▶ {prod.name}
                  </button>
                ))}
            {internalCategoryOptions.slice(0, 2).map((cat) => (
              <button
                key={`quick-int-${cat}`}
                type="button"
                onClick={() =>
                  onStartTimer({
                    customerId: '',
                    productId: '',
                    title: cat,
                    notes: '',
                    source: 'timer',
                    entryType: 'internal',
                    internalCategory: cat,
                  })
                }
                className="rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-100 dark:border-amber-700/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 whitespace-nowrap shrink-0 cursor-pointer"
              >
                ▶ Intern: {cat}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onNavigate('nfc')}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-violet-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              NFC-Tags verwalten
            </button>
          </div>
        )}
      </section>

      {/* Overview Widgets Bar (positioned beneath the task start box) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Widget 1: Tagesfortschritt */}
        {(() => {
          const goalHours = Math.max(1, company.dailyGoalHours ?? 8);
          const todayHours = todayTotalSeconds / 3600;
          const pct = Math.min(100, Math.round((todayHours / goalHours) * 100));
          return (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-[#2e2349] dark:bg-[#171126]">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium">Tagesziel ({goalHours} Std.)</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-violet-300">
                  {pct} %
                </span>
              </div>
              <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatHoursShort(todayTotalSeconds)}
              </div>
              <progress
                value={Math.min(todayHours, goalHours)}
                max={goalHours}
                className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 accent-blue-700 dark:bg-[#211936] dark:accent-violet-500 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-slate-100 dark:[&::-webkit-progress-bar]:bg-[#211936] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-blue-700 dark:[&::-webkit-progress-value]:bg-violet-500"
              />
            </div>
          );
        })()}

        {/* Widget 2: Abrechnung & Überfällig */}
        <button
          type="button"
          onClick={() => onNavigate('invoices')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-400 hover:bg-slate-50/70 dark:border-[#2e2349] dark:bg-[#171126] dark:hover:border-violet-500 dark:hover:bg-[#211936]/50 cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">Abrechnungs-Widget</span>
            <FileText className="h-3.5 w-3.5 text-blue-700 dark:text-violet-400" />
          </div>
          <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCurrency(unbilledTotalNet)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {overdueInvoicesCount > 0 ? (
              <span className="font-semibold text-red-600 dark:text-red-400">
                {overdueInvoicesCount} überfällige Rechnung(en) →
              </span>
            ) : (
              <span>Offen zum Abrechnen · Rechnungen öffnen →</span>
            )}
          </div>
        </button>

        {/* Widget 3: Nächster Termin */}
        <button
          type="button"
          onClick={() => onNavigate('calendar')}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-400 hover:bg-slate-50/70 dark:border-[#2e2349] dark:bg-[#171126] dark:hover:border-violet-500 dark:hover:bg-[#211936]/50 cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">Nächster Termin</span>
            <CalendarIcon className="h-3.5 w-3.5 text-blue-700 dark:text-violet-400" />
          </div>
          {nextAppointment ? (
            <>
              <div className="mt-1.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {nextAppointment.title}
              </div>
              <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                {formatDateTimeDE(nextAppointment.startTime)}
              </div>
            </>
          ) : (
            <>
              <div className="mt-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                Keine anstehenden Termine
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Kalender &amp; Nextcloud öffnen →
              </div>
            </>
          )}
        </button>
      </div>

      {/* Onboarding hint if customers or products are missing */}
      {missingMasterData && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Für Kundenaufträge werden mindestens ein Kunde und eine Leistung benötigt. Interne Tätigkeiten (z. B. Kundenakquise oder Studio-Reinigung) kannst du bereits sofort erfassen.
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

      {/* Android Status Bar Notification Banner if permission required / blocked */}
      {notificationStatus && !notificationStatus.enabled && (
        <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50/80 p-4 text-sm text-violet-950 dark:border-violet-900/60 dark:bg-[#1f1738] dark:text-violet-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                Statusleisten-Timer auf deinem Smartphone aktivieren
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Damit der Timer ganz oben in der Benachrichtigungsleiste und auf dem Sperrbildschirm mit Pausieren/Stoppen-Tasten sichtbar bleibt, benötigt TaktWerk die Benachrichtigungsberechtigung.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {notificationStatus.status === 'PERMISSION_REQUIRED' && onRequestNotificationPermission && (
              <button
                type="button"
                onClick={onRequestNotificationPermission}
                className="rounded-lg bg-violet-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap cursor-pointer"
              >
                Benachrichtigung erlauben
              </button>
            )}
            {(notificationStatus.status === 'PERMISSION_DENIED' ||
              notificationStatus.status === 'CHANNEL_DISABLED') &&
              onOpenNotificationSettings && (
                <button
                  type="button"
                  onClick={onOpenNotificationSettings}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-violet-900 transition-colors hover:bg-violet-100 dark:border-violet-800 dark:bg-[#281e46] dark:text-violet-200 whitespace-nowrap cursor-pointer"
                >
                  <Settings className="h-3.5 w-3.5" />
                  In Android-Einstellungen aktivieren
                </button>
              )}
          </div>
        </div>
      )}

      {/* Filter Bar + Batch Invoice Action */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <ThemedSelect
              size="sm"
              className="w-44"
              value={filterActivityType}
              onChange={(val) =>
                setFilterActivityType(val as 'all' | 'project' | 'internal')
              }
              ariaLabel="Tätigkeitstyp filtern"
              options={[
                { value: 'all', label: 'Alle Tätigkeiten' },
                { value: 'project', label: 'Kundenaufträge' },
                { value: 'internal', label: 'Interne Arbeiten' },
              ]}
            />

            <ThemedSelect
              size="sm"
              className="w-52"
              value={filterCustomerId}
              onChange={setFilterCustomerId}
              options={[
                { value: 'all', label: 'Alle Kunden' },
                ...customers.map((c) => ({ value: c.id, label: c.companyName })),
              ]}
            />

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

          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-mono font-semibold tabular-nums">{selectedIds.length}</span>{' '}
                  ausgewählt
                </span>
                {selectedCustomerIds.length > 1 ? (
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    Für Rechnung nur 1 Kunden wählen.
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleBatchInvoice}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    Rechnung erstellen
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleExportTimesheetPdf()}
              title="Stundennachweis / Tätigkeitsbericht als PDF"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              Stundennachweis
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              title="Zeiten als CSV (Excel) exportieren"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>
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
                  <th className="px-4 py-3">Aufgabe &amp; Zuordnung</th>
                  <th className="px-4 py-3">Zeitraum</th>
                  <th className="px-4 py-3 text-right">Dauer</th>
                  <th className="px-4 py-3 text-right">Nettowert</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filteredEntries.map((entry) => {
                  const isInternal = entry.entryType === 'internal' || !entry.customerId;
                  const customer = !isInternal ? customerMap.get(entry.customerId) : undefined;
                  const product = !isInternal ? productMap.get(entry.productId) : undefined;
                  const netValue = isInternal
                    ? 0
                    : (entry.durationSeconds / 3600) * entry.hourlyRateNet;
                  const canSelect = !isInternal && entry.billable && !entry.billedInvoiceId;
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
                        <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                          <span>{entry.title}</span>
                          {isInternal && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                              Intern
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          {isInternal ? (
                            <>
                              <span className="text-amber-700 dark:text-amber-300">
                                {entry.internalCategory || 'Interne Tätigkeit'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>Kein Kunde / ohne Rechnung</span>
                            </>
                          ) : (
                            <>
                              <span>{customer?.companyName ?? 'Unbekannter Kunde'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{product?.name ?? 'Leistung'}</span>
                            </>
                          )}
                          {entry.source === 'nfc' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-blue-700 dark:text-violet-400">NFC</span>
                            </>
                          )}
                          {entry.source === 'geo' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-700 dark:text-emerald-400">
                                Ortsregel
                              </span>
                            </>
                          )}
                        </div>
                        {entry.notes && (
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {entry.notes}
                          </div>
                        )}
                        {entry.location && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span>
                                {entry.location.address ||
                                  `${entry.location.lat.toFixed(4)}, ${entry.location.lng.toFixed(4)}`}
                              </span>
                            </span>
                            {typeof entry.travelDistanceKm === 'number' &&
                              entry.travelDistanceKm > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                                  <Car className="h-3 w-3 shrink-0" />
                                  {formatNumber(entry.travelDistanceKm, 1)} km ·{' '}
                                  {formatCurrency(entry.travelCostNet ?? 0)}
                                </span>
                              )}
                            {company.homeBaseLocation &&
                              entry.travelDistanceKm === undefined &&
                              !entry.billedInvoiceId &&
                              !isInternal && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!company.homeBaseLocation || !entry.location) return;
                                    const calc = computeTravelFromBase(
                                      company.homeBaseLocation,
                                      entry.location,
                                      company.travelRatePerKm ?? 0.3,
                                      company.travelRoundTripDefault ?? true
                                    );
                                    onUpdateEntry({
                                      ...entry,
                                      travelDistanceKm: calc.distanceKm,
                                      travelCostNet: calc.costNet,
                                    });
                                    onNotify(
                                      `Fahrtkosten berechnet: ${formatNumber(calc.distanceKm, 1)} km (${formatCurrency(calc.costNet)})`
                                    );
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50/70 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 cursor-pointer"
                                >
                                  <Car className="h-3 w-3" />
                                  Fahrtkosten berechnen
                                </button>
                              )}
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
                        {!isInternal && entry.billable ? formatCurrency(netValue) : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isInternal ? (
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                            Intern (ohne Ertrag)
                          </span>
                        ) : entry.billedInvoiceId ? (
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
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditEntryForm(entry)}
                            disabled={Boolean(entry.billedInvoiceId)}
                            title={
                              entry.billedInvoiceId
                                ? 'Abgerechnete Einträge können nicht bearbeitet werden'
                                : 'Eintrag bearbeiten'
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-[#231b38] dark:hover:text-slate-100 cursor-pointer"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
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
                        </div>
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
