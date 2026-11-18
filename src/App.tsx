import { App as CapacitorApp } from '@capacitor/app';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  FilePlus2,
  Info,
  Moon,
  Play,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { CalendarView } from './components/CalendarView';
import { CustomersView } from './components/CustomersView';
import { ExpensesView } from './components/ExpensesView';
import { InvoicesView } from './components/InvoicesView';
import { NextcloudSettingsView } from './components/NextcloudSettingsView';
import { NfcTasksView } from './components/NfcTasksView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ProductsView } from './components/ProductsView';
import { QuickStartMenu, type QuickStartTaskItem } from './components/QuickStartMenu';
import { RecurringInvoicesView } from './components/RecurringInvoicesView';
import { Sidebar } from './components/Sidebar';
import { TimeTrackerView } from './components/TimeTrackerView';
import type {
  AcceptanceSignature,
  ActiveTimer,
  AppDatabase,
  CalendarAppointment,
  CompanyProfile,
  Customer,
  Expense,
  GeoFenceRule,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  LocationSnapshot,
  NavSection,
  NextcloudConfigInfo,
  NfcTask,
  Product,
  RecurringExpense,
  RecurringInterval,
  RecurringInvoiceTemplate,
  TaxRate,
  TimeEntry,
} from './types';
import {
  NextcloudConflictError,
  apiCheckNextcloudRemote,
  apiDeleteNextcloudInvoiceFiles,
  apiLoadDb,
  apiPushNextcloudCalendarEvent,
  apiRunMultiFormatBackup,
  apiSaveDb,
  apiSyncNextcloud,
  apiUploadNextcloudFile,
  cancelNativeTimerReminder,
  getNativeNotificationStatus,
  isNativeCapacitor,
  openNativeNotificationSettings,
  playNativeReminderTone,
  requestNativeNotificationPermission,
  scheduleNativeTimerReminder,
  syncActiveTimerNotification,
  syncNativeWidgetState,
  triggerNfcHaptic,
} from './utils/apiClient';
import { isBackupDue } from './utils/exportBackup';
import {
  addDaysISO,
  calculateDocumentTotals,
  createId,
  formatDateTimeDE,
  formatDuration,
  formatInvoiceNumber,
  getActiveTimerElapsedMs,
  toInputDate,
} from './utils/format';
import {
  calculateDistanceMeters,
  captureCurrentLocation,
  computeTravelFromBase,
} from './utils/geolocation';
import { extractTagIdFromPayload } from './utils/nfcHelpers';
import { createEmptyDatabase, createSampleDatabase } from './utils/sampleData';
import { playReminderSound, showWebReminderNotification } from './utils/soundReminder';
import { TaktWerkNative, type NativeNotificationStatus } from './utils/taktwerkNative';

const SECTION_TITLES: Record<NavSection, string> = {
  tracker: 'Zeiterfassung',
  calendar: 'Kalender',
  analytics: 'Auswertung & Grafik',
  nfc: 'NFC-Aufgaben',
  customers: 'Kundendatenbank',
  products: 'Produkte & Leistungen',
  invoices: 'Rechnungen & Angebote',
  expenses: 'Belege & Ausgaben',
  recurring: 'Wiederkehrende Rechnungen',
  settings: 'Nextcloud & Setup',
};

const NAV_ORDER: NavSection[] = [
  'tracker',
  'calendar',
  'analytics',
  'nfc',
  'customers',
  'products',
  'invoices',
  'expenses',
  'recurring',
  'settings',
];

function advanceRecurringDate(isoDate: string, interval: RecurringInterval): string {
  const [y, m, d] = isoDate.split('-').map((n) => Number(n));
  if (!y || !m || !d) return toInputDate();
  const monthsToAdd = interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12;
  const targetMonthIndex = m - 1 + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDayInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(d, maxDayInMonth);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

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
  const [toast, setToast] = useState<{ text: string; isError: boolean; id: number } | null>(
    null
  );
  const [checkingGeoFence, setCheckingGeoFence] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<{
    customerId: string;
    entryIds: string[];
  } | null>(null);
  const [isWritingNfc, setIsWritingNfc] = useState(false);
  const isWritingNfcRef = useRef(false);
  useEffect(() => {
    isWritingNfcRef.current = isWritingNfc;
  }, [isWritingNfc]);
  const [pendingScannedUid, setPendingScannedUid] = useState<{
    uid: string;
    at: number;
  } | null>(null);
  const [remoteNewerAt, setRemoteNewerAt] = useState<string | null>(null);
  const [pushConflictAt, setPushConflictAt] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] =
    useState<NativeNotificationStatus | null>(null);

  const checkNotificationStatus = useCallback(async () => {
    if (!isNativeCapacitor()) return;
    const status = await getNativeNotificationStatus();
    if (status) {
      setNotificationStatus(status);
    }
  }, []);

  useEffect(() => {
    void checkNotificationStatus();
  }, [checkNotificationStatus]);

  const deepLinkHandledRef = useRef(false);
  const autoBackupCheckedRef = useRef(false);
  const reminderFiredKeyRef = useRef<string | null>(null);
  const geoCooldownRef = useRef<Map<string, number>>(new Map());
  const sectionHistoryRef = useRef<NavSection[]>([]);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    edge: 'left' | 'right';
    time: number;
  } | null>(null);
  const lastNfcTriggerRef = useRef<{ code: string; at: number } | null>(null);
  const dbRef = useRef<AppDatabase>(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const navigateToSection = useCallback((target: NavSection, pushHistory = true) => {
    setSection((prev) => {
      if (pushHistory && prev !== target) {
        sectionHistoryRef.current = [...sectionHistoryRef.current.slice(-14), prev];
      }
      return target;
    });
  }, []);

  const goBackSection = useCallback((): boolean => {
    const prev = sectionHistoryRef.current.pop();
    if (prev) {
      setSection(prev);
      return true;
    }
    if (section !== 'tracker') {
      setSection('tracker');
      return true;
    }
    return false;
  }, [section]);

  // Apply UI customization attributes & custom app/invoice color CSS variables
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-ui-accent', db.company.uiAccent ?? 'violet');
    root.setAttribute('data-ui-density', db.company.uiDensity ?? 'comfortable');
    root.setAttribute('data-ui-scale', db.company.uiFontScale ?? 'normal');
    const customUiHex = /^#[0-9a-fA-F]{6}$/.test(
      (db.company.uiCustomAccentHex || '').trim()
    )
      ? db.company.uiCustomAccentHex!.trim()
      : '#7c3aed';
    root.style.setProperty('--tw-ui-custom-accent', customUiHex);
    root.style.setProperty(
      '--tw-invoice-accent',
      db.company.invoiceCustomAccentHex || '#1d4ed8'
    );
  }, [
    db.company.uiAccent,
    db.company.uiCustomAccentHex,
    db.company.uiDensity,
    db.company.uiFontScale,
    db.company.invoiceCustomAccentHex,
  ]);

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
    setToast({ text, isError, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4600);
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
    (
      sourceDb: AppDatabase,
      tagUid: string
    ): {
      nextDb: AppDatabase;
      message: string;
      isError?: boolean;
      haptic: 'start' | 'stop' | 'error';
    } => {
      const task = sourceDb.nfcTasks.find(
        (t) => t.tagUid.toLowerCase() === tagUid.trim().toLowerCase()
      );
      if (!task) {
        return {
          nextDb: sourceDb,
          message: `Kein NFC-Task mit Tag-ID "${tagUid}" gefunden.`,
          isError: true,
          haptic: 'error',
        };
      }

      const now = new Date();
      const nowIso = now.toISOString();
      let nextTimeEntries = [...sourceDb.timeEntries];
      let nextActiveTimer: ActiveTimer | null = sourceDb.activeTimer;

      const finalizeActive = (timer: ActiveTimer) => {
        const isInternal = timer.entryType === 'internal' || !timer.customerId;
        const duration = Math.max(
          1,
          Math.floor(getActiveTimerElapsedMs(timer, now.getTime()) / 1000)
        );
        const finished: TimeEntry = {
          id: createId('time'),
          customerId: isInternal ? '' : timer.customerId,
          productId: isInternal ? '' : timer.productId,
          nfcTaskId: timer.nfcTaskId,
          title: timer.title,
          notes: timer.notes,
          startTime: timer.startTime,
          endTime: nowIso,
          durationSeconds: duration,
          hourlyRateNet: isInternal ? 0 : timer.hourlyRateNet,
          taxRate: (isInternal ? 0 : timer.taxRate) as TaxRate,
          billable: !isInternal,
          billedInvoiceId: null,
          source: timer.source,
          entryType: isInternal ? 'internal' : 'project',
          internalCategory: isInternal ? timer.internalCategory : undefined,
          location: timer.location ?? null,
          createdAt: nowIso,
        };
        nextTimeEntries = [finished, ...nextTimeEntries];
      };

      const nextTasks = sourceDb.nfcTasks.map((t) =>
        t.id === task.id
          ? { ...t, triggerCount: t.triggerCount + 1, lastTriggeredAt: nowIso }
          : t
      );

      const isInternalTask = task.entryType === 'internal' || !task.customerId;

      if (nextActiveTimer && nextActiveTimer.nfcTaskId === task.id && task.toggleOnRescan) {
        finalizeActive(nextActiveTimer);
        return {
          nextDb: {
            ...sourceDb,
            nfcTasks: nextTasks,
            timeEntries: nextTimeEntries,
            activeTimer: null,
          },
          message: isInternalTask
            ? `Interne NFC-Aufgabe "${task.title}" gestoppt und gespeichert.`
            : `NFC-Aufgabe "${task.title}" gestoppt und als Arbeitszeit gespeichert.`,
          haptic: 'stop',
        };
      }

      if (nextActiveTimer && task.autoStopPrevious) {
        finalizeActive(nextActiveTimer);
        nextActiveTimer = null;
      }

      const product = isInternalTask
        ? undefined
        : sourceDb.products.find((p) => p.id === task.productId);
      const internalCategory = isInternalTask
        ? task.internalCategory?.trim() || 'Sonstiges'
        : undefined;
      const startedTimer: ActiveTimer = {
        id: createId('timer'),
        customerId: isInternalTask ? '' : task.customerId,
        productId: isInternalTask ? '' : task.productId,
        nfcTaskId: task.id,
        title: task.title,
        notes: task.description,
        startTime: nowIso,
        pausedAt: null,
        accumulatedPausedMs: 0,
        hourlyRateNet: isInternalTask ? 0 : product?.unitPriceNet ?? 0,
        taxRate: (isInternalTask ? 0 : product?.taxRate ?? 19) as TaxRate,
        source: 'nfc',
        entryType: isInternalTask ? 'internal' : 'project',
        internalCategory,
        location: null,
      };

      return {
        nextDb: {
          ...sourceDb,
          nfcTasks: nextTasks,
          timeEntries: nextTimeEntries,
          activeTimer: startedTimer,
        },
        message: isInternalTask
          ? `Interne NFC-Aufgabe "${task.title}" (${internalCategory}) gestartet.`
          : `NFC-Aufgabe "${task.title}" gestartet.`,
        haptic: 'start',
      };
    },
    []
  );

  const attachAutoLocationToTimer = useCallback(
    (timerId: string) => {
      if (!dbRef.current.company.autoCaptureLocation) return;
      void captureCurrentLocation()
        .then((loc) => {
          const current = dbRef.current;
          if (!current.activeTimer || current.activeTimer.id !== timerId) return;
          void persistDb({
            ...current,
            activeTimer: {
              ...current.activeTimer,
              location: loc,
            },
          });
        })
        .catch(() => {
          // Best-effort GPS capture: never block timer
        });
    },
    [persistDb]
  );

  const pushFinishedEntryToNextcloudCalendar = useCallback(
    (entry: TimeEntry) => {
      const calCfg = dbRef.current.company.calendarConfig;
      if (!calCfg?.autoSyncTimeEntries || !calCfg.selectedCalendarUrl) return;
      const custName =
        dbRef.current.customers.find((c) => c.id === entry.customerId)?.companyName ?? '';
      const appt: CalendarAppointment = {
        id: entry.id,
        uid: `${entry.id}@taktwerk.app`,
        title: custName ? `${entry.title} (${custName})` : entry.title,
        startTime: entry.startTime,
        endTime: entry.endTime,
        location: entry.location?.address ?? '',
        description: entry.notes || '',
        calendarName: calCfg.selectedCalendarName,
        source: 'nextcloud',
        customerId: entry.customerId,
        productId: entry.productId,
      };
      void apiPushNextcloudCalendarEvent(calCfg.selectedCalendarUrl, appt).catch(() => {});
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
        let sectionOverridden = false;

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
            lastNfcTriggerRef.current = { code: incomingNfc, at: Date.now() };
            const result = triggerNfcOnDb(loadedDb, incomingNfc);
            loadedDb = result.nextDb;
            triggerNfcHaptic(result.haptic);
            notify(result.message, result.isError);
            if (!result.isError) {
              await apiSaveDb(loadedDb);
              if (loadedDb.activeTimer) {
                attachAutoLocationToTimer(loadedDb.activeTimer.id);
              }
            } else {
              setPendingScannedUid({ uid: incomingNfc, at: Date.now() });
              setSection('nfc');
              sectionOverridden = true;
            }
          } else if (isNativeCapacitor()) {
            const widgetAction = await TaktWerkNative.getPendingWidgetAction().catch(
              () => ({ action: null, tagUid: null })
            );
            if (widgetAction?.action === 'trigger' && widgetAction.tagUid) {
              const result = triggerNfcOnDb(loadedDb, widgetAction.tagUid);
              loadedDb = result.nextDb;
              triggerNfcHaptic(result.haptic);
              notify(result.message, result.isError);
              if (!result.isError) {
                await apiSaveDb(loadedDb);
              }
            }
          }
        }

        if (!sectionOverridden && loadedDb.company.defaultStartSection) {
          setSection(loadedDb.company.defaultStartSection);
        }

        dbRef.current = loadedDb;
        setDb(loadedDb);
        void syncNativeWidgetState(loadedDb);

        if (data.nextcloud.configured) {
          void apiCheckNextcloudRemote().then((check) => {
            if (active && check.hasNewerRemote && check.remoteUpdatedAt) {
              setRemoteNewerAt(check.remoteUpdatedAt);
            }
          });
        }

        // Scheduled Automated Multi-Format Backup Check
        if (!autoBackupCheckedRef.current && isBackupDue(loadedDb)) {
          autoBackupCheckedRef.current = true;
          const backupCfg = loadedDb.company.autoBackup!;
          void apiRunMultiFormatBackup(loadedDb, backupCfg.formats, {
            uploadToNextcloud: backupCfg.uploadToNextcloud && data.nextcloud.configured,
            localDownload: backupCfg.localDownload,
          })
            .then((res) => {
              if (!active) return;
              const current = dbRef.current;
              const nextWithStamp: AppDatabase = {
                ...current,
                company: {
                  ...current.company,
                  autoBackup: {
                    ...backupCfg,
                    lastRunAt: new Date().toISOString(),
                    lastRunSummary: res.summary,
                  },
                },
              };
              void persistDb(nextWithStamp);
              notify(`Automatisches Backup abgeschlossen (${res.summary}).`);
            })
            .catch(() => {
              // Silent fallback if offline at startup
            });
        }
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
  }, [attachAutoLocationToTimer, notify, persistDb, triggerNfcOnDb]);

  const handleGlobalNfcCode = useCallback(
    (rawCode: string) => {
      const clean = rawCode.trim();
      if (!clean) return;
      const now = Date.now();
      const prev = lastNfcTriggerRef.current;
      if (prev && prev.code.toLowerCase() === clean.toLowerCase() && now - prev.at < 2500) {
        return;
      }
      lastNfcTriggerRef.current = { code: clean, at: now };

      const prevTimer = dbRef.current.activeTimer;
      const result = triggerNfcOnDb(dbRef.current, clean);
      triggerNfcHaptic(result.haptic);
      if (result.isError) {
        setPendingScannedUid({ uid: clean, at: now });
        navigateToSection('nfc');
        notify(
          `Unbekannter NFC-Tag "${clean}" erkannt — du kannst ihn jetzt einer Aufgabe zuweisen.`,
          true
        );
        return;
      }
      void persistDb(result.nextDb);
      notify(result.message);

      if (result.nextDb.activeTimer && result.nextDb.activeTimer.id !== prevTimer?.id) {
        attachAutoLocationToTimer(result.nextDb.activeTimer.id);
      } else if (!result.nextDb.activeTimer && result.nextDb.timeEntries[0]) {
        pushFinishedEntryToNextcloudCalendar(result.nextDb.timeEntries[0]);
      }
    },
    [
      attachAutoLocationToTimer,
      navigateToSection,
      notify,
      persistDb,
      pushFinishedEntryToNextcloudCalendar,
      triggerNfcOnDb,
    ]
  );

  // Listen for warm/background NFC app launches via Capacitor deep-link (taktwerk://nfc/<tagId>)
  useEffect(() => {
    if (!isNativeCapacitor()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    void CapacitorApp.addListener('appUrlOpen', (event) => {
      if (isWritingNfcRef.current) return;
      const extracted = extractTagIdFromPayload(event.url);
      if (!extracted || extracted === event.url) return;
      handleGlobalNfcCode(extracted);
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
  }, [handleGlobalNfcCode]);

  // Automatic Foreground Dispatch NFC listener in native Android APK (no scanner button needed)
  useEffect(() => {
    if (!isNativeCapacitor()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    void TaktWerkNative.addListener('nfcTagScanned', (event) => {
      if (isWritingNfcRef.current) return;
      let detected = '';
      for (const raw of event.payloads ?? []) {
        const candidate = extractTagIdFromPayload(raw);
        if (candidate) {
          detected = candidate;
          break;
        }
      }
      if (!detected && event.uidHex) {
        detected = event.uidHex;
      }
      if (detected) {
        handleGlobalNfcCode(detected);
      }
    })
      .then((handle) => {
        if (cancelled) {
          void handle.remove();
        } else {
          listenerHandle = handle;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [handleGlobalNfcCode]);

  // Live timer tick (supports pause/resume)
  useEffect(() => {
    if (!db.activeTimer) {
      setElapsedSeconds(0);
      return;
    }
    const updateTick = () => {
      const elapsedMs = getActiveTimerElapsedMs(db.activeTimer!);
      setElapsedSeconds(Math.max(0, Math.floor(elapsedMs / 1000)));
    };
    updateTick();
    if (db.activeTimer.pausedAt) {
      return;
    }
    const interval = setInterval(updateTick, 1000);
    return () => clearInterval(interval);
  }, [db.activeTimer]);

  // Persistent Android status-bar timer notification
  useEffect(() => {
    if (loading) return;
    const customerName = db.activeTimer
      ? db.activeTimer.entryType === 'internal' || !db.activeTimer.customerId
        ? `Intern${db.activeTimer.internalCategory ? ` · ${db.activeTimer.internalCategory}` : ''}`
        : db.customers.find((c) => c.id === db.activeTimer!.customerId)?.companyName ?? ''
      : '';
    void syncActiveTimerNotification(db.activeTimer, customerName).then((status) => {
      if (status) {
        setNotificationStatus(status);
      }
    });
  }, [db.activeTimer, db.customers, loading]);

  // Sync native Android Home Widget & 1-Hour Reminder Alarm
  useEffect(() => {
    if (loading) return;
    void syncNativeWidgetState(db);
  }, [db.activeTimer, db.timeEntries, db.nfcTasks, db.customers, loading, db]);

  // Android Widget Quick-Start Tap Listener & Native Back Button
  useEffect(() => {
    if (!isNativeCapacitor()) return;
    let widgetHandle: { remove: () => Promise<void> } | null = null;
    let backHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    void TaktWerkNative.addListener('widgetActionTriggered', (event) => {
      if (event.action === 'trigger' && event.tagUid) {
        handleGlobalNfcCode(event.tagUid);
      } else {
        navigateToSection('tracker');
      }
    })
      .then((h) => {
        if (cancelled) void h.remove();
        else widgetHandle = h;
      })
      .catch(() => {});

    void CapacitorApp.addListener('backButton', () => {
      const handled = goBackSection();
      if (!handled) {
        void CapacitorApp.exitApp();
      }
    }).then((h) => {
      if (cancelled) void h.remove();
      else backHandle = h;
    });

    return () => {
      cancelled = true;
      if (widgetHandle) void widgetHandle.remove();
      if (backHandle) void backHandle.remove();
    };
  }, [goBackSection, handleGlobalNfcCode, navigateToSection]);

  // 1-Hour Running Task Reminder (Native AlarmManager + Web Notification & Sound)
  useEffect(() => {
    if (loading) return;
    const timer = db.activeTimer;
    const enabled = db.company.timerReminderEnabled !== false;
    const reminderMinutes = Math.max(1, db.company.timerReminderMinutes ?? 60);
    const soundPreset = db.company.timerReminderSound ?? 'chime';
    const systemSoundUri = db.company.timerReminderSystemSoundUri?.trim() || undefined;

    if (!timer || timer.pausedAt || !enabled) {
      void cancelNativeTimerReminder();
      return;
    }

    const elapsedMs = getActiveTimerElapsedMs(timer);
    const thresholdMs = reminderMinutes * 60_000;
    const remainingMs = thresholdMs - elapsedMs;
    const fireKey = `${timer.id}:${reminderMinutes}`;

    if (isNativeCapacitor() && remainingMs > 1500) {
      void scheduleNativeTimerReminder({
        delayMs: remainingMs,
        title: `Laufende Aufgabe (${reminderMinutes} Min.): ${timer.title}`,
        body: 'Der Timer läuft noch — möchtest du pausieren oder stoppen?',
        soundPreset,
        systemSoundUri,
      });
    }

    const triggerReminder = () => {
      if (reminderFiredKeyRef.current === fireKey) return;
      reminderFiredKeyRef.current = fireKey;
      if (isNativeCapacitor()) {
        void playNativeReminderTone(soundPreset, systemSoundUri);
      } else {
        playReminderSound(soundPreset);
      }
      void showWebReminderNotification(
        `TaktWerk Erinnerung (${reminderMinutes} Min.)`,
        `Aufgabe "${timer.title}" läuft noch.`
      );
      notify(`Erinnerung: Aufgabe "${timer.title}" läuft bereits ${reminderMinutes} Minuten.`);
    };

    if (remainingMs <= 0) {
      triggerReminder();
      return;
    }

    const timeoutId = setTimeout(triggerReminder, remainingMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    db.activeTimer,
    db.company.timerReminderEnabled,
    db.company.timerReminderMinutes,
    db.company.timerReminderSound,
    db.company.timerReminderSystemSoundUri,
    loading,
    notify,
  ]);

  const handleStartTimer = (payload: {
    customerId: string;
    productId: string;
    title: string;
    notes: string;
    nfcTaskId?: string | null;
    source?: 'timer' | 'nfc' | 'geo';
    location?: LocationSnapshot | null;
    entryType?: 'project' | 'internal';
    internalCategory?: string;
  }) => {
    const currentDb = dbRef.current;
    const isInternal = payload.entryType === 'internal' || !payload.customerId;
    const product = isInternal
      ? undefined
      : currentDb.products.find((p) => p.id === payload.productId);
    const now = new Date();
    const nowIso = now.toISOString();

    let nextTimeEntries = currentDb.timeEntries;
    let stoppedPreviousTitle = '';
    if (currentDb.activeTimer) {
      const prev = currentDb.activeTimer;
      const prevInternal = prev.entryType === 'internal' || !prev.customerId;
      const prevDuration = Math.max(
        1,
        Math.floor(getActiveTimerElapsedMs(prev, now.getTime()) / 1000)
      );
      const finishedPrev: TimeEntry = {
        id: createId('time'),
        customerId: prevInternal ? '' : prev.customerId,
        productId: prevInternal ? '' : prev.productId,
        nfcTaskId: prev.nfcTaskId,
        title: prev.title,
        notes: prev.notes,
        startTime: prev.startTime,
        endTime: nowIso,
        durationSeconds: prevDuration,
        hourlyRateNet: prevInternal ? 0 : prev.hourlyRateNet,
        taxRate: (prevInternal ? 0 : prev.taxRate) as TaxRate,
        billable: !prevInternal,
        billedInvoiceId: null,
        source: prev.source,
        entryType: prevInternal ? 'internal' : 'project',
        internalCategory: prevInternal ? prev.internalCategory : undefined,
        location: prev.location ?? null,
        createdAt: nowIso,
      };
      nextTimeEntries = [finishedPrev, ...nextTimeEntries];
      stoppedPreviousTitle = prev.title;
      pushFinishedEntryToNextcloudCalendar(finishedPrev);
    }

    const timer: ActiveTimer = {
      id: createId('timer'),
      customerId: isInternal ? '' : payload.customerId,
      productId: isInternal ? '' : payload.productId,
      nfcTaskId: payload.nfcTaskId ?? null,
      title: payload.title,
      notes: payload.notes,
      startTime: nowIso,
      pausedAt: null,
      accumulatedPausedMs: 0,
      hourlyRateNet: isInternal ? 0 : (product?.unitPriceNet ?? 0),
      taxRate: (isInternal ? 0 : (product?.taxRate ?? 19)) as TaxRate,
      source: payload.source ?? 'timer',
      entryType: isInternal ? 'internal' : 'project',
      internalCategory: isInternal ? (payload.internalCategory || 'Sonstiges') : undefined,
      location: payload.location ?? null,
    };
    void persistDb({ ...currentDb, timeEntries: nextTimeEntries, activeTimer: timer });
    notify(
      stoppedPreviousTitle
        ? `"${stoppedPreviousTitle}" gespeichert · Gestartet: ${timer.title}`
        : `Timer gestartet: ${timer.title}`
    );
    if (!payload.location) {
      attachAutoLocationToTimer(timer.id);
    }
  };

  const handleUpdateActiveTimerNotes = useCallback(
    (notes: string) => {
      const current = dbRef.current;
      if (!current.activeTimer) return;
      void persistDb({
        ...current,
        activeTimer: {
          ...current.activeTimer,
          notes,
        },
      });
    },
    [persistDb]
  );

  const handleUpdateActiveTimerLocation = useCallback(
    (location: LocationSnapshot | null) => {
      const current = dbRef.current;
      if (!current.activeTimer) return;
      void persistDb({
        ...current,
        activeTimer: {
          ...current.activeTimer,
          location,
        },
      });
    },
    [persistDb]
  );

  const handleStopTimer = useCallback(() => {
    const currentDb = dbRef.current;
    if (!currentDb.activeTimer) return;
    const active = currentDb.activeTimer;
    if (active.source === 'geo' && active.geoFenceRuleId) {
      geoCooldownRef.current.set(active.geoFenceRuleId, Date.now());
    }
    const now = new Date();
    const durationSeconds = Math.max(
      1,
      Math.floor(getActiveTimerElapsedMs(active, now.getTime()) / 1000)
    );

    const isInternal = active.entryType === 'internal' || !active.customerId;
    let travelDistanceKm: number | undefined;
    let travelCostNet: number | undefined;
    if (
      !isInternal &&
      currentDb.company.autoCalculateTravelOnStop &&
      currentDb.company.homeBaseLocation &&
      active.location
    ) {
      const calc = computeTravelFromBase(
        currentDb.company.homeBaseLocation,
        active.location,
        currentDb.company.travelRatePerKm ?? 0.3,
        currentDb.company.travelRoundTripDefault !== false
      );
      travelDistanceKm = calc.distanceKm;
      travelCostNet = calc.costNet;
    }

    const entry: TimeEntry = {
      id: createId('time'),
      customerId: isInternal ? '' : active.customerId,
      productId: isInternal ? '' : active.productId,
      nfcTaskId: active.nfcTaskId,
      title: active.title,
      notes: active.notes,
      startTime: active.startTime,
      endTime: now.toISOString(),
      durationSeconds,
      hourlyRateNet: isInternal ? 0 : active.hourlyRateNet,
      taxRate: (isInternal ? 0 : active.taxRate) as TaxRate,
      billable: !isInternal,
      billedInvoiceId: null,
      source: active.source,
      entryType: isInternal ? 'internal' : 'project',
      internalCategory: isInternal ? active.internalCategory : undefined,
      location: active.location ?? null,
      travelDistanceKm,
      travelCostNet,
      travelBilledInvoiceId: null,
      createdAt: now.toISOString(),
    };
    void cancelNativeTimerReminder();
    void persistDb({
      ...currentDb,
      activeTimer: null,
      timeEntries: [entry, ...currentDb.timeEntries],
    });
    pushFinishedEntryToNextcloudCalendar(entry);
    notify(
      isInternal
        ? `Interne Tätigkeit gespeichert (${formatDuration(durationSeconds)}).`
        : travelCostNet && travelCostNet > 0
          ? `Arbeitszeit (${formatDuration(durationSeconds)}) & Fahrtkosten (${travelDistanceKm} km) gespeichert.`
          : `Arbeitszeit gespeichert (${formatDuration(durationSeconds)}).`
    );
  }, [notify, persistDb, pushFinishedEntryToNextcloudCalendar]);

  const evaluateGeoFenceRules = useCallback(
    async (manual = false) => {
      const currentDb = dbRef.current;
      const rules = (currentDb.geoFenceRules ?? []).filter((r) => r.enabled);
      if (rules.length === 0) {
        if (manual) {
          notify('Keine aktiven Ortsregeln vorhanden. Lege zuerst unter Einstellungen → Automation eine Regel an.');
        }
        return;
      }

      if (manual) setCheckingGeoFence(true);
      try {
        const loc = await captureCurrentLocation();
        const latestDb = dbRef.current;
        const active = latestDb.activeTimer;
        const nowMs = Date.now();

        // 1. Check auto-stop on exit if a geofence-started timer is currently running
        if (active && active.source === 'geo' && active.geoFenceRuleId) {
          const runningRule = (latestDb.geoFenceRules ?? []).find(
            (r) => r.id === active.geoFenceRuleId
          );
          if (runningRule && runningRule.autoStopOnExit) {
            const dist = calculateDistanceMeters(
              loc.lat,
              loc.lng,
              runningRule.lat,
              runningRule.lng
            );
            if (dist > runningRule.radiusMeters * 1.35) {
              triggerNfcHaptic('stop');
              handleStopTimer();
              notify(
                `Ortsregel "${runningRule.name}" verlassen (${Math.round(dist)} m) — Aufgabe automatisch gestoppt.`
              );
              return;
            }
          }
          if (manual) {
            notify(`Aktiver Timer "${active.title}" befindet sich weiterhin im Zielbereich.`);
          }
          return;
        }

        // 2. If timer is already running manually/NFC, do not override unless manual feedback requested
        if (active) {
          if (manual) {
            notify('Es läuft bereits ein Timer. Pausiere oder stoppe ihn zuerst.');
          }
          return;
        }

        // 3. Find closest matching enabled rule within radius
        let bestMatch: { rule: GeoFenceRule; dist: number } | null = null;
        for (const rule of rules) {
          const dist = calculateDistanceMeters(loc.lat, loc.lng, rule.lat, rule.lng);
          if (dist <= rule.radiusMeters) {
            const cooldownUntil = (geoCooldownRef.current.get(rule.id) ?? 0) + 10 * 60_000;
            if (!manual && nowMs < cooldownUntil) {
              continue;
            }
            if (!bestMatch || dist < bestMatch.dist) {
              bestMatch = { rule, dist };
            }
          }
        }

        if (!bestMatch) {
          if (manual) {
            notify('Standort geprüft — du befindest dich aktuell innerhalb keiner Ortsregel.');
          }
          return;
        }

        const { rule, dist } = bestMatch;
        const product = latestDb.products.find((p) => p.id === rule.productId);
        const nowIso = new Date().toISOString();
        const geoTimer: ActiveTimer = {
          id: createId('timer'),
          entryType: rule.customerId ? 'project' : 'internal',
          customerId: rule.customerId,
          productId: rule.productId,
          nfcTaskId: null,
          geoFenceRuleId: rule.id,
          title: rule.taskTitle || rule.name,
          notes: rule.notes || '',
          startTime: nowIso,
          pausedAt: null,
          accumulatedPausedMs: 0,
          hourlyRateNet: product?.unitPriceNet ?? 0,
          taxRate: (product?.taxRate ?? 19) as TaxRate,
          source: 'geo',
          location: {
            ...loc,
            address: loc.address || rule.address || rule.name,
          },
        };
        triggerNfcHaptic('start');
        void persistDb({ ...latestDb, activeTimer: geoTimer });
        notify(
          `Ortsregel "${rule.name}" (${Math.round(dist)} m): Aufgabe "${geoTimer.title}" automatisch gestartet.`
        );
      } catch (err) {
        if (manual) {
          notify(
            err instanceof Error ? err.message : 'GPS-Standortprüfung fehlgeschlagen.',
            true
          );
        }
      } finally {
        if (manual) setCheckingGeoFence(false);
      }
    },
    [handleStopTimer, notify, persistDb]
  );

  useEffect(() => {
    if (loading) return;
    if (!db.company.autoLocationStartEnabled) return;
    const hasEnabledRules = (db.geoFenceRules ?? []).some((r) => r.enabled);
    if (!hasEnabledRules) return;

    const intervalMs = Math.max(20, db.company.geoFenceCheckIntervalSec ?? 60) * 1000;
    const initialTimeout = setTimeout(() => {
      void evaluateGeoFenceRules(false);
    }, 2500);
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void evaluateGeoFenceRules(false);
      }
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void evaluateGeoFenceRules(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [
    loading,
    db.company.autoLocationStartEnabled,
    db.company.geoFenceCheckIntervalSec,
    db.geoFenceRules,
    evaluateGeoFenceRules,
  ]);

  const handlePauseTimer = useCallback(() => {
    if (!dbRef.current.activeTimer || dbRef.current.activeTimer.pausedAt) return;
    const updatedTimer: ActiveTimer = {
      ...dbRef.current.activeTimer,
      pausedAt: new Date().toISOString(),
    };
    void cancelNativeTimerReminder();
    void persistDb({ ...dbRef.current, activeTimer: updatedTimer });
    notify(`Timer pausiert: ${updatedTimer.title}`);
  }, [notify, persistDb]);

  const handleResumeTimer = useCallback(() => {
    if (!dbRef.current.activeTimer || !dbRef.current.activeTimer.pausedAt) return;
    const pausedMs = new Date(dbRef.current.activeTimer.pausedAt).getTime();
    const addedPause = Math.max(0, Date.now() - pausedMs);
    const updatedTimer: ActiveTimer = {
      ...dbRef.current.activeTimer,
      pausedAt: null,
      accumulatedPausedMs: (dbRef.current.activeTimer.accumulatedPausedMs ?? 0) + addedPause,
    };
    void persistDb({ ...dbRef.current, activeTimer: updatedTimer });
    notify(`Timer fortgesetzt: ${updatedTimer.title}`);
  }, [notify, persistDb]);

  // Interactive Android notification actions (Pause / Resume / Stop) directly from status bar & lockscreen
  useEffect(() => {
    if (!isNativeCapacitor()) return;
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    const handleAction = (action: string) => {
      if (action === 'pause') {
        handlePauseTimer();
      } else if (action === 'resume') {
        handleResumeTimer();
      } else if (action === 'stop') {
        handleStopTimer();
      }
    };

    void TaktWerkNative.addListener('timerNotificationAction', (event) => {
      if (event?.action) {
        handleAction(event.action);
      }
    })
      .then((handle) => {
        if (cancelled) {
          void handle.remove();
        } else {
          listenerHandle = handle;
        }
      })
      .catch(() => {});

    void TaktWerkNative.getPendingTimerAction().then((res) => {
      if (res?.action) {
        handleAction(res.action);
      }
    });

    return () => {
      cancelled = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }, [handlePauseTimer, handleResumeTimer, handleStopTimer]);

  const handleRequestNotificationPermission = useCallback(async () => {
    const status = await requestNativeNotificationPermission();
    if (status) {
      setNotificationStatus(status);
      if (status.enabled) {
        notify('Benachrichtigungen aktiviert – Timer wird nun in der Statusleiste angezeigt.');
        const activeT = dbRef.current.activeTimer;
        const customerName = activeT
          ? activeT.entryType === 'internal' || !activeT.customerId
            ? `Intern${activeT.internalCategory ? ` · ${activeT.internalCategory}` : ''}`
            : dbRef.current.customers.find((c) => c.id === activeT.customerId)?.companyName ?? ''
          : '';
        void syncActiveTimerNotification(activeT, customerName);
      }
    }
  }, [notify]);

  const handleOpenNotificationSettings = useCallback(async () => {
    await openNativeNotificationSettings();
  }, []);

  const handleDiscardTimer = () => {
    if (!db.activeTimer) return;
    void persistDb({ ...db, activeTimer: null });
    notify('Laufender Timer verworfen.');
  };

  const handleAddManualEntry = (entry: TimeEntry) => {
    void persistDb({ ...db, timeEntries: [entry, ...db.timeEntries] });
    notify('Zeiteintrag gespeichert.');
  };

  const handleUpdateEntry = (updatedEntry: TimeEntry) => {
    void persistDb({
      ...db,
      timeEntries: db.timeEntries.map((e) =>
        e.id === updatedEntry.id ? updatedEntry : e
      ),
    });
    notify('Zeiteintrag aktualisiert.');
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
    const prevTimer = db.activeTimer;
    const result = triggerNfcOnDb(db, tagUid);
    triggerNfcHaptic(result.haptic);
    if (result.isError) {
      notify(result.message, true);
      return;
    }
    void persistDb(result.nextDb);
    notify(result.message);
    if (result.nextDb.activeTimer && result.nextDb.activeTimer.id !== prevTimer?.id) {
      attachAutoLocationToTimer(result.nextDb.activeTimer.id);
    } else if (!result.nextDb.activeTimer && result.nextDb.timeEntries[0]) {
      pushFinishedEntryToNextcloudCalendar(result.nextDb.timeEntries[0]);
    }
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

  const handleSaveProduct = (product: Product, incrementSkuSequence = false) => {
    const exists = db.products.some((p) => p.id === product.id);
    const nextProducts = exists
      ? db.products.map((p) => (p.id === product.id ? product : p))
      : [...db.products, product];
    const nextCompany = incrementSkuSequence
      ? {
          ...db.company,
          nextProductSequence: (db.company.nextProductSequence || 1) + 1,
        }
      : db.company;
    void persistDb({ ...db, company: nextCompany, products: nextProducts });
    notify(`Artikel "${product.name}" gespeichert.`);
  };

  const handleDeleteProduct = (id: string) => {
    void persistDb({
      ...db,
      products: db.products.filter((p) => p.id !== id),
    });
  };

  const handleSaveCalendarEvents = (events: CalendarAppointment[]) => {
    void persistDb({ ...dbRef.current, calendarEvents: events });
  };

  const handleCreateInvoice = (
    invoice: Invoice,
    billedEntryIds: string[],
    billedExpenseIds: string[] = [],
    billedTravelEntryIds: string[] = []
  ) => {
    const currentDb = dbRef.current;
    const isQuote = invoice.documentType === 'quote';
    const nextTimeEntries = isQuote
      ? currentDb.timeEntries
      : currentDb.timeEntries.map((entry) => {
          const billTime = billedEntryIds.includes(entry.id);
          const billTravel = billedTravelEntryIds.includes(entry.id);
          if (!billTime && !billTravel) return entry;
          return {
            ...entry,
            billedInvoiceId: billTime ? invoice.id : entry.billedInvoiceId,
            travelBilledInvoiceId: billTravel ? invoice.id : entry.travelBilledInvoiceId,
          };
        });
    const nextExpenses = isQuote
      ? currentDb.expenses ?? []
      : (currentDb.expenses ?? []).map((exp) =>
          billedExpenseIds.includes(exp.id) ? { ...exp, billedInvoiceId: invoice.id } : exp
        );
    const nextDb: AppDatabase = {
      ...currentDb,
      company: {
        ...currentDb.company,
        nextInvoiceSequence: isQuote
          ? currentDb.company.nextInvoiceSequence || 1
          : (currentDb.company.nextInvoiceSequence || 1) + 1,
        nextQuoteSequence: isQuote
          ? (currentDb.company.nextQuoteSequence || 1) + 1
          : currentDb.company.nextQuoteSequence || 1,
      },
      timeEntries: nextTimeEntries,
      expenses: nextExpenses,
      invoices: [invoice, ...currentDb.invoices],
    };
    void persistDb(nextDb);
    notify(
      `${isQuote ? 'Angebot' : 'Rechnung'} ${invoice.invoiceNumber} erstellt.`
    );
  };

  const handleUpdateInvoice = (
    updatedInvoice: Invoice,
    billedEntryIds: string[],
    billedExpenseIds: string[] = [],
    billedTravelEntryIds: string[] = []
  ) => {
    const currentDb = dbRef.current;
    const nextTimeEntries = currentDb.timeEntries.map((entry) => {
      let nextBilledId = entry.billedInvoiceId;
      if (billedEntryIds.includes(entry.id)) {
        nextBilledId = updatedInvoice.id;
      } else if (entry.billedInvoiceId === updatedInvoice.id) {
        nextBilledId = null;
      }

      let nextTravelBilledId = entry.travelBilledInvoiceId ?? null;
      if (billedTravelEntryIds.includes(entry.id)) {
        nextTravelBilledId = updatedInvoice.id;
      } else if (entry.travelBilledInvoiceId === updatedInvoice.id) {
        nextTravelBilledId = null;
      }

      return nextBilledId === entry.billedInvoiceId &&
        nextTravelBilledId === (entry.travelBilledInvoiceId ?? null)
        ? entry
        : {
            ...entry,
            billedInvoiceId: nextBilledId,
            travelBilledInvoiceId: nextTravelBilledId,
          };
    });

    const nextExpenses = (currentDb.expenses ?? []).map((exp) => {
      if (billedExpenseIds.includes(exp.id)) {
        return { ...exp, billedInvoiceId: updatedInvoice.id };
      }
      if (exp.billedInvoiceId === updatedInvoice.id) {
        return { ...exp, billedInvoiceId: null };
      }
      return exp;
    });

    const nextDb: AppDatabase = {
      ...currentDb,
      timeEntries: nextTimeEntries,
      expenses: nextExpenses,
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

  const handleSaveSignature = (invoiceId: string, signature: AcceptanceSignature) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      invoices: currentDb.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, signature } : inv
      ),
    });
    notify(`Abnahme-Unterschrift für Dokument gespeichert.`);
  };

  const handleDeleteSignature = (invoiceId: string) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      invoices: currentDb.invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, signature: undefined } : inv
      ),
    });
    notify('Unterschrift entfernt.');
  };

  const handleToggleArchiveInvoice = (invoiceId: string) => {
    const currentDb = dbRef.current;
    const target = currentDb.invoices.find((inv) => inv.id === invoiceId);
    if (!target) return;
    const willArchive = !target.isArchived;
    void persistDb({
      ...currentDb,
      invoices: currentDb.invoices.map((inv) =>
        inv.id === invoiceId
          ? {
              ...inv,
              isArchived: willArchive,
              archivedAt: willArchive ? new Date().toISOString() : null,
            }
          : inv
      ),
    });
    const docLabel = target.documentType === 'quote' ? 'Angebot' : 'Rechnung';
    notify(
      willArchive
        ? `${docLabel} ${target.invoiceNumber} archiviert.`
        : `${docLabel} ${target.invoiceNumber} aus dem Archiv wiederhergestellt.`
    );
  };

  const handleDeleteInvoice = (invoiceId: string) => {
    const currentDb = dbRef.current;
    const target = currentDb.invoices.find((inv) => inv.id === invoiceId);

    void persistDb({
      ...currentDb,
      timeEntries: currentDb.timeEntries.map((entry) => ({
        ...entry,
        billedInvoiceId:
          entry.billedInvoiceId === invoiceId ? null : entry.billedInvoiceId,
        travelBilledInvoiceId:
          entry.travelBilledInvoiceId === invoiceId
            ? null
            : entry.travelBilledInvoiceId,
      })),
      expenses: (currentDb.expenses ?? []).map((exp) =>
        exp.billedInvoiceId === invoiceId ? { ...exp, billedInvoiceId: null } : exp
      ),
      invoices: currentDb.invoices.filter((inv) => inv.id !== invoiceId),
    });

    if (target && nextcloud.configured) {
      void apiDeleteNextcloudInvoiceFiles(target.invoiceNumber)
        .then((res) => {
          if (res.deletedCount > 0) {
            notify(
              `Dokument ${target.invoiceNumber} lokal & auf Nextcloud gelöscht (${res.deletedCount} Datei(en)).`
            );
          }
        })
        .catch(() => {
          // Local deletion already succeeded; Nextcloud cleanup may retry manually if offline
        });
    }

    notify('Dokument gelöscht. Verknüpfte Zeiten & Belege bleiben als offen erhalten.');
  };

  const handleAddExpense = (expense: Expense) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      expenses: [expense, ...(currentDb.expenses ?? [])],
    });
    notify(`Beleg "${expense.vendor}" gespeichert.`);
  };

  const handleUpdateExpense = (expense: Expense) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      expenses: (currentDb.expenses ?? []).map((e) =>
        e.id === expense.id ? expense : e
      ),
    });
    notify(`Beleg "${expense.vendor}" aktualisiert.`);
  };

  const handleDeleteExpense = (id: string) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      expenses: (currentDb.expenses ?? []).filter((e) => e.id !== id),
    });
    notify('Beleg gelöscht.');
  };

  const handleUploadExpenseReceipt = async (expense: Expense) => {
    if (!nextcloud.configured || !expense.receiptImageDataUrl) return;
    const base64 = expense.receiptImageDataUrl.includes(',')
      ? expense.receiptImageDataUrl.split(',')[1]
      : expense.receiptImageDataUrl;
    const safeVendor = expense.vendor.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'Beleg';
    const filename = `Beleg-${expense.date}-${safeVendor}-${expense.id.slice(-5)}.jpg`;
    const res = await apiUploadNextcloudFile({
      subFolder: 'Belege',
      filename,
      contentOrBase64: base64,
      isBinary: true,
      contentType: 'image/jpeg',
    });
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      expenses: (currentDb.expenses ?? []).map((e) =>
        e.id === expense.id ? { ...e, nextcloudUploadedAt: res.uploadedAt } : e
      ),
    });
    notify(`Beleg nach Nextcloud (${res.path}) hochgeladen.`);
  };

  const handleAddRecurringExpense = (item: RecurringExpense) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      recurringExpenses: [item, ...(currentDb.recurringExpenses ?? [])],
    });
    notify(`Fixkosten-Eintrag "${item.vendor}" gespeichert.`);
  };

  const handleUpdateRecurringExpense = (item: RecurringExpense) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      recurringExpenses: (currentDb.recurringExpenses ?? []).map((r) =>
        r.id === item.id ? item : r
      ),
    });
    notify(`Fixkosten-Eintrag "${item.vendor}" aktualisiert.`);
  };

  const handleDeleteRecurringExpense = (id: string) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      recurringExpenses: (currentDb.recurringExpenses ?? []).filter((r) => r.id !== id),
    });
    notify('Wiederkehrende Ausgabe gelöscht.');
  };

  const handleBookRecurringExpense = (id: string) => {
    const currentDb = dbRef.current;
    const rec = (currentDb.recurringExpenses ?? []).find((r) => r.id === id);
    if (!rec) return;
    const today = toInputDate();
    const bookDate = rec.nextDueDate || today;
    const newExpense: Expense = {
      id: createId('exp'),
      date: bookDate,
      vendor: rec.vendor,
      description: rec.description || `${rec.vendor} (${rec.category})`,
      category: rec.category,
      netAmount: rec.netAmount,
      taxRate: rec.taxRate,
      grossAmount: rec.grossAmount,
      expenseType: 'operating',
      isRecurring: true,
      recurringExpenseId: rec.id,
      customerId: null,
      billableToCustomer: false,
      billedInvoiceId: null,
      receiptImageDataUrl: rec.receiptImageDataUrl || undefined,
      notes: rec.notes || '',
      createdAt: new Date().toISOString(),
    };
    const nextDue = advanceRecurringDate(bookDate, rec.interval);
    void persistDb({
      ...currentDb,
      expenses: [newExpense, ...(currentDb.expenses ?? [])],
      recurringExpenses: (currentDb.recurringExpenses ?? []).map((r) =>
        r.id === rec.id
          ? { ...r, lastBookedDate: today, nextDueDate: nextDue }
          : r
      ),
    });
    notify(`Fixkosten "${rec.vendor}" verbucht (nächste Fälligkeit: ${nextDue}).`);
  };

  const handleBookAllDueRecurringExpenses = () => {
    const currentDb = dbRef.current;
    const today = toInputDate();
    const dueList = (currentDb.recurringExpenses ?? []).filter(
      (r) => r.active && r.nextDueDate <= today
    );
    if (dueList.length === 0) {
      notify('Aktuell sind keine wiederkehrenden Fixkosten fällig.');
      return;
    }
    const created: Expense[] = [];
    const updatedMap = new Map<string, RecurringExpense>();
    for (const rec of dueList) {
      const bookDate = rec.nextDueDate || today;
      created.push({
        id: createId('exp'),
        date: bookDate,
        vendor: rec.vendor,
        description: rec.description || `${rec.vendor} (${rec.category})`,
        category: rec.category,
        netAmount: rec.netAmount,
        taxRate: rec.taxRate,
        grossAmount: rec.grossAmount,
        expenseType: 'operating',
        isRecurring: true,
        recurringExpenseId: rec.id,
        customerId: null,
        billableToCustomer: false,
        billedInvoiceId: null,
        receiptImageDataUrl: rec.receiptImageDataUrl || undefined,
        notes: rec.notes || '',
        createdAt: new Date().toISOString(),
      });
      updatedMap.set(rec.id, {
        ...rec,
        lastBookedDate: today,
        nextDueDate: advanceRecurringDate(bookDate, rec.interval),
      });
    }
    void persistDb({
      ...currentDb,
      expenses: [...created, ...(currentDb.expenses ?? [])],
      recurringExpenses: (currentDb.recurringExpenses ?? []).map(
        (r) => updatedMap.get(r.id) ?? r
      ),
    });
    notify(`${created.length} fällige Fixkosten-Buchung(en) eingetragen.`);
  };

  const handleSaveRecurringTemplate = (tpl: RecurringInvoiceTemplate) => {
    const currentDb = dbRef.current;
    const list = currentDb.recurringInvoices ?? [];
    const exists = list.some((t) => t.id === tpl.id);
    const nextList = exists
      ? list.map((t) => (t.id === tpl.id ? tpl : t))
      : [tpl, ...list];
    void persistDb({ ...currentDb, recurringInvoices: nextList });
    notify(`Wartungsvertrag "${tpl.title}" gespeichert.`);
  };

  const handleDeleteRecurringTemplate = (id: string) => {
    const currentDb = dbRef.current;
    void persistDb({
      ...currentDb,
      recurringInvoices: (currentDb.recurringInvoices ?? []).filter((t) => t.id !== id),
    });
    notify('Wartungsvertrag gelöscht.');
  };

  const generateInvoiceForTemplateObject = (
    sourceDb: AppDatabase,
    tpl: RecurringInvoiceTemplate,
    seqOffset = 0
  ): { invoice: Invoice; updatedTemplate: RecurringInvoiceTemplate } | null => {
    const cust = sourceDb.customers.find((c) => c.id === tpl.customerId);
    if (!cust) return null;
    const isSmallBiz =
      tpl.isSmallBusiness ?? Boolean(sourceDb.company.smallBusinessMode);
    const seqNum = (sourceDb.company.nextInvoiceSequence || 1) + seqOffset;
    const invNum = formatInvoiceNumber(sourceDb.company, seqNum);
    const today = toInputDate();
    const due = addDaysISO(
      today,
      cust.paymentTermDays || sourceDb.company.defaultPaymentTermDays || 14
    );

    const lineItems: InvoiceLineItem[] = tpl.lineItems.map((item) => {
      const qty = Math.max(0, item.quantity);
      const net = Math.round(qty * item.unitPriceNet * 100) / 100;
      const rate: TaxRate = isSmallBiz ? 0 : item.taxRate;
      const tax = Math.round(net * (rate / 100) * 100) / 100;
      return {
        id: createId('li'),
        description: item.description,
        detail: item.detail ?? '',
        quantity: qty,
        unit: item.unit,
        unitPriceNet: item.unitPriceNet,
        taxRate: rate,
        netTotal: net,
        taxAmount: tax,
        grossTotal: Math.round((net + tax) * 100) / 100,
        timeEntryIds: [],
        productId: item.productId ?? null,
      };
    });

    const totals = calculateDocumentTotals(
      lineItems,
      isSmallBiz,
      tpl.discountType,
      tpl.discountValue
    );

    const invoice: Invoice = {
      id: createId('inv'),
      documentType: 'invoice',
      invoiceNumber: invNum,
      customerId: cust.id,
      customerSnapshot: {
        companyName: cust.companyName,
        contactName: cust.contactName,
        street: cust.street,
        postalCode: cust.postalCode,
        city: cust.city,
        country: cust.country,
        vatId: cust.vatId,
        email: cust.email,
      },
      issueDate: today,
      servicePeriodStart: today,
      servicePeriodEnd: today,
      dueDate: due,
      status: tpl.autoMarkSent ? 'Gesendet' : 'Entwurf',
      lineItems,
      subtotalNetBeforeDiscount: totals.subtotalNetBeforeDiscount,
      discountType: tpl.discountValue && tpl.discountValue > 0 ? tpl.discountType : undefined,
      discountValue: tpl.discountValue && tpl.discountValue > 0 ? tpl.discountValue : undefined,
      discountLabel: tpl.discountValue && tpl.discountValue > 0 ? tpl.discountLabel || 'Rabatt' : undefined,
      discountNetAmount: totals.discountNetAmount > 0 ? totals.discountNetAmount : undefined,
      netTotal: totals.netTotal,
      taxTotal: totals.taxTotal,
      grossTotal: totals.grossTotal,
      introText:
        tpl.introText ||
        sourceDb.company.invoiceDefaultIntroText ||
        'Sehr geehrte Damen und Herren,\n\ngemäß Wartungs- / Servicevertrag berechnen wir folgenden Abrechnungszeitraum:',
      outroText:
        tpl.outroText ||
        sourceDb.company.invoiceDefaultOutroText ||
        'Vielen Dank für Ihr Vertrauen.',
      isSmallBusiness: isSmallBiz,
      smallBusinessNotice: isSmallBiz
        ? sourceDb.company.smallBusinessNotice ||
          'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'
        : undefined,
      nextcloudUploadedAt: null,
      createdAt: new Date().toISOString(),
    };

    const updatedTemplate: RecurringInvoiceTemplate = {
      ...tpl,
      lastRunDate: today,
      nextRunDate: advanceRecurringDate(tpl.nextRunDate, tpl.interval),
      generatedCount: (tpl.generatedCount ?? 0) + 1,
    };

    return { invoice, updatedTemplate };
  };

  const handleGenerateInvoiceFromTemplate = (tpl: RecurringInvoiceTemplate) => {
    const currentDb = dbRef.current;
    const res = generateInvoiceForTemplateObject(currentDb, tpl, 0);
    if (!res) {
      notify('Kunde zu diesem Vertrag nicht gefunden.', true);
      return;
    }
    void persistDb({
      ...currentDb,
      company: {
        ...currentDb.company,
        nextInvoiceSequence: (currentDb.company.nextInvoiceSequence || 1) + 1,
      },
      invoices: [res.invoice, ...currentDb.invoices],
      recurringInvoices: (currentDb.recurringInvoices ?? []).map((t) =>
        t.id === tpl.id ? res.updatedTemplate : t
      ),
    });
    notify(`Rechnung ${res.invoice.invoiceNumber} aus Vertrag "${tpl.title}" erstellt.`);
  };

  const handleGenerateAllDueRecurring = () => {
    const currentDb = dbRef.current;
    const today = toInputDate();
    const dueList = (currentDb.recurringInvoices ?? []).filter(
      (t) => t.active && t.nextRunDate <= today
    );
    if (dueList.length === 0) {
      notify('Aktuell sind keine wiederkehrenden Verträge fällig.');
      return;
    }

    const newInvoices: Invoice[] = [];
    const updatedMap = new Map<string, RecurringInvoiceTemplate>();
    let offset = 0;

    for (const tpl of dueList) {
      const res = generateInvoiceForTemplateObject(currentDb, tpl, offset);
      if (res) {
        newInvoices.push(res.invoice);
        updatedMap.set(tpl.id, res.updatedTemplate);
        offset += 1;
      }
    }

    if (newInvoices.length === 0) return;

    void persistDb({
      ...currentDb,
      company: {
        ...currentDb.company,
        nextInvoiceSequence: (currentDb.company.nextInvoiceSequence || 1) + offset,
      },
      invoices: [...newInvoices, ...currentDb.invoices],
      recurringInvoices: (currentDb.recurringInvoices ?? []).map(
        (t) => updatedMap.get(t.id) ?? t
      ),
    });
    notify(`${newInvoices.length} fällige Vertragsrechnung(en) erstellt.`);
  };

  const handleSaveGeoFenceRules = (rules: GeoFenceRule[]) => {
    const currentDb = dbRef.current;
    void persistDb({ ...currentDb, geoFenceRules: rules });
  };

  const handleSyncToNextcloud = async (force = false) => {
    try {
      const data = await apiSyncNextcloud('push', force);
      setNextcloud(data.nextcloud);
      setPushConflictAt(null);
      setRemoteNewerAt(null);
      notify('Datenbank erfolgreich auf Nextcloud gesichert.');
    } catch (err) {
      if (err instanceof NextcloudConflictError) {
        setPushConflictAt(err.remoteUpdatedAt);
        notify(err.message, true);
        return;
      }
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
      setRemoteNewerAt(null);
      setPushConflictAt(null);
      notify('Datenbank von Nextcloud geladen.');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Laden von Nextcloud fehlgeschlagen.',
        true
      );
    }
  };

  const handleImportDatabase = (importedDb: AppDatabase) => {
    void persistDb(importedDb);
    notify('Backup erfolgreich wiederhergestellt.');
  };

  const handleSaveCompany = (company: CompanyProfile) => {
    void persistDb({ ...db, company });
    notify('Einstellungen & Firmendaten gespeichert.');
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
      db.invoices.filter(
        (i) => !i.isArchived && (i.status === 'Entwurf' || i.status === 'Gesendet')
      ).length,
    [db.invoices]
  );

  const dueRecurringCount = useMemo(() => {
    const today = toInputDate();
    return (db.recurringInvoices ?? []).filter(
      (t) => t.active && t.nextRunDate <= today
    ).length;
  }, [db.recurringInvoices]);

  const recentQuickTasks = useMemo(() => {
    const customerMap = new Map(db.customers.map((c) => [c.id, c.companyName]));
    const productMap = new Map(db.products.map((p) => [p.id, p.name]));
    const results: {
      key: string;
      entryType: 'project' | 'internal';
      customerId: string;
      productId: string;
      internalCategory?: string;
      title: string;
      notes: string;
      subtitle: string;
    }[] = [];
    const seen = new Set<string>();

    const sortedEntries = [...db.timeEntries].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    for (const entry of sortedEntries) {
      if (results.length >= 3) break;
      const isInternal = entry.entryType === 'internal' || !entry.customerId;
      const cleanTitle = entry.title.trim() || (isInternal ? 'Interne Arbeit' : 'Tätigkeit');
      const key = isInternal
        ? `internal|${(entry.internalCategory || '').toLowerCase()}|${cleanTitle.toLowerCase()}`
        : `project|${entry.customerId}|${entry.productId}|${cleanTitle.toLowerCase()}`;
      if (seen.has(key)) continue;
      if (!isInternal && !customerMap.has(entry.customerId)) continue;
      seen.add(key);
      results.push({
        key,
        entryType: isInternal ? 'internal' : 'project',
        customerId: isInternal ? '' : entry.customerId,
        productId: isInternal ? '' : entry.productId,
        internalCategory: isInternal ? entry.internalCategory || 'Sonstiges' : undefined,
        title: cleanTitle,
        notes: '',
        subtitle: isInternal
          ? `Intern · ${entry.internalCategory || 'Ohne Kunde'}`
          : [customerMap.get(entry.customerId), productMap.get(entry.productId)]
              .filter(Boolean)
              .join(' · '),
      });
    }

    // Fallback to NFC tasks if fewer than 3 recent time entries exist
    if (results.length < 3) {
      for (const task of db.nfcTasks) {
        if (results.length >= 3) break;
        const key = `project|${task.customerId}|${task.productId}|${task.title.trim().toLowerCase()}`;
        if (seen.has(key) || !customerMap.has(task.customerId)) continue;
        seen.add(key);
        results.push({
          key,
          entryType: 'project',
          customerId: task.customerId,
          productId: task.productId,
          title: task.title,
          notes: task.description || '',
          subtitle: [customerMap.get(task.customerId), productMap.get(task.productId)]
            .filter(Boolean)
            .join(' · '),
        });
      }
    }

    return results;
  }, [db.timeEntries, db.nfcTasks, db.customers, db.products]);

  const isEmptyWorkspace =
    db.customers.length === 0 &&
    db.products.length === 0 &&
    db.timeEntries.length === 0 &&
    db.invoices.length === 0;

  // Strict outer-edge swipe navigation (only arms within 28px of left/right viewport edge
  // and never while a modal, signature canvas, or interactive element is active).
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = null;
    if (db.company.swipeNavigationEnabled === false) return;
    if (e.touches.length !== 1) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'canvas, [role="dialog"], [aria-modal="true"], [data-no-swipe], input, textarea, select, button, a, .overflow-x-auto'
      )
    ) {
      return;
    }

    const startX = e.touches[0].clientX;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const EDGE_PX = 28;
    const edge: 'left' | 'right' | null =
      startX <= EDGE_PX
        ? 'left'
        : viewportWidth > 0 && startX >= viewportWidth - EDGE_PX
          ? 'right'
          : null;

    if (!edge) return;

    touchStartRef.current = {
      x: startX,
      y: e.touches[0].clientY,
      edge,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (db.company.swipeNavigationEnabled === false) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || e.changedTouches.length !== 1) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

    const elapsed = Date.now() - start.time;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;

    if (elapsed > 750) return;
    if (Math.abs(dy) > 60) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.8) return;

    if (start.edge === 'left' && dx >= 75) {
      // Edge Swipe Right from left screen border = Back in history, or previous section
      if (sectionHistoryRef.current.length > 0) {
        goBackSection();
      } else {
        const idx = NAV_ORDER.indexOf(section);
        if (idx > 0) navigateToSection(NAV_ORDER[idx - 1], false);
      }
    } else if (start.edge === 'right' && dx <= -75) {
      // Edge Swipe Left from right screen border = Next section
      const idx = NAV_ORDER.indexOf(section);
      if (idx >= 0 && idx < NAV_ORDER.length - 1) {
        navigateToSection(NAV_ORDER[idx + 1]);
      }
    }
  };

  const handleQuickStartFromHeader = (task: QuickStartTaskItem) => {
    handleStartTimer({
      customerId: task.customerId,
      productId: task.productId,
      title: task.title,
      notes: task.notes,
      source: 'timer',
      entryType: task.entryType,
      internalCategory: task.internalCategory,
    });
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="min-h-screen overflow-x-clip bg-slate-50 text-slate-900 dark:bg-[#0e0a18] dark:text-slate-100 flex flex-col"
    >
      <div className="flex-1 lg:flex">
        <Sidebar
          activeSection={section}
          sectionTitle={SECTION_TITLES[section]}
          onSelectSection={navigateToSection}
          nextcloud={nextcloud}
          openTimeCount={openTimeCount}
          unpaidInvoiceCount={unpaidInvoiceCount}
          dueRecurringCount={dueRecurringCount}
          activeTimer={db.activeTimer}
          elapsedSeconds={elapsedSeconds}
          recentQuickTasks={recentQuickTasks}
          onQuickStartTask={handleQuickStartFromHeader}
          onStopTimer={handleStopTimer}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sticky Desktop Top Bar (Mobile uses consolidated sticky header in Sidebar) */}
          <header className="no-print hidden lg:flex sticky top-0 z-30 h-16 items-center justify-between gap-4 border-b border-slate-200/90 bg-white/95 px-6 backdrop-blur-md dark:border-[#2e2349] dark:bg-[#171126]/95">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-violet-300/60">TaktWerk</span>
              <span className="text-slate-300 dark:text-violet-400/40">/</span>
              <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                {SECTION_TITLES[section]}
              </span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <PWAInstallButton />

              {/* Header Quick-Start Dropdown (Last 3 Tasks) */}
              <QuickStartMenu
                recentTasks={recentQuickTasks}
                activeTimer={db.activeTimer}
                onStartTask={handleQuickStartFromHeader}
                onOpenTracker={() => navigateToSection('tracker')}
              />

              <button
                type="button"
                onClick={toggleTheme}
                title={
                  theme === 'dark' ? 'Zum Hellmodus wechseln' : 'Zum Dunkelmodus wechseln'
                }
                aria-label={
                  theme === 'dark' ? 'Zum Hellmodus wechseln' : 'Zum Dunkelmodus wechseln'
                }
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-200 dark:hover:bg-[#2a2045] cursor-pointer"
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              {db.activeTimer ? (
                <>
                  <button
                    type="button"
                    onClick={handleStopTimer}
                    className="inline-flex items-center gap-2 rounded-lg ui-accent-btn px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    <span className="font-mono tabular-nums">{formatDuration(elapsedSeconds)}</span>
                    <span>Stoppen</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToSection('invoices')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    <span>Rechnung erstellen</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => navigateToSection('invoices')}
                  className="inline-flex items-center gap-1.5 rounded-lg ui-accent-active px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  <span>Rechnung erstellen</span>
                </button>
              )}
            </div>
          </header>

          {/* Translucent Floating Popup Notification */}
          {toast && (
            <div
              key={toast.id}
              role="status"
              aria-live="polite"
              className={`no-print fixed top-16 lg:top-4 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-2rem)] max-w-md rounded-2xl border backdrop-blur-md shadow-2xl px-4 py-3 tw-popup-enter flex items-start gap-3 ${
                toast.isError
                  ? 'border-red-300/80 bg-red-50/90 text-red-950 dark:border-red-700/70 dark:bg-[#2a121b]/90 dark:text-red-100'
                  : 'border-violet-200/90 bg-white/85 text-slate-900 dark:border-violet-500/40 dark:bg-[#19122c]/85 dark:text-slate-100'
              }`}
            >
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${
                toast.isError
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300'
                  : /gespeichert|erstellt|aktualisiert|hochgeladen|abgeschlossen|aktiviert|gestoppt|gestartet|gelöscht|archiviert|wiederhergestellt|verbucht|eingetragen/i.test(
                        toast.text
                      )
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    : 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300'
              }`}
            >
              {toast.isError ? (
                <AlertCircle className="h-4 w-4" />
              ) : /gespeichert|erstellt|aktualisiert|hochgeladen|abgeschlossen|aktiviert|gestoppt|gestartet|gelöscht|archiviert|wiederhergestellt|verbucht|eingetragen/i.test(
                  toast.text
                ) ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">
                {toast.isError
                  ? 'Achtung'
                  : /gespeichert|erstellt|aktualisiert|hochgeladen|abgeschlossen|aktiviert|gestoppt|gestartet|gelöscht|archiviert|wiederhergestellt|verbucht|eingetragen/i.test(
                        toast.text
                      )
                    ? 'Gespeichert'
                    : 'Hinweis'}
              </div>
              <div className="text-sm font-medium leading-snug">{toast.text}</div>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Meldung schließen"
              className="mt-0.5 rounded-lg p-1 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">

          {/* Multi-device Nextcloud Conflict Notice */}
          {remoteNewerAt && (
            <div className="no-print mb-5 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <span>
                In deiner Nextcloud liegt ein neuerer Datenstand ({formatDateTimeDE(remoteNewerAt)}) von einem anderen Gerät.
              </span>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleSyncFromNextcloud()}
                  className="rounded-md bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 cursor-pointer"
                >
                  Jetzt von Nextcloud laden
                </button>
                <button
                  type="button"
                  onClick={() => setRemoteNewerAt(null)}
                  className="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40 cursor-pointer"
                >
                  Später
                </button>
              </div>
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
                  onClick={() => navigateToSection('settings')}
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
                  company={db.company}
                  customers={db.customers}
                  products={db.products}
                  nfcTasks={db.nfcTasks}
                  timeEntries={db.timeEntries}
                  invoices={db.invoices}
                  calendarEvents={db.calendarEvents ?? []}
                  activeTimer={db.activeTimer}
                  elapsedSeconds={elapsedSeconds}
                  onStartTimer={handleStartTimer}
                  onUpdateActiveTimerNotes={handleUpdateActiveTimerNotes}
                  onUpdateActiveTimerLocation={handleUpdateActiveTimerLocation}
                  onPauseTimer={handlePauseTimer}
                  onResumeTimer={handleResumeTimer}
                  onStopTimer={handleStopTimer}
                  onDiscardTimer={handleDiscardTimer}
                  onAddManualEntry={handleAddManualEntry}
                  onUpdateEntry={handleUpdateEntry}
                  onDeleteEntry={handleDeleteEntry}
                  onToggleBillable={handleToggleBillable}
                  onCreateInvoiceFromEntries={(custId, entryIds) => {
                    setInvoiceDraft({ customerId: custId, entryIds });
                    navigateToSection('invoices');
                  }}
                  onNavigate={(target) => navigateToSection(target)}
                  onNotify={notify}
                  notificationStatus={notificationStatus}
                  onRequestNotificationPermission={handleRequestNotificationPermission}
                  onOpenNotificationSettings={handleOpenNotificationSettings}
                  onCheckGeoFenceNow={() => void evaluateGeoFenceRules(true)}
                  checkingGeoFence={checkingGeoFence}
                  geoFenceRuleCount={(db.geoFenceRules ?? []).filter((r) => r.enabled).length}
                />
              )}

              {section === 'calendar' && (
                <CalendarView
                  company={db.company}
                  customers={db.customers}
                  products={db.products}
                  timeEntries={db.timeEntries}
                  invoices={db.invoices}
                  calendarEvents={db.calendarEvents ?? []}
                  nextcloud={nextcloud}
                  onSaveCalendarEvents={handleSaveCalendarEvents}
                  onStartTimerFromAppointment={(payload) => {
                    handleStartTimer({
                      customerId: payload.customerId,
                      productId: payload.productId,
                      title: payload.title,
                      notes: payload.notes,
                      source: 'timer',
                    });
                    navigateToSection('tracker');
                  }}
                  onNavigateSettings={() => navigateToSection('settings')}
                  onNotify={notify}
                />
              )}

              {section === 'analytics' && (
                <AnalyticsView
                  customers={db.customers}
                  products={db.products}
                  timeEntries={db.timeEntries}
                  expenses={db.expenses ?? []}
                  recurringExpenses={db.recurringExpenses ?? []}
                  db={db}
                  onNotify={notify}
                />
              )}

              {section === 'nfc' && (
                <NfcTasksView
                  customers={db.customers}
                  products={db.products}
                  internalCategories={db.company.internalCategories ?? []}
                  nfcTasks={db.nfcTasks}
                  activeTimer={db.activeTimer}
                  incomingUnknownTag={pendingScannedUid}
                  onConsumeIncomingUnknownTag={() => setPendingScannedUid(null)}
                  onWritingStateChange={setIsWritingNfc}
                  onSaveTask={handleSaveNfcTask}
                  onDeleteTask={handleDeleteNfcTask}
                  onTriggerTag={handleTriggerNfcTag}
                />
              )}

              {section === 'customers' && (
                <CustomersView
                  customers={db.customers}
                  products={db.products}
                  timeEntries={db.timeEntries}
                  invoices={db.invoices}
                  categories={db.company.customerCategories ?? []}
                  geoFenceRules={db.geoFenceRules ?? []}
                  autoLocationStartEnabled={Boolean(db.company.autoLocationStartEnabled)}
                  theme={theme}
                  onSaveCustomer={handleSaveCustomer}
                  onDeleteCustomer={handleDeleteCustomer}
                  onSaveGeoFenceRules={handleSaveGeoFenceRules}
                  onNotify={notify}
                  onCreateInvoiceForCustomer={(custId) => {
                    setInvoiceDraft({ customerId: custId, entryIds: [] });
                    navigateToSection('invoices');
                  }}
                />
              )}

              {section === 'products' && (
                <ProductsView
                  company={db.company}
                  customers={db.customers}
                  products={db.products}
                  geoFenceRules={db.geoFenceRules ?? []}
                  autoLocationStartEnabled={Boolean(db.company.autoLocationStartEnabled)}
                  theme={theme}
                  onSaveProduct={handleSaveProduct}
                  onDeleteProduct={handleDeleteProduct}
                  onSaveGeoFenceRules={handleSaveGeoFenceRules}
                  onNotify={notify}
                />
              )}

              {section === 'invoices' && (
                <InvoicesView
                  company={db.company}
                  customers={db.customers}
                  products={db.products}
                  timeEntries={db.timeEntries}
                  expenses={db.expenses ?? []}
                  invoices={db.invoices}
                  nextcloud={nextcloud}
                  preselectedDraft={invoiceDraft}
                  onClearPreselectedDraft={() => setInvoiceDraft(null)}
                  onCreateInvoice={handleCreateInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
                  onMarkInvoiceUploaded={handleMarkInvoiceUploaded}
                  onSaveSignature={handleSaveSignature}
                  onDeleteSignature={handleDeleteSignature}
                  onToggleArchiveInvoice={handleToggleArchiveInvoice}
                  onDeleteInvoice={handleDeleteInvoice}
                  onNotify={notify}
                />
              )}

              {section === 'expenses' && (
                <ExpensesView
                  expenses={db.expenses ?? []}
                  recurringExpenses={db.recurringExpenses ?? []}
                  customers={db.customers}
                  expenseCategories={db.company.expenseCategories ?? []}
                  nextcloudConfigured={nextcloud.configured}
                  onAddExpense={handleAddExpense}
                  onUpdateExpense={handleUpdateExpense}
                  onDeleteExpense={handleDeleteExpense}
                  onUploadExpenseReceipt={handleUploadExpenseReceipt}
                  onAddRecurringExpense={handleAddRecurringExpense}
                  onUpdateRecurringExpense={handleUpdateRecurringExpense}
                  onDeleteRecurringExpense={handleDeleteRecurringExpense}
                  onBookRecurringExpense={handleBookRecurringExpense}
                  onBookAllDueRecurringExpenses={handleBookAllDueRecurringExpenses}
                  onNotify={(msg, tone) => notify(msg, tone === 'warning')}
                />
              )}

              {section === 'recurring' && (
                <RecurringInvoicesView
                  templates={db.recurringInvoices ?? []}
                  customers={db.customers}
                  products={db.products}
                  company={db.company}
                  onSaveTemplate={handleSaveRecurringTemplate}
                  onDeleteTemplate={handleDeleteRecurringTemplate}
                  onGenerateFromTemplate={handleGenerateInvoiceFromTemplate}
                  onGenerateAllDue={handleGenerateAllDueRecurring}
                />
              )}

              {section === 'settings' && (
                <NextcloudSettingsView
                  db={db}
                  nextcloud={nextcloud}
                  company={db.company}
                  geoFenceRules={db.geoFenceRules ?? []}
                  pushConflictAt={pushConflictAt}
                  onDismissConflict={() => setPushConflictAt(null)}
                  onRefreshConfig={setNextcloud}
                  onSyncFromNextcloud={handleSyncFromNextcloud}
                  onSyncToNextcloud={handleSyncToNextcloud}
                  onSaveCompany={handleSaveCompany}
                  onSaveGeoFenceRules={handleSaveGeoFenceRules}
                  onCheckGeoFenceNow={() => void evaluateGeoFenceRules(true)}
                  checkingGeoFence={checkingGeoFence}
                  onImportDatabase={handleImportDatabase}
                  onLoadSampleData={handleLoadSampleData}
                  onResetEmpty={handleResetEmpty}
                  onNotify={notify}
                  theme={theme}
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
      </div>
      <OfflineIndicator />
    </div>
  );
}
