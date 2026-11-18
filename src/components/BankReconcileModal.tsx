import { CheckCircle2, FileUp, Landmark, Upload, X } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Invoice } from '../types';
import {
  matchBankTransactionsToInvoices,
  parseBankStatementCsv,
  type BankReconcileMatch,
  type ParsedBankTransaction,
} from '../utils/bankReconcile';
import { formatCurrency, formatDateDE } from '../utils/format';

interface BankReconcileModalProps {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
  onApplyPaid: (invoiceIds: string[]) => void;
}

export const BankReconcileModal: React.FC<BankReconcileModalProps> = ({
  open,
  onClose,
  invoices,
  onApplyPaid,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [transactions, setTransactions] = useState<ParsedBankTransaction[]>([]);
  const [matches, setMatches] = useState<BankReconcileMatch[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState('');

  const openInvoiceCount = useMemo(
    () =>
      invoices.filter(
        (i) =>
          i.documentType !== 'quote' &&
          !i.isArchived &&
          (i.status === 'Gesendet' || i.status === 'Entwurf')
      ).length,
    [invoices]
  );

  if (!open || typeof document === 'undefined') return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setParseError('');
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      // Decode UTF-8 first; if German bank exported Windows-1252 / ISO-8859-1 (replacement char U+FFFD), fallback cleanly
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('\uFFFD')) {
        try {
          text = new TextDecoder('windows-1252').decode(buffer);
        } catch {
          // Keep UTF-8 decoded text
        }
      }

      const parsed = parseBankStatementCsv(text);
      setTransactions(parsed);
      if (parsed.length === 0) {
        setMatches([]);
        setSelectedIds(new Set());
        setParseError(
          'Keine eingehenden Zahlungen (Gutschriften) in dieser CSV erkannt. Prüfe, ob Betrags- und Buchungsdatumsspalten enthalten sind.'
        );
        return;
      }

      const found = matchBankTransactionsToInvoices(parsed, invoices);
      setMatches(found);
      // Pre-select exact & high-confidence matches automatically
      const preselected = new Set<string>(
        found
          .filter((m) => m.confidence === 'exact_number' || m.confidence === 'amount_and_name')
          .map((m) => m.invoice.id)
      );
      setSelectedIds(preselected);
    } catch {
      setParseError('Die CSV-Datei konnte nicht gelesen werden.');
    }
  };

  const toggleSelect = (invoiceId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  };

  const handleConfirm = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    onApplyPaid(ids);
    onClose();
  };

  const badgeForConfidence = (c: BankReconcileMatch['confidence']) => {
    if (c === 'exact_number') {
      return (
        <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
          Exakt (Rechnungsnr.)
        </span>
      );
    }
    if (c === 'amount_and_name') {
      return (
        <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
          Wahrscheinlich
        </span>
      );
    }
    return (
      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
        Betrag passt
      </span>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kontoabgleich per CSV"
      onClick={onClose}
      className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-[#2a2045]">
          <div className="flex items-center gap-2.5">
            <Landmark className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Zahlungsabgleich (Bank-CSV)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {openInvoiceCount} offene Rechnung(en) zum automatischen Abgleich
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dialog schließen"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-center dark:border-[#3b2d5e] dark:bg-[#211936]/70">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <FileUp className="mx-auto h-7 w-7 text-violet-600 dark:text-violet-400" />
            <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-200">
              {fileName
                ? `Geladen: ${fileName} (${transactions.length} Zahlungseingänge erkannt)`
                : 'CSV-Umsatzexport deiner Bank auswählen (Sparkasse, Volksbank, ING, DKB, N26, Commerzbank…)'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Die Datei wird vollständig lokal auf deinem Gerät ausgewertet — keine Bankdaten werden hochgeladen.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl ui-accent-btn px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              {fileName ? 'Andere CSV-Datei wählen' : 'Bank-CSV auswählen'}
            </button>
          </div>

          {parseError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {parseError}
            </div>
          )}

          {fileName && !parseError && matches.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-600 dark:border-[#2a2045] dark:bg-[#211936] dark:text-slate-300">
              Keine offenen Rechnungen passend zu den {transactions.length} gefundenen Zahlungseingängen erkannt.
            </div>
          )}

          {matches.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span>{matches.length} Zuordnung(en) gefunden</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {selectedIds.size} ausgewählt
                </span>
              </div>

              <div className="space-y-2">
                {matches.map((m) => {
                  const checked = selectedIds.has(m.invoice.id);
                  const invAmount = m.invoice.isSmallBusiness
                    ? m.invoice.netTotal
                    : m.invoice.grossTotal;
                  return (
                    <label
                      key={m.invoice.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                        checked
                          ? 'border-violet-400 bg-violet-50/60 dark:border-violet-500/70 dark:bg-violet-950/25'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-[#2a2045] dark:bg-[#211936]/50 dark:hover:bg-[#211936]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(m.invoice.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                              {m.invoice.invoiceNumber}
                            </span>
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                              {m.invoice.customerSnapshot.companyName}
                            </span>
                            {badgeForConfidence(m.confidence)}
                          </div>
                          <span className="font-mono text-xs font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                            +{formatCurrency(m.transaction.amount)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          {m.reason} (Rechnungsbetrag: {formatCurrency(invAmount)})
                        </p>
                        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {m.transaction.date ? `${formatDateDE(m.transaction.date)} · ` : ''}
                          {m.transaction.payer ? `${m.transaction.payer} · ` : ''}
                          {m.transaction.purpose}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5 dark:border-[#2a2045] dark:bg-[#120d1f]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="inline-flex items-center gap-1.5 rounded-xl ui-accent-btn px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4" />
            {selectedIds.size > 0
              ? `${selectedIds.size} als bezahlt markieren`
              : 'Als bezahlt markieren'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
