import {
  AlertTriangle,
  Bell,
  BellRing,
  Calendar as CalendarIcon,
  Camera,
  Car,
  CheckSquare,
  Coffee,
  Compass,
  Download,
  FilePlus2,
  FileText,
  Gauge,
  Layers,
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
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  WorkPhoto,
} from '../types';
import { computeCustomerBudgetStatus } from '../utils/budgetHelpers';
import { captureCurrentLocation, computeTravelFromBase } from '../utils/geolocation';
import {
  compressWorkPhotoFile,
  uploadWorkPhotoToNextcloud,
} from '../utils/photoHelpers';
import type { NativeNotificationStatus } from '../utils/taktwerkNative';
import { downloadOrShareTextFile, timeEntriesToCsv } from '../utils/exportBackup';
import {
  createId,
  formatCurrency,
  formatDateTimeDE,
  formatDuration,
  formatHoursShort,
  formatNumber,
  getActiveTimerDaySeconds,
  getActiveTimerElapsedMs,
  getEntryDaySlices,
  isInvoiceOverdue,
  toInputDate,
  toInputTime,
} from '../utils/format';
import { downloadTimesheetPdf } from '../utils/pdfInvoice';
import { InfoHintPopup } from './InfoHintPopup';
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
  pausedTimers?: ActiveTimer[];
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
  onUpdateActiveTimerPhotos?: (photos: WorkPhoto[]) => void;
  onDeductBreakMinutes?: (minutes: number) => void;
  nextcloudConfigured?: boolean;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onParkActiveTimer?: () => void;
  onResumePausedTimer?: (pausedId: string) => void;
  onStopPausedTimer?: (pausedId: string) => void;
  onDiscardPausedTimer?: (pausedId: string) => void;
  onStopTimer: () => void;
  onDiscardTimer: () => void;
  onTriggerNfcTag?: (tagUid: string) => void;
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
  pausedTimers = [],
  elapsedSeconds,
  onStartTimer,
  onUpdateActiveTimerNotes,
  onUpdateActiveTimerLocation,
  onUpdateActiveTimerPhotos,
  onDeductBreakMinutes,
  nextcloudConfigured = false,
  onPauseTimer,
  onResumeTimer,
  onParkActiveTimer,
  onResumePausedTimer,
  onStopPausedTimer,
  onDiscardPausedTimer,
  onStopTimer,
  onDiscardTimer,
  onTriggerNfcTag,
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
  const [editingOriginalTimes, setEditingOriginalTimes] = useState<{
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [manualEntryType, setManualEntryType] = useState<'project' | 'internal'>('project');
  const [manualInternalCat, setManualInternalCat] = useState<string>(
    company.internalCategories?.[0] ?? 'Kundenakquise'
  );
  const [manualDate, setManualDate] = useState(toInputDate());
  const [manualEndDate, setManualEndDate] = useState(toInputDate());
  const [manualStart, setManualStart] = useState('09:00');
  const [manualEnd, setManualEnd] = useState('11:00');
  const [manualTitle, setManualTitle] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualCustomerId, setManualCustomerId] = useState(customers[0]?.id ?? '');
  const [manualProductId, setManualProductId] = useState(
    serviceProducts[0]?.id ?? products[0]?.id ?? ''
  );
  const [manualBillable, setManualBillable] = useState(true);
  const [manualPhotos, setManualPhotos] = useState<WorkPhoto[]>([]);
  const [manualError, setManualError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [lightboxData, setLightboxData] = useState<{
    title: string;
    photos: WorkPhoto[];
  } | null>(null);
  const activePhotoInputRef = useRef<HTMLInputElement>(null);
  const manualPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showManualForm || lightboxData) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowManualForm(false);
        setEditingEntry(null);
        setEditingOriginalTimes(null);
        setManualError('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showManualForm, lightboxData]);

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
        if (filterStatus === 'open' && Boolean(entry.billedInvoiceId)) {
          return false;
        }
        if (filterStatus === 'billed' && !entry.billedInvoiceId) {
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
      .sort(
        (a, b) =>
          new Date(b.endTime || b.startTime).getTime() -
          new Date(a.endTime || a.startTime).getTime()
      );
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
    void elapsedSeconds;
    const todayStr = toInputDate();
    const nowMs = Date.now();
    let booked = 0;
    for (const e of timeEntries) {
      for (const slice of getEntryDaySlices(e)) {
        if (slice.dateKey === todayStr) {
          booked += slice.durationSeconds;
        }
      }
    }
    const parked = pausedTimers.reduce(
      (acc, t) => acc + getActiveTimerDaySeconds(t, todayStr, nowMs),
      0
    );
    const activeToday = activeTimer
      ? getActiveTimerDaySeconds(activeTimer, todayStr, nowMs)
      : 0;
    return booked + parked + activeToday;
  }, [timeEntries, pausedTimers, activeTimer, elapsedSeconds]);

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

  const handleAddActivePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0 || !activeTimer || !onUpdateActiveTimerPhotos) return;
    setPhotoBusy(true);
    try {
      const existing = activeTimer.photos ?? [];
      const added: WorkPhoto[] = [];
      for (const file of files.slice(0, 6)) {
        const photo = await compressWorkPhotoFile(file);
        if (nextcloudConfigured) {
          try {
            photo.nextcloudPath = await uploadWorkPhotoToNextcloud(photo, activeTimer.title);
          } catch {
            // Keep photo locally even if upload fails
          }
        }
        added.push(photo);
      }
      onUpdateActiveTimerPhotos([...existing, ...added]);
      onNotify(
        added.length === 1
          ? 'Einsatzfoto gespeichert.'
          : `${added.length} Einsatzfotos gespeichert.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Foto konnte nicht verarbeitet werden.',
        true
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleAddManualPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setPhotoBusy(true);
    try {
      const taskName = manualTitle.trim() || 'Einsatz';
      const added: WorkPhoto[] = [];
      for (const file of files.slice(0, 6)) {
        const photo = await compressWorkPhotoFile(file);
        if (nextcloudConfigured) {
          try {
            photo.nextcloudPath = await uploadWorkPhotoToNextcloud(photo, taskName);
          } catch {
            // Keep local copy
          }
        }
        added.push(photo);
      }
      setManualPhotos((prev) => [...prev, ...added]);
      onNotify(`${added.length} Einsatzfoto(s) hinzugefügt.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Foto konnte nicht verarbeitet werden.',
        true
      );
    } finally {
      setPhotoBusy(false);
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

  const closeManualForm = () => {
    setShowManualForm(false);
    setEditingEntry(null);
    setEditingOriginalTimes(null);
    setManualError('');
  };

  const openCreateManualForm = () => {
    const today = toInputDate();
    setEditingEntry(null);
    setEditingOriginalTimes(null);
    setManualEntryType('project');
    setManualInternalCat(company.internalCategories?.[0] ?? 'Kundenakquise');
    setManualDate(today);
    setManualEndDate(today);
    setManualStart('09:00');
    setManualEnd('11:00');
    setManualTitle('');
    setManualNotes('');
    setManualCustomerId(customers[0]?.id ?? '');
    setManualProductId(serviceProducts[0]?.id ?? products[0]?.id ?? '');
    setManualBillable(true);
    setManualPhotos([]);
    setManualError('');
    setShowManualForm(true);
  };

  const openEditEntryForm = (entry: TimeEntry) => {
    const parsedStart = new Date(entry.startTime);
    const safeStart = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
    const parsedEnd = new Date(entry.endTime);
    const safeEnd = Number.isNaN(parsedEnd.getTime())
      ? new Date(safeStart.getTime() + Math.max(60, entry.durationSeconds || 60) * 1000)
      : parsedEnd;

    const startDateStr = toInputDate(safeStart);
    const endDateStr = toInputDate(safeEnd);
    const startTimeStr = toInputTime(safeStart.toISOString());
    const endTimeStr = toInputTime(safeEnd.toISOString());

    setEditingEntry(entry);
    setEditingOriginalTimes({
      startDate: startDateStr,
      endDate: endDateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
    });
    const isInt = entry.entryType === 'internal' || !entry.customerId;
    setManualEntryType(isInt ? 'internal' : 'project');
    setManualInternalCat(
      entry.internalCategory || company.internalCategories?.[0] || 'Kundenakquise'
    );
    setManualDate(startDateStr);
    setManualEndDate(endDateStr);
    setManualStart(startTimeStr);
    setManualEnd(endTimeStr);
    setManualTitle(entry.title ?? '');
    setManualNotes(entry.notes ?? '');
    setManualCustomerId(entry.customerId || customers[0]?.id || '');
    setManualProductId(
      entry.productId || serviceProducts[0]?.id || products[0]?.id || ''
    );
    setManualBillable(Boolean(entry.billable));
    setManualPhotos(entry.photos ?? []);
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

    let nextStartIsoStr = '';
    let nextEndIsoStr = '';
    let nextDurationSec = 0;

    const origSpanMs = editingOriginalTimes
      ? new Date(`${editingOriginalTimes.endDate}T00:00:00`).getTime() -
        new Date(`${editingOriginalTimes.startDate}T00:00:00`).getTime()
      : 0;
    const currSpanMs =
      new Date(`${(manualEndDate || manualDate)}T00:00:00`).getTime() -
      new Date(`${manualDate}T00:00:00`).getTime();

    const timesUntouched =
      Boolean(editingEntry && editingOriginalTimes) &&
      manualStart === editingOriginalTimes?.startTime &&
      manualEnd === editingOriginalTimes?.endTime &&
      !Number.isNaN(origSpanMs) &&
      !Number.isNaN(currSpanMs) &&
      currSpanMs === origSpanMs;

    if (editingEntry && editingOriginalTimes && timesUntouched) {
      if (
        manualDate === editingOriginalTimes.startDate &&
        manualEndDate === editingOriginalTimes.endDate
      ) {
        // Keep exact original timestamps (including seconds) and pause-adjusted duration
        nextStartIsoStr = editingEntry.startTime;
        nextEndIsoStr = editingEntry.endTime;
        nextDurationSec = editingEntry.durationSeconds;
      } else {
        const origStartDay = new Date(`${editingOriginalTimes.startDate}T00:00:00`);
        const newStartDay = new Date(`${manualDate}T00:00:00`);
        if (Number.isNaN(origStartDay.getTime()) || Number.isNaN(newStartDay.getTime())) {
          setManualError('Bitte ein gültiges Datum eingeben.');
          return;
        }
        const dayShiftMs = newStartDay.getTime() - origStartDay.getTime();
        const origStartMs = new Date(editingEntry.startTime).getTime();
        const origEndMs = new Date(editingEntry.endTime).getTime();
        if (Number.isNaN(origStartMs) || Number.isNaN(origEndMs)) {
          setManualError('Bitte gültige Start- und Endzeiten eingeben.');
          return;
        }
        nextStartIsoStr = new Date(origStartMs + dayShiftMs).toISOString();
        nextEndIsoStr = new Date(origEndMs + dayShiftMs).toISOString();
        nextDurationSec = editingEntry.durationSeconds;
      }
    } else {
      const effectiveEndDate = manualEndDate || manualDate;
      const startIso = new Date(`${manualDate}T${manualStart}:00`);
      const endIso = new Date(`${effectiveEndDate}T${manualEnd}:00`);
      if (Number.isNaN(startIso.getTime()) || Number.isNaN(endIso.getTime())) {
        setManualError('Bitte gültige Start- und Endzeiten eingeben.');
        return;
      }

      const diffSec = Math.floor((endIso.getTime() - startIso.getTime()) / 1000);
      if (diffSec <= 0) {
        setManualError('Die Endzeit muss nach der Startzeit liegen.');
        return;
      }
      nextStartIsoStr = startIso.toISOString();
      nextEndIsoStr = endIso.toISOString();
      nextDurationSec = diffSec;
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
        title: manualTitle.trim() || (isInt ? manualInternalCat : prod?.name || 'Arbeitszeit'),
        notes: manualNotes.trim(),
        startTime: nextStartIsoStr,
        endTime: nextEndIsoStr,
        durationSeconds: nextDurationSec,
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
        photos: manualPhotos.length > 0 ? manualPhotos : undefined,
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
        title:
          manualTitle.trim() || (isInt ? manualInternalCat : prod?.name || 'Manuelle Buchung'),
        notes: manualNotes.trim(),
        startTime: nextStartIsoStr,
        endTime: nextEndIsoStr,
        durationSeconds: nextDurationSec,
        hourlyRateNet: isInt ? 0 : prod?.unitPriceNet ?? 0,
        taxRate: (prod?.taxRate ?? 19) as TaxRate,
        billable: isInt ? false : manualBillable,
        billedInvoiceId: null,
        source: 'manual',
        photos: manualPhotos.length > 0 ? manualPhotos : undefined,
        createdAt: new Date().toISOString(),
      };
      onAddManualEntry(entry);
    }

    setEditingEntry(null);
    setEditingOriginalTimes(null);
    setManualTitle('');
    setManualNotes('');
    setManualPhotos([]);
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

  const activeCustomerBudget = useMemo(() => {
    if (!activeTimer || isActiveInternal) return null;
    const cust = customerMap.get(activeTimer.customerId);
    const st = computeCustomerBudgetStatus(cust, timeEntries, activeTimer);
    return st.hasBudget ? st : null;
  }, [activeTimer, customerMap, isActiveInternal, timeEntries]);

  const draftCustomerBudget = useMemo(() => {
    if (activeTimer || startMode === 'internal' || !effectiveCustomerId) return null;
    const cust = customerMap.get(effectiveCustomerId);
    const st = computeCustomerBudgetStatus(cust, timeEntries, null);
    return st.hasBudget ? st : null;
  }, [activeTimer, customerMap, effectiveCustomerId, startMode, timeEntries]);

  const breakAssistantEnabled = company.breakAssistantEnabled !== false;
  const breakTriggerHours = company.breakTriggerHours ?? 6;
  const breakDefaultMinutes = company.breakDefaultMinutes ?? 30;
  const overnightReminderHour = company.overnightReminderHour ?? 20;

  const showBreakAlert =
    Boolean(activeTimer) &&
    breakAssistantEnabled &&
    elapsedSeconds >= breakTriggerHours * 3600;

  const showOvernightAlert = useMemo(() => {
    if (!activeTimer || !breakAssistantEnabled) return false;
    const parsedStart = new Date(activeTimer.startTime);
    const startDateStr = Number.isNaN(parsedStart.getTime())
      ? activeTimer.startTime.slice(0, 10)
      : toInputDate(parsedStart);
    const todayStr = toInputDate();
    if (startDateStr < todayStr) return true;
    const nowHour = new Date().getHours();
    return nowHour >= overnightReminderHour && elapsedSeconds >= 3600;
  }, [activeTimer, breakAssistantEnabled, elapsedSeconds, overnightReminderHour]);

  return (
    <div className="space-y-6">
      {/* Page Header + KPI Summary */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Zeiterfassung
          </h1>
          <InfoHintPopup
            title="Zeiterfassung"
            text="Kundenaufträge und interne Tätigkeiten live erfassen, nachtragen, mit Standort oder NFC starten und direkt abrechnen."
          />
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
            onClick={openCreateManualForm}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#211936] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Zeit nachtragen
          </button>
        </div>
      </div>

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
                {onParkActiveTimer && (
                  <button
                    type="button"
                    onClick={onParkActiveTimer}
                    title="Aktiven Auftrag pausieren & parken, um eine andere Aufgabe zu starten"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Layers className="h-4 w-4" />
                    Parken &amp; Neu
                  </button>
                )}
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
              <div className="flex flex-col justify-end gap-2 lg:col-span-3">
                <button
                  type="button"
                  onClick={() => void handleCaptureLocationForActive()}
                  disabled={locating}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <LocateFixed className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`} />
                  {locating
                    ? 'Ermittle GPS...'
                    : activeTimer.location
                      ? 'Standort aktualisieren'
                      : 'Standort erfassen (GPS)'}
                </button>

                {onUpdateActiveTimerPhotos && (
                  <>
                    <input
                      ref={activePhotoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => void handleAddActivePhotos(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => activePhotoInputRef.current?.click()}
                      disabled={photoBusy}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] cursor-pointer"
                    >
                      <Camera className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      {photoBusy
                        ? 'Foto wird gespeichert…'
                        : `Einsatzfoto (${activeTimer.photos?.length ?? 0})`}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Active Timer Work Photos Strip */}
            {activeTimer.photos && activeTimer.photos.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-[#2e2349]">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Dokumentationsfotos dieser Aufgabe ({activeTimer.photos.length})
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {activeTimer.photos.map((p) => (
                    <div
                      key={p.id}
                      className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-1.5 dark:border-[#3b2d5e] dark:bg-[#211936]"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxData({
                            title: activeTimer.title,
                            photos: activeTimer.photos ?? [],
                          })
                        }
                        className="block w-full cursor-pointer"
                      >
                        <img
                          src={p.dataUrl}
                          alt={p.caption || 'Einsatzfoto'}
                          className="h-20 w-full rounded object-cover"
                        />
                      </button>
                      {onUpdateActiveTimerPhotos && (
                        <>
                          <input
                            type="text"
                            value={p.caption ?? ''}
                            onChange={(e) =>
                              onUpdateActiveTimerPhotos(
                                (activeTimer.photos ?? []).map((item) =>
                                  item.id === p.id ? { ...item, caption: e.target.value } : item
                                )
                              )
                            }
                            placeholder="Beschreibung…"
                            className="mt-1 w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-800 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateActiveTimerPhotos(
                                (activeTimer.photos ?? []).filter((item) => item.id !== p.id)
                              )
                            }
                            aria-label="Foto entfernen"
                            className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/75 text-white hover:bg-rose-600 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Customer Budget Bar */}
            {activeCustomerBudget && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  activeCustomerBudget.severity === 'exceeded'
                    ? 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200'
                    : activeCustomerBudget.severity === 'warning'
                      ? 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200'
                      : 'border-slate-200 bg-slate-50/70 text-slate-700 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Gauge className="h-3.5 w-3.5" />
                    Kontingent ({activeCustomerBudget.periodLabel}):{' '}
                    {activeCustomerBudget.budgetHours !== null
                      ? `${formatNumber(activeCustomerBudget.usedHours, 1)} / ${formatNumber(
                          activeCustomerBudget.budgetHours,
                          1
                        )} Std.`
                      : `${formatCurrency(activeCustomerBudget.usedAmountNet)} / ${formatCurrency(
                          activeCustomerBudget.budgetAmountNet ?? 0
                        )}`}
                  </span>
                  <span className="font-mono font-bold tabular-nums">
                    {activeCustomerBudget.primaryPct} %
                    {activeCustomerBudget.severity === 'exceeded'
                      ? ' · Kontingent überschritten'
                      : activeCustomerBudget.severity === 'warning'
                        ? ' · Bald erreicht'
                        : ''}
                  </span>
                </div>
                <svg
                  viewBox="0 0 100 4"
                  preserveAspectRatio="none"
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  <rect
                    x="0"
                    y="0"
                    width="100"
                    height="4"
                    rx="2"
                    className="fill-slate-200/80 dark:fill-[#2e2349]"
                  />
                  <rect
                    x="0"
                    y="0"
                    width={Math.min(100, Math.max(0, activeCustomerBudget.primaryPct))}
                    height="4"
                    rx="2"
                    className={
                      activeCustomerBudget.severity === 'exceeded'
                        ? 'fill-rose-500'
                        : activeCustomerBudget.severity === 'warning'
                          ? 'fill-amber-500'
                          : 'fill-emerald-500'
                    }
                  />
                </svg>
              </div>
            )}

            {/* ArbZG Break & Overnight Assistant + Quick Pause Deduction */}
            {(showBreakAlert || showOvernightAlert || (onDeductBreakMinutes && elapsedSeconds >= 900)) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-amber-50/70 px-3.5 py-2.5 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                  {showBreakAlert || showOvernightAlert ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Coffee className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <span>
                    {showOvernightAlert
                      ? 'Timer läuft am späten Abend / seit gestern — vergessen zu stoppen?'
                      : showBreakAlert
                        ? `Über ${breakTriggerHours} Std. am Stück aktiv (ArbZG-Hinweis) — Pause direkt abziehen?`
                        : 'Pause vergessen zu drücken? Schnellabzug:'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {onDeductBreakMinutes && (
                    <>
                      <button
                        type="button"
                        onClick={() => onDeductBreakMinutes(15)}
                        disabled={elapsedSeconds <= 15 * 60}
                        className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-700/60 dark:bg-[#211936] dark:text-amber-200 dark:hover:bg-[#2a2045] cursor-pointer"
                      >
                        −15 Min. Pause
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeductBreakMinutes(breakDefaultMinutes)}
                        disabled={elapsedSeconds <= breakDefaultMinutes * 60}
                        className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40 cursor-pointer"
                      >
                        −{breakDefaultMinutes} Min. Pause
                      </button>
                    </>
                  )}
                  {showOvernightAlert && (
                    <button
                      type="button"
                      onClick={onStopTimer}
                      className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                    >
                      Jetzt stoppen
                    </button>
                  )}
                </div>
              </div>
            )}
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
            {draftCustomerBudget && (
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  draftCustomerBudget.severity === 'exceeded'
                    ? 'border-rose-200 bg-rose-50/70 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200'
                    : draftCustomerBudget.severity === 'warning'
                      ? 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200'
                      : 'border-slate-200 bg-slate-50/70 text-slate-600 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-300'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Gauge className="h-3.5 w-3.5 shrink-0" />
                  Kunden-Kontingent ({draftCustomerBudget.periodLabel}):{' '}
                  {draftCustomerBudget.budgetHours !== null
                    ? `${formatNumber(draftCustomerBudget.usedHours, 1)} / ${formatNumber(
                        draftCustomerBudget.budgetHours,
                        1
                      )} Std.`
                    : `${formatCurrency(draftCustomerBudget.usedAmountNet)} / ${formatCurrency(
                        draftCustomerBudget.budgetAmountNet ?? 0
                      )}`}
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {draftCustomerBudget.primaryPct} %
                </span>
              </div>
            )}
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
              ? nfcTasks
                  .filter((t) => t.actionMode !== 'pauseToggle')
                  .slice(0, 3)
                  .map((task) => {
                    const isIntTask = task.entryType === 'internal' || !task.customerId;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          if (onTriggerNfcTag) {
                            onTriggerNfcTag(task.tagUid);
                          } else {
                            onStartTimer({
                              customerId: isIntTask ? '' : task.customerId,
                              productId: isIntTask ? '' : task.productId,
                              title: task.title,
                              notes: task.description,
                              nfcTaskId: task.id,
                              source: 'nfc',
                              entryType: isIntTask ? 'internal' : 'project',
                              internalCategory: isIntTask ? task.internalCategory : undefined,
                            });
                          }
                        }}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:border-violet-500 dark:hover:bg-[#2c2147] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ▶ {task.title}
                      </button>
                    );
                  })
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

      {/* Parked / Paused Timers ("Parkplatz" for interrupted projects) */}
      {pausedTimers.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-[#1c152e]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Pausierte / geparkte Aufträge ({pausedTimers.length})
              </h2>
            </div>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Jederzeit nahtlos fortsetzen oder direkt abschließen
            </span>
          </div>
          <div className="space-y-2.5">
            {pausedTimers.map((parked) => {
              const isParkedInternal = parked.entryType === 'internal' || !parked.customerId;
              const parkedCustomer = isParkedInternal
                ? undefined
                : customerMap.get(parked.customerId);
              const parkedProduct = isParkedInternal
                ? undefined
                : productMap.get(parked.productId);
              const recordedSec = Math.max(
                0,
                Math.floor(getActiveTimerElapsedMs(parked) / 1000)
              );

              return (
                <div
                  key={parked.id}
                  className="flex flex-col gap-3 rounded-xl border border-amber-200/90 bg-white p-3.5 shadow-xs dark:border-[#3b2d5e] dark:bg-[#171126] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/80 dark:text-amber-200">
                        <Pause className="h-2.5 w-2.5" />
                        Pausiert
                      </span>
                      {isParkedInternal ? (
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          Intern · {parked.internalCategory || 'Sonstiges'}
                        </span>
                      ) : (
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {parkedCustomer?.companyName ?? 'Kunde'}
                          {parkedProduct ? ` · ${parkedProduct.name}` : ''}
                        </span>
                      )}
                      {parked.pausedAt && (
                        <span className="text-slate-400 dark:text-slate-500">
                          · seit {formatDateTimeDE(parked.pausedAt)}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {parked.title}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-sm font-bold text-slate-800 tabular-nums dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-200">
                      {formatDuration(recordedSec)}
                    </span>
                    {onResumePausedTimer && (
                      <button
                        type="button"
                        onClick={() => onResumePausedTimer(parked.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        {activeTimer ? 'Wechseln & Fortsetzen' : 'Fortsetzen'}
                      </button>
                    )}
                    {onStopPausedTimer && (
                      <button
                        type="button"
                        onClick={() => onStopPausedTimer(parked.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap cursor-pointer"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        Speichern
                      </button>
                    )}
                    {onDiscardPausedTimer && (
                      <button
                        type="button"
                        onClick={() => onDiscardPausedTimer(parked.id)}
                        title="Geparkten Auftrag verwerfen"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-[#3b2d5e] dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
          <>
            <div className="max-h-[375px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#211936]">
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:text-violet-200/70">
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
                        {entry.photos && entry.photos.length > 0 && (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxData({
                                  title: entry.title,
                                  photos: entry.photos ?? [],
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300 cursor-pointer"
                            >
                              <Camera className="h-3 w-3" />
                              {entry.photos.length}{' '}
                              {entry.photos.length === 1 ? 'Foto' : 'Fotos'} ansehen
                            </button>
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
                            onClick={() => {
                              if (entry.billedInvoiceId) {
                                onNotify(
                                  'Dieser Eintrag wurde bereits abgerechnet und ist für Änderungen gesperrt.',
                                  true
                                );
                                return;
                              }
                              openEditEntryForm(entry);
                            }}
                            aria-label="Eintrag bearbeiten"
                            aria-disabled={Boolean(entry.billedInvoiceId)}
                            title={
                              entry.billedInvoiceId
                                ? 'Abgerechnete Einträge können nicht bearbeitet werden'
                                : 'Eintrag bearbeiten'
                            }
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                              entry.billedInvoiceId
                                ? 'cursor-not-allowed text-slate-400 opacity-35'
                                : 'cursor-pointer text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#231b38] dark:hover:text-slate-100'
                            }`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (entry.billedInvoiceId) {
                                onNotify(
                                  'Dieser Eintrag wurde bereits abgerechnet und kann nicht gelöscht werden.',
                                  true
                                );
                                return;
                              }
                              onDeleteEntry(entry.id);
                            }}
                            aria-label="Eintrag löschen"
                            aria-disabled={Boolean(entry.billedInvoiceId)}
                            title={
                              entry.billedInvoiceId
                                ? 'Abgerechnete Einträge können nicht gelöscht werden'
                                : 'Eintrag löschen'
                            }
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                              entry.billedInvoiceId
                                ? 'cursor-not-allowed text-slate-400 opacity-35'
                                : 'cursor-pointer text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400'
                            }`}
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
          {filteredEntries.length > 5 && (
            <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2 text-center text-[11px] text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-400">
              Die letzten 5 beendeten Tätigkeiten sichtbar · insgesamt {filteredEntries.length} Einträge (nach oben &amp; unten scrollbar)
            </div>
          )}
        </>
        )}
      </section>

      {/* Manual / Edit Time Entry Modal (Portal so clicking Pencil in table always opens directly in view) */}
      {showManualForm &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingEntry ? 'Zeiteintrag bearbeiten' : 'Arbeitszeit manuell nachtragen'}
            onClick={closeManualForm}
            className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/60 p-2 backdrop-blur-[1px] sm:items-center sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-[#2e2349]">
                <div className="flex min-w-0 items-center gap-2">
                  {editingEntry ? (
                    <Pencil className="h-4 w-4 shrink-0 text-blue-700 dark:text-violet-400" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-blue-700 dark:text-violet-400" />
                  )}
                  <h2 className="truncate font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    {editingEntry ? 'Zeiteintrag bearbeiten' : 'Arbeitszeit manuell nachtragen'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeManualForm}
                  aria-label="Schließen"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable Form */}
              <form onSubmit={handleManualSubmit} className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  {/* Activity Type Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
                      <button
                        type="button"
                        onClick={() => {
                          setManualEntryType('project');
                          setManualBillable(true);
                        }}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
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
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          manualEntryType === 'internal'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                        }`}
                      >
                        Interne Tätigkeit (ohne Kunde)
                      </button>
                    </div>
                    {editingEntry && (
                      <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                        Erfasste Dauer: {formatDuration(editingEntry.durationSeconds)}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
                    {manualEntryType === 'internal' ? (
                      <div className="sm:col-span-6">
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          Interne Kategorie (ohne Kunden &amp; ohne Rechnung)
                        </label>
                        <ThemedSelect
                          value={manualInternalCat}
                          onChange={setManualInternalCat}
                          ariaLabel="Interne Kategorie"
                          options={(manualInternalCat &&
                          !internalCategoryOptions.includes(manualInternalCat)
                            ? [manualInternalCat, ...internalCategoryOptions]
                            : internalCategoryOptions
                          ).map((cat) => ({
                            value: cat,
                            label: cat,
                          }))}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="sm:col-span-3">
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
                        <div className="sm:col-span-3">
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

                    <div className={manualEndDate !== manualDate ? 'sm:col-span-2' : 'sm:col-span-2'}>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        {manualEndDate !== manualDate ? 'Startdatum' : 'Datum'}
                      </label>
                      <input
                        type="date"
                        value={manualDate}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (manualEndDate === manualDate) {
                            setManualEndDate(next);
                          }
                          setManualDate(next);
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                      />
                    </div>

                    {manualEndDate !== manualDate && (
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          Enddatum
                        </label>
                        <input
                          type="date"
                          value={manualEndDate}
                          onChange={(e) => setManualEndDate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                        />
                      </div>
                    )}

                    <div
                      className={`grid grid-cols-2 gap-2 ${
                        manualEndDate !== manualDate ? 'sm:col-span-2' : 'sm:col-span-4'
                      }`}
                    >
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                          Von
                        </label>
                        <input
                          type="time"
                          value={manualStart}
                          onChange={(e) => setManualStart(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
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
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                        />
                      </div>
                    </div>

                    <div className="sm:col-span-6">
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

                    <div className="sm:col-span-6">
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

                    <div className="sm:col-span-6 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-[#2e2349] dark:bg-[#211936]/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                          <Camera className="h-3.5 w-3.5 text-violet-500" />
                          Einsatzfotos / Fotodokumentation ({manualPhotos.length})
                        </span>
                        <input
                          ref={manualPhotoInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => void handleAddManualPhotos(e)}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => manualPhotoInputRef.current?.click()}
                          disabled={photoBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          {photoBusy ? 'Verarbeite…' : 'Foto hinzufügen'}
                        </button>
                      </div>
                      {manualPhotos.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {manualPhotos.map((p) => (
                            <div
                              key={p.id}
                              className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 dark:border-[#3b2d5e] dark:bg-[#171126]"
                            >
                              <img
                                src={p.dataUrl}
                                alt={p.caption || 'Einsatzfoto'}
                                className="h-20 w-full rounded object-cover"
                              />
                              <input
                                type="text"
                                value={p.caption ?? ''}
                                onChange={(e) =>
                                  setManualPhotos((prev) =>
                                    prev.map((item) =>
                                      item.id === p.id ? { ...item, caption: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="Bildbeschreibung…"
                                className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-800 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setManualPhotos((prev) => prev.filter((item) => item.id !== p.id))
                                }
                                aria-label="Foto entfernen"
                                className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/75 text-white hover:bg-rose-600 cursor-pointer"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {manualError && (
                      <p className="text-xs font-medium text-red-600 dark:text-red-400 sm:col-span-6">
                        {manualError}
                      </p>
                    )}

                    <div className="sm:col-span-6">
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
                    </div>
                  </div>
                </div>

                {/* Sticky Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-[#2e2349] dark:bg-[#211936]/40">
                  <button
                    type="button"
                    onClick={closeManualForm}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
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
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Work Photo Lightbox Modal */}
      {lightboxData &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Fotodokumentation"
            onClick={() => setLightboxData(null)}
            className="fixed inset-0 z-[175] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-[#2a2045]">
                <div className="flex items-center gap-2 min-w-0">
                  <Camera className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  <h3 className="truncate font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Einsatzfotos · {lightboxData.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setLightboxData(null)}
                  aria-label="Schließen"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
                {lightboxData.photos.map((photo, idx) => (
                  <div
                    key={photo.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-[#2e2349] dark:bg-[#211936]"
                  >
                    <img
                      src={photo.dataUrl}
                      alt={photo.caption || `Einsatzfoto ${idx + 1}`}
                      className="max-h-72 w-full bg-slate-900/5 object-contain"
                    />
                    <div className="p-3 text-xs">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {photo.caption || `Einsatzfoto #${idx + 1}`}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{formatDateTimeDE(photo.capturedAt)}</span>
                        {photo.nextcloudPath && (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            In Nextcloud gesichert
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
