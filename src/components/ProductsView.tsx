import { MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CompanyProfile,
  Customer,
  GeoFenceRule,
  Product,
  ProductType,
  TaxRate,
  UnitType,
} from '../types';
import { createId, formatCurrency, formatProductSku } from '../utils/format';
import { DEFAULT_PRODUCT_CATEGORIES } from '../utils/sampleData';
import { GeoFenceRuleModal } from './GeoFenceRuleModal';
import { InfoHintPopup } from './InfoHintPopup';
import { CategoryPicker, ThemedSelect } from './ThemedSelect';

interface ProductsViewProps {
  company: CompanyProfile;
  customers: Customer[];
  products: Product[];
  geoFenceRules?: GeoFenceRule[];
  autoLocationStartEnabled?: boolean;
  theme?: 'light' | 'dark';
  onSaveProduct: (product: Product, incrementSkuSequence?: boolean) => void;
  onDeleteProduct: (id: string) => void;
  onSaveGeoFenceRules: (rules: GeoFenceRule[]) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function ProductsView({
  company,
  customers,
  products,
  geoFenceRules = [],
  autoLocationStartEnabled = false,
  theme = 'light',
  onSaveProduct,
  onDeleteProduct,
  onSaveGeoFenceRules,
  onNotify,
}: ProductsViewProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ProductType>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [geoModalOpen, setGeoModalOpen] = useState(false);
  const [geoModalProduct, setGeoModalProduct] = useState<Product | null>(null);
  const [geoModalEditingRule, setGeoModalEditingRule] = useState<GeoFenceRule | null>(null);

  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProductType>('service');
  const [unit, setUnit] = useState<UnitType>('Std.');
  const [unitPriceNet, setUnitPriceNet] = useState('95');
  const [taxRate, setTaxRate] = useState<TaxRate>(19);
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');

  const skuLabel = (company.skuFieldLabel || 'Artikel-Nr.').trim();

  const availableCategories = useMemo(() => {
    const seed =
      company.productCategories && company.productCategories.length > 0
        ? company.productCategories
        : DEFAULT_PRODUCT_CATEGORIES;
    const set = new Set<string>(seed);
    for (const p of products) {
      if (p.category?.trim()) set.add(p.category.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  }, [company.productCategories, products]);

  const openNew = () => {
    setEditing(null);
    setSku(
      formatProductSku(
        company,
        company.nextProductSequence ?? products.length + 101
      )
    );
    setName('');
    setDescription('');
    setType('service');
    setUnit('Std.');
    setUnitPriceNet('95');
    setTaxRate(19);
    setCategory('');
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
    setCategory(p.category ?? '');
    setError('');
    setShowForm(true);
  };

  const saveCurrentForm = (): Product | null => {
    setError('');
    if (!name.trim()) {
      setError('Bitte eine Bezeichnung angeben.');
      return null;
    }
    const price = Number(unitPriceNet.replace(',', '.'));
    if (Number.isNaN(price) || price < 0) {
      setError('Bitte einen gültigen Netto-Preis eingeben.');
      return null;
    }

    const fallbackSku = formatProductSku(
      company,
      company.nextProductSequence ?? products.length + 101
    );
    const saved: Product = {
      id: editing?.id ?? createId('prod'),
      sku: sku.trim() || fallbackSku,
      name: name.trim(),
      description: description.trim(),
      type,
      unit,
      unitPriceNet: price,
      taxRate,
      category: category.trim() || undefined,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    onSaveProduct(saved, !editing);
    return saved;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = saveCurrentForm();
    if (!saved) return;
    setShowForm(false);
  };

  const openNewGeoRuleForProduct = (product: Product) => {
    setGeoModalEditingRule(null);
    setGeoModalProduct(product);
    setGeoModalOpen(true);
  };

  const openEditGeoRule = (rule: GeoFenceRule) => {
    setGeoModalEditingRule(rule);
    setGeoModalProduct(null);
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
    onNotify('Ortsabhängigkeit entfernt.');
  };

  const geoRulesByProduct = useMemo(() => {
    const map = new Map<string, GeoFenceRule[]>();
    for (const r of geoFenceRules) {
      if (!r.productId) continue;
      const list = map.get(r.productId) ?? [];
      list.push(r);
      map.set(r.productId, list);
    }
    return map;
  }, [geoFenceRules]);

  const editingProductGeoRules = editing ? geoRulesByProduct.get(editing.id) ?? [] : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (categoryFilter !== 'all' && (p.category ?? '') !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [products, search, typeFilter, categoryFilter]);

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Produkt- &amp; Leistungskatalog
          </h1>
          <InfoHintPopup
            title="Produkt- & Leistungskatalog"
            text="Stundensätze für die Zeiterfassung sowie Pauschalartikel, Hardware und Ortsabhängigkeiten für automatische Aufgaben verwalten."
          />
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
                {skuLabel}
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
              <ThemedSelect
                value={type}
                onChange={(val) => {
                  const nextType = val as ProductType;
                  setType(nextType);
                  if (nextType === 'service') setUnit('Std.');
                  else if (unit === 'Std.') setUnit('Stk.');
                }}
                options={[
                  { value: 'service', label: 'Dienstleistung (Zeit)' },
                  { value: 'product', label: 'Produkt / Pauschale' },
                ]}
              />
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
                <ThemedSelect
                  value={unit}
                  onChange={(val) => setUnit(val as UnitType)}
                  className="w-28 shrink-0"
                  options={[
                    { value: 'Std.', label: 'Std.' },
                    { value: 'Stk.', label: 'Stk.' },
                    { value: 'Pauschal', label: 'Pauschal' },
                    { value: 'Tag', label: 'Tag' },
                  ]}
                />
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
              <ThemedSelect
                value={String(taxRate)}
                onChange={(val) => setTaxRate(Number(val) as TaxRate)}
                options={[
                  { value: '19', label: '19 %' },
                  { value: '7', label: '7 %' },
                  { value: '0', label: '0 % (Steuerfrei)' },
                ]}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Kategorie
              </label>
              <CategoryPicker
                value={category}
                onChange={setCategory}
                categories={availableCategories}
                placeholder="z. B. Beratung, Entwicklung, Hardware"
              />
            </div>
            {editing && (
              <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-[#2e2349] dark:bg-[#211936]/40 md:col-span-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-blue-700 dark:text-violet-400" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      Ortsabhängigkeiten für dieses Produkt ({editingProductGeoRules.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      openNewGeoRuleForProduct({
                        ...editing,
                        name: name.trim() || editing.name,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ortsabhängigkeit anlegen
                  </button>
                </div>
                {editingProductGeoRules.length > 0 && (
                  <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-[#2e2349] dark:border-[#2e2349] dark:bg-[#171126]">
                    {editingProductGeoRules.map((rule) => (
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
              <p className="text-xs font-medium text-red-600 dark:text-red-400 md:col-span-4">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 md:col-span-4">
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
                    openNewGeoRuleForProduct(saved);
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

          <div className="flex flex-wrap items-center gap-2">
            {availableCategories.length > 0 && (
              <ThemedSelect
                size="sm"
                className="w-48"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: 'all', label: 'Alle Kategorien' },
                  ...availableCategories.map((cat) => ({ value: cat, label: cat })),
                ]}
              />
            )}
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
                  <th className="px-4 py-3">{skuLabel}</th>
                  <th className="px-4 py-3">Bezeichnung &amp; Beschreibung</th>
                  <th className="px-4 py-3">Typ &amp; Kategorie</th>
                  <th className="px-4 py-3 text-right">Netto-Preis</th>
                  <th className="px-4 py-3 text-right">MwSt.</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {filtered.map((p) => {
                  const linkedGeoRules = geoRulesByProduct.get(p.id) ?? [];
                  return (
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
                        {(p.description || linkedGeoRules.length > 0) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {p.description && <span>{p.description}</span>}
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
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        <div>{p.type === 'service' ? 'Dienstleistung' : 'Produkt / Pauschale'}</div>
                        {p.category && (
                          <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-[#231b38] dark:text-violet-300">
                            {p.category}
                          </span>
                        )}
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
                            onClick={() => openNewGeoRuleForProduct(p)}
                            title="Ortsabhängigkeit für dieses Produkt anlegen"
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <GeoFenceRuleModal
        open={geoModalOpen}
        editingRule={geoModalEditingRule}
        initialProduct={geoModalProduct}
        customers={customers}
        products={products}
        existingRules={geoFenceRules}
        theme={theme}
        onSave={handleSaveGeoRule}
        onDelete={handleDeleteGeoRule}
        onClose={() => {
          setGeoModalOpen(false);
          setGeoModalProduct(null);
          setGeoModalEditingRule(null);
        }}
        onNotify={onNotify}
      />
    </div>
  );
}
