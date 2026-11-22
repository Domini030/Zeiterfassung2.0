import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  MapPin,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CalendarAppointment,
  CompanyProfile,
  Customer,
  Invoice,
  NextcloudConfigInfo,
  Product,
  TimeEntry,
} from '../types';
import {
  apiFetchNextcloudCalendarEvents,
  apiPushNextcloudCalendarEvent,
} from '../utils/apiClient';
import { buildIcsEvent } from '../utils/caldavClient';
import { downloadOrShareTextFile } from '../utils/exportBackup';
import {
  createId,
  formatCurrency,
  formatDateDE,
  formatEndTimeForDay,
  formatHoursShort,
  getEntryDaySlices,
  toInputDate,
  toInputTime,
} from '../utils/format';
import { InfoHintPopup } from './InfoHintPopup';
import { ThemedSelect } from './ThemedSelect';

interface CalendarViewProps {
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  timeEntries: TimeEntry[];
  invoices: Invoice[];
  calendarEvents: CalendarAppointment[];
  nextcloud: NextcloudConfigInfo;
  onSaveCalendarEvents: (events: CalendarAppointment[]) => void;
  onStartTimerFromAppointment: (payload: {
    customerId: string;
    productId: string;
    title: string;
    notes: string;
  }) => void;
  onNavigateSettings: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function CalendarView({
  company,
  customers,
  products,
  timeEntries,
  invoices,
  calendarEvents,
  nextcloud,
  onSaveCalendarEvents,
  onStartTimerFromAppointment,
  onNavigateSettings,
  onNotify,
}: CalendarViewProps) {
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string>(() => toInputDate());
  const [syncingNc, setSyncingNc] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(() => toInputDate());
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('10:30');
  const [newLocation, setNewLocation] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCustomerId, setNewCustomerId] = useState(customers[0]?.id ?? '');
  const [newProductId, setNewProductId] = useState(products[0]?.id ?? '');
  const [pushToNextcloud, setPushToNextcloud] = useState(
    Boolean(company.calendarConfig?.selectedCalendarUrl)
  );

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthLabel = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
  }).format(viewDate);

  const calendarGridDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { iso: string; day: number; inMonth: boolean }[] = [];

    const prevMonthLast = new Date(year, month, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLast - i);
      cells.push({ iso: toInputDate(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const cur = new Date(year, month, d);
      cells.push({ iso: toInputDate(cur), day: d, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const nextIndex = cells.length - (startWeekday + daysInMonth) + 1;
      const d = new Date(year, month + 1, nextIndex);
      cells.push({ iso: toInputDate(d), day: d.getDate(), inMonth: false });
    }
    return cells;
  }, [year, month]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of timeEntries) {
      const slices = getEntryDaySlices(e);
      for (const slice of slices) {
        const projected: TimeEntry = slice.isSplitSegment
          ? {
              ...e,
              id: `${e.id}::${slice.dateKey}`,
              startTime: slice.startIso,
              endTime: slice.endIso,
              durationSeconds: slice.durationSeconds,
            }
          : e;
        const list = map.get(slice.dateKey) ?? [];
        list.push(projected);
        map.set(slice.dateKey, list);
      }
    }
    return map;
  }, [timeEntries]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    for (const ev of calendarEvents) {
      const parsed = new Date(ev.startTime);
      const dayKey = Number.isNaN(parsed.getTime())
        ? ev.startTime.slice(0, 10)
        : toInputDate(parsed);
      const list = map.get(dayKey) ?? [];
      list.push(ev);
      map.set(dayKey, list);
    }
    return map;
  }, [calendarEvents]);

  const dueInvoicesByDay = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      if (inv.status === 'Bezahlt' || inv.status === 'Storniert') continue;
      const targetDate = inv.quoteValidUntil || inv.dueDate;
      if (!targetDate) continue;
      const dayKey = targetDate.slice(0, 10);
      const list = map.get(dayKey) ?? [];
      list.push(inv);
      map.set(dayKey, list);
    }
    return map;
  }, [invoices]);

  const selectedDayEntries = entriesByDay.get(selectedDay) ?? [];
  const selectedDayEvents = eventsByDay.get(selectedDay) ?? [];
  const selectedDayDue = dueInvoicesByDay.get(selectedDay) ?? [];

  const handleSyncNextcloudCalendar = async () => {
    const calUrl = company.calendarConfig?.selectedCalendarUrl;
    if (!nextcloud.configured || !calUrl) {
      onNotify(
        'Bitte wähle zuerst unter „Nextcloud & Setup → Nextcloud & Kalender“ deinen Nextcloud-Kalender aus.',
        true
      );
      return;
    }
    setSyncingNc(true);
    try {
      const remoteEvents = await apiFetchNextcloudCalendarEvents(
        calUrl,
        company.calendarConfig?.selectedCalendarName || 'Nextcloud'
      );
      const localOnly = calendarEvents.filter((ev) => ev.source === 'local');
      const merged = [...remoteEvents, ...localOnly].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      onSaveCalendarEvents(merged);
      onNotify(`${remoteEvents.length} Termine aus Nextcloud geladen.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Nextcloud-Kalender-Sync fehlgeschlagen.',
        true
      );
    } finally {
      setSyncingNc(false);
    }
  };

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      onNotify('Bitte einen Titel für den Termin angeben.', true);
      return;
    }
    const startIso = new Date(`${newDate}T${newStartTime}:00`).toISOString();
    const endIso = new Date(`${newDate}T${newEndTime}:00`).toISOString();
    const id = createId('cal');
    const appointment: CalendarAppointment = {
      id,
      uid: `${id}@taktwerk.app`,
      title: newTitle.trim(),
      startTime: startIso,
      endTime: endIso,
      location: newLocation.trim() || undefined,
      description: newDescription.trim() || undefined,
      customerId: newCustomerId || null,
      productId: newProductId || null,
      source: 'local',
      calendarName: pushToNextcloud
        ? company.calendarConfig?.selectedCalendarName || 'Nextcloud'
        : 'TaktWerk Lokal',
    };

    const calUrl = company.calendarConfig?.selectedCalendarUrl;
    if (pushToNextcloud && nextcloud.configured && calUrl) {
      try {
        await apiPushNextcloudCalendarEvent(calUrl, appointment);
        appointment.source = 'nextcloud';
        onNotify('Termin erstellt & in deinen Nextcloud-Kalender übertragen.');
      } catch (err) {
        onNotify(
          `Lokal gespeichert, aber Nextcloud-CalDAV meldet: ${
            err instanceof Error ? err.message : 'Upload fehlgeschlagen'
          }`,
          true
        );
      }
    } else {
      onNotify('Termin im TaktWerk-Kalender gespeichert.');
    }

    onSaveCalendarEvents([...calendarEvents, appointment]);
    setSelectedDay(newDate);
    setNewTitle('');
    setNewLocation('');
    setNewDescription('');
    setShowAddForm(false);
  };

  const handleDownloadIcs = async (ev: CalendarAppointment) => {
    try {
      const ics = buildIcsEvent(ev);
      const safeName = ev.title.replace(/[^a-zA-Z0-9_-]/g, '_');
      await downloadOrShareTextFile(`${safeName}.ics`, ics, 'text/calendar');
      onNotify('Termin als .ics-Kalenderdatei exportiert.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : '.ics-Export fehlgeschlagen.',
        true
      );
    }
  };

  const handleStartFromAppointment = (ev: CalendarAppointment) => {
    const custId = ev.customerId || customers[0]?.id || '';
    const prodId =
      ev.productId ||
      products.find((p) => p.type === 'service')?.id ||
      products[0]?.id ||
      '';
    if (!custId || !prodId) {
      onNotify('Bitte lege zuerst mindestens einen Kunden und eine Leistung an.', true);
      return;
    }
    onStartTimerFromAppointment({
      customerId: custId,
      productId: prodId,
      title: ev.title,
      notes: [ev.location ? `Ort: ${ev.location}` : '', ev.description || '']
        .filter(Boolean)
        .join(' · '),
    });
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  const todayIso = toInputDate();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Kalender &amp; Terminplanung
          </h1>
          <InfoHintPopup
            title="Kalender & Terminplanung"
            text="Verbinde deinen Nextcloud-Kalender (CalDAV), behalte Fälligkeiten im Blick und starte Aufgaben direkt aus Terminen."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {nextcloud.configured && company.calendarConfig?.selectedCalendarUrl ? (
            <button
              type="button"
              onClick={() => void handleSyncNextcloudCalendar()}
              disabled={syncingNc}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingNc ? 'animate-spin' : ''}`} />
              {syncingNc
                ? 'Synchronisiere...'
                : `Nextcloud laden (${company.calendarConfig.selectedCalendarName || 'Kalender'})`}
            </button>
          ) : (
            <button
              type="button"
              onClick={onNavigateSettings}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap cursor-pointer"
            >
              <Cloud className="h-3.5 w-3.5" />
              Nextcloud-Kalender einrichten
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNewDate(selectedDay);
              setShowAddForm((prev) => !prev);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Neuer Termin
          </button>
        </div>
      </div>

      {showAddForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <h2 className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Neuen Kundentermin / Einsatz planen
          </h2>
          <form onSubmit={handleCreateAppointment} className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Termin / Aufgabe *
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="z. B. Vor-Ort-Wartung Serverraum"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Datum
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Von
              </label>
              <input
                type="time"
                value={newStartTime}
                onChange={(e) => setNewStartTime(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Bis
              </label>
              <input
                type="time"
                value={newEndTime}
                onChange={(e) => setNewEndTime(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Kunde (für Direkt-Start)
              </label>
              <ThemedSelect
                value={newCustomerId}
                onChange={setNewCustomerId}
                ariaLabel="Kunde auswählen"
                options={[
                  { value: '', label: 'Kein fester Kunde' },
                  ...customers.map((c) => ({
                    value: c.id,
                    label: c.companyName,
                    hint: c.city || undefined,
                  })),
                ]}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Leistung
              </label>
              <ThemedSelect
                value={newProductId}
                onChange={setNewProductId}
                ariaLabel="Leistung auswählen"
                options={[
                  { value: '', label: 'Standard-Leistung' },
                  ...products.map((p) => ({
                    value: p.id,
                    label: p.name,
                    hint: `${formatCurrency(p.unitPriceNet)}/${p.unit}`,
                  })),
                ]}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Ort / Adresse
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="z. B. Kundenstandort München"
                className={inputClass}
              />
            </div>
            <div className="md:col-span-6">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Notizen
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Vorbereitung, Ansprechpartner oder Zugangsdaten..."
                className={inputClass}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-6">
              {nextcloud.configured && company.calendarConfig?.selectedCalendarUrl ? (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushToNextcloud}
                    onChange={(e) => setPushToNextcloud(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Direkt in Nextcloud-Kalender („{company.calendarConfig.selectedCalendarName}“) übertragen
                </label>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Hinweis: In den Einstellungen kannst du einen Nextcloud-Kalender verknüpfen.
                </span>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  Termin speichern
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Month Grid */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126] lg:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold capitalize text-slate-900 dark:text-slate-100">
              {monthLabel}
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month - 1, 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
                  setSelectedDay(toInputDate(now));
                }}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] cursor-pointer"
              >
                Heute
              </button>
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month + 1, 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400 dark:text-violet-300/60 pb-2">
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarGridDays.map((cell) => {
              const dayEvents = eventsByDay.get(cell.iso) ?? [];
              const dayEntries = entriesByDay.get(cell.iso) ?? [];
              const dayDue = dueInvoicesByDay.get(cell.iso) ?? [];
              const totalSecs = dayEntries.reduce((acc, e) => acc + e.durationSeconds, 0);
              const isSelected = cell.iso === selectedDay;
              const isToday = cell.iso === todayIso;

              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => setSelectedDay(cell.iso)}
                  className={`flex min-h-[68px] flex-col items-start justify-between rounded-lg border p-1.5 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/70 dark:border-violet-500 dark:bg-violet-950/60'
                      : isToday
                        ? 'border-slate-400 bg-slate-50 dark:border-violet-700 dark:bg-[#211936]'
                        : cell.inMonth
                          ? 'border-slate-100 bg-white hover:bg-slate-50 dark:border-[#2e2349] dark:bg-[#171126] dark:hover:bg-[#211936]/70'
                          : 'border-transparent bg-slate-50/40 text-slate-400 dark:bg-[#120d1e]/60 dark:text-slate-600'
                  }`}
                >
                  <span
                    className={`font-mono text-xs font-semibold ${
                      isToday ? 'text-blue-700 dark:text-violet-400' : ''
                    }`}
                  >
                    {cell.day}
                  </span>
                  <div className="w-full space-y-0.5 text-[10px] leading-tight">
                    {dayEvents.length > 0 && (
                      <div className="truncate rounded bg-violet-100 px-1 py-0.5 font-medium text-violet-800 dark:bg-violet-900/60 dark:text-violet-200">
                        {dayEvents.length} Termin{dayEvents.length > 1 ? 'e' : ''}
                      </div>
                    )}
                    {totalSecs > 0 && (
                      <div className="truncate font-mono text-emerald-700 dark:text-emerald-400">
                        {(totalSecs / 3600).toFixed(1)}h
                      </div>
                    )}
                    {dayDue.length > 0 && (
                      <div className="truncate font-medium text-amber-700 dark:text-amber-400">
                        {dayDue.length} Fällig
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Selected Day Details */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126] lg:col-span-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-[#2e2349]">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-blue-700 dark:text-violet-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {formatDateDE(selectedDay)}
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {formatHoursShort(selectedDayEntries.reduce((a, b) => a + b.durationSeconds, 0))} erfasst
            </span>
          </div>

          {/* Appointments on selected day */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Termine ({selectedDayEvents.length})
            </h3>
            {selectedDayEvents.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Keine Termine für diesen Tag eingetragen.
              </p>
            ) : (
              selectedDayEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-[#2e2349] dark:bg-[#211936]/70 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {ev.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {ev.startTime.slice(11, 16)} – {ev.endTime.slice(11, 16)}
                        {ev.calendarName ? ` · ${ev.calendarName}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onSaveCalendarEvents(calendarEvents.filter((x) => x.id !== ev.id))
                      }
                      title="Aus Ansicht entfernen"
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {ev.location && (
                    <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                      <span>{ev.location}</span>
                    </div>
                  )}
                  {ev.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {ev.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleStartFromAppointment(ev)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      Timer starten
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadIcs(ev)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                    >
                      <Download className="h-3 w-3" />
                      .ics
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Due Invoices / Quotes */}
          {selectedDayDue.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Fälligkeiten &amp; Fristen ({selectedDayDue.length})
              </h3>
              {selectedDayDue.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30"
                >
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {inv.documentType === 'quote' ? 'Angebot gültig bis' : 'Rechnung fällig'}:{' '}
                      <span className="font-mono">{inv.invoiceNumber}</span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                      {inv.customerSnapshot.companyName}
                    </div>
                  </div>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(inv.grossTotal)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Tracked time on selected day */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Erfasste Arbeitszeiten ({selectedDayEntries.length})
            </h3>
            {selectedDayEntries.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Keine Arbeitszeiten an diesem Tag gebucht.
              </p>
            ) : (
              <div className="space-y-1.5">
                {selectedDayEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-[#2e2349]"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {entry.title}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        {toInputTime(entry.startTime)} –{' '}
                        {formatEndTimeForDay(entry.startTime, entry.endTime)}
                        {entry.location?.address ? ` · ${entry.location.address}` : ''}
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {formatHoursShort(entry.durationSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
