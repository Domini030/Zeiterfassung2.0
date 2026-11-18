import { FilePlus2, Gauge, MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  Customer,
  GeoFenceRule,
  Invoice,
  Product,
  TimeEntry,
  TimeRoundingMinutes,
} from '../types';
import { computeCustomerBudgetStatus } from '../utils/budgetHelpers';
import { createId, formatCurrency, formatHoursShort, formatNumber } from '../utils/format';
import { DEFAULT_CUSTOMER_CATEGORIES } from '../utils/sampleData';
import { GeoFenceRuleModal } from './GeoFenceRuleModal';
import { InfoHintPopup } from './InfoHintPopup';
import { CategoryPicker, ThemedSelect } from './ThemedSelect';

interface CustomersViewProps {
  customers: Customer[];
  products: Product[];
  timeEntries: TimeEntry[];
  invoices: Invoice[];
  categories?: string[];
  geoFenceRules?: GeoFenceRule[];
  autoLocationStartEnabled?: boolean;
  theme?: 'light' | 'dark';
  onSaveCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  onSaveGeoFenceRules: (rules: GeoFenceRule[]) => void;
  onNotify: (msg: string, isError?: boolean) => void;
  onCreateInvoiceForCustomer: (customerId: string) => void;
}

export function CustomersView({
  customers,
  products,
  timeEntries,
  invoices,
  categories = [],
  geoFenceRules = [],
  autoLocationStartEnabled = false,
  theme = 'light',
  onSaveCustomer,
  onDeleteCustomer,
  onSaveGeoFenceRules,
  onNotify,
  onCreateInvoiceForCustomer,
}: CustomersViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [geoModalCustomer, setGeoModalCustomer] = useState<Customer | null>(null);
  const [geoModalEditingRule, setGeoModalEditingRule] = useState<GeoFenceRule | null>(null);

  const [customerNumber, setCustomerNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Deutschland');
  const [vatId, setVatId] = useState('');
  const [paymentTermDays, setPaymentTermDays] = useState(14);
  const [timeRoundingInput, setTimeRoundingInput] = useState<string>('');
  const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'total'>('monthly');
  const [budgetHoursInput, setBudgetHoursInput] = useState<string>('');
  const [budgetAmountInput, setBudgetAmountInput] = useState<string>('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const availableCategories = useMemo(() => {
    const seed = categories.length > 0 ? categories : DEFAULT_CUSTOMER_CATEGORIES;
    const set = new Set<string>(seed);
    for (const c of customers) {
      if (c.category?.trim()) set.add(c.category.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  }, [categories, customers]);

  const openNew = () => {
    setEditing(null);
    const nextNum = 1001 + customers.length;
    setCustomerNumber(`KD-${nextNum}`);
    setCompanyName('');
    setContactName('');
    setEmail('');
    setPhone('');
    setStreet('');
    setPostalCode('');
    setCity('');
    setCountry('Deutschland');
    setVatId('');
    setPaymentTermDays(14);
    setTimeRoundingInput('');
    setBudgetPeriod('monthly');
    setBudgetHoursInput('');
    setBudgetAmountInput('');
    setCategory('');
    setNotes('');
    setError('');
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setCustomerNumber(c.customerNumber);
    setCompanyName(c.companyName);
    setContactName(c.contactName);
    setEmail(c.email);
    setPhone(c.phone);
    setStreet(c.street);
    setPostalCode(c.postalCode);
    setCity(c.city);
    setCountry(c.country);
    setVatId(c.vatId);
    setPaymentTermDays(c.paymentTermDays);
    setTimeRoundingInput(
      c.timeRoundingMinutes !== undefined && c.timeRoundingMinutes !== null
        ? String(c.timeRoundingMinutes)
        : ''
    );
    setBudgetPeriod(c.budgetPeriod ?? 'monthly');
    setBudgetHoursInput(c.budgetHours && c.budgetHours > 0 ? String(c.budgetHours) : '');
    setBudgetAmountInput(
      c.budgetAmountNet && c.budgetAmountNet > 0 ? String(c.budgetAmountNet) : ''
    );
    setCategory(c.category ?? '');
    setNotes(c.notes);
    setError('');
    setShowForm(true);
  };

  const saveCurrentForm = (): Customer | null => {
    setError('');
    if (!companyName.trim()) {
      setError('Bitte einen Firmen- oder Kundennamen angeben.');
      return null;
    }

    const parsedBudgetHours = parseFloat(budgetHoursInput.replace(',', '.'));
    const parsedBudgetNet = parseFloat(budgetAmountInput.replace(',', '.'));

    const saved: Customer = {
      id: editing?.id ?? createId('cust'),
      customerNumber: customerNumber.trim() || `KD-${1001 + customers.length}`,
      companyName: companyName.trim(),
      contactName: contactName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      street: street.trim(),
      postalCode: postalCode.trim(),
      city: city.trim(),
      country: country.trim() || 'Deutschland',
      vatId: vatId.trim(),
      paymentTermDays: Math.max(0, Number(paymentTermDays) || 14),
      timeRoundingMinutes:
        timeRoundingInput === ''
          ? null
          : (Number(timeRoundingInput) as TimeRoundingMinutes),
      budgetPeriod,
      budgetHours:
        Number.isFinite(parsedBudgetHours) && parsedBudgetHours > 0
          ? parsedBudgetHours
          : null,
      budgetAmountNet:
        Number.isFinite(parsedBudgetNet) && parsedBudgetNet > 0 ? parsedBudgetNet : null,
      category: category.trim() || undefined,
      notes: notes.trim(),
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    onSaveCustomer(saved);
    return saved;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = saveCurrentForm();
    if (!saved) return;
    setShowForm(false);
  };

  const openNewGeoRuleForCustomer = (customer: Customer) => {
    setGeoModalEditingRule(null);
    setGeoModalCustomer(customer);
    setGeoModalOpen(true);
  };

  const openEditGeoRule = (rule: GeoFenceRule) => {
    setGeoModalEditingRule(rule);
    setGeoModalCustomer(null);
    setGeoModalOpen(true);
  };

  const handleSaveGeoRule = (rule: GeoFenceRule) => {
    const exists = geoFenceRules.some((r) => r.id === rule.id);
    const next = exists
      ? geoFenceRules.map((r) => (r.id === rule.id ? rule : r))
      : [rule, ...geoFenceRules];
    onSaveGeoFenceRules(next);
    if (!autoLocationStartEnabled && rule.enabled) {
      onNotify(
        `Ortsabhängigkeit "${rule.name}" gespeichert. Hinweis: Ortsautomatik unter Einstellungen → Ortung aktivieren.`
      );
    } else {
      onNotify(`Ortsabhängigkeit "${rule.name}" gespeichert.`);
    }
  };

  const handleDeleteGeoRule = (id: string) => {
    onSaveGeoFenceRules(geoFenceRules.filter((r) => r.id !== id));
  };

  const geoRulesByCustomer = useMemo(() => {
    const map = new Map<string, GeoFenceRule[]>();
    for (const r of geoFenceRules) {
      if (!r.customerId) continue;
      const list = map.get(r.customerId) ?? [];
      list.push(r);
      map.set(r.customerId, list);
    }
    return map;
  }, [geoFenceRules]);

  const editingCustomerGeoRules = editing ? geoRulesByCustomer.get(editing.id) ?? [] : [];

  const statsByCustomer = useMemo(() => {
    const map = new Map<
      string,
      { openSeconds: number; openNet: number; openIds: string[]; invoiceCount: number }
    >();
    for (const c of customers) {
      map.set(c.id, { openSeconds: 0, openNet: 0, openIds: [], invoiceCount: 0 });
    }
    for (const entry of timeEntries) {
      if (entry.billable && !entry.billedInvoiceId) {
        const cur = map.get(entry.customerId);
        if (cur) {
          cur.openSeconds += entry.durationSeconds;
          cur.openNet += (entry.durationSeconds / 3600) * entry.hourlyRateNet;
          cur.openIds.push(entry.id);
        }
      }
    }
    for (const inv of invoices) {
      const cur = map.get(inv.customerId);
      if (cur) cur.invoiceCount += 1;
    }
    return map;
  }, [customers, timeEntries, invoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (categoryFilter !== 'all' && (c.category ?? '') !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.companyName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.customerNumber.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [customers, search, categoryFilter]);

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Kundendatenbank
          </h1>
          <InfoHintPopup
            title="Kundendatenbank"
            text="Stammdaten, Rechnungsanschriften, Zahlungsziele, Ortsabhängigkeiten und offene Stunden pro Kunde verwalten."
          />
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Neuer Kunde
        </button>
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <h2 className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {editing ? 'Kunde bearbeiten' : 'Neuen Kunden anlegen'}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Kundennummer
              </label>
              <input
                type="text"
                value={customerNumber}
                onChange={(e) => setCustomerNumber(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Firmenname / Kunde *
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="z. B. Musterwerk GmbH"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Ansprechpartner
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Telefon
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Straße &amp; Hausnummer
              </label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  PLZ
                </label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Ort
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Land
              </label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                USt-IdNr.
              </label>
              <input
                type="text"
                value={vatId}
                onChange={(e) => setVatId(e.target.value)}
                placeholder="DE..."
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Zahlungsziel (Tage)
              </label>
              <input
                type="number"
                min={0}
                value={paymentTermDays}
                onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Zeitrundung (Takt für Rechnungen)
              </label>
              <ThemedSelect
                value={timeRoundingInput}
                onChange={setTimeRoundingInput}
                options={[
                  { value: '', label: 'Firmen-Standard verwenden' },
                  { value: '0', label: 'Exakt (keine Aufrundung)' },
                  { value: '5', label: 'Aufrunden auf 5 Minuten' },
                  { value: '10', label: 'Aufrunden auf 10 Minuten' },
                  { value: '15', label: 'Aufrunden auf 15 Minuten' },
                  { value: '30', label: 'Aufrunden auf 30 Minuten' },
                ]}
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
                placeholder="z. B. Stammkunde oder Wartungsvertrag"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Notizen
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-[#2e2349] dark:bg-[#211936]/40 md:col-span-3 md:grid-cols-3">
              <div className="flex items-center gap-1.5 md:col-span-3">
                <Gauge className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Stundenkontingent &amp; Projektbudget (optional)
                </span>
                <InfoHintPopup
                  size="sm"
                  title="Stundenkontingent & Budget"
                  text="Lege ein monatliches Retainer-Kontingent oder ein Gesamtprojekt-Budget in Stunden und/oder Euro Netto fest. TaktWerk zeigt dir den aktuellen Verbrauch live an und warnt ab 80 % sowie 100 % Auslastung."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Zeitraum
                </label>
                <ThemedSelect
                  value={budgetPeriod}
                  onChange={(v) => setBudgetPeriod(v as 'monthly' | 'total')}
                  options={[
                    { value: 'monthly', label: 'Monatliches Kontingent' },
                    { value: 'total', label: 'Gesamtprojekt-Budget' },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Stundenkontingent (Std.)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={budgetHoursInput}
                  onChange={(e) => setBudgetHoursInput(e.target.value)}
                  placeholder="z. B. 20"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Euro-Budget Netto (€)
                </label>
                <input
                  type="number"
                  min={0}
                  step="10"
                  value={budgetAmountInput}
                  onChange={(e) => setBudgetAmountInput(e.target.value)}
                  placeholder="z. B. 2500"
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
            {editing && (
              <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-[#2e2349] dark:bg-[#211936]/40 md:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-blue-700 dark:text-violet-400" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      Ortsabhängigkeiten für diesen Kunden ({editingCustomerGeoRules.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      openNewGeoRuleForCustomer({
                        ...editing,
                        companyName: companyName.trim() || editing.companyName,
                        street: street.trim(),
                        postalCode: postalCode.trim(),
                        city: city.trim(),
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ortsabhängigkeit anlegen
                  </button>
                </div>
                {editingCustomerGeoRules.length > 0 && (
                  <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-[#2e2349] dark:border-[#2e2349] dark:bg-[#171126]">
                    {editingCustomerGeoRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {rule.name}
                          </span>
                          <span className="mx-1.5 text-slate-400">·</span>
                          <span className="font-mono text-slate-500 dark:text-slate-400">
                            {rule.radiusMeters} m
                          </span>
                          <span className="mx-1.5 text-slate-400">·</span>
                          <span
                            className={
                              rule.enabled
                                ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-400'
                            }
                          >
                            {rule.enabled ? 'Aktiv' : 'Pausiert'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditGeoRule(rule)}
                            title="Ortsregel bearbeiten"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#231b38] dark:hover:text-slate-100 cursor-pointer"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteGeoRule(rule.id)}
                            title="Ortsregel löschen"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {error && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400 md:col-span-3">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 md:col-span-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                Abbrechen
              </button>
              {!editing && (
                <button
                  type="button"
                  onClick={() => {
                    const saved = saveCurrentForm();
                    if (!saved) return;
                    setShowForm(false);
                    openNewGeoRuleForCustomer(saved);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <MapPin className="h-4 w-4" />
                  Speichern &amp; Ort festlegen
                </button>
              )}
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Kunde speichern
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-violet-300/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kunden suchen..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
            />
          </div>
          {availableCategories.length > 0 && (
            <ThemedSelect
              size="sm"
              className="w-52"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: 'all', label: 'Alle Kategorien' },
                ...availableCategories.map((cat) => ({ value: cat, label: cat })),
              ]}
            />
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Keine Kunden gefunden.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Lege deinen ersten Kunden an oder lade Beispieldaten unter „Nextcloud &amp; Setup“.
            </p>
          </div>
        ) : (
          <>
            <div className="max-h-[365px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-[#211936]">
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:text-violet-200/70">
                    <th className="px-4 py-3">Nr.</th>
                    <th className="px-4 py-3">Firma &amp; Kontakt</th>
                    <th className="px-4 py-3">Adresse</th>
                    <th className="px-4 py-3 text-right">Offene Zeiten</th>
                    <th className="px-4 py-3 text-right">Offener Betrag</th>
                    <th className="px-4 py-3 text-right">Aktionen</th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filtered.map((c) => {
                  const st = statsByCustomer.get(c.id);
                  const hasOpen = (st?.openIds.length ?? 0) > 0;
                  const linkedGeoRules = geoRulesByCustomer.get(c.id) ?? [];
                  const budget = computeCustomerBudgetStatus(c, timeEntries);
                  const clampedPct = Math.min(100, Math.max(0, budget.primaryPct));
                  const barFillClass =
                    budget.severity === 'exceeded'
                      ? 'fill-rose-500'
                      : budget.severity === 'warning'
                        ? 'fill-amber-500'
                        : 'fill-emerald-500';
                  return (
                    <tr
                      key={c.id}
                      className="transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-violet-200/80 whitespace-nowrap">
                        {c.customerNumber}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {c.companyName}
                          </span>
                          {c.category && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-[#231b38] dark:text-violet-300">
                              {c.category}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            {[c.contactName, c.email].filter(Boolean).join(' · ') || '—'}
                          </span>
                          {linkedGeoRules.length > 0 && (
                            <button
                              type="button"
                              onClick={() => openEditGeoRule(linkedGeoRules[0])}
                              className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline dark:text-violet-300 cursor-pointer"
                            >
                              <MapPin className="h-3 w-3 shrink-0" />
                              {linkedGeoRules.length === 1
                                ? linkedGeoRules[0].name
                                : `${linkedGeoRules.length} Ortsregeln`}
                            </button>
                          )}
                        </div>
                        {budget.hasBudget && (
                          <div className="mt-1.5 max-w-xs space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span
                                className={`font-medium ${
                                  budget.severity === 'exceeded'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : budget.severity === 'warning'
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {budget.budgetHours !== null
                                  ? `${formatNumber(budget.usedHours, 1)} / ${formatNumber(budget.budgetHours, 1)} Std.`
                                  : `${formatCurrency(budget.usedAmountNet)} / ${formatCurrency(budget.budgetAmountNet ?? 0)}`}{' '}
                                ({budget.periodLabel})
                              </span>
                              <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                {budget.primaryPct} %
                              </span>
                            </div>
                            <svg
                              viewBox="0 0 100 5"
                              preserveAspectRatio="none"
                              className="h-1.5 w-full overflow-hidden rounded-full"
                              aria-hidden="true"
                            >
                              <rect
                                x="0"
                                y="0"
                                width="100"
                                height="5"
                                rx="2.5"
                                className="fill-slate-200 dark:fill-[#2e2349]"
                              />
                              <rect
                                x="0"
                                y="0"
                                width={clampedPct}
                                height="5"
                                rx="2.5"
                                className={barFillClass}
                              />
                            </svg>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                        <div>{c.street || '—'}</div>
                        <div>
                          {[c.postalCode, c.city].filter(Boolean).join(' ') || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                        {st ? formatHoursShort(st.openSeconds) : '0,00 Std.'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {st ? formatCurrency(st.openNet) : '0,00 €'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {hasOpen && (
                            <button
                              type="button"
                              onClick={() => onCreateInvoiceForCustomer(c.id)}
                              className="mr-1 inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <FilePlus2 className="h-3.5 w-3.5" />
                              Abrechnen
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openNewGeoRuleForCustomer(c)}
                            title="Ortsabhängigkeit für diesen Kunden anlegen"
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md cursor-pointer ${
                              linkedGeoRules.length > 0
                                ? 'text-blue-700 hover:bg-blue-50 dark:text-violet-300 dark:hover:bg-[#231b38]'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#231b38] dark:hover:text-slate-100'
                            }`}
                          >
                            <MapPin className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            title="Bearbeiten"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#231b38] dark:hover:text-slate-100 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCustomer(c.id)}
                            title="Löschen"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
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
          {filtered.length > 5 && (
            <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2 text-center text-[11px] text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-400">
              Zeigt 5 sichtbar · insgesamt {filtered.length} Kunden (nach oben &amp; unten scrollbar)
            </div>
          )}
        </>
        )}
      </section>

      <GeoFenceRuleModal
        open={geoModalOpen}
        editingRule={geoModalEditingRule}
        initialCustomer={geoModalCustomer}
        customers={customers}
        products={products}
        existingRules={geoFenceRules}
        theme={theme}
        onSave={handleSaveGeoRule}
        onDelete={handleDeleteGeoRule}
        onClose={() => {
          setGeoModalOpen(false);
          setGeoModalCustomer(null);
          setGeoModalEditingRule(null);
        }}
        onNotify={onNotify}
      />
    </div>
  );
}
