import {
  Camera,
  CheckCircle2,
  CloudUpload,
  Edit3,
  Eye,
  FileImage,
  Loader2,
  Plus,
  Receipt,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Customer, Expense, TaxRate } from '../types';
import { apiScanReceiptWithAi } from '../utils/apiClient';
import { createId, formatCurrency, formatDateDE, toInputDate } from '../utils/format';
import { DEFAULT_EXPENSE_CATEGORIES } from '../utils/sampleData';
import { CategoryPicker, ThemedSelect } from './ThemedSelect';

interface ExpensesViewProps {
  expenses: Expense[];
  customers: Customer[];
  nextcloudConfigured: boolean;
  onAddExpense: (expense: Expense) => void;
  onUpdateExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
  onUploadExpenseReceipt: (expense: Expense) => Promise<void>;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'warning') => void;
}

async function compressImageFileToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) {
        reject(new Error('Leeres Bild.'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Bildformat wird nicht unterstützt.'));
      img.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export function ExpensesView({
  expenses,
  customers,
  nextcloudConfigured,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  onUploadExpenseReceipt,
  onNotify,
}: ExpensesViewProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [showBillableOnly, setShowBillableOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scanningAi, setScanningAi] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<Expense | null>(null);

  const [date, setDate] = useState(toInputDate());
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(DEFAULT_EXPENSE_CATEGORIES[0]);
  const [taxRate, setTaxRate] = useState<TaxRate>(19);
  const [grossAmount, setGrossAmount] = useState<number>(0);
  const [netAmount, setNetAmount] = useState<number>(0);
  const [customerId, setCustomerId] = useState<string>('');
  const [billableToCustomer, setBillableToCustomer] = useState(false);
  const [notes, setNotes] = useState('');
  const [receiptImageDataUrl, setReceiptImageDataUrl] = useState<string>('');

  const availableCategories = useMemo(() => {
    const set = new Set<string>(DEFAULT_EXPENSE_CATEGORIES);
    expenses.forEach((e) => {
      if (e.category?.trim()) set.add(e.category.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  }, [expenses]);

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );

  const filtered = useMemo(() => {
    return [...expenses]
      .filter((e) => (categoryFilter === 'ALL' ? true : e.category === categoryFilter))
      .filter((e) => (showBillableOnly ? Boolean(e.billableToCustomer) : true))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, categoryFilter, showBillableOnly]);

  const stats = useMemo(() => {
    const totalGross = expenses.reduce((acc, e) => acc + (e.grossAmount || 0), 0);
    const totalNet = expenses.reduce((acc, e) => acc + (e.netAmount || 0), 0);
    const openBillable = expenses.filter((e) => e.billableToCustomer && !e.billedInvoiceId);
    const openBillableNet = openBillable.reduce((acc, e) => acc + (e.netAmount || 0), 0);
    return {
      totalGross,
      totalNet,
      openBillableCount: openBillable.length,
      openBillableNet,
    };
  }, [expenses]);

  const resetForm = () => {
    setEditingId(null);
    setDate(toInputDate());
    setVendor('');
    setDescription('');
    setCategory(DEFAULT_EXPENSE_CATEGORIES[0]);
    setTaxRate(19);
    setGrossAmount(0);
    setNetAmount(0);
    setCustomerId('');
    setBillableToCustomer(false);
    setNotes('');
    setReceiptImageDataUrl('');
  };

  const openNewModal = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingId(exp.id);
    setDate(exp.date);
    setVendor(exp.vendor);
    setDescription(exp.description);
    setCategory(exp.category || DEFAULT_EXPENSE_CATEGORIES[0]);
    setTaxRate(exp.taxRate);
    setGrossAmount(exp.grossAmount);
    setNetAmount(exp.netAmount);
    setCustomerId(exp.customerId || '');
    setBillableToCustomer(Boolean(exp.billableToCustomer));
    setNotes(exp.notes || '');
    setReceiptImageDataUrl(exp.receiptImageDataUrl || '');
    setFormOpen(true);
  };

  const handleGrossChange = (val: number) => {
    const safe = Math.max(0, Number.isFinite(val) ? val : 0);
    setGrossAmount(safe);
    setNetAmount(Math.round((safe / (1 + taxRate / 100)) * 100) / 100);
  };

  const handleNetChange = (val: number) => {
    const safe = Math.max(0, Number.isFinite(val) ? val : 0);
    setNetAmount(safe);
    setGrossAmount(Math.round(safe * (1 + taxRate / 100) * 100) / 100);
  };

  const handleTaxChange = (nextTax: TaxRate) => {
    setTaxRate(nextTax);
    if (grossAmount > 0) {
      setNetAmount(Math.round((grossAmount / (1 + nextTax / 100)) * 100) / 100);
    } else if (netAmount > 0) {
      setGrossAmount(Math.round(netAmount * (1 + nextTax / 100) * 100) / 100);
    }
  };

  const handleReceiptSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    autoScan = true
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToJpeg(file);
      setReceiptImageDataUrl(dataUrl);
      if (!formOpen) setFormOpen(true);
      if (autoScan) {
        setScanningAi(true);
        try {
          const parsed = await apiScanReceiptWithAi(dataUrl);
          if (parsed.vendor) setVendor(parsed.vendor);
          if (parsed.date) setDate(parsed.date);
          if (parsed.description) setDescription(parsed.description);
          if (parsed.category) setCategory(parsed.category);
          setTaxRate(parsed.taxRate);
          if (parsed.grossAmount > 0) setGrossAmount(parsed.grossAmount);
          if (parsed.netAmount > 0) setNetAmount(parsed.netAmount);
          if (parsed.notes) setNotes(parsed.notes);
          onNotify('Beleg erfolgreich per KI analysiert!', 'success');
        } catch (aiErr) {
          onNotify(
            aiErr instanceof Error
              ? aiErr.message
              : 'Belegfoto angehängt. Werte bitte manuell ergänzen.',
            'warning'
          );
        } finally {
          setScanningAi(false);
        }
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Bild konnte nicht verarbeitet werden.',
        'warning'
      );
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendor.trim() && !description.trim()) {
      onNotify('Bitte mindestens Händler/Anbieter oder Beschreibung angeben.', 'warning');
      return;
    }

    const existing = editingId ? expenses.find((item) => item.id === editingId) : undefined;
    const payload: Expense = {
      id: editingId || createId('exp'),
      date: date || toInputDate(),
      vendor: vendor.trim() || 'Unbekannter Anbieter',
      description: description.trim() || vendor.trim(),
      category: category.trim() || 'Sonstiges',
      netAmount: Math.round(netAmount * 100) / 100,
      taxRate,
      grossAmount: Math.round(grossAmount * 100) / 100,
      customerId: customerId || null,
      billableToCustomer: Boolean(billableToCustomer && customerId),
      billedInvoiceId: existing?.billedInvoiceId ?? null,
      receiptImageDataUrl: receiptImageDataUrl || undefined,
      notes: notes.trim() || undefined,
      nextcloudUploadedAt: existing?.nextcloudUploadedAt ?? null,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    if (editingId) {
      onUpdateExpense(payload);
    } else {
      onAddExpense(payload);
    }
    setFormOpen(false);
    resetForm();
  };

  return (
    <div className="space-y-6">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void handleReceiptSelected(e, true)}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handleReceiptSelected(e, true)}
        className="hidden"
      />

      {/* Top KPI Cards + Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Ausgaben gesamt (Brutto)
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
            {formatCurrency(stats.totalGross)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Netto: {formatCurrency(stats.totalNet)} ({expenses.length} Belege)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Weiterberechenbar (offen)
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {formatCurrency(stats.openBillableNet)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {stats.openBillableCount} offene Kundenauslage(n) für Rechnungen
          </p>
        </div>

        <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl ui-accent-btn px-3 py-2 text-xs font-semibold text-white shadow-sm cursor-pointer"
            >
              <Camera className="h-4 w-4" />
              Beleg scannen
            </button>
            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Manuell
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Foto aufnehmen oder hochladen — KI liest Händler, Datum & Betrag aus.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
        <div className="flex flex-wrap items-center gap-2.5">
          <ThemedSelect
            size="sm"
            className="w-56"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: 'ALL', label: 'Alle Ausgabenkategorien' },
              ...availableCategories.map((c) => ({ value: c, label: c })),
            ]}
          />
          <button
            type="button"
            onClick={() => setShowBillableOnly((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              showBillableOnly
                ? 'ui-accent-selected border-violet-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300'
            }`}
          >
            Nur weiterberechenbare
          </button>
        </div>
        <button
          type="button"
          onClick={() => galleryInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 cursor-pointer"
        >
          <FileImage className="h-3.5 w-3.5" />
          Foto aus Galerie scannen
        </button>
      </div>

      {/* Expense List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-[#3b2d5e] dark:bg-[#19122c]">
          <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Noch keine Belege oder Ausgaben erfasst
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Scannen Sie Kassenbons per Kamera oder legen Sie eine Betriebsausgabe manuell an.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((exp) => {
            const cust = exp.customerId ? customerMap.get(exp.customerId) : undefined;
            return (
              <div
                key={exp.id}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]"
              >
                <div className="flex items-start gap-3">
                  {exp.receiptImageDataUrl ? (
                    <button
                      type="button"
                      onClick={() => setPreviewReceipt(exp)}
                      className="group relative h-16 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-[#3b2d5e] cursor-pointer"
                      title="Belegfoto vergrößern"
                    >
                      <img
                        src={exp.receiptImageDataUrl}
                        alt={exp.vendor}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <Eye className="h-4 w-4 text-white" />
                      </span>
                    </button>
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-[#241b3d] dark:text-slate-400">
                      <Receipt className="h-5 w-5" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {exp.vendor}
                      </h4>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {formatCurrency(exp.grossAmount)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">
                      {exp.description}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-[#2a2045] dark:text-slate-300">
                        {formatDateDE(exp.date)}
                      </span>
                      <span className="rounded-md bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                        {exp.category}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        Netto {formatCurrency(exp.netAmount)} ({exp.taxRate} %)
                      </span>
                    </div>

                    {cust && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                          Kunde: {cust.companyName}
                        </span>
                        {exp.billableToCustomer && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold ${
                              exp.billedInvoiceId
                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300'
                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                            }`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {exp.billedInvoiceId ? 'Bereits berechnet' : 'Weiterberechenbar'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-100 pt-2.5 dark:border-[#2e234a]">
                  {exp.receiptImageDataUrl && nextcloudConfigured && (
                    <button
                      type="button"
                      disabled={uploadingId === exp.id}
                      onClick={async () => {
                        setUploadingId(exp.id);
                        try {
                          await onUploadExpenseReceipt(exp);
                        } finally {
                          setUploadingId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                    >
                      {uploadingId === exp.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CloudUpload className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
                      )}
                      {exp.nextcloudUploadedAt ? 'Erneut sichern' : 'Nach Nextcloud'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEditModal(exp)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteExpense(exp.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/15 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Expense Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#342653] dark:bg-[#19122c]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-[#2e234a]">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingId ? 'Beleg bearbeiten' : 'Beleg / Ausgabe erfassen'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto p-5 space-y-4">
              {/* Scan bar inside modal */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                <div className="flex items-center gap-2 text-xs text-violet-900 dark:text-violet-200">
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span>
                    {scanningAi
                      ? 'KI liest Belegdaten aus...'
                      : 'Foto aufnehmen / auswählen für automatische Beleg-Erkennung'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={scanningAi}
                    onClick={() => cameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg ui-accent-btn px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                  >
                    {scanningAi ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                    Kamera
                  </button>
                  <button
                    type="button"
                    disabled={scanningAi}
                    onClick={() => galleryInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
                  >
                    <FileImage className="h-3.5 w-3.5" />
                    Datei
                  </button>
                </div>
              </div>

              {receiptImageDataUrl && (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-[#3b2d5e] dark:bg-[#211936]">
                  <img
                    src={receiptImageDataUrl}
                    alt="Belegvorschau"
                    className="h-16 w-14 rounded-lg object-cover border border-slate-200"
                  />
                  <div className="min-w-0 flex-1 text-xs text-slate-600 dark:text-slate-300">
                    Belegfoto angehängt.
                  </div>
                  <button
                    type="button"
                    disabled={scanningAi}
                    onClick={async () => {
                      setScanningAi(true);
                      try {
                        const parsed = await apiScanReceiptWithAi(receiptImageDataUrl);
                        if (parsed.vendor) setVendor(parsed.vendor);
                        if (parsed.date) setDate(parsed.date);
                        if (parsed.description) setDescription(parsed.description);
                        if (parsed.category) setCategory(parsed.category);
                        setTaxRate(parsed.taxRate);
                        if (parsed.grossAmount > 0) setGrossAmount(parsed.grossAmount);
                        if (parsed.netAmount > 0) setNetAmount(parsed.netAmount);
                        if (parsed.notes) setNotes(parsed.notes);
                        onNotify('Belegdaten aktualisiert.', 'success');
                      } catch (err) {
                        onNotify(
                          err instanceof Error ? err.message : 'Scan fehlgeschlagen.',
                          'warning'
                        );
                      } finally {
                        setScanningAi(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/40 dark:bg-[#19122c] dark:text-violet-300 cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Erneut scannen
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Anbieter / Händler *
                  </label>
                  <input
                    type="text"
                    required
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder="z. B. Aral, Conrad, Obi..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Belegdatum
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Beschreibung / Positionen
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="z. B. Materialeinsatz oder Kraftstoff"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kategorie
                  </label>
                  <CategoryPicker
                    value={category}
                    onChange={setCategory}
                    categories={availableCategories}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Bruttobetrag (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={grossAmount}
                    onChange={(e) => handleGrossChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    MwSt.-Satz
                  </label>
                  <ThemedSelect
                    value={String(taxRate)}
                    onChange={(v) => handleTaxChange(Number(v) as TaxRate)}
                    options={[
                      { value: '19', label: '19 % USt.' },
                      { value: '7', label: '7 % USt.' },
                      { value: '0', label: '0 % (Steuerfrei)' },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Nettobetrag (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={netAmount}
                    onChange={(e) => handleNetChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-[#342653] dark:bg-[#211936]/70">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kunde zuordnen (optional)
                  </label>
                  <ThemedSelect
                    value={customerId}
                    onChange={(v) => {
                      setCustomerId(v);
                      if (!v) setBillableToCustomer(false);
                    }}
                    options={[
                      { value: '', label: 'Kein Kunde (Interne Betriebsausgabe)' },
                      ...customers.map((c) => ({
                        value: c.id,
                        label: c.companyName,
                        hint: c.customerNumber,
                      })),
                    ]}
                  />
                </div>
                {customerId && (
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={billableToCustomer}
                      onChange={(e) => setBillableToCustomer(e.target.checked)}
                      className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    Auf nächster Kundenrechnung weiterberechnen (Auslage)
                  </label>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Notizen / Belegnummer
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                />
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
                  {editingId ? 'Änderungen speichern' : 'Beleg speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Receipt Image Preview Modal */}
      {previewReceipt && previewReceipt.receiptImageDataUrl && (
        <div
          onClick={() => setPreviewReceipt(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{previewReceipt.vendor}</p>
                <p className="text-xs text-slate-400">
                  {formatDateDE(previewReceipt.date)} · {formatCurrency(previewReceipt.grossAmount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewReceipt(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-3 bg-slate-950 flex items-center justify-center">
              <img
                src={previewReceipt.receiptImageDataUrl}
                alt={previewReceipt.vendor}
                className="max-h-[75vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
