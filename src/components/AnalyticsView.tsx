import { BarChart3, Calculator, Clock, FileDown, Layers, Receipt, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AppDatabase,
  Customer,
  Expense,
  Product,
  RecurringExpense,
  TimeEntry,
} from '../types';
import { formatCurrency, formatNumber, getEntryDaySlices, toInputDate } from '../utils/format';
import { downloadFilteredReportPdf } from '../utils/pdfInvoice';
import { InfoHintPopup } from './InfoHintPopup';
import { TaxAdvisorPanel } from './TaxAdvisorPanel';
import { ThemedSelect } from './ThemedSelect';

interface AnalyticsViewProps {
  customers: Customer[];
  products: Product[];
  timeEntries: TimeEntry[];
  expenses?: Expense[];
  recurringExpenses?: RecurringExpense[];
  db?: AppDatabase;
  onNotify?: (msg: string, isError?: boolean) => void;
}

const INTERNAL_KEY = '__internal__';
const INTERNAL_COLOR = '#d97706';

type RangePreset = '7d' | '30d' | 'all';

const CHART_PALETTE = [
  '#7c3aed', // violet-600
  '#2563eb', // blue-600
  '#059669', // emerald-600
  '#d97706', // amber-600
  '#e11d48', // rose-600
  '#0891b2', // cyan-600
  '#4f46e5', // indigo-600
  '#65a30d', // lime-600
];

function getLocalDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayShort(dateKey: string): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}.${parts[1]}.`;
}

export function AnalyticsView({
  customers,
  products,
  timeEntries,
  expenses = [],
  recurringExpenses = [],
  db,
  onNotify,
}: AnalyticsViewProps) {
  const [activeTab, setActiveTab] = useState<'charts' | 'tax'>('charts');
  const [range, setRange] = useState<RangePreset>('30d');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);
  const [hoveredCustomerId, setHoveredCustomerId] = useState<string | null>(null);

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const customerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((c, idx) => {
      map.set(c.id, CHART_PALETTE[idx % CHART_PALETTE.length]);
    });
    map.set(INTERNAL_KEY, INTERNAL_COLOR);
    return map;
  }, [customers]);

  const productColorMap = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p, idx) => {
      map.set(p.id, CHART_PALETTE[(idx + 2) % CHART_PALETTE.length]);
    });
    return map;
  }, [products]);

  const filteredSlices = useMemo(() => {
    const now = new Date();
    const rangeStartKey =
      range === '7d'
        ? toInputDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
        : range === '30d'
          ? toInputDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29))
          : null;

    const result: {
      entry: TimeEntry;
      dateKey: string;
      durationSeconds: number;
    }[] = [];

    for (const entry of timeEntries) {
      const isInternal = entry.entryType === 'internal' || !entry.customerId;
      if (selectedCustomerId === 'internal_only') {
        if (!isInternal) continue;
      } else if (selectedCustomerId !== 'all') {
        if (isInternal || entry.customerId !== selectedCustomerId) continue;
      }
      if (selectedProductId !== 'all' && entry.productId !== selectedProductId) {
        continue;
      }
      for (const slice of getEntryDaySlices(entry)) {
        if (rangeStartKey && slice.dateKey < rangeStartKey) continue;
        result.push({
          entry,
          dateKey: slice.dateKey,
          durationSeconds: slice.durationSeconds,
        });
      }
    }
    return result;
  }, [timeEntries, range, selectedCustomerId, selectedProductId]);

  const kpis = useMemo(() => {
    let totalSeconds = 0;
    let billableSeconds = 0;
    let internalSeconds = 0;
    let totalRevenueNet = 0;
    const activeCustIds = new Set<string>();
    const entryIds = new Set<string>();

    for (const item of filteredSlices) {
      const e = item.entry;
      entryIds.add(e.id);
      const isInternal = e.entryType === 'internal' || !e.customerId;
      totalSeconds += item.durationSeconds;
      const hours = item.durationSeconds / 3600;
      if (!isInternal && e.billable) {
        billableSeconds += item.durationSeconds;
        totalRevenueNet += hours * e.hourlyRateNet;
      }
      if (isInternal) {
        internalSeconds += item.durationSeconds;
      } else if (e.customerId) {
        activeCustIds.add(e.customerId);
      }
    }

    const billableRatioPct =
      totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 100) : 0;

    return {
      totalHours: totalSeconds / 3600,
      billableHours: billableSeconds / 3600,
      internalHours: internalSeconds / 3600,
      billableRatioPct,
      totalRevenueNet,
      activeCustomers: activeCustIds.size,
      entryCount: entryIds.size,
    };
  }, [filteredSlices]);

  const internalCategoryStats = useMemo(() => {
    const map = new Map<string, { label: string; seconds: number; entryIds: Set<string> }>();
    for (const item of filteredSlices) {
      const e = item.entry;
      const isInternal = e.entryType === 'internal' || !e.customerId;
      if (!isInternal) continue;
      const cat = e.internalCategory || 'Sonstige interne Arbeit';
      const cur = map.get(cat) ?? { label: cat, seconds: 0, entryIds: new Set<string>() };
      cur.seconds += item.durationSeconds;
      cur.entryIds.add(e.id);
      map.set(cat, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ label: v.label, seconds: v.seconds, count: v.entryIds.size }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [filteredSlices]);

  const expenseSummary = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      range === '7d'
        ? now - 7 * 86400 * 1000
        : range === '30d'
          ? now - 30 * 86400 * 1000
          : 0;
    const inRange = expenses.filter((exp) => {
      if (cutoffMs === 0) return true;
      const ms = new Date(`${exp.date}T12:00:00`).getTime();
      return Number.isNaN(ms) || ms >= cutoffMs;
    });
    const operatingNet = inRange
      .filter((e) => e.expenseType === 'operating' || !e.customerId)
      .reduce((acc, e) => acc + (e.netAmount || 0), 0);
    const totalExpenseNet = inRange.reduce((acc, e) => acc + (e.netAmount || 0), 0);
    const monthlyFixedNet = recurringExpenses
      .filter((r) => r.active)
      .reduce((acc, r) => {
        const factor =
          r.interval === 'monthly' ? 1 : r.interval === 'quarterly' ? 1 / 3 : 1 / 12;
        return acc + (r.netAmount || 0) * factor;
      }, 0);
    return {
      operatingNet,
      totalExpenseNet,
      monthlyFixedNet,
      count: inRange.length,
    };
  }, [expenses, recurringExpenses, range]);

  const handleQuickPdfExport = async () => {
    if (!db) return;
    const now = new Date();
    const startDate =
      range === '7d'
        ? toInputDate(new Date(now.getTime() - 7 * 86400 * 1000))
        : range === '30d'
          ? toInputDate(new Date(now.getTime() - 30 * 86400 * 1000))
          : undefined;
    try {
      await downloadFilteredReportPdf(db, {
        title: 'Grafischer Tätigkeits- & Auswertungsbericht',
        startDate,
        endDate: range === 'all' ? undefined : toInputDate(now),
        customerId: selectedCustomerId,
        productId: selectedProductId,
      });
      onNotify?.('Grafische PDF-Auswertung erstellt.');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'PDF-Auswertung fehlgeschlagen.',
        true
      );
    }
  };

  // Aggregate by customer (and group internal activities cleanly)
  const customerStats = useMemo(() => {
    const acc = new Map<
      string,
      {
        customerId: string;
        name: string;
        color: string;
        seconds: number;
        revenueNet: number;
        entryIds: Set<string>;
      }
    >();

    for (const item of filteredSlices) {
      const e = item.entry;
      const isInternal = e.entryType === 'internal' || !e.customerId;
      const key = isInternal ? INTERNAL_KEY : e.customerId;
      const cust = !isInternal ? customerMap.get(e.customerId) : undefined;
      const existing = acc.get(key) ?? {
        customerId: key,
        name: isInternal
          ? 'Intern (nicht verrechenbar)'
          : cust?.companyName ?? 'Unbekannter Kunde',
        color: customerColorMap.get(key) ?? '#7c3aed',
        seconds: 0,
        revenueNet: 0,
        entryIds: new Set<string>(),
      };
      existing.seconds += item.durationSeconds;
      if (!isInternal && e.billable) {
        existing.revenueNet += (item.durationSeconds / 3600) * e.hourlyRateNet;
      }
      existing.entryIds.add(e.id);
      acc.set(key, existing);
    }

    return Array.from(acc.values())
      .map((v) => ({
        customerId: v.customerId,
        name: v.name,
        color: v.color,
        seconds: v.seconds,
        revenueNet: v.revenueNet,
        entries: v.entryIds.size,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [filteredSlices, customerMap, customerColorMap]);

  // Aggregate by product / internal category
  const productStats = useMemo(() => {
    const acc = new Map<
      string,
      {
        productId: string;
        name: string;
        color: string;
        seconds: number;
        revenueNet: number;
        entryIds: Set<string>;
      }
    >();

    for (const item of filteredSlices) {
      const e = item.entry;
      const isInternal = e.entryType === 'internal' || !e.customerId;
      const key = isInternal
        ? `int::${e.internalCategory || 'Interne Tätigkeit'}`
        : e.productId;
      const prod = !isInternal ? productMap.get(e.productId) : undefined;
      const existing = acc.get(key) ?? {
        productId: key,
        name: isInternal
          ? `[Intern] ${e.internalCategory || 'Interne Tätigkeit'}`
          : prod?.name ?? 'Leistung',
        color: isInternal ? INTERNAL_COLOR : productColorMap.get(e.productId) ?? '#2563eb',
        seconds: 0,
        revenueNet: 0,
        entryIds: new Set<string>(),
      };
      existing.seconds += item.durationSeconds;
      if (!isInternal && e.billable) {
        existing.revenueNet += (item.durationSeconds / 3600) * e.hourlyRateNet;
      }
      existing.entryIds.add(e.id);
      acc.set(key, existing);
    }

    return Array.from(acc.values())
      .map((v) => ({
        productId: v.productId,
        name: v.name,
        color: v.color,
        seconds: v.seconds,
        revenueNet: v.revenueNet,
        entries: v.entryIds.size,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [filteredSlices, productMap, productColorMap]);

  // Aggregate daily stacked bars (Customer & Internal segments per day)
  const dailySeries = useMemo(() => {
    const dayMap = new Map<
      string,
      {
        dateKey: string;
        totalSeconds: number;
        revenueNet: number;
        byCustomer: Map<string, number>;
      }
    >();

    if (range === '7d' || range === '30d') {
      const daysCount = range === '7d' ? 7 : 14;
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400 * 1000);
        const key = getLocalDateKey(d.toISOString());
        dayMap.set(key, {
          dateKey: key,
          totalSeconds: 0,
          revenueNet: 0,
          byCustomer: new Map(),
        });
      }
    }

    for (const item of filteredSlices) {
      const e = item.entry;
      const isInternal = e.entryType === 'internal' || !e.customerId;
      const custKey = isInternal ? INTERNAL_KEY : e.customerId;
      const key = item.dateKey;
      const bucket = dayMap.get(key) ?? {
        dateKey: key,
        totalSeconds: 0,
        revenueNet: 0,
        byCustomer: new Map(),
      };
      bucket.totalSeconds += item.durationSeconds;
      if (!isInternal && e.billable) {
        bucket.revenueNet += (item.durationSeconds / 3600) * e.hourlyRateNet;
      }
      bucket.byCustomer.set(
        custKey,
        (bucket.byCustomer.get(custKey) ?? 0) + item.durationSeconds
      );
      dayMap.set(key, bucket);
    }

    const sorted = Array.from(dayMap.values()).sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey)
    );
    return sorted.slice(-16);
  }, [filteredSlices, range]);

  const maxDayHours = useMemo(() => {
    const peak = dailySeries.reduce(
      (max, d) => Math.max(max, d.totalSeconds / 3600),
      0
    );
    return Math.max(1, Math.ceil(peak));
  }, [dailySeries]);

  // Customer x Product Matrix
  const matrixRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        customerName: string;
        customerColor: string;
        productName: string;
        hours: number;
        revenueNet: number;
        entryIds: Set<string>;
      }
    >();

    for (const item of filteredSlices) {
      const e = item.entry;
      const isInternal = e.entryType === 'internal' || !e.customerId;
      const custKey = isInternal ? INTERNAL_KEY : e.customerId;
      const prodKey = isInternal ? e.internalCategory || 'Intern' : e.productId;
      const key = `${custKey}::${prodKey}`;
      const cust = !isInternal ? customerMap.get(e.customerId) : undefined;
      const prod = !isInternal ? productMap.get(e.productId) : undefined;
      const itemRow = grouped.get(key) ?? {
        key,
        customerName: isInternal
          ? 'Intern (ohne Ertrag)'
          : cust?.companyName ?? 'Unbekannter Kunde',
        customerColor: customerColorMap.get(custKey) ?? '#7c3aed',
        productName: isInternal
          ? e.internalCategory || 'Interne Tätigkeit'
          : prod?.name ?? 'Leistung',
        hours: 0,
        revenueNet: 0,
        entryIds: new Set<string>(),
      };
      const hrs = item.durationSeconds / 3600;
      itemRow.hours += hrs;
      if (!isInternal && e.billable) {
        itemRow.revenueNet += hrs * e.hourlyRateNet;
      }
      itemRow.entryIds.add(e.id);
      grouped.set(key, itemRow);
    }

    return Array.from(grouped.values())
      .map((v) => ({
        key: v.key,
        customerName: v.customerName,
        customerColor: v.customerColor,
        productName: v.productName,
        hours: v.hours,
        revenueNet: v.revenueNet,
        count: v.entryIds.size,
      }))
      .sort((a, b) => b.hours - a.hours);
  }, [filteredSlices, customerMap, productMap, customerColorMap]);

  // SVG Donut geometry
  const donutSegments = useMemo(() => {
    const totalSeconds = customerStats.reduce((sum, c) => sum + c.seconds, 0);
    if (totalSeconds <= 0) return [];
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    let cumulative = 0;

    return customerStats.map((c) => {
      const fraction = c.seconds / totalSeconds;
      const dashLength = fraction * circumference;
      const dashOffset = -cumulative;
      cumulative += dashLength;
      return {
        ...c,
        fraction,
        dashArray: `${dashLength} ${circumference}`,
        dashOffset,
      };
    });
  }, [customerStats]);

  const activeDayDetail = useMemo(() => {
    if (!hoveredDayKey) return null;
    return dailySeries.find((d) => d.dateKey === hoveredDayKey) ?? null;
  }, [hoveredDayKey, dailySeries]);

  const maxProductSeconds = useMemo(
    () => productStats.reduce((m, p) => Math.max(m, p.seconds), 1),
    [productStats]
  );

  const maxMatrixHours = useMemo(
    () => matrixRows.reduce((m, r) => Math.max(m, r.hours), 1),
    [matrixRows]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Auswertung &amp; Steuern
            </h1>
            <InfoHintPopup
              title="Auswertung & Steuern"
              text="Grafische Verteilung deiner Arbeitszeiten & Umsätze sowie EÜR-, UStVA- und DATEV-/Steuerberater-Export."
            />
          </div>
          {db && (
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-[#2e2349] dark:bg-[#211936]">
              <button
                type="button"
                onClick={() => setActiveTab('charts')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'charts'
                    ? 'ui-accent-active text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Zeit &amp; Umsatz
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('tax')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'tax'
                    ? 'ui-accent-active text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Calculator className="h-3.5 w-3.5" />
                EÜR, UStVA &amp; Steuerberater
              </button>
            </div>
          )}
        </div>

        {activeTab === 'charts' && (
          <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
            {([
              { id: '7d', label: '7 Tage' },
              { id: '30d', label: '30 Tage' },
              { id: 'all', label: 'Gesamt' },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRange(item.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  range === item.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <ThemedSelect
            size="sm"
            value={selectedCustomerId}
            onChange={setSelectedCustomerId}
            ariaLabel="Nach Kunde filtern"
            className="min-w-44"
            options={[
              { value: 'all', label: 'Alle Kunden & Intern' },
              { value: 'internal_only', label: 'Nur interne Tätigkeiten' },
              ...customers.map((c) => ({
                value: c.id,
                label: c.companyName,
              })),
            ]}
          />

          <ThemedSelect
            size="sm"
            value={selectedProductId}
            onChange={setSelectedProductId}
            ariaLabel="Nach Produkt filtern"
            className="min-w-44"
            options={[
              { value: 'all', label: 'Alle Leistungen' },
              ...products.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
          />

          {db && (
            <button
              type="button"
              onClick={() => void handleQuickPdfExport()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              Grafik-PDF
            </button>
          )}
          </div>
        )}
      </div>

      {activeTab === 'tax' && db ? (
        <TaxAdvisorPanel
          db={db}
          onNotify={(msg, tone) => onNotify?.(msg, tone === 'error')}
        />
      ) : (
      <>
      {/* KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Erfasste Arbeitszeit</span>
            <Clock className="h-4 w-4 text-blue-700 dark:text-violet-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatNumber(kpis.totalHours, 2)} Std.
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {formatNumber(kpis.billableHours, 1)}h Projekt · {formatNumber(kpis.internalHours, 1)}h Intern
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Abrechenbarer Wert (Netto)</span>
            <BarChart3 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCurrency(kpis.totalRevenueNet)}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Verrechenbare Quote: {kpis.billableRatioPct} %
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Aktive Kunden</span>
            <Users className="h-4 w-4 text-blue-700 dark:text-violet-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {kpis.activeCustomers}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Aus {kpis.entryCount} Zeiteinträgen gesamt
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Ausgaben &amp; Fixkosten (Netto)</span>
            <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCurrency(expenseSummary.totalExpenseNet)}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ø Fixkosten: {formatCurrency(expenseSummary.monthlyFixedNet)}/Monat
          </p>
        </div>
      </section>

      {/* Verrechenbar vs. Interne Tätigkeiten Breakdown */}
      {(kpis.internalHours > 0 || kpis.billableHours > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Verhältnis: Verrechenbare Aufträge vs. Interne Arbeiten
              </h2>
              <InfoHintPopup
                size="sm"
                title="Verrechenbare vs. Interne Arbeiten"
                text="Übersicht über ertragbringende Projektzeit und interne Aufgaben (z. B. Kundenakquise, Studio-Reinigung)."
              />
            </div>
            <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
              {kpis.billableRatioPct} % Verrechenbar · {100 - kpis.billableRatioPct} % Intern / Nicht verrechenbar
            </div>
          </div>
          <svg
            viewBox="0 0 400 14"
            preserveAspectRatio="none"
            className="mt-3 h-3.5 w-full overflow-hidden rounded-full"
          >
            <rect x="0" y="0" width="400" height="14" rx="7" fill="#d97706" />
            <rect
              x="0"
              y="0"
              width={Math.round((kpis.billableRatioPct / 100) * 400)}
              height="14"
              rx="7"
              fill="#7c3aed"
            />
          </svg>
          {internalCategoryStats.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {internalCategoryStats.map((cat) => (
                <div
                  key={cat.label}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  <span className="font-medium">{cat.label}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {formatNumber(cat.seconds / 3600, 2)} Std.
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {filteredSlices.length === 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-[#2e2349] dark:bg-[#171126]">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Keine Zeiteinträge im gewählten Filter vorhanden.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Wähle einen größeren Zeitraum oder erfasse Arbeitszeiten über Timer bzw. NFC-Tags.
          </p>
        </section>
      ) : (
        <>
          {/* Daily Stacked Bar Chart */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Zeitverlauf nach Tagen &amp; Kunden
                </h2>
                <InfoHintPopup
                  size="sm"
                  title="Zeitverlauf nach Tagen & Kunden"
                  text="Gestapelte Stunden pro Tag, farblich nach Kunde aufgeschlüsselt (Tippen/Hover für Tagesdetails)."
                />
              </div>
              {activeDayDetail && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-[#3b2d5e] dark:bg-[#211936]">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {formatDayShort(activeDayDetail.dateKey)}:
                  </span>{' '}
                  <span className="font-mono font-semibold text-blue-700 dark:text-violet-300">
                    {formatNumber(activeDayDetail.totalSeconds / 3600, 2)} Std.
                  </span>{' '}
                  ·{' '}
                  <span className="font-mono text-slate-600 dark:text-slate-300">
                    {formatCurrency(activeDayDetail.revenueNet)}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <svg
                viewBox="0 0 760 220"
                className="h-56 w-full min-w-[540px]"
                role="img"
                aria-label="Säulendiagramm der erfassten Arbeitsstunden nach Tagen"
              >
                {/* Horizontal Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const yPos = 180 - step * 150;
                  const labelVal = Math.round(step * maxDayHours * 10) / 10;
                  return (
                    <g key={step}>
                      <line
                        x1="44"
                        y1={yPos}
                        x2="744"
                        y2={yPos}
                        className="stroke-slate-200 dark:stroke-[#2e2349]"
                        strokeWidth="1"
                      />
                      <text
                        x="38"
                        y={yPos + 4}
                        textAnchor="end"
                        className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono"
                      >
                        {labelVal}h
                      </text>
                    </g>
                  );
                })}

                {/* Stacked Bars */}
                {dailySeries.map((day, idx) => {
                  const slotWidth = 700 / Math.max(1, dailySeries.length);
                  const barWidth = Math.min(34, Math.max(14, slotWidth * 0.62));
                  const barX = 44 + idx * slotWidth + (slotWidth - barWidth) / 2;

                  const segments = Array.from(day.byCustomer.entries()).sort(
                    (a, b) => b[1] - a[1]
                  );

                  let currentTopY = 180;
                  const isHovered = hoveredDayKey === day.dateKey;

                  return (
                    <g
                      key={day.dateKey}
                      onMouseEnter={() => setHoveredDayKey(day.dateKey)}
                      onMouseLeave={() => setHoveredDayKey(null)}
                      onClick={() =>
                        setHoveredDayKey((prev) =>
                          prev === day.dateKey ? null : day.dateKey
                        )
                      }
                      className="cursor-pointer"
                    >
                      {isHovered && (
                        <rect
                          x={barX - 4}
                          y={24}
                          width={barWidth + 8}
                          height={158}
                          rx="6"
                          className="fill-slate-100 dark:fill-[#211936]"
                        />
                      )}

                      {segments.map(([custId, secs]) => {
                        const segHours = secs / 3600;
                        const segHeight = Math.max(2, (segHours / maxDayHours) * 150);
                        currentTopY -= segHeight;
                        const fill = customerColorMap.get(custId) ?? '#7c3aed';
                        return (
                          <rect
                            key={custId}
                            x={barX}
                            y={currentTopY}
                            width={barWidth}
                            height={segHeight}
                            rx="3"
                            fill={fill}
                            opacity={hoveredDayKey && !isHovered ? 0.55 : 1}
                          />
                        );
                      })}

                      <text
                        x={barX + barWidth / 2}
                        y={198}
                        textAnchor="middle"
                        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                      >
                        {formatDayShort(day.dateKey)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>

          {/* Customer Donut + Product Breakdown */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Customer Donut */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] lg:col-span-6">
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Arbeitszeit &amp; Umsatz nach Kunden
                </h2>
                <InfoHintPopup
                  size="sm"
                  title="Arbeitszeit & Umsatz nach Kunden"
                  text="Anteilige Zeitverteilung über alle aktiven Kunden."
                />
              </div>

              <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
                <div className="relative h-44 w-44 shrink-0">
                  <svg
                    viewBox="0 0 180 180"
                    className="h-full w-full -rotate-90"
                    role="img"
                    aria-label="Kreisdiagramm Arbeitszeit pro Kunde"
                  >
                    <circle
                      cx="90"
                      cy="90"
                      r="64"
                      fill="transparent"
                      className="stroke-slate-100 dark:stroke-[#211936]"
                      strokeWidth="22"
                    />
                    {donutSegments.map((seg) => {
                      const dimmed =
                        hoveredCustomerId !== null &&
                        hoveredCustomerId !== seg.customerId;
                      return (
                        <circle
                          key={seg.customerId}
                          cx="90"
                          cy="90"
                          r="64"
                          fill="transparent"
                          stroke={seg.color}
                          strokeWidth="22"
                          strokeDasharray={seg.dashArray}
                          strokeDashoffset={seg.dashOffset}
                          opacity={dimmed ? 0.35 : 1}
                          onMouseEnter={() => setHoveredCustomerId(seg.customerId)}
                          onMouseLeave={() => setHoveredCustomerId(null)}
                          className="transition-opacity cursor-pointer"
                        />
                      );
                    })}
                  </svg>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatNumber(kpis.totalHours, 1)}h
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Gesamt
                    </span>
                  </div>
                </div>

                <div className="w-full flex-1 space-y-2.5">
                  {donutSegments.map((seg) => (
                    <div
                      key={seg.customerId}
                      onMouseEnter={() => setHoveredCustomerId(seg.customerId)}
                      onMouseLeave={() => setHoveredCustomerId(null)}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-xs transition-colors hover:bg-slate-50 dark:border-[#2e2349] dark:hover:bg-[#211936]/70"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
                          <circle cx="6" cy="6" r="5" fill={seg.color} />
                        </svg>
                        <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                          {seg.name}
                        </span>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatNumber(seg.seconds / 3600, 2)}h
                        </span>{' '}
                        <span className="text-slate-400 dark:text-slate-500">
                          ({Math.round(seg.fraction * 100)}%)
                        </span>
                        <div className="text-[11px] text-slate-500 dark:text-violet-300/80">
                          {formatCurrency(seg.revenueNet)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Product Horizontal Bars */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] lg:col-span-6">
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Arbeitszeit nach Produkten &amp; Leistungen
                </h2>
                <InfoHintPopup
                  size="sm"
                  title="Arbeitszeit nach Produkten & Leistungen"
                  text="Welche Leistungen die meiste Arbeitszeit und den höchsten Umsatz erzeugen."
                />
              </div>

              <div className="mt-5 space-y-4">
                {productStats.map((prod) => {
                  const pct = Math.max(4, Math.round((prod.seconds / maxProductSeconds) * 100));
                  const barWidth = (pct / 100) * 240;
                  return (
                    <div key={prod.productId} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                          {prod.name}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300 shrink-0">
                          {formatNumber(prod.seconds / 3600, 2)} Std. ·{' '}
                          <strong className="text-slate-900 dark:text-violet-300">
                            {formatCurrency(prod.revenueNet)}
                          </strong>
                        </span>
                      </div>
                      <svg
                        viewBox="0 0 240 10"
                        preserveAspectRatio="none"
                        className="h-2.5 w-full overflow-hidden rounded-full"
                      >
                        <rect
                          x="0"
                          y="0"
                          width="240"
                          height="10"
                          rx="5"
                          className="fill-slate-100 dark:fill-[#211936]"
                        />
                        <rect
                          x="0"
                          y="0"
                          width={barWidth}
                          height="10"
                          rx="5"
                          fill={prod.color}
                        />
                      </svg>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Customer x Product Matrix */}
          <section className="rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
            <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-4 dark:border-[#2e2349]">
              <Layers className="h-4 w-4 text-blue-700 dark:text-violet-400" />
              <div className="flex items-center gap-1.5">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Kunde × Produkt Verknüpfung
                </h2>
                <InfoHintPopup
                  size="sm"
                  title="Kunde × Produkt Verknüpfung"
                  text="Aufschlüsselung, welcher Kunde welche Leistung in welchem Umfang genutzt hat."
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
                    <th className="px-6 py-3">Kunde</th>
                    <th className="px-4 py-3">Produkt / Leistung</th>
                    <th className="px-4 py-3 w-48">Anteil</th>
                    <th className="px-4 py-3 text-right">Buchungen</th>
                    <th className="px-4 py-3 text-right">Stunden</th>
                    <th className="px-6 py-3 text-right">Umsatz (Netto)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                  {matrixRows.map((row) => {
                    const barW = Math.max(
                      10,
                      Math.round((row.hours / maxMatrixHours) * 160)
                    );
                    return (
                      <tr
                        key={row.key}
                        className="transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50"
                      >
                        <td className="px-6 py-3 font-medium text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-2">
                            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0">
                              <circle cx="5" cy="5" r="4" fill={row.customerColor} />
                            </svg>
                            <span>{row.customerName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {row.productName}
                        </td>
                        <td className="px-4 py-3">
                          <svg
                            viewBox="0 0 160 8"
                            preserveAspectRatio="none"
                            className="h-2 w-full rounded-full"
                          >
                            <rect
                              x="0"
                              y="0"
                              width="160"
                              height="8"
                              rx="4"
                              className="fill-slate-100 dark:fill-[#211936]"
                            />
                            <rect
                              x="0"
                              y="0"
                              width={barW}
                              height="8"
                              rx="4"
                              fill={row.customerColor}
                            />
                          </svg>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          {row.count}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatNumber(row.hours, 2)} Std.
                        </td>
                        <td className="px-6 py-3 text-right font-mono text-sm font-semibold text-slate-900 dark:text-violet-300 tabular-nums">
                          {formatCurrency(row.revenueNet)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      </>
      )}
    </div>
  );
}
