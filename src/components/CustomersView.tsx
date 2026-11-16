import { FilePlus2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  Customer,
  Invoice,
  TimeEntry,
  TimeRoundingMinutes,
} from '../types';
import { createId, formatCurrency, formatHoursShort } from '../utils/format';
import { DEFAULT_CUSTOMER_CATEGORIES } from '../utils/sampleData';
import { CategoryPicker, ThemedSelect } from './ThemedSelect';

interface CustomersViewProps {
  customers: Customer[];
  timeEntries: TimeEntry[];
  invoices: Invoice[];
  categories?: string[];
  onSaveCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  onCreateInvoiceForCustomer: (customerId: string) => void;
}

export function CustomersView({
  customers,
  timeEntries,
  invoices,
  categories = [],
  onSaveCustomer,
  onDeleteCustomer,
  onCreateInvoiceForCustomer,
}: CustomersViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

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
    setCategory(c.category ?? '');
    setNotes(c.notes);
    setError('');
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!companyName.trim()) {
      setError('Bitte einen Firmen- oder Kundennamen angeben.');
      return;
    }

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
      category: category.trim() || undefined,
      notes: notes.trim(),
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    onSaveCustomer(saved);
    setShowForm(false);
  };

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
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Kundendatenbank
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Stammdaten, Rechnungsanschriften, Zahlungsziele und offene Stunden pro Kunde.
          </p>
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
            {error && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400 md:col-span-3">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 md:col-span-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-[#231b38] cursor-pointer"
              >
                Abbrechen
              </button>
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
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
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {[c.contactName, c.email].filter(Boolean).join(' · ') || '—'}
                        </div>
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
                        <div className="flex items-center justify-end gap-2">
                          {hasOpen && (
                            <button
                              type="button"
                              onClick={() => onCreateInvoiceForCustomer(c.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <FilePlus2 className="h-3.5 w-3.5" />
                              Abrechnen
                            </button>
                          )}
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
        )}
      </section>
    </div>
  );
}
