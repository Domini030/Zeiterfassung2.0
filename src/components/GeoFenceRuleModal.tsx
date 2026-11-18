import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MapPin, Save, Search, Trash2, X } from 'lucide-react';
import type { Customer, GeoFenceRule, Product } from '../types';
import { createId, formatCurrency } from '../utils/format';
import { captureCurrentLocation, geocodeAddress } from '../utils/geolocation';
import { GeoFenceMapPicker } from './GeoFenceMapPicker';
import { ThemedSelect } from './ThemedSelect';

interface GeoFenceRuleModalProps {
  open: boolean;
  editingRule?: GeoFenceRule | null;
  initialCustomer?: Customer | null;
  initialProduct?: Product | null;
  customers: Customer[];
  products: Product[];
  existingRules: GeoFenceRule[];
  theme: 'light' | 'dark';
  onSave: (rule: GeoFenceRule) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const RADIUS_OPTIONS = [
  { value: '50', label: '50 m (Gebäude)' },
  { value: '100', label: '100 m (Standort)' },
  { value: '150', label: '150 m (Standard)' },
  { value: '250', label: '250 m (Werksgelände)' },
  { value: '500', label: '500 m (Stadtteil)' },
  { value: '1000', label: '1.000 m (Region)' },
];

export const GeoFenceRuleModal: React.FC<GeoFenceRuleModalProps> = ({
  open,
  editingRule,
  initialCustomer,
  initialProduct,
  customers,
  products,
  existingRules,
  theme,
  onSave,
  onDelete,
  onClose,
  onNotify,
}) => {
  const [name, setName] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [radius, setRadius] = useState('150');
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [notes, setNotes] = useState('');
  const [autoStopOnExit, setAutoStopOnExit] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [capturingGps, setCapturingGps] = useState(false);
  const [cameraNonce, setCameraNonce] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    if (editingRule) {
      setName(editingRule.name);
      setTaskTitle(editingRule.taskTitle);
      setRadius(String(editingRule.radiusMeters));
      setCustomerId(editingRule.customerId);
      setProductId(editingRule.productId);
      setAddress(editingRule.address ?? '');
      setLat(editingRule.lat.toFixed(6));
      setLng(editingRule.lng.toFixed(6));
      setNotes(editingRule.notes ?? '');
      setAutoStopOnExit(Boolean(editingRule.autoStopOnExit));
      setEnabled(editingRule.enabled);
      setCameraNonce((n) => n + 1);
      return;
    }

    const defaultServiceProduct =
      products.find((p) => p.type === 'service') ?? products[0] ?? null;

    if (initialCustomer) {
      const customerAddress = [
        initialCustomer.street,
        [initialCustomer.postalCode, initialCustomer.city].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', ');

      setName(`Vor Ort: ${initialCustomer.companyName}`);
      setTaskTitle(`Vor-Ort-Einsatz ${initialCustomer.companyName}`);
      setRadius('150');
      setCustomerId(initialCustomer.id);
      setProductId(initialProduct?.id ?? defaultServiceProduct?.id ?? '');
      setAddress(customerAddress);
      setLat('');
      setLng('');
      setNotes('');
      setAutoStopOnExit(false);
      setEnabled(true);

      if (customerAddress) {
        setSearchingAddress(true);
        void geocodeAddress(customerAddress)
          .then((hit) => {
            if (cancelled || !hit) return;
            setLat(hit.lat.toFixed(6));
            setLng(hit.lng.toFixed(6));
            if (hit.address) setAddress(hit.address);
            setCameraNonce((n) => n + 1);
          })
          .catch(() => {})
          .finally(() => {
            if (!cancelled) setSearchingAddress(false);
          });
      }
      return () => {
        cancelled = true;
      };
    }

    if (initialProduct) {
      setName(`Standort: ${initialProduct.name}`);
      setTaskTitle(initialProduct.name);
      setRadius('150');
      setCustomerId('');
      setProductId(initialProduct.id);
      setAddress('');
      setLat('');
      setLng('');
      setNotes('');
      setAutoStopOnExit(false);
      setEnabled(true);
      return;
    }

    setName('');
    setTaskTitle('');
    setRadius('150');
    setCustomerId(customers[0]?.id ?? '');
    setProductId(defaultServiceProduct?.id ?? '');
    setAddress('');
    setLat('');
    setLng('');
    setNotes('');
    setAutoStopOnExit(false);
    setEnabled(true);
  }, [open, editingRule, initialCustomer, initialProduct, customers, products]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const parsedLat = lat.trim() ? Number(lat.replace(',', '.')) : null;
  const parsedLng = lng.trim() ? Number(lng.replace(',', '.')) : null;
  const validLat = parsedLat !== null && Number.isFinite(parsedLat) ? parsedLat : null;
  const validLng = parsedLng !== null && Number.isFinite(parsedLng) ? parsedLng : null;

  const handleSearchAddress = async () => {
    const query = address.trim();
    if (!query) {
      onNotify('Bitte zuerst eine Adresse eingeben.', true);
      return;
    }
    setSearchingAddress(true);
    try {
      const hit = await geocodeAddress(query);
      if (!hit) {
        onNotify('Adresse wurde auf OpenStreetMap nicht gefunden.', true);
        return;
      }
      setLat(hit.lat.toFixed(6));
      setLng(hit.lng.toFixed(6));
      if (hit.address) setAddress(hit.address);
      setCameraNonce((n) => n + 1);
      onNotify(`Standort gefunden: ${hit.address}`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Adresssuche fehlgeschlagen.',
        true
      );
    } finally {
      setSearchingAddress(false);
    }
  };

  const handleCaptureGps = async () => {
    setCapturingGps(true);
    try {
      const loc = await captureCurrentLocation();
      setLat(loc.lat.toFixed(6));
      setLng(loc.lng.toFixed(6));
      if (loc.address) setAddress(loc.address);
      setCameraNonce((n) => n + 1);
      onNotify(`Aktueller GPS-Standort übernommen (${loc.address || 'Position gespeichert'}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'GPS-Standort konnte nicht abgerufen werden.',
        true
      );
    } finally {
      setCapturingGps(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      onNotify('Bitte einen Ortsnamen eingeben.', true);
      return;
    }
    if (validLat === null || validLng === null) {
      onNotify('Bitte zuerst einen Punkt auf der Karte wählen, eine Adresse suchen oder GPS nutzen.', true);
      return;
    }

    const rule: GeoFenceRule = {
      id: editingRule?.id ?? createId('geo'),
      name: trimmedName,
      enabled,
      lat: validLat,
      lng: validLng,
      address: address.trim() || undefined,
      radiusMeters: Math.max(30, Number(radius) || 150),
      customerId,
      productId,
      taskTitle: taskTitle.trim() || trimmedName,
      notes: notes.trim(),
      autoStopOnExit,
      lastTriggeredAt: editingRule?.lastTriggeredAt,
      createdAt: editingRule?.createdAt ?? new Date().toISOString(),
    };

    onSave(rule);
    onClose();
  };

  const inputClass =
    'min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  const modalTitle = editingRule
    ? 'Ortsabhängigkeit bearbeiten'
    : initialCustomer
      ? `Ortsabhängigkeit für ${initialCustomer.companyName}`
      : initialProduct
        ? `Ortsabhängigkeit für ${initialProduct.name}`
        : 'Neue Ortsabhängigkeit anlegen';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/60 p-2 backdrop-blur-[1px] sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-[#2e2349]">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 shrink-0 text-blue-700 dark:text-violet-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {modalTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Modal schließen"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {/* Map Picker */}
            <GeoFenceMapPicker
              selectedLat={validLat}
              selectedLng={validLng}
              selectedAddress={address}
              radiusMeters={Math.max(30, Number(radius) || 150)}
              rules={existingRules}
              customers={customers}
              products={products}
              focusedRuleId={editingRule?.id ?? null}
              cameraRequestNonce={cameraNonce}
              theme={theme}
              onSelectLocation={(loc) => {
                setLat(loc.lat.toFixed(6));
                setLng(loc.lng.toFixed(6));
                if (loc.address) setAddress(loc.address);
                if (!name.trim() && loc.suggestedName) {
                  setName(loc.suggestedName);
                }
              }}
              onNotify={onNotify}
            />

            {/* Name, Task, Radius */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Ortsname *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="z. B. Kundenbüro München"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Aufgabentitel
                </label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="z. B. Vor-Ort-Service"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Zielradius
                </label>
                <ThemedSelect
                  value={radius}
                  onChange={setRadius}
                  ariaLabel="Zielradius"
                  options={RADIUS_OPTIONS}
                />
              </div>
            </div>

            {/* Customer & Product */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Kunde
                </label>
                <ThemedSelect
                  value={customerId}
                  onChange={setCustomerId}
                  ariaLabel="Kunde für Ortsabhängigkeit"
                  options={[
                    { value: '', label: 'Kein Kunde (interne Aufgabe)' },
                    ...customers.map((c) => ({
                      value: c.id,
                      label: c.companyName,
                    })),
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Produkt / Leistung
                </label>
                <ThemedSelect
                  value={productId}
                  onChange={setProductId}
                  ariaLabel="Leistung für Ortsabhängigkeit"
                  options={[
                    { value: '', label: 'Keine Leistung gewählt' },
                    ...products.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${formatCurrency(p.unitPriceNet)}/${p.unit})`,
                    })),
                  ]}
                />
              </div>
            </div>

            {/* Address Search + GPS + Coordinates */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-6">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Adresse suchen oder GPS übernehmen
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-1.5">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Straße Nr., PLZ Ort"
                    className={`${inputClass} flex-1`}
                  />
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleSearchAddress()}
                      disabled={searchingAddress}
                      className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
                    >
                      {searchingAddress ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      Suchen
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCaptureGps()}
                      disabled={capturingGps}
                      title="Aktuellen GPS-Standort übernehmen"
                      className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-300 cursor-pointer shrink-0"
                    >
                      {capturingGps ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MapPin className="h-3.5 w-3.5" />
                      )}
                      GPS
                    </button>
                  </div>
                </div>
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Breitengrad (Lat)
                </label>
                <input
                  type="text"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="48.13715"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Längengrad (Lng)
                </label>
                <input
                  type="text"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="11.57612"
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Notizen für gestartete Zeiteinträge (optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="z. B. Automatisch per Standortregel gestartet"
                className={inputClass}
              />
            </div>

            {/* Switches */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                Ortsregel aktiv
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoStopOnExit}
                  onChange={(e) => setAutoStopOnExit(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                Aufgabe automatisch beenden, sobald ich den Radius verlasse
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-3 dark:border-[#2e2349] dark:bg-[#211936]/50">
            <div>
              {editingRule && onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    onDelete(editingRule.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Löschen
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg ui-accent-active px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                Ortsregel speichern
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
