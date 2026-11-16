import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Product, ProductType, TaxRate, UnitType } from '../types';
import { createId, formatCurrency } from '../utils/format';

interface ProductsViewProps {
  products: Product[];
  onSaveProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
}

export function ProductsView({
  products,
  onSaveProduct,
  onDeleteProduct,
}: ProductsViewProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ProductType>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProductType>('service');
  const [unit, setUnit] = useState<UnitType>('Std.');
  const [unitPriceNet, setUnitPriceNet] = useState('95');
  const [taxRate, setTaxRate] = useState<TaxRate>(19);
  const [error, setError] = useState('');

  const openNew = () => {
    setEditing(null);
    setSku(`ART-${101 + products.length}`);
    setName('');
    setDescription('');
    setType('service');
    setUnit('Std.');
    setUnitPriceNet('95');
    setTaxRate(19);
    setError('');
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setSku(p.sku);
    setName(p.name);
    setDescription(p.description);
    setType(p.type);
    setUnit(p.unit);
    setUnitPriceNet(String(p.unitPriceNet));
    setTaxRate(p.taxRate);
    setError('');
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Bitte eine Bezeichnung angeben.');
      return;
    }
    const price = Number(unitPriceNet.replace(',', '.'));
    if (Number.isNaN(price) || price < 0) {
      setError('Bitte einen gültigen Netto-Preis eingeben.');
      return;
    }

    const saved: Product = {
      id: editing?.id ?? createId('prod'),
      sku: sku.trim() || `ART-${101 + products.length}`,
      name: name.trim(),
      description: description.trim(),
      type,
      unit,
      unitPriceNet: price,
      taxRate,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    onSaveProduct(saved);
    setShowForm(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });
  }, [products, search, typeFilter]);

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Produkt- &amp; Leistungskatalog
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Stundensätze für die Zeiterfassung sowie Pauschalartikel und Hardware für Rechnungen.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Neuer Artikel / Leistung
        </button>
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <h2 className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {editing ? 'Eintrag bearbeiten' : 'Neues Produkt / Leistung anlegen'}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Artikel-Nr.
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Bezeichnung *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Webentwicklung oder NFC-Tag Paket"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Typ
              </label>
              <select
                value={type}
                onChange={(e) => {
                  const nextType = e.target.value as ProductType;
                  setType(nextType);
                  if (nextType === 'service') setUnit('Std.');
                  else if (unit === 'Std.') setUnit('Stk.');
                }}
                className={inputClass}
              >
                <option value="service">Dienstleistung (Zeit)</option>
                <option value="product">Produkt / Pauschale</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Beschreibung (für Rechnungstext)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Einheit &amp; Netto-Preis (€)
              </label>
              <div className="flex gap-2">
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as UnitType)}
                  className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
                >
                  <option value="Std.">Std.</option>
                  <option value="Stk.">Stk.</option>
                  <option value="Pauschal">Pauschal</option>
                  <option value="Tag">Tag</option>
                </select>
                <input
                  type="text"
                  value={unitPriceNet}
                  onChange={(e) => setUnitPriceNet(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                MwSt.-Satz
              </label>
              <select
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value) as TaxRate)}
                className={`${inputClass} font-mono`}
              >
                <option value={19}>19 %</option>
                <option value={7}>7 %</option>
                <option value={0}>0 % (Steuerfrei)</option>
              </select>
            </div>
            {error && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400 md:col-span-4">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 md:col-span-4">
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
                Speichern
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
              placeholder="Artikel oder Leistung suchen..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#211936] self-start">
            {(
              [
                { id: 'all', label: 'Alle' },
                { id: 'service', label: 'Dienstleistungen' },
                { id: 'product', label: 'Produkte' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTypeFilter(tab.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  typeFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-violet-600 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Keine Produkte oder Leistungen gefunden.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Lege Dienstleistungen mit Stundensätzen oder Zusatzprodukte für Rechnungen an.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Bezeichnung &amp; Beschreibung</th>
                  <th className="px-4 py-3">Typ</th>
                  <th className="px-4 py-3 text-right">Netto-Preis</th>
                  <th className="px-4 py-3 text-right">MwSt.</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-violet-200/80 whitespace-nowrap">
                      {p.sku}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {p.name}
                      </div>
                      {p.description && (
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {p.type === 'service' ? 'Dienstleistung' : 'Produkt / Pauschale'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                      {formatCurrency(p.unitPriceNet)} / {p.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {p.taxRate} %
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          title="Bearbeiten"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#231b38] dark:hover:text-slate-100 cursor-pointer"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProduct(p.id)}
                          title="Löschen"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
