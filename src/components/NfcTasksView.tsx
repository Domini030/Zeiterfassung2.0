import {
  Check,
  Copy,
  Nfc,
  Pencil,
  Play,
  Plus,
  Radio,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveTimer, Customer, NfcTask, Product } from '../types';
import { isNativeCapacitor } from '../utils/apiClient';
import { createId, formatCurrency, formatDateTimeDE } from '../utils/format';
import {
  buildAppNfcUri,
  extractTagIdFromPayload,
} from '../utils/nfcHelpers';
import { TaktWerkNative } from '../utils/taktwerkNative';
import { ThemedSelect } from './ThemedSelect';

interface NdefRecordLike {
  recordType: string;
  data?: DataView;
  encoding?: string;
}

interface NdefReadingEventLike extends Event {
  serialNumber?: string;
  message: {
    records: NdefRecordLike[];
  };
}

interface NdefReaderLike {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  write: (
    message: {
      records: { recordType: string; data: string }[];
    },
    options?: { signal?: AbortSignal }
  ) => Promise<void>;
  onreading: ((event: NdefReadingEventLike) => void) | null;
  onreadingerror: (() => void) | null;
}

interface NfcTasksViewProps {
  customers: Customer[];
  products: Product[];
  nfcTasks: NfcTask[];
  activeTimer: ActiveTimer | null;
  incomingUnknownTag?: { uid: string; at: number } | null;
  onConsumeIncomingUnknownTag?: () => void;
  onWritingStateChange?: (writing: boolean) => void;
  onSaveTask: (task: NfcTask) => void;
  onDeleteTask: (id: string) => void;
  onTriggerTag: (tagUid: string) => void;
}

export function NfcTasksView({
  customers,
  products,
  nfcTasks,
  activeTimer,
  incomingUnknownTag,
  onConsumeIncomingUnknownTag,
  onWritingStateChange,
  onSaveTask,
  onDeleteTask,
  onTriggerTag,
}: NfcTasksViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagUid, setTagUid] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [autoStopPrevious, setAutoStopPrevious] = useState(true);
  const [toggleOnRescan, setToggleOnRescan] = useState(true);
  const [formError, setFormError] = useState('');

  const nativeCapacitor = isNativeCapacitor();
  const webNfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;
  const nfcSupported = nativeCapacitor || webNfcSupported;
  const [scanning, setScanning] = useState(false);
  const [nativeNfcStatus, setNativeNfcStatus] = useState<
    'checking' | 'NFC_OK' | 'NFC_DISABLED' | 'NO_NFC' | 'UNSUPPORTED'
  >(nativeCapacitor ? 'checking' : 'UNSUPPORTED');
  const [nfcMessage, setNfcMessage] = useState<string | null>(null);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [writingTagId, setWritingTagId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualScanCode, setManualScanCode] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const writeAbortRef = useRef<AbortController | null>(null);
  const onWritingStateChangeRef = useRef(onWritingStateChange);
  useEffect(() => {
    onWritingStateChangeRef.current = onWritingStateChange;
  }, [onWritingStateChange]);

  const refreshNativeStatus = async () => {
    if (!nativeCapacitor) return;
    try {
      const res = await TaktWerkNative.getNfcStatus();
      if (!res.supported) {
        setNativeNfcStatus('NO_NFC');
        return;
      }
      setNativeNfcStatus(res.status);
    } catch {
      setNativeNfcStatus('UNSUPPORTED');
    }
  };

  useEffect(() => {
    let writeResultHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    if (nativeCapacitor) {
      void refreshNativeStatus();
      void TaktWerkNative.addListener('nfcWriteResult', (res) => {
        setWritingTagId(null);
        onWritingStateChangeRef.current?.(false);
        if (res.success) {
          setNfcError(null);
          setNfcMessage(
            `App-URI (${res.uri}) erfolgreich auf den NFC-Tag geschrieben! Beim nächsten Scan startet TaktWerk automatisch — auch wenn die App geschlossen ist.`
          );
        } else {
          setNfcMessage(null);
          setNfcError(res.error || 'NFC-Tag konnte nicht beschrieben werden.');
        }
      })
        .then((handle) => {
          if (cancelled) {
            void handle.remove();
          } else {
            writeResultHandle = handle;
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      writeAbortRef.current?.abort();
      if (writeResultHandle) {
        void writeResultHandle.remove();
      }
      if (nativeCapacitor) {
        void TaktWerkNative.cancelNfcWrite().catch(() => {});
        onWritingStateChangeRef.current?.(false);
      }
    };
  }, [nativeCapacitor]);

  useEffect(() => {
    if (!incomingUnknownTag) return;
    setTagUid(incomingUnknownTag.uid);
    setNfcError(null);
    if (customers.length > 0 && products.length > 0) {
      setEditingId(null);
      setTitle('');
      setDescription('');
      setCustomerId((prev) => prev || customers[0].id);
      setProductId((prev) => prev || products[0].id);
      setAutoStopPrevious(true);
      setToggleOnRescan(true);
      setFormError('');
      setShowForm(true);
      setNfcMessage(
        `Unbekannter Tag "${incomingUnknownTag.uid}" erkannt. Du kannst ihn jetzt direkt einer Aufgabe zuweisen.`
      );
    } else {
      setNfcMessage(
        `Unbekannter Tag "${incomingUnknownTag.uid}" erkannt. Lege zuerst mindestens einen Kunden und eine Leistung an, um ihn zuzuweisen.`
      );
    }
    onConsumeIncomingUnknownTag?.();
  }, [incomingUnknownTag, customers, products, onConsumeIncomingUnknownTag]);

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const openNewForm = () => {
    setEditingId(null);
    setTagUid(`NFC-${Math.random().toString(36).slice(2, 7).toUpperCase()}`);
    setTitle('');
    setDescription('');
    setCustomerId(customers[0]?.id ?? '');
    setProductId(products[0]?.id ?? '');
    setAutoStopPrevious(true);
    setToggleOnRescan(true);
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (task: NfcTask) => {
    setEditingId(task.id);
    setTagUid(task.tagUid);
    setTitle(task.title);
    setDescription(task.description);
    setCustomerId(task.customerId);
    setProductId(task.productId);
    setAutoStopPrevious(task.autoStopPrevious);
    setToggleOnRescan(task.toggleOnRescan);
    setFormError('');
    setShowForm(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const cleanUid = tagUid.trim();
    if (!cleanUid || !title.trim() || !customerId || !productId) {
      setFormError('Bitte Tag-ID, Aufgabentitel, Kunde und Leistung ausfüllen.');
      return;
    }

    const duplicate = nfcTasks.find(
      (t) => t.tagUid.toLowerCase() === cleanUid.toLowerCase() && t.id !== editingId
    );
    if (duplicate) {
      setFormError(`Die Tag-ID "${cleanUid}" ist bereits einer anderen Aufgabe zugewiesen.`);
      return;
    }

    const existing = editingId ? nfcTasks.find((t) => t.id === editingId) : undefined;
    const saved: NfcTask = {
      id: existing?.id ?? createId('nfc'),
      tagUid: cleanUid,
      title: title.trim(),
      description: description.trim(),
      customerId,
      productId,
      autoStopPrevious,
      toggleOnRescan,
      triggerCount: existing?.triggerCount ?? 0,
      lastTriggeredAt: existing?.lastTriggeredAt ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    onSaveTask(saved);
    setShowForm(false);
  };

  const extractTagIdentifier = (event: NdefReadingEventLike): string => {
    const decoder = new TextDecoder();
    for (const record of event.message.records) {
      if (record.data) {
        const text = decoder.decode(record.data).trim();
        const extracted = extractTagIdFromPayload(text);
        if (extracted) {
          return extracted;
        }
      }
    }
    return event.serialNumber || '';
  };

  const handleDetectedNfcCode = (detectedCode: string) => {
    if (!detectedCode) {
      setNfcError('Tag erkannt, aber keine gültige ID oder TaktWerk-URL gefunden.');
      return;
    }
    const matched = nfcTasks.find(
      (t) => t.tagUid.toLowerCase() === detectedCode.toLowerCase()
    );
    if (matched) {
      onTriggerTag(matched.tagUid);
      setNfcMessage(`NFC-Tag "${matched.tagUid}" erkannt — Aufgabe "${matched.title}" ausgelöst.`);
    } else {
      setTagUid(detectedCode);
      setNfcMessage(
        `Unbekannter Tag "${detectedCode}" gelesen. Du kannst ihn jetzt einer neuen Aufgabe zuweisen.`
      );
      if (!showForm && customers.length > 0 && products.length > 0) {
        setEditingId(null);
        setTitle('');
        setDescription('');
        setCustomerId(customers[0].id);
        setProductId(products[0].id);
        setShowForm(true);
      }
    }
  };

  const stopNativeWriteMode = async () => {
    if (nativeCapacitor) {
      await TaktWerkNative.cancelNfcWrite().catch(() => {});
    } else {
      writeAbortRef.current?.abort();
      writeAbortRef.current = null;
    }
    setWritingTagId(null);
    onWritingStateChange?.(false);
  };

  const ensureNativeNfcReady = async (): Promise<boolean> => {
    const res = await TaktWerkNative.getNfcStatus();
    setNativeNfcStatus(res.status);
    if (!res.supported || res.status === 'NO_NFC') {
      setNfcError('Keine NFC-Hardware auf diesem Gerät gefunden.');
      return false;
    }
    if (!res.enabled || res.status === 'NFC_DISABLED') {
      setNfcError('NFC ist deaktiviert. Bitte schalte NFC in den Android-Schnelleinstellungen ein.');
      return false;
    }
    return true;
  };

  const startWebNfcScan = async () => {
    setNfcError(null);
    setNfcMessage(null);
    if (nativeCapacitor) {
      await refreshNativeStatus();
      return;
    }
    if (!nfcSupported) {
      setNfcError(
        'Web NFC wird in diesem Browser nicht direkt unterstützt (verfügbar in Chrome für Android oder in der TaktWerk-APK). Nutze alternativ die App-/Trigger-URL oder das Testfeld rechts.'
      );
      return;
    }

    try {
      const NdefCtor = (window as unknown as { NDEFReader: new () => NdefReaderLike }).NDEFReader;
      const reader = new NdefCtor();
      const controller = new AbortController();
      abortRef.current = controller;

      await reader.scan({ signal: controller.signal });
      setScanning(true);
      setNfcMessage('NFC-Lesemodus aktiv — Smartphone jetzt an einen NFC-Tag halten.');

      reader.onreading = (event) => {
        const detectedCode = extractTagIdentifier(event);
        handleDetectedNfcCode(detectedCode);
      };

      reader.onreadingerror = () => {
        setNfcError('NFC-Tag konnte nicht gelesen werden. Bitte erneut versuchen.');
      };
    } catch (err) {
      setScanning(false);
      setNfcError(
        err instanceof Error
          ? `NFC-Start fehlgeschlagen: ${err.message}`
          : 'NFC-Scanner konnte nicht gestartet werden.'
      );
    }
  };

  const stopWebNfcScan = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
    setNfcMessage('NFC-Modus beendet.');
  };

  const writeUrlToPhysicalTag = async (task: NfcTask) => {
    setNfcError(null);
    setNfcMessage(null);
    if (!nfcSupported) {
      setNfcError(
        'Direktes Beschreiben erfordert die TaktWerk-Android-APK oder Chrome auf Android. Alternativ kannst du den Link kopieren und mit "NFC Tools" schreiben.'
      );
      return;
    }

    if (writingTagId === task.id) {
      await stopNativeWriteMode();
      setNfcMessage('Schreibvorgang abgebrochen. Automatischer NFC-Empfang wieder aktiv.');
      return;
    }

    if (nativeCapacitor) {
      try {
        const ready = await ensureNativeNfcReady();
        if (!ready) return;

        const appUri = buildAppNfcUri(task.tagUid);
        onWritingStateChange?.(true);
        setWritingTagId(task.id);
        await TaktWerkNative.armNfcWrite({ uri: appUri });
        setNfcMessage(
          `Schreibmodus aktiv für "${task.title}" — NFC-Tag jetzt ruhig an die Rückseite des Smartphones halten.`
        );
      } catch (err) {
        await stopNativeWriteMode();
        setNfcError(
          err instanceof Error ? `Beschreiben fehlgeschlagen: ${err.message}` : 'Tag-Schreibfehler.'
        );
      }
      return;
    }

    try {
      // Stop active web scan so Chrome does not conflict while waiting to write
      abortRef.current?.abort();
      abortRef.current = null;
      setScanning(false);

      const writeController = new AbortController();
      writeAbortRef.current = writeController;
      setWritingTagId(task.id);
      setNfcMessage(
        `Schreibmodus aktiv — NFC-Tag für "${task.title}" jetzt an die Rückseite des Smartphones halten...`
      );
      const NdefCtor = (window as unknown as { NDEFReader: new () => NdefReaderLike }).NDEFReader;
      const writer = new NdefCtor();
      const triggerUrl = `${window.location.origin}/?nfc=${encodeURIComponent(task.tagUid)}`;
      await writer.write(
        { records: [{ recordType: 'url', data: triggerUrl }] },
        { signal: writeController.signal }
      );
      setNfcMessage(`Trigger-URL erfolgreich auf den NFC-Tag für "${task.title}" geschrieben.`);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setNfcError(
          err instanceof Error ? `Beschreiben fehlgeschlagen: ${err.message}` : 'Tag-Schreibfehler.'
        );
      }
    } finally {
      writeAbortRef.current = null;
      setWritingTagId(null);
    }
  };

  const copyTriggerUrl = async (task: NfcTask) => {
    const triggerUrl = nativeCapacitor
      ? buildAppNfcUri(task.tagUid)
      : `${window.location.origin}/?nfc=${encodeURIComponent(task.tagUid)}`;
    await navigator.clipboard.writeText(triggerUrl);
    setCopiedId(task.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleManualScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualScanCode.trim()) return;
    onTriggerTag(manualScanCode.trim());
    setManualScanCode('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            NFC-Aufgaben &amp; Trigger
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Verknüpfe physische NFC-Tags mit Kunden und Leistungen, um Timer per Smartphone-Tap zu starten oder zu stoppen.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewForm}
          disabled={customers.length === 0 || products.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Neue NFC-Aufgabe
        </button>
      </div>

      {/* Web NFC Hardware & URL Trigger Bar */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126] lg:col-span-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-blue-700 dark:text-violet-400" />
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {nativeCapacitor
                    ? 'Automatischer NFC-Empfang (Android-App)'
                    : 'Live NFC-Scanner (Web NFC & Deep-Link)'}
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {nativeCapacitor
                  ? writingTagId
                    ? 'Schreibmodus aktiv — halte den NFC-Tag zum Beschreiben ruhig an die Rückseite deines Smartphones.'
                    : nativeNfcStatus === 'NFC_DISABLED'
                    ? 'NFC ist am Smartphone deaktiviert. Tippe rechts auf „NFC aktivieren“, um die Android-NFC-Einstellungen zu öffnen.'
                    : nativeNfcStatus === 'NO_NFC' || nativeNfcStatus === 'UNSUPPORTED'
                    ? 'Auf diesem Gerät wurde keine aktive NFC-Hardware erkannt.'
                    : 'Ohne Scanner-Start aktiv: Solange die App offen ist, erkennt TaktWerk jeden Tag sofort. Einmal mit „App-Tag schreiben“ beschriebene Tags starten die Zeiterfassung sogar, wenn TaktWerk komplett geschlossen ist!'
                  : webNfcSupported
                  ? 'Browser-Modus (Chrome Web NFC): Aus Sicherheitsgründen verlangen Webbrowser einen Klick auf „NFC-Scanner starten“. Für automatisches Scannen ohne Knopf & bei geschlossener App bitte die TaktWerk Android-APK nutzen.'
                  : 'Desktop / iOS erkannt: Kopiere die Trigger-URL auf deinen NFC-Tag (z. B. mit NFC Tools) — beim Scannen startet TaktWerk die Aufgabe automatisch.'}
              </p>
            </div>
            {nativeCapacitor ? (
              writingTagId ? (
                <button
                  type="button"
                  onClick={() => void stopNativeWriteMode()}
                  className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Schreiben abbrechen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (nativeNfcStatus === 'NFC_DISABLED') {
                      void TaktWerkNative.openNfcSettings().catch(() => {});
                    } else {
                      void refreshNativeStatus();
                    }
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                    nativeNfcStatus === 'NFC_OK'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : nativeNfcStatus === 'NFC_DISABLED'
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200'
                  }`}
                >
                  <Nfc className="h-4 w-4" />
                  {nativeNfcStatus === 'NFC_OK'
                    ? 'Auto-NFC bereit'
                    : nativeNfcStatus === 'NFC_DISABLED'
                    ? 'NFC aktivieren'
                    : nativeNfcStatus === 'checking'
                    ? 'Prüfe NFC...'
                    : 'NFC prüfen'}
                </button>
              )
            ) : scanning ? (
              <button
                type="button"
                onClick={() => void stopWebNfcScan()}
                className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Scanner stoppen
              </button>
            ) : (
              <button
                type="button"
                onClick={startWebNfcScan}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Nfc className="h-4 w-4" />
                NFC-Scanner starten
              </button>
            )}
          </div>
          {nfcMessage && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 dark:border-violet-700/60 dark:bg-violet-950/70 dark:text-violet-100">
              {nfcMessage}
            </div>
          )}
          {nfcError && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
              {nfcError}
            </div>
          )}
        </div>

        {/* Manual / Simulation Trigger */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126] lg:col-span-5">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-slate-700 dark:text-violet-300" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Tag-ID direkt testen / auslösen
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Gib eine Tag-UID ein oder nutze die Auslösen-Buttons unten in der Liste.
          </p>
          <form onSubmit={handleManualScanSubmit} className="mt-3 flex gap-2">
            <input
              type="text"
              value={manualScanCode}
              onChange={(e) => setManualScanCode(e.target.value)}
              placeholder="z. B. NFC-ALPEN-SRV"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Auslösen
            </button>
          </form>
        </div>
      </section>

      {/* Create / Edit Form */}
      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126]">
          <h2 className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            {editingId ? 'NFC-Aufgabe bearbeiten' : 'Neue NFC-Aufgabe anlegen'}
          </h2>
          <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                NFC-Tag UID / Kennung
              </label>
              <input
                type="text"
                value={tagUid}
                onChange={(e) => setTagUid(e.target.value)}
                placeholder="z. B. NFC-WERKSTATT-01 oder 04:A1:2B:..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Aufgabentitel
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z. B. Serverraum Wartung vor Ort"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Kunde
              </label>
              <ThemedSelect
                value={customerId}
                onChange={setCustomerId}
                ariaLabel="Kunde für NFC-Aufgabe"
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.companyName,
                  hint: c.city || undefined,
                }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Leistung / Stundensatz
              </label>
              <ThemedSelect
                value={productId}
                onChange={setProductId}
                ariaLabel="Leistung für NFC-Aufgabe"
                options={products.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${formatCurrency(p.unitPriceNet)}/${p.unit})`,
                }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Beschreibung / Standardnotiz für die Rechnung
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optionaler Hinweis zum Arbeitsplatz oder Leistungsumfang..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500"
              />
            </div>
            <div className="flex flex-wrap gap-6 md:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoStopPrevious}
                  onChange={(e) => setAutoStopPrevious(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                />
                Vorherigen Timer automatisch speichern &amp; stoppen
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={toggleOnRescan}
                  onChange={(e) => setToggleOnRescan(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                />
                Bei erneutem Scan derselben Aufgabe Timer stoppen (Ein-/Ausstempeln)
              </label>
            </div>
            {formError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400 md:col-span-2">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 md:col-span-2">
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
                NFC-Aufgabe speichern
              </button>
            </div>
          </form>
        </section>
      )}

      {/* NFC Tasks List */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]">
        {nfcTasks.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Noch keine NFC-Aufgaben eingerichtet.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Lege eine Aufgabe an, um einen NFC-Sticker mit einem Kunden und Stundensatz zu verknüpfen.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 dark:border-[#2e2349] dark:bg-[#211936]/70 dark:text-violet-200/70">
                  <th className="px-4 py-3">Tag-ID</th>
                  <th className="px-4 py-3">Aufgabe &amp; Kunde</th>
                  <th className="px-4 py-3">Verknüpfte Leistung</th>
                  <th className="px-4 py-3 text-right">Auslösungen</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2e2349]">
                {nfcTasks.map((task) => {
                  const customer = customerMap.get(task.customerId);
                  const product = productMap.get(task.productId);
                  const isRunning = activeTimer?.nfcTaskId === task.id;
                  const isCopied = copiedId === task.id;

                  return (
                    <tr
                      key={task.id}
                      className="transition-colors hover:bg-slate-50/75 dark:hover:bg-[#211936]/50"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800 dark:text-violet-200 whitespace-nowrap">
                        {task.tagUid}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {task.title}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {customer?.companyName ?? 'Unbekannter Kunde'}
                          {task.lastTriggeredAt
                            ? ` · Zuletzt ${formatDateTimeDE(task.lastTriggeredAt)}`
                            : ' · Noch nie ausgelöst'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        <div>{product?.name ?? 'Leistung'}</div>
                        <div className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          {product ? `${formatCurrency(product.unitPriceNet)} / ${product.unit}` : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                        {task.triggerCount}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => onTriggerTag(task.tagUid)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              isRunning
                                ? 'bg-blue-700 text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500'
                                : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#2a2045] dark:hover:bg-violet-600'
                            }`}
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            {isRunning ? 'Stoppen / Neu' : 'Auslösen'}
                          </button>

                          {nfcSupported && (
                            <button
                              type="button"
                              onClick={() => void writeUrlToPhysicalTag(task)}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                                writingTagId === task.id
                                  ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-violet-500 dark:bg-violet-950/70 dark:text-violet-200'
                                  : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38]'
                              }`}
                            >
                              {writingTagId === task.id
                                ? 'Tag hinhalten (Abbrechen)'
                                : nativeCapacitor
                                ? 'App-Tag schreiben'
                                : 'Auf Tag schreiben'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => copyTriggerUrl(task)}
                            title={
                              nativeCapacitor
                                ? 'App-Trigger-URI (taktwerk://) kopieren'
                                : 'NFC Trigger-URL kopieren'
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:text-slate-200 dark:hover:bg-[#231b38] whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                Kopiert
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                {nativeCapacitor ? 'App-URI' : 'Tag-URL'}
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditForm(task)}
                            title="Bearbeiten"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-[#231b38] dark:hover:text-slate-100 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTask(task.id)}
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
