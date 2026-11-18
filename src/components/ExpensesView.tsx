import {
  AlertCircle,
  Building2,
  Camera,
  CheckCircle2,
  CloudUpload,
  Edit3,
  Eye,
  FileImage,
  Loader2,
  Play,
  Plus,
  Receipt,
  Repeat,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  Customer,
  Expense,
  RecurringExpense,
  RecurringInterval,
  TaxRate,
} from '../types';
import { apiScanReceiptWithAi } from '../utils/apiClient';
import { createId, formatCurrency, formatDateDE, toInputDate } from '../utils/format';
import { DEFAULT_EXPENSE_CATEGORIES } from '../utils/sampleData';
import { InfoHintPopup } from './InfoHintPopup';
import { CategoryPicker, ThemedSelect } from './ThemedSelect';

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  monthly: 'Monatlich',
  quarterly: 'Quartalsweise',
  yearly: 'Jährlich',
};

interface ExpensesViewProps {
  expenses: Expense[];
  recurringExpenses?: RecurringExpense[];
  customers: Customer[];
  expenseCategories?: string[];
  nextcloudConfigured: boolean;
  onAddExpense: (expense: Expense) => void;
  onUpdateExpense: (expense: Expense) => void;
  onDeleteExpense: (id: string) => void;
  onUploadExpenseReceipt: (expense: Expense) => Promise<void>;
  onAddRecurringExpense?: (item: RecurringExpense) => void;
  onUpdateRecurringExpense?: (item: RecurringExpense) => void;
  onDeleteRecurringExpense?: (id: string) => void;
  onBookRecurringExpense?: (id: string) => void;
  onBookAllDueRecurringExpenses?: () => void;
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
  recurringExpenses = [],
  customers,
  expenseCategories,
  nextcloudConfigured,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  onUploadExpenseReceipt,
  onAddRecurringExpense,
  onUpdateRecurringExpense,
  onDeleteRecurringExpense,
  onBookRecurringExpense,
  onBookAllDueRecurringExpenses,
  onNotify,
}: ExpensesViewProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const recCameraInputRef = useRef<HTMLInputElement>(null);
  const recGalleryInputRef = useRef<HTMLInputElement>(null);

  const configuredCategories = useMemo(
    () =>
      expenseCategories && expenseCategories.length > 0
        ? expenseCategories
        : DEFAULT_EXPENSE_CATEGORIES,
    [expenseCategories]
  );

  const defaultOperatingCategory = useMemo(
    () =>
      configuredCategories.find((c) => /miete|raum/i.test(c)) ??
      configuredCategories[0] ??
      'Sonstiges',
    [configuredCategories]
  );

  const defaultProjectCategory = useMemo(
    () =>
      configuredCategories.find((c) => !/miete|raum/i.test(c)) ??
      configuredCategories[0] ??
      'Sonstiges',
    [configuredCategories]
  );

  const [activeSubTab, setActiveSubTab] = useState<'receipts' | 'recurring'>('receipts');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'operating' | 'project'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [showBillableOnly, setShowBillableOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scanningAi, setScanningAi] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<{
    title: string;
    subtitle: string;
    imageDataUrl: string;
  } | null>(null);

  const [date, setDate] = useState(toInputDate());
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(defaultOperatingCategory);
  const [expenseType, setExpenseType] = useState<'operating' | 'project'>('operating');
  const [taxRate, setTaxRate] = useState<TaxRate>(19);
  const [grossAmount, setGrossAmount] = useState<number>(0);
  const [netAmount, setNetAmount] = useState<number>(0);
  const [customerId, setCustomerId] = useState<string>('');
  const [billableToCustomer, setBillableToCustomer] = useState(false);
  const [notes, setNotes] = useState('');
  const [receiptImageDataUrl, setReceiptImageDataUrl] = useState<string>('');

  // Recurring Expense Modal State
  const [recFormOpen, setRecFormOpen] = useState(false);
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [recVendor, setRecVendor] = useState('');
  const [recDescription, setRecDescription] = useState('');
  const [recCategory, setRecCategory] = useState(defaultOperatingCategory);
  const [recTaxRate, setRecTaxRate] = useState<TaxRate>(19);
  const [recGross, setRecGross] = useState<number>(0);
  const [recNet, setRecNet] = useState<number>(0);
  const [recInterval, setRecInterval] = useState<RecurringInterval>('monthly');
  const [recNextDueDate, setRecNextDueDate] = useState(toInputDate());
  const [recActive, setRecActive] = useState(true);
  const [recNotes, setRecNotes] = useState('');
  const [recReceiptImageDataUrl, setRecReceiptImageDataUrl] = useState<string>('');
  const [recScanningAi, setRecScanningAi] = useState(false);

  const availableCategories = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const addUnique = (val?: string) => {
      const clean = val?.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        ordered.push(clean);
      }
    };
    configuredCategories.forEach(addUnique);
    expenses.forEach((e) => addUnique(e.category));
    recurringExpenses.forEach((r) => addUnique(r.category));
    return ordered;
  }, [configuredCategories, expenses, recurringExpenses]);

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );

  const todayStr = toInputDate();

  const dueRecurringList = useMemo(
    () => recurringExpenses.filter((r) => r.active && r.nextDueDate <= todayStr),
    [recurringExpenses, todayStr]
  );

  const monthlyFixedCosts = useMemo(() => {
    let net = 0;
    let gross = 0;
    for (const r of recurringExpenses) {
      if (!r.active) continue;
      const factor = r.interval === 'monthly' ? 1 : r.interval === 'quarterly' ? 1 / 3 : 1 / 12;
      net += (r.netAmount || 0) * factor;
      gross += (r.grossAmount || 0) * factor;
    }
    return {
      net: Math.round(net * 100) / 100,
      gross: Math.round(gross * 100) / 100,
    };
  }, [recurringExpenses]);

  const filtered = useMemo(() => {
    return [...expenses]
      .filter((e) => {
        const isOperating = e.expenseType === 'operating' || !e.customerId;
        if (typeFilter === 'operating' && !isOperating) return false;
        if (typeFilter === 'project' && isOperating) return false;
        return true;
      })
      .filter((e) => (categoryFilter === 'ALL' ? true : e.category === categoryFilter))
      .filter((e) => (showBillableOnly ? Boolean(e.billableToCustomer) : true))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, typeFilter, categoryFilter, showBillableOnly]);

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
    setCategory(defaultProjectCategory);
    setExpenseType('operating');
    setTaxRate(19);
    setGrossAmount(0);
    setNetAmount(0);
    setCustomerId('');
    setBillableToCustomer(false);
    setNotes('');
    setReceiptImageDataUrl('');
  };

  const openNewModal = (defaultType: 'operating' | 'project' = 'operating') => {
    resetForm();
    setExpenseType(defaultType);
    setCategory(
      defaultType === 'operating' ? defaultOperatingCategory : defaultProjectCategory
    );
    setFormOpen(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingId(exp.id);
    setDate(exp.date);
    setVendor(exp.vendor);
    setDescription(exp.description);
    setCategory(exp.category || defaultOperatingCategory);
    setExpenseType(exp.expenseType ?? (exp.customerId ? 'project' : 'operating'));
    setTaxRate(exp.taxRate);
    setGrossAmount(exp.grossAmount);
    setNetAmount(exp.netAmount);
    setCustomerId(exp.customerId || '');
    setBillableToCustomer(Boolean(exp.billableToCustomer));
    setNotes(exp.notes || '');
    setReceiptImageDataUrl(exp.receiptImageDataUrl || '');
    setFormOpen(true);
  };

  const openNewRecurringModal = () => {
    setEditingRecId(null);
    setRecVendor('');
    setRecDescription('');
    setRecCategory(defaultOperatingCategory);
    setRecTaxRate(19);
    setRecGross(0);
    setRecNet(0);
    setRecInterval('monthly');
    setRecNextDueDate(toInputDate());
    setRecActive(true);
    setRecNotes('');
    setRecReceiptImageDataUrl('');
    setRecFormOpen(true);
  };

  const openEditRecurringModal = (item: RecurringExpense) => {
    setEditingRecId(item.id);
    setRecVendor(item.vendor);
    setRecDescription(item.description);
    setRecCategory(item.category || defaultOperatingCategory);
    setRecTaxRate(item.taxRate);
    setRecGross(item.grossAmount);
    setRecNet(item.netAmount);
    setRecInterval(item.interval);
    setRecNextDueDate(item.nextDueDate);
    setRecActive(item.active);
    setRecNotes(item.notes || '');
    setRecReceiptImageDataUrl(item.receiptImageDataUrl || '');
    setRecFormOpen(true);
  };

  const runRecurringReceiptAiScan = async (imageDataUrl: string) => {
    setRecScanningAi(true);
    try {
      const parsed = await apiScanReceiptWithAi(imageDataUrl);
      if (parsed.vendor) setRecVendor(parsed.vendor);
      if (parsed.description) setRecDescription(parsed.description);
      if (parsed.category) setRecCategory(parsed.category);
      setRecTaxRate(parsed.taxRate);
      if (parsed.grossAmount > 0) setRecGross(parsed.grossAmount);
      if (parsed.netAmount > 0) setRecNet(parsed.netAmount);
      if (parsed.notes) setRecNotes(parsed.notes);
      onNotify('Belegdaten für Fixkosten übernommen.', 'success');
    } catch (aiErr) {
      onNotify(
        aiErr instanceof Error
          ? aiErr.message
          : 'Beleg angehängt. Werte bitte bei Bedarf manuell ergänzen.',
        'warning'
      );
    } finally {
      setRecScanningAi(false);
    }
  };

  const handleRecurringReceiptSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToJpeg(file);
      setRecReceiptImageDataUrl(dataUrl);
      if (!recVendor.trim() && recGross === 0) {
        await runRecurringReceiptAiScan(dataUrl);
      } else {
        onNotify('Beleg / Vertrag an Fixkosten angehängt.', 'success');
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Bild konnte nicht verarbeitet werden.',
        'warning'
      );
    }
  };

  const handleRecGrossChange = (val: number) => {
    const safe = Math.max(0, Number.isFinite(val) ? val : 0);
    setRecGross(safe);
    setRecNet(Math.round((safe / (1 + recTaxRate / 100)) * 100) / 100);
  };

  const handleRecNetChange = (val: number) => {
    const safe = Math.max(0, Number.isFinite(val) ? val : 0);
    setRecNet(safe);
    setRecGross(Math.round(safe * (1 + recTaxRate / 100) * 100) / 100);
  };

  const handleRecTaxChange = (nextTax: TaxRate) => {
    setRecTaxRate(nextTax);
    if (recGross > 0) {
      setRecNet(Math.round((recGross / (1 + nextTax / 100)) * 100) / 100);
    } else if (recNet > 0) {
      setRecGross(Math.round(recNet * (1 + nextTax / 100) * 100) / 100);
    }
  };

  const handleSaveRecurring = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recVendor.trim() && !recDescription.trim()) {
      onNotify('Bitte Anbieter oder Beschreibung für die Fixkosten angeben.', 'warning');
      return;
    }
    const existing = editingRecId
      ? recurringExpenses.find((r) => r.id === editingRecId)
      : undefined;
    const payload: RecurringExpense = {
      id: editingRecId || createId('recexp'),
      vendor: recVendor.trim() || 'Unbekannter Anbieter',
      description: recDescription.trim() || recVendor.trim(),
      category: recCategory.trim() || 'Miete & Raumkosten',
      netAmount: Math.round(recNet * 100) / 100,
      taxRate: recTaxRate,
      grossAmount: Math.round(recGross * 100) / 100,
      interval: recInterval,
      active: recActive,
      nextDueDate: recNextDueDate || toInputDate(),
      lastBookedDate: existing?.lastBookedDate ?? null,
      receiptImageDataUrl: recReceiptImageDataUrl || undefined,
      notes: recNotes.trim() || undefined,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if (editingRecId) {
      onUpdateRecurringExpense?.(payload);
    } else {
      onAddRecurringExpense?.(payload);
    }
    setRecFormOpen(false);
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
      expenseType: expenseType,
      netAmount: Math.round(netAmount * 100) / 100,
      taxRate,
      grossAmount: Math.round(grossAmount * 100) / 100,
      customerId: expenseType === 'project' ? customerId || null : null,
      billableToCustomer: Boolean(
        expenseType === 'project' && billableToCustomer && customerId
      ),
      billedInvoiceId: existing?.billedInvoiceId ?? null,
      receiptImageDataUrl: receiptImageDataUrl || undefined,
      notes: notes.trim() || undefined,
      isRecurring: existing?.isRecurring,
      recurringExpenseId: existing?.recurringExpenseId ?? null,
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
      <input
        ref={recCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void handleRecurringReceiptSelected(e)}
        className="hidden"
      />
      <input
        ref={recGalleryInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handleRecurringReceiptSelected(e)}
        className="hidden"
      />

      {/* Page Header & Sub-Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Belege &amp; Betriebskosten
          </h1>
          <InfoHintPopup
            title="Belege & Betriebskosten"
            text="Einzelbelege scannen, allgemeine Betriebskosten erfassen und wiederkehrende Fixkosten wie Miete oder Abos verwalten."
          />
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-[#342653] dark:bg-[#19122c] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('receipts')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeSubTab === 'receipts'
                ? 'ui-accent-active text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#241b3d]'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            Belege &amp; Ausgaben ({expenses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('recurring')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeSubTab === 'recurring'
                ? 'ui-accent-active text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#241b3d]'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
            Wiederkehrende Fixkosten ({recurringExpenses.length})
            {dueRecurringList.length > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {dueRecurringList.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Due Recurring Expenses Banner (visible in both tabs if any due) */}
      {dueRecurringList.length > 0 && onBookAllDueRecurringExpenses && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-800/60 dark:bg-amber-950/40 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm text-amber-950 dark:text-amber-100">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">
                {dueRecurringList.length} wiederkehrende Ausgabe(n) sind fällig
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200/80">
                {dueRecurringList.map((r) => `${r.vendor} (${formatCurrency(r.grossAmount)})`).join(' · ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBookAllDueRecurringExpenses}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Alle fälligen verbuchen
          </button>
        </div>
      )}

      {/* Top KPI Cards + Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Ausgaben gesamt (Brutto)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(stats.totalGross)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Netto: {formatCurrency(stats.totalNet)} ({expenses.length} Buchungen)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Fixkosten pro Monat (Ø)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
            {formatCurrency(monthlyFixedCosts.gross)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Netto {formatCurrency(monthlyFixedCosts.net)}/Monat ·{' '}
            {recurringExpenses.filter((r) => r.active).length} aktiv
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Weiterberechenbar (offen)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {formatCurrency(stats.openBillableNet)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {stats.openBillableCount} offene Kundenauslage(n)
          </p>
        </div>

        <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
          {activeSubTab === 'recurring' ? (
            <>
              <button
                type="button"
                onClick={openNewRecurringModal}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl ui-accent-btn px-3 py-2 text-xs font-semibold text-white shadow-sm cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Neue Fixkosten (z. B. Miete)
              </button>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Monatliche, quartalsweise oder jährliche Betriebskosten automatisieren.
              </p>
            </>
          ) : (
            <>
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
                  onClick={() => openNewModal('operating')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Neu
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Beleg scannen oder sonstige Betriebskosten manuell eintragen.
              </p>
            </>
          )}
        </div>
      </div>

      {activeSubTab === 'recurring' ? (
        /* RECURRING FIXED EXPENSES TAB */
        <div className="space-y-4">
          {recurringExpenses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-[#3b2d5e] dark:bg-[#19122c]">
              <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-400" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Noch keine wiederkehrenden Betriebskosten hinterlegt
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Lege hier laufende Fixkosten wie Studio-Miete, Strom, Internet, Versicherungen oder Software-Abos an.
              </p>
              <button
                type="button"
                onClick={openNewRecurringModal}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl ui-accent-btn px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Erste Fixkosten anlegen
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {recurringExpenses.map((rec) => {
                const isDue = rec.active && rec.nextDueDate <= todayStr;
                return (
                  <div
                    key={rec.id}
                    className={`flex flex-col justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm dark:bg-[#19122c] ${
                      isDue
                        ? 'border-amber-300 dark:border-amber-700/70'
                        : 'border-slate-200 dark:border-[#342653]'
                    } ${!rec.active ? 'opacity-65' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {rec.receiptImageDataUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewReceipt({
                              title: rec.vendor,
                              subtitle: `${INTERVAL_LABELS[rec.interval]} · ${formatCurrency(rec.grossAmount)}`,
                              imageDataUrl: rec.receiptImageDataUrl!,
                            })
                          }
                          className="group relative h-16 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-[#3b2d5e] cursor-pointer"
                          title="Hinterlegten Beleg / Vertrag vergrößern"
                        >
                          <img
                            src={rec.receiptImageDataUrl}
                            alt={`Beleg ${rec.vendor}`}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-slate-900/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Eye className="h-4 w-4 text-white" />
                          </span>
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                                {rec.vendor}
                              </h4>
                              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                {INTERVAL_LABELS[rec.interval]}
                              </span>
                              {!rec.active && (
                                <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-[#2a2045] dark:text-slate-400">
                                  Pausiert
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                              {rec.description}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                              {formatCurrency(rec.grossAmount)}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              Netto {formatCurrency(rec.netAmount)} ({rec.taxRate}%)
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-md bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                            {rec.category}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 font-medium ${
                              isDue
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-[#2a2045] dark:text-slate-300'
                            }`}
                          >
                            {isDue ? 'Fällig seit ' : 'Nächste Buchung: '}
                            {formatDateDE(rec.nextDueDate)}
                          </span>
                          {rec.receiptImageDataUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewReceipt({
                                  title: rec.vendor,
                                  subtitle: `${INTERVAL_LABELS[rec.interval]} · ${formatCurrency(rec.grossAmount)}`,
                                  imageDataUrl: rec.receiptImageDataUrl!,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 cursor-pointer"
                            >
                              <Eye className="h-3 w-3" />
                              Beleg ansehen
                            </button>
                          )}
                          {rec.lastBookedDate && (
                            <span className="text-slate-500 dark:text-slate-400">
                              Zuletzt: {formatDateDE(rec.lastBookedDate)}
                            </span>
                          )}
                        </div>
                        {rec.notes && (
                          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                            {rec.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-[#2e234a]">
                      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rec.active}
                          onChange={(e) =>
                            onUpdateRecurringExpense?.({ ...rec, active: e.target.checked })
                          }
                          className="h-3.5 w-3.5 rounded accent-violet-600"
                        />
                        Aktiv
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {onBookRecurringExpense && (
                          <button
                            type="button"
                            onClick={() => onBookRecurringExpense(rec.id)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                              isDue
                                ? 'bg-amber-600 text-white hover:bg-amber-700'
                                : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#2a2045]'
                            }`}
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Jetzt verbuchen
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditRecurringModal(rec)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Bearbeiten
                        </button>
                        {onDeleteRecurringExpense && (
                          <button
                            type="button"
                            onClick={() => onDeleteRecurringExpense(rec.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/15 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* RECEIPTS & OPERATING EXPENSES TAB */
        <>
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936]">
                {([
                  { id: 'ALL', label: 'Alle' },
                  { id: 'operating', label: 'Betriebskosten' },
                  { id: 'project', label: 'Projekt / Kunde' },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTypeFilter(t.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      typeFilter === t.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
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
                Scanne Kassenbons per Kamera oder erfasse eine Betriebsausgabe manuell.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map((exp) => {
                const cust = exp.customerId ? customerMap.get(exp.customerId) : undefined;
                const isOperating = exp.expenseType === 'operating' || !exp.customerId;
                return (
                  <div
                    key={exp.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#342653] dark:bg-[#19122c]"
                  >
                    <div className="flex items-start gap-3">
                      {exp.receiptImageDataUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewReceipt({
                              title: exp.vendor,
                              subtitle: `${formatDateDE(exp.date)} · ${formatCurrency(exp.grossAmount)}`,
                              imageDataUrl: exp.receiptImageDataUrl!,
                            })
                          }
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
                          {exp.isRecurring ? (
                            <Repeat className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <Receipt className="h-5 w-5" />
                          )}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                            {exp.vendor}
                          </h4>
                          <span className="font-mono text-sm font-bold text-slate-900 dark:text-white tabular-nums">
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
                          {isOperating && (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              {exp.isRecurring ? 'Fixkosten' : 'Betriebskosten'}
                            </span>
                          )}
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
        </>
      )}

      {/* Expense Form Modal */}
      {formOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-no-swipe="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4"
        >
          <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#342653] dark:bg-[#19122c]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-[#2e234a]">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingId ? 'Ausgabe bearbeiten' : 'Beleg / Betriebskosten erfassen'}
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
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-[#3b2d5e] dark:bg-[#211936]">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewReceipt({
                        title: vendor.trim() || 'Belegvorschau',
                        subtitle: `${formatDateDE(date)} · ${formatCurrency(grossAmount)}`,
                        imageDataUrl: receiptImageDataUrl,
                      })
                    }
                    className="h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 cursor-pointer"
                    title="Vorschau vergrößern"
                  >
                    <img
                      src={receiptImageDataUrl}
                      alt="Belegvorschau"
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1 text-xs text-slate-600 dark:text-slate-300">
                    Belegfoto angehängt.
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
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
                    <button
                      type="button"
                      onClick={() => setReceiptImageDataUrl('')}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-[#19122c] dark:text-rose-300 cursor-pointer"
                      title="Beleg entfernen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kostenart
                  </span>
                  <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-[#19122c]">
                    <button
                      type="button"
                      onClick={() => {
                        setExpenseType('operating');
                        setCustomerId('');
                        setBillableToCustomer(false);
                      }}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                        expenseType === 'operating'
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Betriebskosten (allgemein)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpenseType('project')}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                        expenseType === 'project'
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Projekt / Kunde
                    </button>
                  </div>
                </div>
                {expenseType === 'project' && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Kunde zuordnen
                      </label>
                      <ThemedSelect
                        value={customerId}
                        onChange={(v) => {
                          setCustomerId(v);
                          if (!v) setBillableToCustomer(false);
                        }}
                        options={[
                          { value: '', label: 'Kein Kunde' },
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
                  </>
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

      {/* Recurring Expense Form Modal */}
      {recFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-no-swipe="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4"
        >
          <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#342653] dark:bg-[#19122c]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-[#2e234a]">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingRecId
                  ? 'Wiederkehrende Fixkosten bearbeiten'
                  : 'Neue wiederkehrende Ausgabe (z. B. Miete)'}
              </h3>
              <button
                type="button"
                onClick={() => setRecFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRecurring} className="overflow-y-auto p-5 space-y-4">
              {/* Receipt / Contract attachment bar for recurring fixed costs */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                <div className="flex items-center gap-2 text-xs text-violet-900 dark:text-violet-200">
                  <Receipt className="h-4 w-4 shrink-0" />
                  <span>
                    {recScanningAi
                      ? 'KI liest Belegdaten aus...'
                      : 'Vertrag, Dauerrechnung oder Belegfoto hinterlegen (wird bei Verbuchung übernommen)'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={recScanningAi}
                    onClick={() => recCameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg ui-accent-btn px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                  >
                    {recScanningAi ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                    Kamera
                  </button>
                  <button
                    type="button"
                    disabled={recScanningAi}
                    onClick={() => recGalleryInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
                  >
                    <FileImage className="h-3.5 w-3.5" />
                    Datei
                  </button>
                </div>
              </div>

              {recReceiptImageDataUrl && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-[#3b2d5e] dark:bg-[#211936]">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewReceipt({
                        title: recVendor.trim() || 'Fixkosten-Beleg',
                        subtitle: `${INTERVAL_LABELS[recInterval]} · ${formatCurrency(recGross)}`,
                        imageDataUrl: recReceiptImageDataUrl,
                      })
                    }
                    className="h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 cursor-pointer"
                    title="Beleg vergrößern"
                  >
                    <img
                      src={recReceiptImageDataUrl}
                      alt="Fixkosten-Belegvorschau"
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1 text-xs text-slate-600 dark:text-slate-300">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Beleg / Vertrag angehängt
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Tippen zum Vergrößern — wird bei jeder Buchung mit übernommen.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={recScanningAi}
                      onClick={() => void runRecurringReceiptAiScan(recReceiptImageDataUrl)}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/40 dark:bg-[#19122c] dark:text-violet-300 cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      KI auslesen
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecReceiptImageDataUrl('')}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-[#19122c] dark:text-rose-300 cursor-pointer"
                      title="Beleg entfernen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Anbieter / Vermieter *
                  </label>
                  <input
                    type="text"
                    required
                    value={recVendor}
                    onChange={(e) => setRecVendor(e.target.value)}
                    placeholder="z. B. Immobilienverwaltung, Telekom, Stromanbieter..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Kategorie
                  </label>
                  <CategoryPicker
                    value={recCategory}
                    onChange={setRecCategory}
                    categories={availableCategories}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Beschreibung
                </label>
                <input
                  type="text"
                  value={recDescription}
                  onChange={(e) => setRecDescription(e.target.value)}
                  placeholder="z. B. Studio-Miete inkl. Nebenkosten"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                />
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
                    value={recGross}
                    onChange={(e) => handleRecGrossChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    MwSt.-Satz
                  </label>
                  <ThemedSelect
                    value={String(recTaxRate)}
                    onChange={(v) => handleRecTaxChange(Number(v) as TaxRate)}
                    options={[
                      { value: '19', label: '19 % USt.' },
                      { value: '7', label: '7 % USt.' },
                      { value: '0', label: '0 % (z. B. Miete / Versicherung)' },
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
                    value={recNet}
                    onChange={(e) => handleRecNetChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Zahlungsintervall
                  </label>
                  <ThemedSelect
                    value={recInterval}
                    onChange={(v) => setRecInterval(v as RecurringInterval)}
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
                    value={recNextDueDate}
                    onChange={(e) => setRecNextDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Notizen / Vertragsnummer (optional)
                </label>
                <input
                  type="text"
                  value={recNotes}
                  onChange={(e) => setRecNotes(e.target.value)}
                  placeholder="Optional..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recActive}
                  onChange={(e) => setRecActive(e.target.checked)}
                  className="h-4 w-4 rounded accent-violet-600"
                />
                Aktiv (wird bei Fälligkeit zur Verbuchung vorgeschlagen)
              </label>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4 dark:border-[#2e234a]">
                <button
                  type="button"
                  onClick={() => setRecFormOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg ui-accent-btn px-4 py-2 text-xs font-semibold text-white shadow-sm cursor-pointer"
                >
                  {editingRecId ? 'Änderungen speichern' : 'Fixkosten speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Receipt Image Preview Modal */}
      {previewReceipt && previewReceipt.imageDataUrl && (
        <div
          role="dialog"
          aria-modal="true"
          data-no-swipe="true"
          onClick={() => setPreviewReceipt(null)}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{previewReceipt.title}</p>
                <p className="text-xs text-slate-400">{previewReceipt.subtitle}</p>
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
                src={previewReceipt.imageDataUrl}
                alt={previewReceipt.title}
                className="max-h-[75vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
