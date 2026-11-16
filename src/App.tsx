import { App as CapacitorApp } from '@capacitor/app';
import { Cloud, FilePlus2, Moon, Play, Square, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { CalendarView } from './components/CalendarView';
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
  CalendarAppointment,
  CompanyProfile,
  Customer,
  Invoice,
  InvoiceStatus,
  LocationSnapshot,
  NavSection,
  NextcloudConfigInfo,
  NfcTask,
  Product,
  TaxRate,
  TimeEntry,
} from './types';
import {
  NextcloudConflictError,
  apiCheckNextcloudRemote,
  apiLoadDb,
  apiPushNextcloudCalendarEvent,
  apiRunMultiFormatBackup,
  apiSaveDb,
  apiSyncNextcloud,
  cancelNativeTimerReminder,
  getNativeNotificationStatus,
  isNativeCapacitor,
  openNativeNotificationSettings,
  requestNativeNotificationPermission,
  scheduleNativeTimerReminder,
  syncActiveTimerNotification,
  syncNativeWidgetState,
  triggerNfcHaptic,
} from './utils/apiClient';
import { isBackupDue } from './utils/exportBackup';
import {
  createId,
  formatDateTimeDE,
  formatDuration,
  getActiveTimerElapsedMs,
} from './utils/format';
import { captureCurrentLocation } from './utils/geolocation';
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
  'settings',
];

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
  const sectionHistoryRef = useRef<NavSection[]>([]);
  const touchStartRef = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
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

  // Apply UI customization attributes & custom invoice color CSS variable
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-ui-accent', db.company.uiAccent ?? 'violet');
    root.setAttribute('data-ui-density', db.company.uiDensity ?? 'comfortable');
    root.setAttribute('data-ui-scale', db.company.uiFontScale ?? 'normal');
    root.style.setProperty(
      '--tw-invoice-accent',
      db.company.invoiceCustomAccentHex || '#1d4ed8'
    );
  }, [
    db.company.uiAccent,
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
        const duration = Math.max(
          1,
          Math.floor(getActiveTimerElapsedMs(timer, now.getTime()) / 1000)
        );
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
          haptic: 'stop',
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
        pausedAt: null,
        accumulatedPausedMs: 0,
        hourlyRateNet: product?.unitPriceNet ?? 0,
        taxRate: (product?.taxRate ?? 19) as TaxRate,
        source: 'nfc',
        location: null,
      };

      return {
        nextDb: {
          ...sourceDb,
          nfcTasks: nextTasks,
          timeEntries: nextTimeEntries,
          activeTimer: startedTimer,
        },
        message: `NFC-Aufgabe "${task.title}" gestartet.`,
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
      ? db.customers.find((c) => c.id === db.activeTimer!.customerId)?.companyName ?? ''
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
      });
    }

    const triggerReminder = () => {
      if (reminderFiredKeyRef.current === fireKey) return;
      reminderFiredKeyRef.current = fireKey;
      playReminderSound(soundPreset);
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
    loading,
    notify,
  ]);

  const handleStartTimer = (payload: {
    customerId: string;
    productId: string;
    title: string;
    notes: string;
    nfcTaskId?: string | null;
    source?: 'timer' | 'nfc';
    location?: LocationSnapshot | null;
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
      pausedAt: null,
      accumulatedPausedMs: 0,
      hourlyRateNet: product?.unitPriceNet ?? 0,
      taxRate: (product?.taxRate ?? 19) as TaxRate,
      source: payload.source ?? 'timer',
      location: payload.location ?? null,
    };
    void persistDb({ ...db, activeTimer: timer });
    notify(`Timer gestartet: ${timer.title}`);
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
    if (!dbRef.current.activeTimer) return;
    const now = new Date();
    const durationSeconds = Math.max(
      1,
      Math.floor(getActiveTimerElapsedMs(dbRef.current.activeTimer, now.getTime()) / 1000)
    );
    const entry: TimeEntry = {
      id: createId('time'),
      customerId: dbRef.current.activeTimer.customerId,
      productId: dbRef.current.activeTimer.productId,
      nfcTaskId: dbRef.current.activeTimer.nfcTaskId,
      title: dbRef.current.activeTimer.title,
      notes: dbRef.current.activeTimer.notes,
      startTime: dbRef.current.activeTimer.startTime,
      endTime: now.toISOString(),
      durationSeconds,
      hourlyRateNet: dbRef.current.activeTimer.hourlyRateNet,
      taxRate: dbRef.current.activeTimer.taxRate,
      billable: true,
      billedInvoiceId: null,
      source: dbRef.current.activeTimer.source,
      location: dbRef.current.activeTimer.location ?? null,
      createdAt: now.toISOString(),
    };
    void cancelNativeTimerReminder();
    void persistDb({
      ...dbRef.current,
      activeTimer: null,
      timeEntries: [entry, ...dbRef.current.timeEntries],
    });
    pushFinishedEntryToNextcloudCalendar(entry);
    notify(`Arbeitszeit gespeichert (${formatDuration(durationSeconds)}).`);
  }, [notify, persistDb, pushFinishedEntryToNextcloudCalendar]);

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
        const customerName = dbRef.current.activeTimer
          ? dbRef.current.customers.find((c) => c.id === dbRef.current.activeTimer!.customerId)?.companyName ?? ''
          : '';
        void syncActiveTimerNotification(dbRef.current.activeTimer, customerName);
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

  const handleCreateInvoice = (invoice: Invoice, billedEntryIds: string[]) => {
    const currentDb = dbRef.current;
    const isQuote = invoice.documentType === 'quote';
    const nextTimeEntries = isQuote
      ? currentDb.timeEntries
      : currentDb.timeEntries.map((entry) =>
          billedEntryIds.includes(entry.id)
            ? { ...entry, billedInvoiceId: invoice.id }
            : entry
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
      invoices: [invoice, ...currentDb.invoices],
    };
    void persistDb(nextDb);
    notify(
      `${isQuote ? 'Angebot' : 'Rechnung'} ${invoice.invoiceNumber} erstellt.`
    );
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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (db.company.swipeNavigationEnabled === false) return;
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    const ignore = Boolean(
      target?.closest('input, textarea, select, [data-no-swipe], .overflow-x-auto')
    );
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      ignore,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (db.company.swipeNavigationEnabled === false) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.ignore || e.changedTouches.length !== 1) return;

    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 80 || Math.abs(dy) > 55) return;

    if (dx > 0) {
      // Swipe Right = Back in history, or previous section
      if (sectionHistoryRef.current.length > 0) {
        goBackSection();
      } else {
        const idx = NAV_ORDER.indexOf(section);
        if (idx > 0) navigateToSection(NAV_ORDER[idx - 1], false);
      }
    } else {
      // Swipe Left = Next section
      const idx = NAV_ORDER.indexOf(section);
      if (idx >= 0 && idx < NAV_ORDER.length - 1) {
        navigateToSection(NAV_ORDER[idx + 1]);
      }
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0e0a18] dark:text-slate-100 lg:flex"
    >
      <Sidebar
        activeSection={section}
        onSelectSection={navigateToSection}
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
                onClick={() => navigateToSection('invoices')}
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
                />
              )}

              {section === 'nfc' && (
                <NfcTasksView
                  customers={db.customers}
                  products={db.products}
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
                  timeEntries={db.timeEntries}
                  invoices={db.invoices}
                  categories={db.company.customerCategories ?? []}
                  onSaveCustomer={handleSaveCustomer}
                  onDeleteCustomer={handleDeleteCustomer}
                  onCreateInvoiceForCustomer={(custId) => {
                    setInvoiceDraft({ customerId: custId, entryIds: [] });
                    navigateToSection('invoices');
                  }}
                />
              )}

              {section === 'products' && (
                <ProductsView
                  company={db.company}
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
                  db={db}
                  nextcloud={nextcloud}
                  company={db.company}
                  pushConflictAt={pushConflictAt}
                  onDismissConflict={() => setPushConflictAt(null)}
                  onRefreshConfig={setNextcloud}
                  onSyncFromNextcloud={handleSyncFromNextcloud}
                  onSyncToNextcloud={handleSyncToNextcloud}
                  onSaveCompany={handleSaveCompany}
                  onImportDatabase={handleImportDatabase}
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
