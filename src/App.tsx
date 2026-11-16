import { App as CapacitorApp } from '@capacitor/app';
import { Cloud, FilePlus2, Moon, Play, Square, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { CustomersView } from './components/CustomersView';
import { InvoicesView } from './components/InvoicesView';
import { NextcloudSettingsView } from './components/NextcloudSettingsView';
import { NfcTasksView } from './components/NfcTasksView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ProductsView } from './components/ProductsView';
import { Sidebar } from './components/Sidebar';
import { TimeTrackerView } from './components/TimeTrackerView';
import type {
  ActiveTimer,
  AppDatabase,
  CompanyProfile,
  Customer,
  Invoice,
  InvoiceStatus,
  NavSection,
  NextcloudConfigInfo,
  NfcTask,
  Product,
  TaxRate,
  TimeEntry,
} from './types';
import {
  apiLoadDb,
  apiSaveDb,
  apiSyncNextcloud,
  isNativeCapacitor,
} from './utils/apiClient';
import { createId, formatDuration } from './utils/format';
import { extractTagIdFromPayload } from './utils/nfcHelpers';
import { createEmptyDatabase, createSampleDatabase } from './utils/sampleData';

const SECTION_TITLES: Record<NavSection, string> = {
  tracker: 'Zeiterfassung',
  analytics: 'Auswertung & Grafik',
  nfc: 'NFC-Aufgaben',
  customers: 'Kundendatenbank',
  products: 'Produkte & Leistungen',
  invoices: 'Rechnungen',
  settings: 'Nextcloud & Setup',
};

const DEFAULT_NC_INFO: NextcloudConfigInfo = {
  configured: false,
  url: '',
  username: '',
  folder: '/TaktWerk',
  autoSync: true,
  hasPassword: false,
  fromEnv: false,
  lastSyncAt: null,
  lastSyncError: null,
};

function getInitialTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
  return 'light';
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [section, setSection] = useState<NavSection>('tracker');
  const [db, setDb] = useState<AppDatabase>(() => createEmptyDatabase());
  const [nextcloud, setNextcloud] = useState<NextcloudConfigInfo>(DEFAULT_NC_INFO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<{
    customerId: string;
    entryIds: string[];
  } | null>(null);

  const deepLinkHandledRef = useRef(false);
  const dbRef = useRef<AppDatabase>(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      try {
        localStorage.setItem('taktwerk-theme', next);
      } catch {
        // Ignore storage restrictions
      }
      return next;
    });
  }, []);

  const notify = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const persistDb = useCallback(
    async (nextDb: AppDatabase) => {
      dbRef.current = nextDb;
      setDb(nextDb);
      setSaving(true);
      try {
        const result = await apiSaveDb(nextDb);
        setNextcloud(result.nextcloud);
        if (result.syncWarning) {
          notify(`Lokal gespeichert, aber Nextcloud-Sync meldet: ${result.syncWarning}`, true);
        }
      } catch (err) {
        notify(
          err instanceof Error ? err.message : 'Fehler beim Speichern der Daten.',
          true
        );
      } finally {
        setSaving(false);
      }
    },
    [notify]
  );

  const triggerNfcOnDb = useCallback(
    (sourceDb: AppDatabase, tagUid: string): { nextDb: AppDatabase; message: string; isError?: boolean } => {
      const task = sourceDb.nfcTasks.find(
        (t) => t.tagUid.toLowerCase() === tagUid.trim().toLowerCase()
      );
      if (!task) {
        return {
          nextDb: sourceDb,
          message: `Kein NFC-Task mit Tag-ID "${tagUid}" gefunden.`,
          isError: true,
        };
      }

      const now = new Date();
      const nowIso = now.toISOString();
      let nextTimeEntries = [...sourceDb.timeEntries];
      let nextActiveTimer: ActiveTimer | null = sourceDb.activeTimer;

      const finalizeActive = (timer: ActiveTimer) => {
        const startMs = new Date(timer.startTime).getTime();
        const duration = Math.max(1, Math.floor((now.getTime() - startMs) / 1000));
        const finished: TimeEntry = {
          id: createId('time'),
          customerId: timer.customerId,
          productId: timer.productId,
          nfcTaskId: timer.nfcTaskId,
          title: timer.title,
          notes: timer.notes,
          startTime: timer.startTime,
          endTime: nowIso,
          durationSeconds: duration,
          hourlyRateNet: timer.hourlyRateNet,
          taxRate: timer.taxRate,
          billable: true,
          billedInvoiceId: null,
          source: timer.source,
          createdAt: nowIso,
        };
        nextTimeEntries = [finished, ...nextTimeEntries];
      };

      const nextTasks = sourceDb.nfcTasks.map((t) =>
        t.id === task.id
          ? { ...t, triggerCount: t.triggerCount + 1, lastTriggeredAt: nowIso }
          : t
      );

      if (nextActiveTimer && nextActiveTimer.nfcTaskId === task.id && task.toggleOnRescan) {
        finalizeActive(nextActiveTimer);
        return {
          nextDb: {
            ...sourceDb,
            nfcTasks: nextTasks,
            timeEntries: nextTimeEntries,
            activeTimer: null,
          },
          message: `NFC-Aufgabe "${task.title}" gestoppt und als Arbeitszeit gespeichert.`,
        };
      }

      if (nextActiveTimer && task.autoStopPrevious) {
        finalizeActive(nextActiveTimer);
        nextActiveTimer = null;
      }

      const product = sourceDb.products.find((p) => p.id === task.productId);
      const startedTimer: ActiveTimer = {
        id: createId('timer'),
        customerId: task.customerId,
        productId: task.productId,
        nfcTaskId: task.id,
        title: task.title,
        notes: task.description,
        startTime: nowIso,
        hourlyRateNet: product?.unitPriceNet ?? 0,
        taxRate: (product?.taxRate ?? 19) as TaxRate,
        source: 'nfc',
      };

      return {
        nextDb: {
          ...sourceDb,
          nfcTasks: nextTasks,
          timeEntries: nextTimeEntries,
          activeTimer: startedTimer,
        },
        message: `NFC-Aufgabe "${task.title}" gestartet.`,
      };
    },
    []
  );

  // Initial Load + URL Deep-Link (?nfc=<tagId> or Capacitor taktwerk://nfc/<tagId>)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await apiLoadDb();
        if (!active) return;

        let loadedDb = data.db ?? createEmptyDatabase();
        setNextcloud(data.nextcloud);

        if (!deepLinkHandledRef.current) {
          deepLinkHandledRef.current = true;

          let incomingNfc = '';
          const params = new URLSearchParams(window.location.search);
          const nfcParam = params.get('nfc');
          if (nfcParam) {
            incomingNfc = nfcParam;
            window.history.replaceState({}, '', window.location.pathname);
          } else if (isNativeCapacitor()) {
            const launch = await CapacitorApp.getLaunchUrl();
            if (launch?.url) {
              const extracted = extractTagIdFromPayload(launch.url);
              if (extracted && extracted !== launch.url) {
                incomingNfc = extracted;
              }
            }
          }

          if (incomingNfc) {
            const result = triggerNfcOnDb(loadedDb, incomingNfc);
            loadedDb = result.nextDb;
            notify(result.message, result.isError);
            if (!result.isError) {
              await apiSaveDb(loadedDb);
            } else {
              setSection('nfc');
            }
          }
        }

        dbRef.current = loadedDb;
        setDb(loadedDb);
      } catch (err) {
        notify(
          err instanceof Error ? err.message : 'Verbindung zum Server fehlgeschlagen.',
          true
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [notify, triggerNfcOnDb]);

  // Listen for warm/background NFC app launches via Capacitor deep-link (taktwerk://nfc/<tagId>)
  useEffect(() => {
    if (!isNativeCapacitor()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    void CapacitorApp.addListener('appUrlOpen', (event) => {
      const extracted = extractTagIdFromPayload(event.url);
      if (!extracted || extracted === event.url) return;
      const result = triggerNfcOnDb(dbRef.current, extracted);
      if (result.isError) {
        notify(result.message, true);
        setSection('nfc');
        return;
      }
      void persistDb(result.nextDb);
      notify(result.message);
    }).then((handle) => {
      if (cancelled) {
        void handle.remove();
      } else {
        listenerHandle = handle;
      }
    });

    return () => {
      cancelled = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [notify, persistDb, triggerNfcOnDb]);

  // Live timer tick
  useEffect(() => {
    if (!db.activeTimer) {
      setElapsedSeconds(0);
      return;
    }
    const updateTick = () => {
      const startMs = new Date(db.activeTimer!.startTime).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    };
    updateTick();
    const interval = setInterval(updateTick, 1000);
    return () => clearInterval(interval);
  }, [db.activeTimer]);

  const handleStartTimer = (payload: {
    customerId: string;
    productId: string;
    title: string;
    notes: string;
    nfcTaskId?: string | null;
    source?: 'timer' | 'nfc';
  }) => {
    const product = db.products.find((p) => p.id === payload.productId);
    const nowIso = new Date().toISOString();
    const timer: ActiveTimer = {
      id: createId('timer'),
      customerId: payload.customerId,
      productId: payload.productId,
      nfcTaskId: payload.nfcTaskId ?? null,
      title: payload.title,
      notes: payload.notes,
      startTime: nowIso,
      hourlyRateNet: product?.unitPriceNet ?? 0,
      taxRate: (product?.taxRate ?? 19) as TaxRate,
      source: payload.source ?? 'timer',
    };
    void persistDb({ ...db, activeTimer: timer });
    notify(`Timer gestartet: ${timer.title}`);
  };

  const handleStopTimer = () => {
    if (!db.activeTimer) return;
    const now = new Date();
    const startMs = new Date(db.activeTimer.startTime).getTime();
    const durationSeconds = Math.max(1, Math.floor((now.getTime() - startMs) / 1000));
    const entry: TimeEntry = {
      id: createId('time'),
      customerId: db.activeTimer.customerId,
      productId: db.activeTimer.productId,
      nfcTaskId: db.activeTimer.nfcTaskId,
      title: db.activeTimer.title,
      notes: db.activeTimer.notes,
      startTime: db.activeTimer.startTime,
      endTime: now.toISOString(),
      durationSeconds,
      hourlyRateNet: db.activeTimer.hourlyRateNet,
      taxRate: db.activeTimer.taxRate,
      billable: true,
      billedInvoiceId: null,
      source: db.activeTimer.source,
      createdAt: now.toISOString(),
    };
    void persistDb({
      ...db,
      activeTimer: null,
      timeEntries: [entry, ...db.timeEntries],
    });
    notify(`Arbeitszeit gespeichert (${formatDuration(durationSeconds)}).`);
  };

  const handleDiscardTimer = () => {
    if (!db.activeTimer) return;
    void persistDb({ ...db, activeTimer: null });
    notify('Laufender Timer verworfen.');
  };

  const handleAddManualEntry = (entry: TimeEntry) => {
    void persistDb({ ...db, timeEntries: [entry, ...db.timeEntries] });
    notify('Zeiteintrag gespeichert.');
  };

  const handleDeleteEntry = (id: string) => {
    void persistDb({
      ...db,
      timeEntries: db.timeEntries.filter((e) => e.id !== id),
    });
  };

  const handleToggleBillable = (id: string) => {
    void persistDb({
      ...db,
      timeEntries: db.timeEntries.map((e) =>
        e.id === id ? { ...e, billable: !e.billable } : e
      ),
    });
  };

  const handleSaveNfcTask = (task: NfcTask) => {
    const exists = db.nfcTasks.some((t) => t.id === task.id);
    const nextTasks = exists
      ? db.nfcTasks.map((t) => (t.id === task.id ? task : t))
      : [task, ...db.nfcTasks];
    void persistDb({ ...db, nfcTasks: nextTasks });
    notify(`NFC-Aufgabe "${task.title}" gespeichert.`);
  };

  const handleDeleteNfcTask = (id: string) => {
    void persistDb({
      ...db,
      nfcTasks: db.nfcTasks.filter((t) => t.id !== id),
    });
  };

  const handleTriggerNfcTag = (tagUid: string) => {
    const result = triggerNfcOnDb(db, tagUid);
    if (result.isError) {
      notify(result.message, true);
      return;
    }
    void persistDb(result.nextDb);
    notify(result.message);
  };

  const handleSaveCustomer = (customer: Customer) => {
    const exists = db.customers.some((c) => c.id === customer.id);
    const nextCustomers = exists
      ? db.customers.map((c) => (c.id === customer.id ? customer : c))
      : [...db.customers, customer];
    void persistDb({ ...db, customers: nextCustomers });
    notify(`Kunde "${customer.companyName}" gespeichert.`);
  };

  const handleDeleteCustomer = (id: string) => {
    void persistDb({
      ...db,
      customers: db.customers.filter((c) => c.id !== id),
    });
  };

  const handleSaveProduct = (product: Product) => {
    const exists = db.products.some((p) => p.id === product.id);
    const nextProducts = exists
      ? db.products.map((p) => (p.id === product.id ? product : p))
      : [...db.products, product];
    void persistDb({ ...db, products: nextProducts });
    notify(`Artikel "${product.name}" gespeichert.`);
  };

  const handleDeleteProduct = (id: string) => {
    void persistDb({
      ...db,
      products: db.products.filter((p) => p.id !== id),
    });
  };

  const handleCreateInvoice = (invoice: Invoice, billedEntryIds: string[]) => {
    const currentDb = dbRef.current;
    const nextTimeEntries = currentDb.timeEntries.map((entry) =>
      billedEntryIds.includes(entry.id)
        ? { ...entry, billedInvoiceId: invoice.id }
        : entry
    );
    const nextDb: AppDatabase = {
      ...currentDb,
      company: {
        ...currentDb.company,
        nextInvoiceSequence: (currentDb.company.nextInvoiceSequence || 1) + 1,
      },
      timeEntries: nextTimeEntries,
      invoices: [invoice, ...currentDb.invoices],
    };
    void persistDb(nextDb);
    notify(`Rechnung ${invoice.invoiceNumber} erstellt.`);
  };

  const handleUpdateInvoice = (updatedInvoice: Invoice, billedEntryIds: string[]) => {
    const currentDb = dbRef.current;
    const nextTimeEntries = currentDb.timeEntries.map((entry) => {
      if (billedEntryIds.includes(entry.id)) {
        return { ...entry, billedInvoiceId: updatedInvoice.id };
      }
      if (entry.billedInvoiceId === updatedInvoice.id) {
        return { ...entry, billedInvoiceId: null };
      }
      return entry;
    });
    const nextDb: AppDatabase = {
      ...currentDb,
      timeEntries: nextTimeEntries,
      invoices: currentDb.invoices.map((inv) =>
        inv.id === updatedInvoice.id ? updatedInvoice : inv
      ),
    };
    void persistDb(nextDb);
    notify(`Rechnung ${updatedInvoice.invoiceNumber} aktualisiert.`);
  };

  const handleUpdateInvoiceStatus = (invoiceId: string, status: InvoiceStatus) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      invoices: currentDb.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, status } : inv
      ),
    });
  };

  const handleMarkInvoiceUploaded = (invoiceId: string, uploadedAt: string) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      invoices: currentDb.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, nextcloudUploadedAt: uploadedAt } : inv
      ),
    });
  };

  const handleDeleteInvoice = (invoiceId: string) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      timeEntries: currentDb.timeEntries.map((entry) =>
        entry.billedInvoiceId === invoiceId
          ? { ...entry, billedInvoiceId: null }
          : entry
      ),
      invoices: currentDb.invoices.filter((inv) => inv.id !== invoiceId),
    });
    notify('Rechnung gelöscht. Alle verknüpften Arbeitszeiten bleiben als offen erhalten.');
  };

  const handleSyncToNextcloud = async () => {
    try {
      const data = await apiSyncNextcloud('push');
      setNextcloud(data.nextcloud);
      notify('Datenbank erfolgreich auf Nextcloud gesichert.');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Upload nach Nextcloud fehlgeschlagen.',
        true
      );
    }
  };

  const handleSyncFromNextcloud = async () => {
    try {
      const data = await apiSyncNextcloud('pull');
      if (data.db) {
        dbRef.current = data.db;
        setDb(data.db);
      }
      setNextcloud(data.nextcloud);
      notify('Datenbank von Nextcloud geladen.');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Laden von Nextcloud fehlgeschlagen.',
        true
      );
    }
  };

  const handleSaveCompany = (company: CompanyProfile) => {
    void persistDb({ ...db, company });
    notify('Firmendaten gespeichert.');
  };

  const handleLoadSampleData = () => {
    const sample = createSampleDatabase();
    void persistDb(sample);
    notify('Beispieldaten (Kunden, Produkte, NFC-Tags, Zeiten & Rechnung) geladen.');
  };

  const handleResetEmpty = () => {
    const empty = createEmptyDatabase();
    void persistDb(empty);
    notify('Datenbank zurückgesetzt.');
  };

  const openTimeCount = useMemo(
    () => db.timeEntries.filter((e) => e.billable && !e.billedInvoiceId).length,
    [db.timeEntries]
  );

  const unpaidInvoiceCount = useMemo(
    () =>
      db.invoices.filter((i) => i.status === 'Entwurf' || i.status === 'Gesendet').length,
    [db.invoices]
  );

  const isEmptyWorkspace =
    db.customers.length === 0 &&
    db.products.length === 0 &&
    db.timeEntries.length === 0 &&
    db.invoices.length === 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0e0a18] dark:text-slate-100 lg:flex">
      <Sidebar
        activeSection={section}
        onSelectSection={setSection}
        nextcloud={nextcloud}
        openTimeCount={openTimeCount}
        unpaidInvoiceCount={unpaidInvoiceCount}
        activeTimerTitle={db.activeTimer?.title ?? null}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract */}
        <header className="no-print flex h-16 items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 dark:text-violet-300/60">TaktWerk</span>
            <span className="text-slate-300 dark:text-violet-400/40">/</span>
            <span className="truncate font-medium text-slate-900 dark:text-slate-100">
              {SECTION_TITLES[section]}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={toggleTheme}
              title={
                theme === 'dark' ? 'Zum Hellmodus wechseln' : 'Zum Dunkelmodus wechseln'
              }
              aria-label={
                theme === 'dark' ? 'Zum Hellmodus wechseln' : 'Zum Dunkelmodus wechseln'
              }
              className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-200 dark:hover:bg-[#2a2045] cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            {db.activeTimer ? (
              <button
                type="button"
                onClick={handleStopTimer}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span className="font-mono tabular-nums">{formatDuration(elapsedSeconds)}</span>
                <span>Stoppen</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSection('invoices')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                Rechnung erstellen
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-6xl flex-1 p-6">
          {/* Notification Banner */}
          {toast && (
            <div
              role="status"
              className={`no-print mb-5 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${
                toast.isError
                  ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200'
                  : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-violet-700/60 dark:bg-violet-950/70 dark:text-violet-100'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Hinweis schließen"
                className="text-current opacity-60 hover:opacity-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* First-run Empty Onboarding Banner */}
          {!loading && isEmptyWorkspace && section === 'tracker' && (
            <div className="mb-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-[#2e2349] dark:bg-[#171126] sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Willkommen bei TaktWerk
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Starte mit leeren Listen oder lade Beispieldaten, um Kunden, NFC-Aufgaben, Zeiterfassung und Rechnungsexport direkt auszuprobieren.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSection('settings')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  Nextcloud verbinden
                </button>
                <button
                  type="button"
                  onClick={handleLoadSampleData}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Beispieldaten laden
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]" />
              <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126]" />
            </div>
          ) : (
            <>
              {section === 'tracker' && (
                <TimeTrackerView
                  customers={db.customers}
                  products={db.products}
                  nfcTasks={db.nfcTasks}
                  timeEntries={db.timeEntries}
                  activeTimer={db.activeTimer}
                  elapsedSeconds={elapsedSeconds}
                  onStartTimer={handleStartTimer}
                  onStopTimer={handleStopTimer}
                  onDiscardTimer={handleDiscardTimer}
                  onAddManualEntry={handleAddManualEntry}
                  onDeleteEntry={handleDeleteEntry}
                  onToggleBillable={handleToggleBillable}
                  onCreateInvoiceFromEntries={(custId, entryIds) => {
                    setInvoiceDraft({ customerId: custId, entryIds });
                    setSection('invoices');
                  }}
                  onNavigate={(target) => setSection(target)}
                />
              )}

              {section === 'analytics' && (
                <AnalyticsView
                  customers={db.customers}
                  products={db.products}
                  timeEntries={db.timeEntries}
                />
              )}

              {section === 'nfc' && (
                <NfcTasksView
                  customers={db.customers}
                  products={db.products}
                  nfcTasks={db.nfcTasks}
                  activeTimer={db.activeTimer}
                  onSaveTask={handleSaveNfcTask}
                  onDeleteTask={handleDeleteNfcTask}
                  onTriggerTag={handleTriggerNfcTag}
                />
              )}

              {section === 'customers' && (
                <CustomersView
                  customers={db.customers}
                  timeEntries={db.timeEntries}
                  invoices={db.invoices}
                  onSaveCustomer={handleSaveCustomer}
                  onDeleteCustomer={handleDeleteCustomer}
                  onCreateInvoiceForCustomer={(custId) => {
                    setInvoiceDraft({ customerId: custId, entryIds: [] });
                    setSection('invoices');
                  }}
                />
              )}

              {section === 'products' && (
                <ProductsView
                  products={db.products}
                  onSaveProduct={handleSaveProduct}
                  onDeleteProduct={handleDeleteProduct}
                />
              )}

              {section === 'invoices' && (
                <InvoicesView
                  company={db.company}
                  customers={db.customers}
                  products={db.products}
                  timeEntries={db.timeEntries}
                  invoices={db.invoices}
                  nextcloud={nextcloud}
                  preselectedDraft={invoiceDraft}
                  onClearPreselectedDraft={() => setInvoiceDraft(null)}
                  onCreateInvoice={handleCreateInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
                  onMarkInvoiceUploaded={handleMarkInvoiceUploaded}
                  onDeleteInvoice={handleDeleteInvoice}
                  onNotify={notify}
                />
              )}

              {section === 'settings' && (
                <NextcloudSettingsView
                  nextcloud={nextcloud}
                  company={db.company}
                  onRefreshConfig={setNextcloud}
                  onSyncFromNextcloud={handleSyncFromNextcloud}
                  onSyncToNextcloud={handleSyncToNextcloud}
                  onSaveCompany={handleSaveCompany}
                  onLoadSampleData={handleLoadSampleData}
                  onResetEmpty={handleResetEmpty}
                  onNotify={notify}
                />
              )}
            </>
          )}

          {saving && (
            <div className="sr-only" aria-live="polite">
              Speichert...
            </div>
          )}
        </main>
      </div>
      <OfflineIndicator />
    </div>
  );
}
