import {
  Clock,
  FileText,
  MapPin,
  Nfc,
  Package,
  Play,
  Receipt,
  Repeat,
  Search,
  Users,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppDatabase, NavSection, NfcTask } from '../types';
import { formatCurrency, formatDateDE, formatDuration } from '../utils/format';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  db: AppDatabase;
  onNavigate: (section: NavSection) => void;
  onTriggerNfcTask?: (task: NfcTask) => void;
}

interface SearchResultItem {
  id: string;
  category:
    | 'Kunde'
    | 'Produkt'
    | 'Rechnung'
    | 'Tätigkeit'
    | 'NFC-Aufgabe'
    | 'Ausgabe'
    | 'Fixkosten'
    | 'Ortsregel';
  title: string;
  subtitle: string;
  badge?: string;
  targetSection: NavSection;
  nfcTask?: NfcTask;
}

const MAX_RESULTS_PER_CATEGORY = 6;
const MAX_TOTAL_RESULTS = 28;

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  open,
  onClose,
  db,
  onNavigate,
  onTriggerNfcTask,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const customerMap = useMemo(
    () => new Map(db.customers.map((c) => [c.id, c])),
    [db.customers]
  );

  const results = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const items: SearchResultItem[] = [];

    const match = (...fields: (string | number | undefined | null)[]) => {
      if (!q) return true;
      return fields.some((f) => f !== undefined && f !== null && String(f).toLowerCase().includes(q));
    };

    // 1. NFC-Aufgaben (quick launch!)
    let count = 0;
    for (const task of db.nfcTasks) {
      if (count >= MAX_RESULTS_PER_CATEGORY) break;
      const cust = customerMap.get(task.customerId);
      if (
        match(task.title, task.tagUid, task.description, cust?.companyName, task.internalCategory)
      ) {
        items.push({
          id: `nfc-${task.id}`,
          category: 'NFC-Aufgabe',
          title: task.title,
          subtitle: `${cust?.companyName || task.internalCategory || 'Intern'} · Tag ${task.tagUid}`,
          badge: 'Startbar',
          targetSection: 'nfc',
          nfcTask: task,
        });
        count++;
      }
    }

    // 2. Kunden
    count = 0;
    for (const c of db.customers) {
      if (count >= MAX_RESULTS_PER_CATEGORY) break;
      if (match(c.companyName, c.contactName, c.customerNumber, c.city, c.email, c.category, c.notes)) {
        items.push({
          id: `cust-${c.id}`,
          category: 'Kunde',
          title: c.companyName,
          subtitle: [c.customerNumber, c.contactName, c.city].filter(Boolean).join(' · '),
          badge: c.category || undefined,
          targetSection: 'customers',
        });
        count++;
      }
    }

    // 3. Rechnungen & Angebote
    count = 0;
    for (const inv of db.invoices) {
      if (count >= MAX_RESULTS_PER_CATEGORY) break;
      if (
        match(
          inv.invoiceNumber,
          inv.customerSnapshot.companyName,
          inv.status,
          inv.issueDate,
          inv.grossTotal
        )
      ) {
        items.push({
          id: `inv-${inv.id}`,
          category: 'Rechnung',
          title: `${inv.invoiceNumber} · ${inv.customerSnapshot.companyName}`,
          subtitle: `${formatDateDE(inv.issueDate)} · ${formatCurrency(
            inv.isSmallBusiness ? inv.netTotal : inv.grossTotal
          )}`,
          badge: inv.documentType === 'quote' ? 'Angebot' : inv.status,
          targetSection: 'invoices',
        });
        count++;
      }
    }

    // 4. Produkte / Leistungen
    count = 0;
    for (const p of db.products) {
      if (count >= MAX_RESULTS_PER_CATEGORY) break;
      if (match(p.name, p.sku, p.description, p.category, p.unit)) {
        items.push({
          id: `prod-${p.id}`,
          category: 'Produkt',
          title: p.name,
          subtitle: `${p.sku || 'Ohne Nr.'} · ${formatCurrency(p.unitPriceNet)} / ${p.unit}`,
          badge: p.category || undefined,
          targetSection: 'products',
        });
        count++;
      }
    }

    // 5. Tätigkeiten
    count = 0;
    for (const e of db.timeEntries) {
      if (count >= MAX_RESULTS_PER_CATEGORY) break;
      const cust = customerMap.get(e.customerId);
      if (match(e.title, e.notes, cust?.companyName, e.location?.address, e.internalCategory)) {
        items.push({
          id: `time-${e.id}`,
          category: 'Tätigkeit',
          title: e.title,
          subtitle: `${cust?.companyName || e.internalCategory || 'Intern'} · ${formatDateDE(
            e.startTime
          )} · ${formatDuration(e.durationSeconds)}`,
          badge: e.billedInvoiceId ? 'Abgerechnet' : undefined,
          targetSection: 'tracker',
        });
        count++;
      }
    }

    // 6. Ausgaben
    count = 0;
    for (const exp of db.expenses ?? []) {
      if (count >= MAX_RESULTS_PER_CATEGORY) break;
      if (match(exp.vendor, exp.description, exp.category, exp.notes, exp.date)) {
        items.push({
          id: `exp-${exp.id}`,
          category: 'Ausgabe',
          title: `${exp.vendor}${exp.description ? ` – ${exp.description}` : ''}`,
          subtitle: `${formatDateDE(exp.date)} · ${exp.category} · ${formatCurrency(
            exp.grossAmount
          )}`,
          targetSection: 'expenses',
        });
        count++;
      }
    }

    // 7. Fixkosten
    count = 0;
    for (const rec of db.recurringExpenses ?? []) {
      if (count >= 4) break;
      if (match(rec.vendor, rec.description, rec.category)) {
        items.push({
          id: `recexp-${rec.id}`,
          category: 'Fixkosten',
          title: `${rec.vendor} – ${rec.description}`,
          subtitle: `${rec.category} · ${formatCurrency(rec.grossAmount)}`,
          targetSection: 'expenses',
        });
        count++;
      }
    }

    // 8. Ortsregeln
    count = 0;
    for (const rule of db.geoFenceRules ?? []) {
      if (count >= 4) break;
      const cust = customerMap.get(rule.customerId);
      if (match(rule.name, rule.address, rule.taskTitle, cust?.companyName)) {
        items.push({
          id: `geo-${rule.id}`,
          category: 'Ortsregel',
          title: rule.name,
          subtitle: `${rule.address || rule.taskTitle} (${rule.radiusMeters} m)`,
          targetSection: 'nfc',
        });
        count++;
      }
    }

    return items.slice(0, MAX_TOTAL_RESULTS);
  }, [customerMap, db, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev + 1) % results.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          results.length > 0 ? (prev - 1 + results.length) % results.length : 0
        );
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        const item = results[selectedIndex];
        onNavigate(item.targetSection);
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNavigate, open, results, selectedIndex]);

  if (!open || typeof document === 'undefined') return null;

  const getCategoryIcon = (cat: SearchResultItem['category']) => {
    switch (cat) {
      case 'Kunde':
        return <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
      case 'Produkt':
        return <Package className="h-4 w-4 text-violet-600 dark:text-violet-400" />;
      case 'Rechnung':
        return <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
      case 'Tätigkeit':
        return <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
      case 'NFC-Aufgabe':
        return <Nfc className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" />;
      case 'Ausgabe':
        return <Receipt className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
      case 'Fixkosten':
        return <Repeat className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
      case 'Ortsregel':
        return <MapPin className="h-4 w-4 text-teal-600 dark:text-teal-400" />;
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Globale Schnellsuche"
      onClick={onClose}
      className="fixed inset-0 z-[180] flex items-start justify-center bg-slate-950/60 px-3 pt-[10vh] backdrop-blur-xs sm:px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3 dark:border-[#2a2045]">
          <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-violet-300" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suche nach Kunden, Rechnungen, Tätigkeiten, NFC, Belegen…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Suche leeren"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Schnellsuche schließen"
            className="rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:border-[#3b2d5e] dark:text-slate-400 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            ESC
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Keine Treffer für „{query}“ gefunden.
            </div>
          ) : (
            <ul className="space-y-1">
              {results.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <li key={item.id}>
                    <div
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition-colors ${
                        isSelected
                          ? 'bg-slate-100 dark:bg-[#2a2045]'
                          : 'hover:bg-slate-50 dark:hover:bg-[#211936]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onNavigate(item.targetSection);
                          onClose();
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-[#211936]">
                          {getCategoryIcon(item.category)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                              {item.title}
                            </span>
                            <span className="shrink-0 rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-[#3b2d5e]/70 dark:text-violet-200">
                              {item.category}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                            {item.subtitle}
                          </span>
                        </span>
                      </button>

                      {item.nfcTask && onTriggerNfcTask && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTriggerNfcTask(item.nfcTask!);
                            onClose();
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg ui-accent-btn px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                        >
                          <Play className="h-3 w-3" />
                          Start
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500 dark:border-[#2a2045] dark:bg-[#120d1f] dark:text-slate-400">
          <span>{results.length} Ergebnis(se)</span>
          <span className="hidden sm:inline">↑↓ Navigieren · Enter Öffnen · Strg+K</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
