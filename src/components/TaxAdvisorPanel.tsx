import {
  Archive,
  Calculator,
  Download,
  FileSpreadsheet,
  Receipt,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import type { AppDatabase } from '../types';
import { formatCurrency } from '../utils/format';
import {
  calculateTaxPeriodSummary,
  downloadDatevCsv,
  downloadTaxAdvisorZip,
  type TaxBasisMode,
  type TaxPeriodType,
} from '../utils/taxExport';
import { InfoHintPopup } from './InfoHintPopup';
import { ThemedSelect } from './ThemedSelect';

interface TaxAdvisorPanelProps {
  db: AppDatabase;
  onNotify?: (message: string, tone?: 'success' | 'info' | 'error') => void;
}

export const TaxAdvisorPanel: React.FC<TaxAdvisorPanelProps> = ({ db, onNotify }) => {
  const currentYear = new Date().getFullYear();

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear, currentYear - 1]);
    for (const inv of db.invoices) {
      const y = parseInt(inv.issueDate?.slice(0, 4) || '', 10);
      if (!Number.isNaN(y) && y >= 2015 && y <= 2100) years.add(y);
    }
    for (const exp of db.expenses ?? []) {
      const y = parseInt(exp.date?.slice(0, 4) || '', 10);
      if (!Number.isNaN(y) && y >= 2015 && y <= 2100) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [currentYear, db.expenses, db.invoices]);

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedPeriod, setSelectedPeriod] = useState<TaxPeriodType>('year');
  const [basis, setBasis] = useState<TaxBasisMode>('ist');
  const [exportingZip, setExportingZip] = useState(false);

  const summary = useMemo(
    () => calculateTaxPeriodSummary(db, selectedYear, selectedPeriod, basis),
    [basis, db, selectedPeriod, selectedYear]
  );

  const maxCatAmount = useMemo(
    () => Math.max(...summary.expenseByCategory.map((c) => c.net), 1),
    [summary.expenseByCategory]
  );

  const handleDownloadCsv = async () => {
    try {
      await downloadDatevCsv(summary);
      onNotify?.(`DATEV-CSV für ${summary.periodLabel} exportiert.`, 'success');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'DATEV-CSV Export fehlgeschlagen.',
        'error'
      );
    }
  };

  const handleDownloadZip = async () => {
    if (exportingZip) return;
    setExportingZip(true);
    try {
      await downloadTaxAdvisorZip(db, summary);
      onNotify?.(
        `Steuerberater-Paket (${summary.invoicesIncluded.length} Rechnungen, ${summary.expensesIncluded.length} Belege) erstellt.`,
        'success'
      );
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Steuerberater-Paket konnte nicht erstellt werden.',
        'error'
      );
    } finally {
      setExportingZip(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter & Export Toolbar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-[#2a2045] dark:bg-[#171126]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              EÜR, UStVA & Steuerberater-Export
            </h2>
            <InfoHintPopup
              title="EÜR, UStVA & DATEV-Export"
              text="Berechnet Betriebseinnahmen, Betriebsausgaben, EÜR-Überschuss und UStVA-Kennzahlen (Elster Kz. 81, 86, 66, 83) für ein Jahr oder Quartal. Über den ZIP-Export erhältst du alle Rechnungs-PDFs, Belegfotos, den EÜR-Bericht und die DATEV-Buchungs-CSV (SKR03) in einem Paket."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="w-28">
              <ThemedSelect
                size="sm"
                ariaLabel="Steuerjahr wählen"
                value={String(selectedYear)}
                onChange={(v) => setSelectedYear(Number(v))}
                options={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
              />
            </div>

            <div className="w-36">
              <ThemedSelect
                size="sm"
                ariaLabel="Zeitraum wählen"
                value={selectedPeriod}
                onChange={(v) => setSelectedPeriod(v as TaxPeriodType)}
                options={[
                  { value: 'year', label: 'Gesamtjahr' },
                  { value: 'Q1', label: 'Q1 (Jan – Mär)' },
                  { value: 'Q2', label: 'Q2 (Apr – Jun)' },
                  { value: 'Q3', label: 'Q3 (Jul – Sep)' },
                  { value: 'Q4', label: 'Q4 (Okt – Dez)' },
                ]}
              />
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-[#3b2d5e] dark:bg-[#211936]">
              <button
                type="button"
                onClick={() => setBasis('ist')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  basis === 'ist'
                    ? 'ui-accent-active text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                Ist (Bezahlt)
              </button>
              <button
                type="button"
                onClick={() => setBasis('soll')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  basis === 'soll'
                    ? 'ui-accent-active text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                Soll (Gestellt)
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-[#2a2045]">
          <button
            type="button"
            onClick={() => void handleDownloadZip()}
            disabled={exportingZip}
            className="inline-flex items-center gap-2 rounded-xl ui-accent-btn px-3.5 py-2 text-xs font-semibold text-white shadow-xs disabled:opacity-60 cursor-pointer"
          >
            <Archive className="h-4 w-4" />
            {exportingZip ? 'Paket wird erstellt…' : 'Steuerberater-Paket (ZIP)'}
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            DATEV-CSV (SKR03)
          </button>

          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {summary.invoicesIncluded.length} Rechnungen · {summary.expensesIncluded.length} Belege
          </span>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#2a2045] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Einnahmen ({summary.isSmallBusinessCompany ? '§19' : 'Netto'})</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatCurrency(
              summary.isSmallBusinessCompany ? summary.revenueGrossTotal : summary.revenueNetTotal
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Brutto: {formatCurrency(summary.revenueGrossTotal)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#2a2045] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Ausgaben ({summary.isSmallBusinessCompany ? 'Brutto' : 'Netto'})</span>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatCurrency(
              summary.isSmallBusinessCompany ? summary.expenseGrossTotal : summary.expenseNetTotal
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Brutto: {formatCurrency(summary.expenseGrossTotal)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#2a2045] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>EÜR-Überschuss (Gewinn)</span>
            <Calculator className="h-4 w-4 text-violet-500" />
          </div>
          <div
            className={`mt-1.5 font-mono text-xl font-bold tabular-nums ${
              summary.euerProfit >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatCurrency(summary.euerProfit)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {summary.periodLabel} ({basis === 'ist' ? 'Ist' : 'Soll'})
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#2a2045] dark:bg-[#171126]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>UStVA Zahllast (Kz. 83)</span>
            <Receipt className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {summary.isSmallBusinessCompany ? '0,00 €' : formatCurrency(summary.vatPayable)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {summary.isSmallBusinessCompany
              ? 'Kleinunternehmer (§ 19 UStG)'
              : summary.vatPayable >= 0
                ? 'An das Finanzamt zu zahlen'
                : 'Vorsteuer-Erstattungsanspruch'}
          </div>
        </div>
      </div>

      {/* Elster UStVA Kennzahlen + Ausgabenkategorien */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#2a2045] dark:bg-[#171126]">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            ELSTER UStVA-Kennzahlen ({summary.periodLabel})
          </h3>
          <div className="mt-3 divide-y divide-slate-100 text-xs dark:divide-[#2a2045]">
            <div className="flex items-center justify-between py-2.5">
              <div>
                <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">
                  Kz. 81
                </span>{' '}
                <span className="text-slate-700 dark:text-slate-200">
                  Steuerpflichtige Umsätze 19 % (Netto)
                </span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatCurrency(summary.revenueNet19)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  USt: {formatCurrency(summary.revenueVat19)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <div>
                <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">
                  Kz. 86
                </span>{' '}
                <span className="text-slate-700 dark:text-slate-200">
                  Steuerpflichtige Umsätze 7 % (Netto)
                </span>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatCurrency(summary.revenueNet7)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  USt: {formatCurrency(summary.revenueVat7)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <div>
                <span className="font-mono font-semibold text-slate-500 dark:text-slate-400">
                  0 % / §19
                </span>{' '}
                <span className="text-slate-700 dark:text-slate-200">
                  Steuerfreie / Kleinunternehmer-Umsätze
                </span>
              </div>
              <div className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {formatCurrency(summary.revenueNet0)}
              </div>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <div>
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                  Kz. 66
                </span>{' '}
                <span className="text-slate-700 dark:text-slate-200">
                  Abziehbare Vorsteuer aus Rechnungen
                </span>
              </div>
              <div className="font-mono font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                − {formatCurrency(summary.expenseInputVatTotal)}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 font-semibold">
              <div>
                <span className="font-mono text-amber-700 dark:text-amber-300">Kz. 83</span>{' '}
                <span className="text-slate-900 dark:text-white">
                  Verbleibende USt-Vorauszahlung
                </span>
              </div>
              <div className="font-mono text-sm text-slate-900 tabular-nums dark:text-white">
                {formatCurrency(summary.vatPayable)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#2a2045] dark:bg-[#171126]">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Betriebsausgaben nach Kategorie
          </h3>
          {summary.expenseByCategory.length === 0 ? (
            <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Keine Ausgaben im ausgewählten Zeitraum vorhanden.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {summary.expenseByCategory.slice(0, 8).map((cat) => {
                const pct = Math.max(4, Math.min(100, Math.round((cat.net / maxCatAmount) * 100)));
                return (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                        {cat.category}{' '}
                        <span className="text-slate-400">({cat.count})</span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {formatCurrency(
                          summary.isSmallBusinessCompany ? cat.gross : cat.net
                        )}
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 100 4"
                      preserveAspectRatio="none"
                      className="h-1.5 w-full overflow-hidden rounded-full"
                      aria-hidden="true"
                    >
                      <rect
                        x="0"
                        y="0"
                        width="100"
                        height="4"
                        rx="2"
                        className="fill-slate-100 dark:fill-[#2a2045]"
                      />
                      <rect
                        x="0"
                        y="0"
                        width={pct}
                        height="4"
                        rx="2"
                        className="fill-violet-500"
                      />
                    </svg>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-[#211936] dark:text-slate-400">
            <Download className="h-3.5 w-3.5 shrink-0 text-violet-500" />
            <span>
              Tipp: Das Steuerberater-Paket enthält alle Rechnungen als PDF, alle Belegfotos und den
              DATEV-Buchungsstapel (SKR03).
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
