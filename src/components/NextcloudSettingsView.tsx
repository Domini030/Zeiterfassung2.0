import {
  AlertTriangle,
  Archive,
  BarChart3,
  BellRing,
  Building2,
  Calendar,
  Car,
  CheckCircle2,
  Cloud,
  Compass,
  Database,
  Download,
  DownloadCloud,
  FileArchive,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Loader2,
  Map as MapIcon,
  MapPin,
  Palette,
  Plus,
  Radar,
  RefreshCw,
  RotateCcw,
  Server,
  Share2,
  Smartphone,
  Trash2,
  Upload,
  UploadCloud,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppDatabase,
  AutoBackupFormat,
  AutoBackupFrequency,
  CompanyProfile,
  GeoFenceRule,
  HomeBaseLocation,
  InvoiceAccentPreset,
  InvoiceFontFamily,
  InvoiceLayoutStyle,
  NavSection,
  NextcloudConfigInfo,
  ReminderSoundPreset,
  TimeRoundingMinutes,
  UiAccentPreset,
  UiDensity,
  UiFontScale,
} from '../types';
import {
  apiClearNextcloudConfig,
  apiDiscoverNextcloudCalendars,
  apiRunMultiFormatBackup,
  apiSaveNextcloudConfig,
  apiTestNextcloud,
  apiUploadNextcloudFile,
  getBackendServerUrl,
  isNativeCapacitor,
  playNativeReminderTone,
  setBackendServerUrl,
} from '../utils/apiClient';
import type { DiscoveredCalendar } from '../utils/caldavClient';
import {
  INVOICE_ACCENT_STYLES,
  INVOICE_FONT_OPTIONS,
  INVOICE_LAYOUT_OPTIONS,
  createId,
  formatCurrency,
  formatDateTimeDE,
  formatInvoiceNumber,
  formatNumber,
  formatProductSku,
  formatQuoteNumber,
  toInputDate,
} from '../utils/format';
import { captureCurrentLocation, geocodeAddress } from '../utils/geolocation';
import {
  buildInvoicesZipBase64,
  downloadExcelBackup,
  downloadInvoicesZip,
  downloadOrShareTextFile,
  invoicesToCsv,
  timeEntriesToCsv,
  validateImportedDatabase,
} from '../utils/exportBackup';
import {
  downloadFilteredReportPdf,
  downloadFullBackupPdf,
  getFilteredReportPdfBase64,
  shareFilteredReportPdf,
  type FilteredReportOptions,
} from '../utils/pdfInvoice';
import { REMINDER_SOUND_OPTIONS, playReminderSound } from '../utils/soundReminder';
import { GeoFenceMapPicker, type PickedMapLocation } from './GeoFenceMapPicker';
import { ThemedSelect } from './ThemedSelect';

type SettingsTab = 'general' | 'company' | 'cloud' | 'backups' | 'automation';

interface NextcloudSettingsViewProps {
  db: AppDatabase;
  nextcloud: NextcloudConfigInfo;
  company: CompanyProfile;
  geoFenceRules: GeoFenceRule[];
  pushConflictAt: string | null;
  onDismissConflict: () => void;
  onRefreshConfig: (nextcloud: NextcloudConfigInfo) => void;
  onSyncFromNextcloud: () => Promise<void>;
  onSyncToNextcloud: (force?: boolean) => Promise<void>;
  onSaveCompany: (company: CompanyProfile) => void;
  onSaveGeoFenceRules: (rules: GeoFenceRule[]) => void;
  onCheckGeoFenceNow?: () => void;
  checkingGeoFence?: boolean;
  onImportDatabase: (db: AppDatabase) => void;
  onLoadSampleData: () => void;
  onResetEmpty: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
  theme?: 'light' | 'dark';
}

const UI_ACCENTS: { id: UiAccentPreset; label: string; dotClass: string }[] = [
  { id: 'violet', label: 'TaktWerk Violett', dotClass: 'bg-violet-600' },
  { id: 'blue', label: 'Ozean Blau', dotClass: 'bg-blue-600' },
  { id: 'emerald', label: 'Smaragd Grün', dotClass: 'bg-emerald-600' },
  { id: 'amber', label: 'Bernstein Gold', dotClass: 'bg-amber-600' },
  { id: 'rose', label: 'Rubin Rot', dotClass: 'bg-rose-600' },
];

const START_SECTION_OPTIONS: { id: NavSection; label: string }[] = [
  { id: 'tracker', label: 'Zeiterfassung (Standard)' },
  { id: 'calendar', label: 'Kalender' },
  { id: 'analytics', label: 'Auswertung & Grafik' },
  { id: 'nfc', label: 'NFC-Aufgaben' },
  { id: 'customers', label: 'Kunden' },
  { id: 'products', label: 'Produkte & Leistungen' },
  { id: 'invoices', label: 'Rechnungen & Angebote' },
  { id: 'expenses', label: 'Belege & Kosten' },
  { id: 'recurring', label: 'Wiederkehrend / Verträge' },
];

export function NextcloudSettingsView({
  db,
  nextcloud,
  company,
  geoFenceRules,
  pushConflictAt,
  onDismissConflict,
  onRefreshConfig,
  onSyncFromNextcloud,
  onSyncToNextcloud,
  onSaveCompany,
  onSaveGeoFenceRules,
  onCheckGeoFenceNow,
  checkingGeoFence = false,
  onImportDatabase,
  onLoadSampleData,
  onResetEmpty,
  onNotify,
  theme = 'light',
}: NextcloudSettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const [ncUrl, setNcUrl] = useState(nextcloud.url);
  const [ncUsername, setNcUsername] = useState(nextcloud.username);
  const [ncPassword, setNcPassword] = useState('');
  const [ncFolder, setNcFolder] = useState(nextcloud.folder || '/TaktWerk');
  const [ncAutoSync, setNcAutoSync] = useState(nextcloud.autoSync);
  const [testing, setTesting] = useState(false);
  const [savingNc, setSavingNc] = useState(false);
  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const [companyForm, setCompanyForm] = useState<CompanyProfile>(company);
  useEffect(() => {
    setCompanyForm(company);
  }, [company]);

  const [newCustomerCategory, setNewCustomerCategory] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('');
  const [newInternalCategory, setNewInternalCategory] = useState('');

  const [discoveredCalendars, setDiscoveredCalendars] = useState<DiscoveredCalendar[]>([]);
  const [discoveringCalendars, setDiscoveringCalendars] = useState(false);
  const [runningBackup, setRunningBackup] = useState(false);

  // Invoices ZIP package state
  const [zipIncludeQuotes, setZipIncludeQuotes] = useState(true);
  const [zipIncludeArchived, setZipIncludeArchived] = useState(true);
  const [exportingZip, setExportingZip] = useState(false);

  // Graphical PDF Report Builder state
  const [reportTitle, setReportTitle] = useState('Grafischer Tätigkeits- & Auswertungsbericht');
  const [reportStartDate, setReportStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return toInputDate(d);
  });
  const [reportEndDate, setReportEndDate] = useState(() => toInputDate());
  const [reportCustomerId, setReportCustomerId] = useState<string>('all');
  const [reportProductId, setReportProductId] = useState<string>('all');
  const [reportTaskTitle, setReportTaskTitle] = useState<string>('all');
  const [reportEntryType, setReportEntryType] = useState<'all' | 'project' | 'internal'>('all');
  const [reportBillable, setReportBillable] = useState<'all' | 'billable_only' | 'unbillable_only'>('all');
  const [exportingReport, setExportingReport] = useState(false);

  const nativeApp = isNativeCapacitor();
  const [serverUrl, setServerUrl] = useState(() => getBackendServerUrl());

  // Travel Home Base state
  const [homeAddressQuery, setHomeAddressQuery] = useState(
    () => company.homeBaseLocation?.address ?? ''
  );
  const [homeSearching, setHomeSearching] = useState(false);
  const [homeLocating, setHomeLocating] = useState(false);

  // Geofence New Rule state
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleAddress, setNewRuleAddress] = useState('');
  const [newRuleLat, setNewRuleLat] = useState<string>('');
  const [newRuleLng, setNewRuleLng] = useState<string>('');
  const [newRuleRadius, setNewRuleRadius] = useState<string>('150');
  const [newRuleCustomerId, setNewRuleCustomerId] = useState(
    db.customers[0]?.id ?? ''
  );
  const [newRuleProductId, setNewRuleProductId] = useState(
    db.products[0]?.id ?? ''
  );
  const [newRuleTaskTitle, setNewRuleTaskTitle] = useState('');
  const [newRuleNotes, setNewRuleNotes] = useState('');
  const [newRuleAutoStop, setNewRuleAutoStop] = useState(true);
  const [searchingRuleLoc, setSearchingRuleLoc] = useState(false);
  const [locatingRule, setLocatingRule] = useState(false);
  const [focusedRuleId, setFocusedRuleId] = useState<string | null>(null);
  const [mapCameraNonce, setMapCameraNonce] = useState(0);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);

  const invoiceNumberPreview = useMemo(
    () => formatInvoiceNumber(companyForm),
    [companyForm]
  );
  const quoteNumberPreview = useMemo(
    () => formatQuoteNumber(companyForm),
    [companyForm]
  );
  const skuPreview = useMemo(
    () => formatProductSku(companyForm),
    [companyForm]
  );

  const distinctTaskTitles = useMemo(() => {
    const set = new Set<string>();
    for (const entry of db.timeEntries) {
      const clean = entry.title.trim();
      if (clean) set.add(clean);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  }, [db.timeEntries]);

  const reportOptions: FilteredReportOptions = useMemo(
    () => ({
      title: reportTitle.trim() || 'Grafischer Tätigkeits- & Auswertungsbericht',
      startDate: reportStartDate || undefined,
      endDate: reportEndDate || undefined,
      customerId: reportCustomerId,
      productId: reportProductId,
      taskTitle: reportTaskTitle,
      entryType: reportEntryType,
      billableFilter: reportBillable,
    }),
    [
      reportTitle,
      reportStartDate,
      reportEndDate,
      reportCustomerId,
      reportProductId,
      reportTaskTitle,
      reportEntryType,
      reportBillable,
    ]
  );

  const matchingReportSummary = useMemo(() => {
    let count = 0;
    let totalSec = 0;
    for (const e of db.timeEntries) {
      const dateStr = e.startTime.slice(0, 10);
      if (reportStartDate && dateStr < reportStartDate) continue;
      if (reportEndDate && dateStr > reportEndDate) continue;
      const isInternal = e.entryType === 'internal' || !e.customerId;
      if (reportEntryType === 'internal' && !isInternal) continue;
      if (reportEntryType === 'project' && isInternal) continue;
      if (reportCustomerId === 'internal_only' && !isInternal) continue;
      if (
        reportCustomerId !== 'all' &&
        reportCustomerId !== 'internal_only' &&
        e.customerId !== reportCustomerId
      ) {
        continue;
      }
      if (reportProductId !== 'all' && e.productId !== reportProductId) continue;
      if (reportTaskTitle !== 'all' && e.title !== reportTaskTitle) continue;
      if (reportBillable === 'billable_only' && !e.billable) continue;
      if (reportBillable === 'unbillable_only' && e.billable) continue;
      count += 1;
      totalSec += e.durationSeconds;
    }
    return { count, hours: totalSec / 3600 };
  }, [
    db.timeEntries,
    reportStartDate,
    reportEndDate,
    reportEntryType,
    reportCustomerId,
    reportProductId,
    reportTaskTitle,
    reportBillable,
  ]);

  const zipTargetCount = useMemo(() => {
    return db.invoices.filter((inv) => {
      if (inv.isArchived && !zipIncludeArchived) return false;
      if (inv.documentType === 'quote' && !zipIncludeQuotes) return false;
      return true;
    }).length;
  }, [db.invoices, zipIncludeArchived, zipIncludeQuotes]);

  const autoBackup = companyForm.autoBackup ?? {
    enabled: false,
    frequency: 'weekly' as AutoBackupFrequency,
    formats: ['json', 'excel'] as AutoBackupFormat[],
    uploadToNextcloud: true,
    localDownload: false,
    lastRunAt: null,
    lastRunSummary: null,
  };

  const updateAutoBackup = (patch: Partial<NonNullable<CompanyProfile['autoBackup']>>) => {
    setCompanyForm((prev) => ({
      ...prev,
      autoBackup: {
        ...(prev.autoBackup ?? {
          enabled: false,
          frequency: 'weekly',
          formats: ['json', 'excel'],
          uploadToNextcloud: true,
          localDownload: false,
          lastRunAt: null,
          lastRunSummary: null,
        }),
        ...patch,
      },
    }));
  };

  const toggleBackupFormat = (fmt: AutoBackupFormat) => {
    const current = autoBackup.formats ?? [];
    const next = current.includes(fmt)
      ? current.filter((f) => f !== fmt)
      : [...current, fmt];
    updateAutoBackup({ formats: next });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      onNotify('Logo-Datei darf maximal 4 MB groß sein.', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      const img = new Image();
      img.onload = () => {
        const maxW = 560;
        const maxH = 200;
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const pngDataUrl = canvas.toDataURL('image/png');
        setCompanyForm((prev) => ({
          ...prev,
          logoDataUrl: pngDataUrl,
          invoiceShowLogo: true,
        }));
      };
      img.onerror = () => {
        onNotify('Bilddatei konnte nicht geladen werden.', true);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveServerUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = setBackendServerUrl(serverUrl);
    setServerUrl(saved);
    onNotify(
      saved
        ? `TaktWerk-Server verbunden (${saved}). Bitte App neu laden oder synchronisieren.`
        : 'Server-URL entfernt. App speichert nun lokal auf dem Gerät.'
    );
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await apiTestNextcloud({
        url: ncUrl,
        username: ncUsername,
        appPassword: ncPassword,
        folder: ncFolder,
      });
      setTestResult({ ok: true, text: data.message });
    } catch (err) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveNextcloud = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNc(true);
    try {
      const nextNc = await apiSaveNextcloudConfig({
        url: ncUrl,
        username: ncUsername,
        appPassword: ncPassword,
        folder: ncFolder,
        autoSync: ncAutoSync,
      });
      onRefreshConfig(nextNc);
      setNcPassword('');
      onNotify('Nextcloud-WebDAV-Verbindung gespeichert.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Konfiguration konnte nicht gespeichert werden.',
        true
      );
    } finally {
      setSavingNc(false);
    }
  };

  const handleClearNextcloud = async () => {
    try {
      const cleared = await apiClearNextcloudConfig();
      onRefreshConfig(cleared);
      setNcUrl('');
      setNcUsername('');
      setNcPassword('');
      setNcFolder('/TaktWerk');
      setTestResult(null);
      onNotify('Nextcloud-Verbindung getrennt.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Verbindung konnte nicht getrennt werden.',
        true
      );
    }
  };

  const handlePush = async (force = false) => {
    setSyncing('push');
    try {
      await onSyncToNextcloud(force);
    } finally {
      setSyncing(null);
    }
  };

  const handlePull = async () => {
    setSyncing('pull');
    try {
      await onSyncFromNextcloud();
    } finally {
      setSyncing(null);
    }
  };

  const handleCompanySubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onSaveCompany(companyForm);
  };

  const handleDiscoverCalendars = async () => {
    setDiscoveringCalendars(true);
    try {
      const list = await apiDiscoverNextcloudCalendars();
      setDiscoveredCalendars(list);
      if (list.length === 0) {
        onNotify('Keine Kalender in diesem Nextcloud-Konto gefunden.', true);
      } else {
        onNotify(`${list.length} Nextcloud-Kalender gefunden.`);
        if (!companyForm.calendarConfig?.selectedCalendarUrl && list[0]) {
          setCompanyForm((prev) => ({
            ...prev,
            calendarConfig: {
              selectedCalendarUrl: list[0].url,
              selectedCalendarName: list[0].displayName,
              autoSyncTimeEntries: prev.calendarConfig?.autoSyncTimeEntries ?? false,
            },
          }));
        }
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Kalender-Abfrage fehlgeschlagen.',
        true
      );
    } finally {
      setDiscoveringCalendars(false);
    }
  };

  const handleRunBackupNow = async () => {
    if (!autoBackup.formats || autoBackup.formats.length === 0) {
      onNotify('Bitte mindestens ein Backup-Format (z. B. JSON oder Excel) auswählen.', true);
      return;
    }
    if (!autoBackup.uploadToNextcloud && !autoBackup.localDownload) {
      onNotify('Bitte mindestens ein Ziel (Nextcloud oder lokaler Download) wählen.', true);
      return;
    }
    if (autoBackup.uploadToNextcloud && !nextcloud.configured && !autoBackup.localDownload) {
      onNotify('Bitte verbinde zuerst Nextcloud oder aktiviere den lokalen Download.', true);
      return;
    }

    setRunningBackup(true);
    try {
      const result = await apiRunMultiFormatBackup(db, autoBackup.formats, {
        uploadToNextcloud: autoBackup.uploadToNextcloud && nextcloud.configured,
        localDownload: autoBackup.localDownload,
      });
      const nowIso = new Date().toISOString();
      const updatedCompany: CompanyProfile = {
        ...companyForm,
        autoBackup: {
          ...autoBackup,
          lastRunAt: nowIso,
          lastRunSummary: result.summary,
        },
      };
      setCompanyForm(updatedCompany);
      onSaveCompany(updatedCompany);
      onNotify(`Backup abgeschlossen: ${result.summary}`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Backup fehlgeschlagen.',
        true
      );
    } finally {
      setRunningBackup(false);
    }
  };

  const handleTestSound = () => {
    const preset = companyForm.timerReminderSound ?? 'chime';
    playReminderSound(preset);
    if (nativeApp) {
      void playNativeReminderTone(preset);
    }
  };

  const handleCaptureHomeBaseGps = async () => {
    setHomeLocating(true);
    try {
      const loc = await captureCurrentLocation();
      const base: HomeBaseLocation = {
        address: loc.address || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`,
        lat: loc.lat,
        lng: loc.lng,
      };
      setHomeAddressQuery(base.address);
      const nextCompany = { ...companyForm, homeBaseLocation: base };
      setCompanyForm(nextCompany);
      onSaveCompany(nextCompany);
      onNotify(`Startadresse auf "${base.address}" gesetzt.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'GPS-Standort konnte nicht abgerufen werden.',
        true
      );
    } finally {
      setHomeLocating(false);
    }
  };

  const handleGeocodeHomeBase = async (queryOverride?: string) => {
    const query = (queryOverride ?? homeAddressQuery).trim();
    if (!query) {
      onNotify('Bitte eine Startadresse eingeben.', true);
      return;
    }
    setHomeSearching(true);
    try {
      const found = await geocodeAddress(query);
      if (!found) {
        onNotify('Adresse konnte nicht gefunden werden.', true);
        return;
      }
      const base: HomeBaseLocation = {
        address: found.address || query,
        lat: found.lat,
        lng: found.lng,
      };
      setHomeAddressQuery(base.address);
      const nextCompany = { ...companyForm, homeBaseLocation: base };
      setCompanyForm(nextCompany);
      onSaveCompany(nextCompany);
      onNotify(`Startadresse ermittelt & gespeichert: ${base.address}`);
    } catch {
      onNotify('Adresssuche fehlgeschlagen.', true);
    } finally {
      setHomeSearching(false);
    }
  };

  const handleCaptureRuleGps = async () => {
    setLocatingRule(true);
    try {
      const loc = await captureCurrentLocation();
      setNewRuleLat(loc.lat.toFixed(6));
      setNewRuleLng(loc.lng.toFixed(6));
      if (loc.address) {
        setNewRuleAddress(loc.address);
      }
      setFocusedRuleId(null);
      setMapCameraNonce((n) => n + 1);
      onNotify('Aktuelle GPS-Koordinaten für die Ortsregel übernommen.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Standort konnte nicht ermittelt werden.',
        true
      );
    } finally {
      setLocatingRule(false);
    }
  };

  const handleSearchRuleAddress = async () => {
    if (!newRuleAddress.trim()) {
      onNotify('Bitte eine Adresse oder einen Ort für die Ortsregel eingeben.', true);
      return;
    }
    setSearchingRuleLoc(true);
    try {
      const found = await geocodeAddress(newRuleAddress.trim());
      if (!found) {
        onNotify('Adresse nicht gefunden.', true);
        return;
      }
      setNewRuleLat(found.lat.toFixed(6));
      setNewRuleLng(found.lng.toFixed(6));
      if (found.address) {
        setNewRuleAddress(found.address);
      }
      setFocusedRuleId(null);
      setMapCameraNonce((n) => n + 1);
      onNotify(`Standort gefunden (${found.lat.toFixed(4)}, ${found.lng.toFixed(4)}).`);
    } catch {
      onNotify('Adresssuche fehlgeschlagen.', true);
    } finally {
      setSearchingRuleLoc(false);
    }
  };

  const handleMapPickLocation = (loc: PickedMapLocation) => {
    setNewRuleLat(loc.lat.toFixed(6));
    setNewRuleLng(loc.lng.toFixed(6));
    if (loc.address) {
      setNewRuleAddress(loc.address);
    }
    if (loc.suggestedName && !newRuleName.trim()) {
      setNewRuleName(loc.suggestedName);
    }
    setFocusedRuleId(null);
  };

  const handleFocusRuleOnMap = (rule: GeoFenceRule) => {
    setFocusedRuleId(rule.id);
    setMapCameraNonce((n) => n + 1);
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleUseRuleAsDraft = (rule: GeoFenceRule) => {
    setNewRuleLat(rule.lat.toFixed(6));
    setNewRuleLng(rule.lng.toFixed(6));
    setNewRuleAddress(rule.address || '');
    setNewRuleRadius(String(rule.radiusMeters));
    if (!newRuleName.trim()) setNewRuleName(`${rule.name} (Kopie)`);
    setFocusedRuleId(null);
    setMapCameraNonce((n) => n + 1);
    onNotify(`Koordinaten von "${rule.name}" in das Formular übernommen.`);
  };

  const handleAddGeoRule = () => {
    const lat = Number(newRuleLat);
    const lng = Number(newRuleLng);
    if (!newRuleName.trim()) {
      onNotify('Bitte einen Namen für die Ortsregel eingeben.', true);
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      onNotify('Bitte Koordinaten über Adresse oder GPS übernehmen.', true);
      return;
    }
    if (!newRuleCustomerId || !newRuleProductId) {
      onNotify('Bitte Kunde und Leistung auswählen.', true);
      return;
    }
    const rule: GeoFenceRule = {
      id: createId('geo'),
      name: newRuleName.trim(),
      enabled: true,
      lat,
      lng,
      address: newRuleAddress.trim() || undefined,
      radiusMeters: Math.max(30, Number(newRuleRadius) || 150),
      customerId: newRuleCustomerId,
      productId: newRuleProductId,
      taskTitle: newRuleTaskTitle.trim() || newRuleName.trim(),
      notes: newRuleNotes.trim(),
      autoStopOnExit: newRuleAutoStop,
      createdAt: new Date().toISOString(),
    };
    onSaveGeoFenceRules([rule, ...geoFenceRules]);
    setNewRuleName('');
    setNewRuleAddress('');
    setNewRuleLat('');
    setNewRuleLng('');
    setNewRuleTaskTitle('');
    setNewRuleNotes('');
    onNotify(`Ortsregel "${rule.name}" gespeichert.`);
  };

  const handleToggleGeoRule = (id: string) => {
    onSaveGeoFenceRules(
      geoFenceRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleDeleteGeoRule = (id: string) => {
    onSaveGeoFenceRules(geoFenceRules.filter((r) => r.id !== id));
    onNotify('Ortsregel gelöscht.');
  };

  const handleExportTimeCsv = async () => {
    try {
      const csv = timeEntriesToCsv(db.timeEntries, db.customers, db.products);
      await downloadOrShareTextFile(
        `taktwerk-arbeitszeiten-${toInputDate()}.csv`,
        csv,
        'text/csv'
      );
      onNotify('Arbeitszeiten als CSV exportiert.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'CSV-Export fehlgeschlagen.',
        true
      );
    }
  };

  const handleExportInvoicesCsv = async () => {
    try {
      const csv = invoicesToCsv(db.invoices);
      await downloadOrShareTextFile(
        `taktwerk-rechnungen-${toInputDate()}.csv`,
        csv,
        'text/csv'
      );
      onNotify('Rechnungen als CSV exportiert.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'CSV-Export fehlgeschlagen.',
        true
      );
    }
  };

  const handleExportExcel = async () => {
    try {
      await downloadExcelBackup(db);
      onNotify('Excel-Arbeitsmappe (.xlsx) mit allen Tabellen erstellt.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Excel-Export fehlgeschlagen.',
        true
      );
    }
  };

  const handleExportFullPdf = async () => {
    try {
      await downloadFullBackupPdf(db);
      onNotify('Gesamtbericht als PDF erstellt.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'PDF-Gesamtbericht fehlgeschlagen.',
        true
      );
    }
  };

  const handleExportJsonBackup = async () => {
    try {
      const json = JSON.stringify(db, null, 2);
      await downloadOrShareTextFile(
        `taktwerk-backup-${toInputDate()}.json`,
        json,
        'application/json'
      );
      onNotify('Vollständige JSON-Sicherung erstellt.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Backup-Export fehlgeschlagen.',
        true
      );
    }
  };

  const handleImportJsonBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const imported = validateImportedDatabase(text);
        onImportDatabase(imported);
      } catch (err) {
        onNotify(
          err instanceof Error ? err.message : 'Backup konnte nicht eingelesen werden.',
          true
        );
      }
    };
    reader.onerror = () => {
      onNotify('Backup-Datei konnte nicht gelesen werden.', true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyReportDatePreset = (preset: '7d' | '30d' | 'month' | 'year' | 'all') => {
    const today = new Date();
    const end = toInputDate(today);
    if (preset === 'all') {
      setReportStartDate('');
      setReportEndDate('');
      return;
    }
    if (preset === '7d') {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      setReportStartDate(toInputDate(start));
      setReportEndDate(end);
      return;
    }
    if (preset === '30d') {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      setReportStartDate(toInputDate(start));
      setReportEndDate(end);
      return;
    }
    if (preset === 'month') {
      setReportStartDate(
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
      );
      setReportEndDate(end);
      return;
    }
    setReportStartDate(`${today.getFullYear()}-01-01`);
    setReportEndDate(end);
  };

  const handleDownloadFilteredReport = async () => {
    setExportingReport(true);
    try {
      await downloadFilteredReportPdf(db, reportOptions);
      onNotify(
        `Grafische PDF-Auswertung (${matchingReportSummary.count} Einträge) erstellt.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'PDF-Auswertung konnte nicht erstellt werden.',
        true
      );
    } finally {
      setExportingReport(false);
    }
  };

  const handleShareFilteredReport = async () => {
    setExportingReport(true);
    try {
      await shareFilteredReportPdf(db, reportOptions);
      onNotify('Grafische PDF-Auswertung zum Teilen vorbereitet.');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'PDF-Auswertung konnte nicht geteilt werden.',
        true
      );
    } finally {
      setExportingReport(false);
    }
  };

  const handleUploadFilteredReportNextcloud = async () => {
    if (!nextcloud.configured) {
      onNotify('Bitte verbinde zuerst Nextcloud unter dem Reiter "Nextcloud & Kalender".', true);
      return;
    }
    setExportingReport(true);
    try {
      const base64 = getFilteredReportPdfBase64(db, reportOptions);
      const filename = `TaktWerk-Auswertung-${toInputDate()}.pdf`;
      const res = await apiUploadNextcloudFile({
        subFolder: 'Berichte',
        filename,
        contentOrBase64: base64,
        isBinary: true,
        contentType: 'application/pdf',
      });
      onNotify(`Grafische PDF-Auswertung in Nextcloud gespeichert (${res.path}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Nextcloud-Upload der PDF-Auswertung fehlgeschlagen.',
        true
      );
    } finally {
      setExportingReport(false);
    }
  };

  const handleDownloadInvoicesZip = async () => {
    if (zipTargetCount === 0) {
      onNotify('Keine passenden Rechnungen oder Angebote für das ZIP-Paket vorhanden.', true);
      return;
    }
    setExportingZip(true);
    try {
      await downloadInvoicesZip(db.invoices, companyForm, {
        includeQuotes: zipIncludeQuotes,
        includeArchived: zipIncludeArchived,
      });
      onNotify(`Rechnungen-ZIP-Paket (${zipTargetCount} Dokument(e)) erstellt.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'ZIP-Paket konnte nicht erstellt werden.',
        true
      );
    } finally {
      setExportingZip(false);
    }
  };

  const handleUploadInvoicesZipNextcloud = async () => {
    if (!nextcloud.configured) {
      onNotify('Bitte verbinde zuerst Nextcloud unter dem Reiter "Nextcloud & Kalender".', true);
      return;
    }
    if (zipTargetCount === 0) {
      onNotify('Keine passenden Rechnungen oder Angebote für das ZIP-Paket vorhanden.', true);
      return;
    }
    setExportingZip(true);
    try {
      const base64 = await buildInvoicesZipBase64(db.invoices, companyForm, {
        includeQuotes: zipIncludeQuotes,
        includeArchived: zipIncludeArchived,
      });
      const filename = `TaktWerk-Rechnungen-${toInputDate()}.zip`;
      const res = await apiUploadNextcloudFile({
        subFolder: 'Backups',
        filename,
        contentOrBase64: base64,
        isBinary: true,
        contentType: 'application/zip',
      });
      onNotify(`Rechnungen-ZIP (${zipTargetCount} Dokument(e)) in Nextcloud gesichert (${res.path}).`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Nextcloud-Upload des ZIP-Pakets fehlgeschlagen.',
        true
      );
    } finally {
      setExportingZip(false);
    }
  };

  const addCategory = (kind: 'customer' | 'product' | 'internal') => {
    if (kind === 'customer') {
      const val = newCustomerCategory.trim();
      if (!val) return;
      const list = companyForm.customerCategories ?? [];
      if (!list.includes(val)) {
        setCompanyForm({ ...companyForm, customerCategories: [...list, val] });
      }
      setNewCustomerCategory('');
    } else if (kind === 'product') {
      const val = newProductCategory.trim();
      if (!val) return;
      const list = companyForm.productCategories ?? [];
      if (!list.includes(val)) {
        setCompanyForm({ ...companyForm, productCategories: [...list, val] });
      }
      setNewProductCategory('');
    } else {
      const val = newInternalCategory.trim();
      if (!val) return;
      const list = companyForm.internalCategories ?? [];
      if (!list.includes(val)) {
        setCompanyForm({ ...companyForm, internalCategories: [...list, val] });
      }
      setNewInternalCategory('');
    }
  };

  const removeCategory = (kind: 'customer' | 'product' | 'internal', item: string) => {
    if (kind === 'customer') {
      setCompanyForm({
        ...companyForm,
        customerCategories: (companyForm.customerCategories ?? []).filter((c) => c !== item),
      });
    } else if (kind === 'product') {
      setCompanyForm({
        ...companyForm,
        productCategories: (companyForm.productCategories ?? []).filter((c) => c !== item),
      });
    } else {
      setCompanyForm({
        ...companyForm,
        internalCategories: (companyForm.internalCategories ?? []).filter((c) => c !== item),
      });
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
    { id: 'general', label: 'Oberfläche & Kategorien', icon: Palette },
    { id: 'company', label: 'Firma, Nummern & Design', icon: Building2 },
    { id: 'cloud', label: 'Nextcloud & Kalender', icon: Cloud },
    { id: 'backups', label: 'Backups & Exporte', icon: Archive },
    { id: 'automation', label: 'Ortung, Erinnerung & Widgets', icon: BellRing },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Einstellungen, Design &amp; Nextcloud
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Passe App-Oberfläche, Nummernkreise, Rechnungsdesign, Nextcloud-Synchronisation, Backups und Automatisierung an.
        </p>
      </div>

      {/* Sub-Menu Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-[#2e2349] dark:bg-[#171126]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'ui-accent-active text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#211936] dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Oberfläche & Kategorien */}
      {activeTab === 'general' && (
        <form onSubmit={handleCompanySubmit} className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
            <div className="border-b border-slate-200 pb-3 dark:border-[#2e2349]">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                App-Oberfläche anpassen
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Steuere Akzentfarbe, Informationsdichte, Textgröße, Startansicht und Wischgesten.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
                App-Akzentfarbe
              </label>
              <div className="flex flex-wrap gap-2">
                {UI_ACCENTS.map((item) => {
                  const selected = (companyForm.uiAccent ?? 'violet') === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCompanyForm({ ...companyForm, uiAccent: item.id })}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-slate-900 bg-slate-100 text-slate-900 dark:border-violet-400 dark:bg-[#2a2045] dark:text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-300'
                      }`}
                    >
                      <span className={`h-3 w-3 rounded-full ${item.dotClass}`} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Darstellungsdichte
                </label>
                <ThemedSelect
                  value={companyForm.uiDensity ?? 'comfortable'}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      uiDensity: val as UiDensity,
                    })
                  }
                  ariaLabel="Darstellungsdichte"
                  options={[
                    { value: 'comfortable', label: 'Komfortabel (Standard)' },
                    { value: 'compact', label: 'Kompakt (mehr Inhalt)' },
                  ]}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Schriftgröße der App
                </label>
                <ThemedSelect
                  value={companyForm.uiFontScale ?? 'normal'}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      uiFontScale: val as UiFontScale,
                    })
                  }
                  ariaLabel="Schriftgröße der App"
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'large', label: 'Groß (bessere Lesbarkeit)' },
                  ]}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Startbereich
                </label>
                <ThemedSelect
                  value={companyForm.defaultStartSection ?? 'tracker'}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      defaultStartSection: val as NavSection,
                    })
                  }
                  ariaLabel="Standard-Startbereich"
                  options={START_SECTION_OPTIONS.map((opt) => ({
                    value: opt.id,
                    label: opt.label,
                  }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Tagesziel (Stunden-Widget)
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  step="0.5"
                  value={companyForm.dailyGoalHours ?? 8}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      dailyGoalHours: Math.max(1, Number(e.target.value) || 8),
                    })
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={companyForm.swipeNavigationEnabled !== false}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    swipeNavigationEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
              />
              Wischgesten am äußeren Bildschirmrand aktivieren (vom linken/rechten Rand wischen für Zurück / Vor; schützt Unterschriften &amp; Formulare)
            </label>
          </section>

          {/* Categories Management */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
            <div className="border-b border-slate-200 pb-3 dark:border-[#2e2349]">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Kategorien für Kunden, Produkte &amp; interne Arbeiten
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Stehen in der Kunden-, Produkt- und Zeiterfassung (inkl. nicht-ertragbringender interner Arbeiten) als Schnellauswahl &amp; Filter zur Verfügung.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Kunden-Kategorien
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(companyForm.customerCategories ?? []).map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200"
                    >
                      {cat}
                      <button
                        type="button"
                        onClick={() => removeCategory('customer', cat)}
                        aria-label={`${cat} entfernen`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCustomerCategory}
                    onChange={(e) => setNewCustomerCategory(e.target.value)}
                    placeholder="Neue Kunden-Kategorie..."
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => addCategory('customer')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Neu
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Tätigkeiten- &amp; Produkt-Kategorien
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(companyForm.productCategories ?? []).map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200"
                    >
                      {cat}
                      <button
                        type="button"
                        onClick={() => removeCategory('product', cat)}
                        aria-label={`${cat} entfernen`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProductCategory}
                    onChange={(e) => setNewProductCategory(e.target.value)}
                    placeholder="Neue Produkt-Kategorie..."
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => addCategory('product')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Neu
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Interne Tätigkeiten (ohne Kunde)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(companyForm.internalCategories ?? []).map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                      {cat}
                      <button
                        type="button"
                        onClick={() => removeCategory('internal', cat)}
                        aria-label={`${cat} entfernen`}
                        className="text-amber-600/70 hover:text-red-600 cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newInternalCategory}
                    onChange={(e) => setNewInternalCategory(e.target.value)}
                    placeholder="z. B. Kundenakquise, Reinigung..."
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => addCategory('internal')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Neu
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Oberfläche &amp; Kategorien speichern
              </button>
            </div>
          </section>
        </form>
      )}

      {/* TAB 2: Firma, Nummern & Design */}
      {activeTab === 'company' && (
        <form onSubmit={handleCompanySubmit} className="space-y-6">
          {/* Firmendaten & Bank */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Eigene Firmendaten &amp; Bankverbindung (für Rechnungen &amp; Angebote)
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Diese Angaben erscheinen im Briefkopf und in der Fußzeile jeder PDF-Rechnung.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Firmenname
                </label>
                <input
                  type="text"
                  value={companyForm.companyName}
                  onChange={(e) => setCompanyForm({ ...companyForm, companyName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Inhaber / Geschäftsführer
                </label>
                <input
                  type="text"
                  value={companyForm.ownerName}
                  onChange={(e) => setCompanyForm({ ...companyForm, ownerName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  E-Mail
                </label>
                <input
                  type="email"
                  value={companyForm.email}
                  onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Straße
                </label>
                <input
                  type="text"
                  value={companyForm.street}
                  onChange={(e) => setCompanyForm({ ...companyForm, street: e.target.value })}
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
                    value={companyForm.postalCode}
                    onChange={(e) => setCompanyForm({ ...companyForm, postalCode: e.target.value })}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Ort
                  </label>
                  <input
                    type="text"
                    value={companyForm.city}
                    onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Telefon
                </label>
                <input
                  type="text"
                  value={companyForm.phone}
                  onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Steuernummer
                </label>
                <input
                  type="text"
                  value={companyForm.taxNumber}
                  onChange={(e) => setCompanyForm({ ...companyForm, taxNumber: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  USt-IdNr.
                </label>
                <input
                  type="text"
                  value={companyForm.vatId}
                  onChange={(e) => setCompanyForm({ ...companyForm, vatId: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Zahlungsziel (Tage)
                </label>
                <input
                  type="number"
                  min="1"
                  value={companyForm.defaultPaymentTermDays}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      defaultPaymentTermDays: Math.max(1, Number(e.target.value) || 14),
                    })
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Bankname
                </label>
                <input
                  type="text"
                  value={companyForm.bankName}
                  onChange={(e) => setCompanyForm({ ...companyForm, bankName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  IBAN
                </label>
                <input
                  type="text"
                  value={companyForm.iban}
                  onChange={(e) => setCompanyForm({ ...companyForm, iban: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  BIC
                </label>
                <input
                  type="text"
                  value={companyForm.bic}
                  onChange={(e) => setCompanyForm({ ...companyForm, bic: e.target.value })}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          </section>

          {/* Nummernkreise: Rechnungen, Angebote & Artikelnummer */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-6">
            <div className="border-b border-slate-200 pb-3 dark:border-[#2e2349]">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Nummernkreise &amp; Artikelnummer-Bezeichnung
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Platzhalter überall nutzbar: <span className="font-mono">{'{PREFIX}, {YYYY}, {YY}, {MM}, {DD}, {NR}'}</span>
              </p>
            </div>

            {/* Rechnungsnummer */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                  Rechnungsnummer
                </h3>
                <span className="font-mono text-xs font-semibold text-blue-700 dark:text-violet-300">
                  Vorschau: {invoiceNumberPreview}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-5">
                  <label className="mb-1 block text-xs text-slate-500">Format</label>
                  <input
                    type="text"
                    value={companyForm.invoiceNumberPattern ?? '{PREFIX}{YYYY}-{NR}'}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, invoiceNumberPattern: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Präfix</label>
                  <input
                    type="text"
                    value={companyForm.invoicePrefix}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, invoicePrefix: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Stellen</label>
                  <ThemedSelect
                    value={String(companyForm.invoiceSequenceDigits ?? 4)}
                    onChange={(val) =>
                      setCompanyForm({
                        ...companyForm,
                        invoiceSequenceDigits: Number(val),
                      })
                    }
                    ariaLabel="Rechnungsnummer-Stellen"
                    options={[2, 3, 4, 5, 6].map((d) => ({
                      value: String(d),
                      label: `${d} (${String(1).padStart(d, '0')})`,
                    }))}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500">Nächste Nr.</label>
                  <input
                    type="number"
                    min={1}
                    value={companyForm.nextInvoiceSequence || 1}
                    onChange={(e) =>
                      setCompanyForm({
                        ...companyForm,
                        nextInvoiceSequence: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>
            </div>

            {/* Angebotsnummer */}
            <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-[#2e2349]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                  Angebotsnummer
                </h3>
                <span className="font-mono text-xs font-semibold text-blue-700 dark:text-violet-300">
                  Vorschau: {quoteNumberPreview}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-5">
                  <label className="mb-1 block text-xs text-slate-500">Format</label>
                  <input
                    type="text"
                    value={companyForm.quoteNumberPattern ?? '{PREFIX}{YYYY}-{NR}'}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, quoteNumberPattern: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500">Präfix</label>
                  <input
                    type="text"
                    value={companyForm.quotePrefix ?? 'ANG-'}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, quotePrefix: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="mb-1 block text-xs text-slate-500">Nächste Angebotsnr.</label>
                  <input
                    type="number"
                    min={1}
                    value={companyForm.nextQuoteSequence || 1}
                    onChange={(e) =>
                      setCompanyForm({
                        ...companyForm,
                        nextQuoteSequence: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>
            </div>

            {/* Artikelnummer Bezeichnung & Format */}
            <div className="space-y-3 border-t border-slate-200 pt-5 dark:border-[#2e2349]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                  Artikelnummer-Bezeichnung &amp; Schema
                </h3>
                <span className="font-mono text-xs font-semibold text-blue-700 dark:text-violet-300">
                  Vorschau: {skuPreview}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500">
                    Feld-Bezeichnung (UI)
                  </label>
                  <input
                    type="text"
                    value={companyForm.skuFieldLabel ?? 'Artikelnummer'}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, skuFieldLabel: e.target.value })
                    }
                    placeholder="z. B. Positions-ID oder Art.-Nr."
                    className={inputClass}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500">Format</label>
                  <input
                    type="text"
                    value={companyForm.productNumberPattern ?? '{PREFIX}{NR}'}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, productNumberPattern: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Präfix</label>
                  <input
                    type="text"
                    value={companyForm.productPrefix ?? 'ART-'}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, productPrefix: e.target.value })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Stellen</label>
                  <ThemedSelect
                    value={String(companyForm.productSequenceDigits ?? 3)}
                    onChange={(val) =>
                      setCompanyForm({
                        ...companyForm,
                        productSequenceDigits: Number(val),
                      })
                    }
                    ariaLabel="Artikelnummer-Stellen"
                    options={[2, 3, 4, 5].map((d) => ({
                      value: String(d),
                      label: `${d} (${String(1).padStart(d, '0')})`,
                    }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Nächste Nr.</label>
                  <input
                    type="number"
                    min={1}
                    value={companyForm.nextProductSequence || 1}
                    onChange={(e) =>
                      setCompanyForm({
                        ...companyForm,
                        nextProductSequence: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Rechnungsgestaltung: Logo, Farben, Schriftarten, Layouts & Texte */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-6">
            <div className="border-b border-slate-200 pb-3 dark:border-[#2e2349]">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Rechnungs- &amp; Angebotsdesign
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Gestalte Logo, Akzentfarben, eigene Wunschfarbe, Schriftart, Layout-Stil und Standardtexte für Vorschau &amp; PDF.
              </p>
            </div>

            {/* Logo */}
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 md:grid-cols-12 md:items-center">
              <div className="md:col-span-7 space-y-2">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Firmenlogo
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-100 cursor-pointer">
                    <ImagePlus className="h-3.5 w-3.5" />
                    Logo auswählen
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                  {companyForm.logoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setCompanyForm((prev) => ({ ...prev, logoDataUrl: '' }))}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-[#171126] dark:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Entfernen
                    </button>
                  )}
                </div>
                <label className="flex items-center gap-2 pt-1 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={companyForm.invoiceShowLogo !== false}
                    onChange={(e) =>
                      setCompanyForm({ ...companyForm, invoiceShowLogo: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Logo oben rechts einblenden
                </label>
              </div>
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-3 dark:border-[#3b2d5e] dark:bg-[#171126] md:col-span-5">
                {companyForm.logoDataUrl ? (
                  <img
                    src={companyForm.logoDataUrl}
                    alt="Logo-Vorschau"
                    className="max-h-16 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-slate-400">Kein Logo hinterlegt</span>
                )}
              </div>
            </div>

            {/* Farben */}
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Farbschema &amp; eigene Wunschfarbe
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(INVOICE_ACCENT_STYLES) as InvoiceAccentPreset[]).map((presetKey) => {
                  const item = INVOICE_ACCENT_STYLES[presetKey];
                  const selected = (companyForm.invoiceAccentColor ?? 'slate') === presetKey;
                  return (
                    <button
                      key={presetKey}
                      type="button"
                      onClick={() =>
                        setCompanyForm({ ...companyForm, invoiceAccentColor: presetKey })
                      }
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-slate-900 bg-slate-100 text-slate-900 dark:border-violet-400 dark:bg-[#2a2045] dark:text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-300'
                      }`}
                    >
                      <span className={`h-3 w-3 rounded-full ${item.swatchClass}`} />
                      {item.label}
                    </button>
                  );
                })}
                {companyForm.invoiceAccentColor === 'custom' && (
                  <div className="flex items-center gap-2 ml-2">
                    <input
                      type="color"
                      value={companyForm.invoiceCustomAccentHex || '#1d4ed8'}
                      onChange={(e) =>
                        setCompanyForm({
                          ...companyForm,
                          invoiceCustomAccentHex: e.target.value,
                        })
                      }
                      aria-label="Wunschfarbe wählen"
                      className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                    />
                    <input
                      type="text"
                      value={companyForm.invoiceCustomAccentHex || '#1d4ed8'}
                      onChange={(e) =>
                        setCompanyForm({
                          ...companyForm,
                          invoiceCustomAccentHex: e.target.value,
                        })
                      }
                      className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs text-slate-900 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Schriftart & Layout */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Schriftart (Vorschau &amp; PDF)
                </label>
                <ThemedSelect
                  value={companyForm.invoiceFontFamily ?? 'sans'}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      invoiceFontFamily: val as InvoiceFontFamily,
                    })
                  }
                  ariaLabel="Schriftart für Rechnungen"
                  options={(Object.keys(INVOICE_FONT_OPTIONS) as InvoiceFontFamily[]).map(
                    (fk) => ({
                      value: fk,
                      label: INVOICE_FONT_OPTIONS[fk].label,
                    })
                  )}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Layout-Stil
                </label>
                <ThemedSelect
                  value={companyForm.invoiceLayoutStyle ?? 'classic'}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      invoiceLayoutStyle: val as InvoiceLayoutStyle,
                    })
                  }
                  ariaLabel="Layout-Stil für Rechnungen"
                  options={(Object.keys(INVOICE_LAYOUT_OPTIONS) as InvoiceLayoutStyle[]).map(
                    (lk) => ({
                      value: lk,
                      label: `${INVOICE_LAYOUT_OPTIONS[lk].label} — ${INVOICE_LAYOUT_OPTIONS[lk].description}`,
                    })
                  )}
                />
              </div>
            </div>

            {/* Überschriften & Texte */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Dokument-Überschrift (Rechnung)
                </label>
                <input
                  type="text"
                  value={companyForm.invoiceHeaderTitle ?? 'Rechnung'}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, invoiceHeaderTitle: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Dokument-Überschrift (Angebot)
                </label>
                <input
                  type="text"
                  value={companyForm.quoteHeaderTitle ?? 'Angebot'}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, quoteHeaderTitle: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Einleitung (Rechnung)
                </label>
                <textarea
                  rows={2}
                  value={companyForm.invoiceDefaultIntroText ?? ''}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, invoiceDefaultIntroText: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Schlusstext (Rechnung)
                </label>
                <textarea
                  rows={2}
                  value={companyForm.invoiceDefaultOutroText ?? ''}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, invoiceDefaultOutroText: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Einleitung (Angebot)
                </label>
                <textarea
                  rows={2}
                  value={companyForm.quoteDefaultIntroText ?? ''}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, quoteDefaultIntroText: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Schlusstext (Angebot)
                </label>
                <textarea
                  rows={2}
                  value={companyForm.quoteDefaultOutroText ?? ''}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, quoteDefaultOutroText: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>

            {/* § 19 UStG & Takt & Fußzeile */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 space-y-3">
              <label className="flex items-start gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(companyForm.smallBusinessMode)}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      smallBusinessMode: e.target.checked,
                      smallBusinessNotice:
                        companyForm.smallBusinessNotice ||
                        'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                <span>Kleinunternehmerregelung (§ 19 UStG) standardmäßig aktivieren</span>
              </label>
              {companyForm.smallBusinessMode && (
                <input
                  type="text"
                  value={
                    companyForm.smallBusinessNotice ??
                    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'
                  }
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, smallBusinessNotice: e.target.value })
                  }
                  className={inputClass}
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Standard-Zeitrundung bei Abrechnung
                </label>
                <ThemedSelect
                  value={String(companyForm.defaultTimeRoundingMinutes ?? 0)}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      defaultTimeRoundingMinutes: Number(val) as TimeRoundingMinutes,
                    })
                  }
                  ariaLabel="Standard-Zeitrundung"
                  options={[
                    { value: '0', label: 'Keine Rundung (exakt auf die Sekunde)' },
                    { value: '5', label: 'Auf 5-Minuten-Takt aufrunden' },
                    { value: '10', label: 'Auf 10-Minuten-Takt aufrunden' },
                    { value: '15', label: 'Auf 15-Minuten-Takt aufrunden' },
                    { value: '30', label: 'Auf 30-Minuten-Takt aufrunden' },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Zusätzlicher Fußzeilen-Hinweis (HRB / Gerichtsstand)
                </label>
                <input
                  type="text"
                  value={companyForm.invoiceFooterNote ?? ''}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, invoiceFooterNote: e.target.value })
                  }
                  placeholder="z. B. Amtsgericht Hamburg · HRB 12345"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(companyForm.invoiceIncludeLocationDefault)}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      invoiceIncludeLocationDefault: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                Aufgezeichneten Einsatzort standardmäßig auf Rechnungen &amp; Angeboten angeben
              </label>

              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(companyForm.invoiceIncludeTimeNotesDefault)}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      invoiceIncludeTimeNotesDefault: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                Auftragsnotizen standardmäßig auf Rechnungen &amp; Angeboten ausgeben
              </label>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Firmendaten, Nummern &amp; Design speichern
              </button>
            </div>
          </section>
        </form>
      )}

      {/* TAB 3: Nextcloud & Kalender */}
      {activeTab === 'cloud' && (
        <div className="space-y-6">
          {nativeApp && (
            <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
              <div className="flex items-start gap-2.5">
                <Server className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    TaktWerk Server-URL (optional für Android-App)
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Leer lassen für eigenständigen Gerätespeicher + direkten Nextcloud-Sync, oder eigene Server-URL hinterlegen.
                  </p>
                </div>
              </div>
              <form onSubmit={handleSaveServerUrl} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://deine-taktwerk-url.run.app (optional)"
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Server speichern
                </button>
              </form>
            </section>
          )}

          {/* WebDAV */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Cloud className="h-5 w-5 text-blue-700 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Nextcloud WebDAV-Anbindung
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Speichert Datenbank, PDF-Rechnungen und Backups in deiner eigenen Nextcloud.
                  </p>
                </div>
              </div>
              <div className="text-xs font-medium">
                {nextcloud.configured ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Verbunden · {nextcloud.lastSyncAt ? `Stand ${formatDateTimeDE(nextcloud.lastSyncAt)}` : 'Bereit'}
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">Noch nicht verbunden</span>
                )}
              </div>
            </div>

            <form onSubmit={handleSaveNextcloud} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Nextcloud-Server-URL
                </label>
                <input
                  type="url"
                  value={ncUrl}
                  onChange={(e) => setNcUrl(e.target.value)}
                  placeholder="https://cloud.deine-domain.de"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Zielordner in Nextcloud
                </label>
                <input
                  type="text"
                  value={ncFolder}
                  onChange={(e) => setNcFolder(e.target.value)}
                  placeholder="/TaktWerk"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Benutzername
                </label>
                <input
                  type="text"
                  value={ncUsername}
                  onChange={(e) => setNcUsername(e.target.value)}
                  placeholder="max.mustermann"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  App-Passwort{' '}
                  {nextcloud.hasPassword && (
                    <span className="text-emerald-700 dark:text-emerald-400">(gespeichert)</span>
                  )}
                </label>
                <input
                  type="password"
                  value={ncPassword}
                  onChange={(e) => setNcPassword(e.target.value)}
                  placeholder={nextcloud.hasPassword ? '••••••••••••••••' : 'App-Passwort'}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ncAutoSync}
                    onChange={(e) => setNcAutoSync(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Änderungen automatisch per WebDAV synchronisieren
                </label>
              </div>

              {testResult && (
                <div
                  className={`rounded-lg border px-3.5 py-2.5 text-xs font-medium md:col-span-2 ${
                    testResult.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200'
                  }`}
                >
                  {testResult.text}
                </div>
              )}

              {pushConflictAt && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200 md:col-span-2 space-y-3">
                  <div className="flex items-start gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Mehrgeräte-Konflikt: In Nextcloud liegt ein neuerer Stand vom{' '}
                      {formatDateTimeDE(pushConflictAt)}.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePull()}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      Von Nextcloud laden
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePush(true)}
                      className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 cursor-pointer"
                    >
                      Lokal überschreiben
                    </button>
                    <button
                      type="button"
                      onClick={onDismissConflict}
                      className="px-2.5 py-1.5 text-xs font-medium cursor-pointer"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 md:col-span-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
                  >
                    <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
                    Testen
                  </button>
                  <button
                    type="submit"
                    disabled={savingNc}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                  >
                    Zugangsdaten speichern
                  </button>
                  {nextcloud.configured && (
                    <button
                      type="button"
                      onClick={handleClearNextcloud}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:text-red-700 dark:border-[#3b2d5e] dark:text-slate-300 cursor-pointer"
                    >
                      Trennen
                    </button>
                  )}
                </div>

                {nextcloud.configured && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePush(false)}
                      disabled={syncing !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 cursor-pointer"
                    >
                      <UploadCloud className="h-4 w-4" />
                      {syncing === 'push' ? 'Sichere...' : 'Auf Nextcloud sichern'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePull()}
                      disabled={syncing !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
                    >
                      <DownloadCloud className="h-4 w-4" />
                      {syncing === 'pull' ? 'Lade...' : 'Von Nextcloud laden'}
                    </button>
                  </div>
                )}
              </div>
            </form>
          </section>

          {/* CalDAV Kalender-Anbindung */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-4">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Calendar className="h-5 w-5 text-blue-700 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Nextcloud Kalender (CalDAV)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Verknüpfe einen Nextcloud-Kalender, um Termine direkt in TaktWerk zu sehen &amp; Zeiten zu starten oder zurückzuschreiben.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDiscoverCalendars()}
                disabled={!nextcloud.configured || discoveringCalendars}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${discoveringCalendars ? 'animate-spin' : ''}`} />
                Kalender von Nextcloud laden
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {discoveredCalendars.length > 0 && (
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Gefundener Nextcloud-Kalender
                  </label>
                  <ThemedSelect
                    value={companyForm.calendarConfig?.selectedCalendarUrl ?? ''}
                    onChange={(val) => {
                      const cal = discoveredCalendars.find((c) => c.url === val);
                      setCompanyForm((prev) => ({
                        ...prev,
                        calendarConfig: {
                          selectedCalendarUrl: val,
                          selectedCalendarName:
                            cal?.displayName ?? prev.calendarConfig?.selectedCalendarName ?? '',
                          autoSyncTimeEntries: prev.calendarConfig?.autoSyncTimeEntries ?? false,
                        },
                      }));
                    }}
                    ariaLabel="Nextcloud-Kalender auswählen"
                    placeholder="Kalender auswählen..."
                    options={[
                      { value: '', label: 'Kalender auswählen...' },
                      ...discoveredCalendars.map((c) => ({
                        value: c.url,
                        label: c.displayName,
                      })),
                    ]}
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  CalDAV-Kalender-URL
                </label>
                <input
                  type="url"
                  value={companyForm.calendarConfig?.selectedCalendarUrl ?? ''}
                  onChange={(e) =>
                    setCompanyForm((prev) => ({
                      ...prev,
                      calendarConfig: {
                        selectedCalendarUrl: e.target.value,
                        selectedCalendarName: prev.calendarConfig?.selectedCalendarName ?? '',
                        autoSyncTimeEntries: prev.calendarConfig?.autoSyncTimeEntries ?? false,
                      },
                    }))
                  }
                  placeholder="https://cloud.../remote.php/dav/calendars/user/personal/"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Anzeigename des Kalenders
                </label>
                <input
                  type="text"
                  value={companyForm.calendarConfig?.selectedCalendarName ?? ''}
                  onChange={(e) =>
                    setCompanyForm((prev) => ({
                      ...prev,
                      calendarConfig: {
                        selectedCalendarUrl: prev.calendarConfig?.selectedCalendarUrl ?? '',
                        selectedCalendarName: e.target.value,
                        autoSyncTimeEntries: prev.calendarConfig?.autoSyncTimeEntries ?? false,
                      },
                    }))
                  }
                  placeholder="z. B. Persönlich oder Einsätze"
                  className={inputClass}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(companyForm.calendarConfig?.autoSyncTimeEntries)}
                onChange={(e) =>
                  setCompanyForm((prev) => ({
                    ...prev,
                    calendarConfig: {
                      selectedCalendarUrl: prev.calendarConfig?.selectedCalendarUrl ?? '',
                      selectedCalendarName: prev.calendarConfig?.selectedCalendarName ?? '',
                      autoSyncTimeEntries: e.target.checked,
                    },
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              />
              Abgeschlossene Zeiteinträge automatisch als Termin in den Nextcloud-Kalender eintragen
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => handleCompanySubmit()}
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Kalender-Einstellung speichern
              </button>
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: Backups & Exporte */}
      {activeTab === 'backups' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Automatisierte Multi-Format-Backups
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Sichert automatisch alle Daten als JSON, CSV, Excel (.xlsx), Gesamtbericht-PDF und Rechnungen-ZIP nach Zeitplan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRunBackupNow()}
                disabled={runningBackup}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer shrink-0"
              >
                <Archive className="h-4 w-4" />
                {runningBackup ? 'Erstelle Backups...' : 'Backup jetzt ausführen'}
              </button>
            </div>

            <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 cursor-pointer">
              <input
                type="checkbox"
                checked={autoBackup.enabled}
                onChange={(e) => updateAutoBackup({ enabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              />
              Automatisches Backup beim App-Start prüfen &amp; fällige Sicherungen ausführen
            </label>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Intervall
                </label>
                <ThemedSelect
                  value={autoBackup.frequency}
                  onChange={(val) =>
                    updateAutoBackup({ frequency: val as AutoBackupFrequency })
                  }
                  ariaLabel="Backup-Intervall"
                  options={[
                    { value: 'daily', label: 'Täglich' },
                    { value: 'weekly', label: 'Wöchentlich' },
                    { value: 'monthly', label: 'Monatlich' },
                  ]}
                />
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Enthaltene Formate
                </span>
                <div className="grid grid-cols-1 gap-2 text-xs text-slate-700 dark:text-slate-200 sm:grid-cols-2">
                  {([
                    { id: 'json', label: 'JSON (Vollbackup)' },
                    { id: 'excel', label: 'Excel (.xlsx)' },
                    { id: 'pdf', label: 'Gesamtbericht (.pdf)' },
                    { id: 'csv', label: 'CSV-Tabellen' },
                    { id: 'invoices_zip', label: 'Rechnungen als ZIP (.zip)' },
                  ] as const).map((fmt) => (
                    <label key={fmt.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(autoBackup.formats ?? []).includes(fmt.id)}
                        onChange={() => toggleBackupFormat(fmt.id)}
                        className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                      />
                      {fmt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Speicherziel
                </span>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBackup.uploadToNextcloud}
                    onChange={(e) => updateAutoBackup({ uploadToNextcloud: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  In Nextcloud (/Backups) hochladen
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBackup.localDownload}
                    onChange={(e) => updateAutoBackup({ localDownload: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Lokal herunterladen / auf Gerät teilen
                </label>
              </div>
            </div>

            {autoBackup.lastRunAt && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-[#2e2349] dark:bg-[#211936]/50 dark:text-slate-300">
                Letztes Multi-Format-Backup: <span className="font-mono font-semibold">{formatDateTimeDE(autoBackup.lastRunAt)}</span>
                {autoBackup.lastRunSummary ? ` — ${autoBackup.lastRunSummary}` : ''}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => handleCompanySubmit()}
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Backup-Konfiguration speichern
              </button>
            </div>
          </section>

          {/* Grafische PDF-Auswertung mit Filtern */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <BarChart3 className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Grafische Auswertung als PDF (mit Filtern)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Erstellt einen visuellen PDF-Bericht mit Kennzahlen, Verteilungsdiagramm, Schwerpunkt-Balken und Einzelaufstellung nach Wunschfilter.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { id: '7d', label: '7 Tage' },
                  { id: '30d', label: '30 Tage' },
                  { id: 'month', label: 'Dieser Monat' },
                  { id: 'year', label: 'Dieses Jahr' },
                  { id: 'all', label: 'Gesamt' },
                ] as const).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyReportDatePreset(preset.id)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Berichtstitel
                </label>
                <input
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="Grafischer Tätigkeits- & Auswertungsbericht"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Zeitraum von
                </label>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Zeitraum bis
                </label>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Kunde
                </label>
                <ThemedSelect
                  value={reportCustomerId}
                  onChange={setReportCustomerId}
                  ariaLabel="Kunde für PDF-Bericht"
                  options={[
                    { value: 'all', label: 'Alle Kunden & Intern' },
                    { value: 'internal_only', label: 'Nur interne Arbeiten' },
                    ...db.customers.map((c) => ({
                      value: c.id,
                      label: c.companyName,
                    })),
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Leistung / Produkt
                </label>
                <ThemedSelect
                  value={reportProductId}
                  onChange={setReportProductId}
                  ariaLabel="Leistung für PDF-Bericht"
                  options={[
                    { value: 'all', label: 'Alle Leistungen' },
                    ...db.products.map((p) => ({
                      value: p.id,
                      label: p.name,
                    })),
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Auftrag / Tätigkeit
                </label>
                <ThemedSelect
                  value={reportTaskTitle}
                  onChange={setReportTaskTitle}
                  ariaLabel="Auftrag für PDF-Bericht"
                  options={[
                    { value: 'all', label: 'Alle Aufträge' },
                    ...distinctTaskTitles.map((title) => ({
                      value: title,
                      label: title,
                    })),
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Tätigkeitsart
                </label>
                <ThemedSelect
                  value={reportEntryType}
                  onChange={(val) => setReportEntryType(val as 'all' | 'project' | 'internal')}
                  ariaLabel="Tätigkeitsart für PDF-Bericht"
                  options={[
                    { value: 'all', label: 'Alle Arten' },
                    { value: 'project', label: 'Kundenaufträge' },
                    { value: 'internal', label: 'Interne Arbeiten' },
                  ]}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Abrechnung
                </label>
                <ThemedSelect
                  value={reportBillable}
                  onChange={(val) =>
                    setReportBillable(val as 'all' | 'billable_only' | 'unbillable_only')
                  }
                  ariaLabel="Verrechenbarkeit für PDF-Bericht"
                  options={[
                    { value: 'all', label: 'Alle Zeiten' },
                    { value: 'billable_only', label: 'Nur verrechenbar' },
                    { value: 'unbillable_only', label: 'Nur nicht verrechenbar' },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-[#2e2349] dark:bg-[#211936]/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-700 dark:text-slate-200">
                Ausgewählter Umfang:{' '}
                <span className="font-mono font-semibold">
                  {matchingReportSummary.count} Zeiteinträge
                </span>{' '}
                ·{' '}
                <span className="font-mono font-semibold">
                  {formatNumber(matchingReportSummary.hours, 2)} Std.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadFilteredReport()}
                  disabled={exportingReport}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {exportingReport ? 'Erstelle...' : 'Grafik-PDF herunterladen'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleShareFilteredReport()}
                  disabled={exportingReport}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Teilen
                </button>
                <button
                  type="button"
                  onClick={() => void handleUploadFilteredReportNextcloud()}
                  disabled={exportingReport || !nextcloud.configured}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 cursor-pointer"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  In Nextcloud sichern
                </button>
              </div>
            </div>
          </section>

          {/* Rechnungen als ZIP-Paket */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-4">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <FileArchive className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Rechnungen als ZIP-Paket sichern
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Bündelt alle PDF-Rechnungen (inkl. unterschriebener Abnahmeprotokolle und einer CSV-Übersicht) in einem einzigen ZIP-Archiv für Buchhaltung oder Steuerberater.
                  </p>
                </div>
              </div>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 shrink-0">
                {zipTargetCount} Dokument(e) im Paket
              </span>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-5 text-xs text-slate-700 dark:text-slate-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zipIncludeQuotes}
                    onChange={(e) => setZipIncludeQuotes(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Angebote einschließen
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={zipIncludeArchived}
                    onChange={(e) => setZipIncludeArchived(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Archivierte Rechnungen einschließen
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadInvoicesZip()}
                  disabled={exportingZip || zipTargetCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  <FileArchive className="h-3.5 w-3.5" />
                  {exportingZip ? 'Packe ZIP...' : 'Rechnungen-ZIP herunterladen'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUploadInvoicesZipNextcloud()}
                  disabled={exportingZip || zipTargetCount === 0 || !nextcloud.configured}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 cursor-pointer"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  ZIP in Nextcloud sichern
                </button>
              </div>
            </div>
          </section>

          {/* Manuelle Exporte & DB Reset */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 h-5 w-5 text-slate-600 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Manuelle Exporte, Wiederherstellung &amp; Datenbank
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Alle Formate einzeln exportieren oder ein vorhandenes JSON-Backup einspielen.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onLoadSampleData}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 cursor-pointer"
                >
                  Beispieldaten laden
                </button>
                <button
                  type="button"
                  onClick={onResetEmpty}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-[#171126] dark:text-red-400 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Datenbank leeren
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 dark:border-[#2e2349] md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Excel, PDF &amp; CSV Exporte
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExportExcel()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportFullPdf()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5 text-red-700 dark:text-red-400" />
                    Gesamtbericht (.pdf)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportTimeCsv()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Zeiten (CSV)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExportInvoicesCsv()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Rechnungen (CSV)
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Vollständige JSON-Sicherung
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExportJsonBackup()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Backup sichern (.json)
                  </button>
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    Backup einspielen
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleImportJsonBackup}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 5: Ortung, Geofencing, Fahrtkosten & Erinnerung */}
      {activeTab === 'automation' && (
        <form onSubmit={handleCompanySubmit} className="space-y-6">
          {/* Ortserkennung & Ortsbasierter Start (Geofencing) */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-2.5">
                <Radar className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Ortung &amp; automatischer Aufgaben-Start (Geofencing)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Erfasst deinen Standort beim Timer-Start oder startet bestimmte Aufgaben automatisch, sobald du dich an einem hinterlegten Ort befindest.
                  </p>
                </div>
              </div>
              {onCheckGeoFenceNow && (
                <button
                  type="button"
                  onClick={onCheckGeoFenceNow}
                  disabled={checkingGeoFence}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
                >
                  {checkingGeoFence ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Compass className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  Standort jetzt prüfen
                </button>
              )}
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(companyForm.autoCaptureLocation)}
                  onChange={(e) =>
                    setCompanyForm({ ...companyForm, autoCaptureLocation: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                Standort automatisch beim Start eines Timers (manuell &amp; NFC-Tag) abrufen
              </label>

              <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(companyForm.autoLocationStartEnabled)}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      autoLocationStartEnabled: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                />
                Ortsbasierte Automatik aktivieren (Aufgabe startet automatisch im Zielradius)
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Prüfintervall für Standortregeln
                </label>
                <ThemedSelect
                  value={String(companyForm.geoFenceCheckIntervalSec ?? 60)}
                  onChange={(val) =>
                    setCompanyForm({
                      ...companyForm,
                      geoFenceCheckIntervalSec: Number(val),
                    })
                  }
                  ariaLabel="Standort-Prüfintervall"
                  options={[
                    { value: '30', label: 'Alle 30 Sekunden (präzise)' },
                    { value: '60', label: 'Jede Minute (empfohlen)' },
                    { value: '120', label: 'Alle 2 Minuten (akkuschonend)' },
                    { value: '300', label: 'Alle 5 Minuten' },
                  ]}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:border-violet-600 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  Ortsautomatik-Einstellung speichern
                </button>
              </div>
            </div>

            {/* Existing Geo Rules */}
            <div className="space-y-2.5 border-t border-slate-200 pt-4 dark:border-[#2e2349]">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Hinterlegte Ortsregeln ({geoFenceRules.length})
              </h3>
              {geoFenceRules.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Noch keine Ortsregeln angelegt. Füge unten z. B. dein Büro oder einen Kundenstandort hinzu.
                </p>
              ) : (
                <div className="space-y-2">
                  {geoFenceRules.map((rule) => {
                    const cust = db.customers.find((c) => c.id === rule.customerId);
                    const prod = db.products.find((p) => p.id === rule.productId);
                    return (
                      <div
                        key={rule.id}
                        className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-[#2e2349] dark:bg-[#211936]/50 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {rule.name}
                            </span>
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-700 dark:bg-violet-950/70 dark:text-violet-300">
                              {rule.radiusMeters} m Radius
                            </span>
                            {rule.autoStopOnExit && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                Auto-Stopp bei Verlassen
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            Startet: <span className="font-medium">{rule.taskTitle}</span> ·{' '}
                            {cust?.companyName ?? 'Kunde'} ({prod?.name ?? 'Leistung'})
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
                            {rule.address ? `${rule.address} · ` : ''}
                            {rule.lat.toFixed(5)}, {rule.lng.toFixed(5)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleFocusRuleOnMap(rule)}
                            title="Auf der Karte anzeigen"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 dark:hover:bg-[#2a2045] cursor-pointer"
                          >
                            <MapIcon className="h-3.5 w-3.5" />
                            Karte
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleGeoRule(rule.id)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                              rule.enabled
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : 'border-slate-200 bg-white text-slate-500 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-400'
                            }`}
                          >
                            {rule.enabled ? 'Aktiv' : 'Pausiert'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteGeoRule(rule.id)}
                            title="Ortsregel löschen"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Interactive OpenStreetMap View for Location Selection & Rule Preview */}
              <div
                ref={mapSectionRef}
                className="mt-4 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MapIcon className="h-4 w-4 text-blue-700 dark:text-violet-400" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      Interaktive OpenStreetMap-Kartenansicht (Orte wählen &amp; Zielradius prüfen)
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kostenlos · Klicken, Pin ziehen oder Adresse suchen
                  </span>
                </div>
                <GeoFenceMapPicker
                  selectedLat={newRuleLat.trim() ? Number(newRuleLat) : null}
                  selectedLng={newRuleLng.trim() ? Number(newRuleLng) : null}
                  selectedAddress={newRuleAddress}
                  radiusMeters={Math.max(30, Number(newRuleRadius) || 150)}
                  rules={geoFenceRules}
                  customers={db.customers}
                  products={db.products}
                  focusedRuleId={focusedRuleId}
                  cameraRequestNonce={mapCameraNonce}
                  theme={theme}
                  onSelectLocation={handleMapPickLocation}
                  onUseRuleAsDraft={handleUseRuleAsDraft}
                  onNotify={onNotify}
                />
              </div>

              {/* Create GeoFence Rule */}
              <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 dark:border-[#3b2d5e] dark:bg-[#211936]/30 space-y-3">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Neue Ortsregel hinzufügen
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Ortsname</label>
                    <input
                      type="text"
                      value={newRuleName}
                      onChange={(e) => setNewRuleName(e.target.value)}
                      placeholder="z. B. Kundenbüro München"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Aufgabentitel</label>
                    <input
                      type="text"
                      value={newRuleTaskTitle}
                      onChange={(e) => setNewRuleTaskTitle(e.target.value)}
                      placeholder="z. B. Vor-Ort-Service"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Radius</label>
                    <ThemedSelect
                      value={newRuleRadius}
                      onChange={setNewRuleRadius}
                      ariaLabel="Ortsregel-Radius"
                      options={[
                        { value: '50', label: '50 m (Gebäude)' },
                        { value: '100', label: '100 m (Standort)' },
                        { value: '150', label: '150 m (Standard)' },
                        { value: '250', label: '250 m (Werksgelände)' },
                        { value: '500', label: '500 m (Stadtteil)' },
                        { value: '1000', label: '1.000 m (Region)' },
                      ]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Kunde</label>
                    <ThemedSelect
                      value={newRuleCustomerId}
                      onChange={setNewRuleCustomerId}
                      ariaLabel="Kunde für Ortsregel"
                      options={db.customers.map((c) => ({
                        value: c.id,
                        label: c.companyName,
                      }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Leistung</label>
                    <ThemedSelect
                      value={newRuleProductId}
                      onChange={setNewRuleProductId}
                      ariaLabel="Leistung für Ortsregel"
                      options={db.products.map((p) => ({
                        value: p.id,
                        label: `${p.name} (${formatCurrency(p.unitPriceNet)}/${p.unit})`,
                      }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="md:col-span-6">
                    <label className="mb-1 block text-xs text-slate-500">
                      Adresse suchen oder per GPS übernehmen
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newRuleAddress}
                        onChange={(e) => setNewRuleAddress(e.target.value)}
                        placeholder="Straße Nr., PLZ Ort"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => void handleSearchRuleAddress()}
                        disabled={searchingRuleLoc}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-100 cursor-pointer shrink-0"
                      >
                        {searchingRuleLoc ? '...' : 'Suchen'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCaptureRuleGps()}
                        disabled={locatingRule}
                        title="Aktuellen GPS-Standort übernehmen"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-violet-300 cursor-pointer shrink-0"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        {locatingRule ? '...' : 'GPS'}
                      </button>
                    </div>
                  </div>
                  <div className="md:col-span-3">
                    <label className="mb-1 block text-xs text-slate-500">Breitengrad (Lat)</label>
                    <input
                      type="text"
                      value={newRuleLat}
                      onChange={(e) => setNewRuleLat(e.target.value)}
                      placeholder="48.13715"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="mb-1 block text-xs text-slate-500">Längengrad (Lng)</label>
                    <input
                      type="text"
                      value={newRuleLng}
                      onChange={(e) => setNewRuleLng(e.target.value)}
                      placeholder="11.57612"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRuleAutoStop}
                      onChange={(e) => setNewRuleAutoStop(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                    />
                    Aufgabe automatisch beenden, sobald ich den Radius wieder verlasse
                  </label>
                  <button
                    type="button"
                    onClick={handleAddGeoRule}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ortsregel speichern
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Fahrtkosten- & Distanz-Automatik */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-4">
            <div className="flex items-start gap-2.5">
              <Car className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Fahrtkosten- &amp; Distanz-Automatik
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Berechnet aus deiner Startadresse und dem Einsatzort automatisch die Straßenentfernung (Faktor 1,25) und den Nettopreis in €/km.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Startpunkt / Firmensitz für Anfahrtberechnung
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={homeAddressQuery}
                  onChange={(e) => setHomeAddressQuery(e.target.value)}
                  placeholder="z. B. Musterstraße 1, 80331 München"
                  className={`${inputClass} flex-1 min-w-56`}
                />
                <button
                  type="button"
                  onClick={() => void handleGeocodeHomeBase()}
                  disabled={homeSearching}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer"
                >
                  {homeSearching ? 'Suche...' : 'Adresse ermitteln'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleGeocodeHomeBase(
                      `${companyForm.street}, ${companyForm.postalCode} ${companyForm.city}`
                    )
                  }
                  disabled={homeSearching}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer"
                >
                  Aus Firmendaten
                </button>
                <button
                  type="button"
                  onClick={() => void handleCaptureHomeBaseGps()}
                  disabled={homeLocating}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-300 cursor-pointer"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  {homeLocating ? 'Orte...' : 'Aktueller GPS'}
                </button>
              </div>
              {companyForm.homeBaseLocation && (
                <p className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                  Gespeichert: {companyForm.homeBaseLocation.address} (
                  {companyForm.homeBaseLocation.lat.toFixed(4)},{' '}
                  {companyForm.homeBaseLocation.lng.toFixed(4)})
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Kilometerpauschale (€/km Netto)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.05"
                  value={companyForm.travelRatePerKm ?? 0.3}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      travelRatePerKm: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={companyForm.travelRoundTripDefault !== false}
                    onChange={(e) =>
                      setCompanyForm({
                        ...companyForm,
                        travelRoundTripDefault: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Hin- &amp; Rückfahrt verdoppeln (× 2)
                </label>
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(companyForm.autoCalculateTravelOnStop)}
                    onChange={(e) =>
                      setCompanyForm({
                        ...companyForm,
                        autoCalculateTravelOnStop: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  />
                  Beim Timer-Stopp automatisch berechnen
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Fahrtkosten-Einstellungen speichern
              </button>
            </div>
          </section>

          {/* 1-Stunden Erinnerung */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-4">
            <div className="flex items-start gap-2.5">
              <BellRing className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Erinnerung für laufende Aufgaben &amp; Klingelton
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Benachrichtigt dich nach einer Stunde (oder deiner Wunschdauer), falls ein Timer noch aktiv ist — inklusive wählbarem Signalton.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={companyForm.timerReminderEnabled !== false}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    timerReminderEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              />
              Erinnerung bei laufender Tätigkeit aktivieren
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Erinnerung auslösen nach (Minuten)
                </label>
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={companyForm.timerReminderMinutes ?? 60}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      timerReminderMinutes: Math.max(1, Number(e.target.value) || 60),
                    })
                  }
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                  Klingelton / Signalpreset
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <ThemedSelect
                      value={companyForm.timerReminderSound ?? 'chime'}
                      onChange={(val) =>
                        setCompanyForm({
                          ...companyForm,
                          timerReminderSound: val as ReminderSoundPreset,
                        })
                      }
                      ariaLabel="Klingelton auswählen"
                      options={(Object.keys(REMINDER_SOUND_OPTIONS) as ReminderSoundPreset[]).map(
                        (key) => ({
                          value: key,
                          label: REMINDER_SOUND_OPTIONS[key].label,
                        })
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSound}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 cursor-pointer shrink-0"
                  >
                    <Volume2 className="h-4 w-4" />
                    Ton testen
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Ortung &amp; Erinnerung speichern
              </button>
            </div>
          </section>

          {/* Android Homescreen Widget Guide */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-3">
            <div className="flex items-start gap-2.5">
              <Smartphone className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Android Startbildschirm-Widget
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  TaktWerk liefert ein natives Startbildschirm-Widget für Android (Pixel &amp; Co.). Halte eine freie Stelle auf dem Android-Startbildschirm gedrückt → <span className="font-semibold text-slate-700 dark:text-slate-200">Widgets → TaktWerk</span>. Dort siehst du deinen laufenden Timer, heutige Gesamtstunden und 1-Tippen-Schnellstarts für deine wichtigsten NFC-Aufgaben.
                </p>
              </div>
            </div>
          </section>
        </form>
      )}
    </div>
  );
}
