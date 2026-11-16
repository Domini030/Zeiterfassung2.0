import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  DownloadCloud,
  FileSliders,
  FileSpreadsheet,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  AppDatabase,
  CompanyProfile,
  InvoiceAccentPreset,
  NextcloudConfigInfo,
  TimeRoundingMinutes,
} from '../types';
import {
  apiClearNextcloudConfig,
  apiSaveNextcloudConfig,
  apiTestNextcloud,
  getBackendServerUrl,
  isNativeCapacitor,
  setBackendServerUrl,
} from '../utils/apiClient';
import {
  INVOICE_ACCENT_STYLES,
  formatDateTimeDE,
  formatInvoiceNumber,
  toInputDate,
} from '../utils/format';
import {
  downloadOrShareTextFile,
  invoicesToCsv,
  timeEntriesToCsv,
  validateImportedDatabase,
} from '../utils/exportBackup';

interface NextcloudSettingsViewProps {
  db: AppDatabase;
  nextcloud: NextcloudConfigInfo;
  company: CompanyProfile;
  pushConflictAt: string | null;
  onDismissConflict: () => void;
  onRefreshConfig: (nextcloud: NextcloudConfigInfo) => void;
  onSyncFromNextcloud: () => Promise<void>;
  onSyncToNextcloud: (force?: boolean) => Promise<void>;
  onSaveCompany: (company: CompanyProfile) => void;
  onImportDatabase: (db: AppDatabase) => void;
  onLoadSampleData: () => void;
  onResetEmpty: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function NextcloudSettingsView({
  db,
  nextcloud,
  company,
  pushConflictAt,
  onDismissConflict,
  onRefreshConfig,
  onSyncFromNextcloud,
  onSyncToNextcloud,
  onSaveCompany,
  onImportDatabase,
  onLoadSampleData,
  onResetEmpty,
  onNotify,
}: NextcloudSettingsViewProps) {
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

  const nativeApp = isNativeCapacitor();
  const [serverUrl, setServerUrl] = useState(() => getBackendServerUrl());

  const invoiceNumberPreview = useMemo(
    () => formatInvoiceNumber(companyForm),
    [companyForm]
  );

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

  const handleCompanySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCompany(companyForm);
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

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:focus:border-violet-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Nextcloud-Speicher &amp; Firmendaten
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Verbinde deine eigene Nextcloud-Instanz per WebDAV als Daten- und Rechnungsarchiv.
        </p>
      </div>

      {nativeApp && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
          <div className="flex items-start gap-2.5">
            <Server className="mt-0.5 h-5 w-5 text-blue-700 dark:text-violet-400" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                TaktWerk Server-URL (optional für Android-App)
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Leer lassen für eigenständigen Gerätespeicher + direkten Nextcloud-Sync, oder deine eigene TaktWerk-Cloud-Run-URL eintragen.
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

      {/* Nextcloud WebDAV Configuration */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 text-blue-700 dark:text-violet-400" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Nextcloud WebDAV-Anbindung
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Speichert deine Datenbank als <span className="font-mono">taktwerk-db.json</span> und PDF-Rechnungen im Unterordner <span className="font-mono">/Rechnungen</span>.
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
              <span className="text-slate-500 dark:text-slate-400">
                Noch nicht verbunden (lokaler Server-Speicher aktiv)
              </span>
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
              Nextcloud-Benutzername
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
                <span className="text-emerald-700 dark:text-emerald-400">
                  (gespeichert — leer lassen zum Beibehalten)
                </span>
              )}
            </label>
            <input
              type="password"
              value={ncPassword}
              onChange={(e) => setNcPassword(e.target.value)}
              placeholder={
                nextcloud.hasPassword
                  ? '••••••••••••••••'
                  : 'In Nextcloud unter Einstellungen → Sicherheit erstellen'
              }
              className={`${inputClass} font-mono`}
            />
          </div>

          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={ncAutoSync}
                onChange={(e) => setNcAutoSync(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-700 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
              />
              Änderungen automatisch per WebDAV mit Nextcloud synchronisieren
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

          {nextcloud.lastSyncError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200 md:col-span-2">
              Letzter Sync-Hinweis: {nextcloud.lastSyncError}
            </div>
          )}

          {pushConflictAt && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200 md:col-span-2 space-y-3">
              <div className="flex items-start gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Mehrgeräte-Konflikt erkannt: In Nextcloud existiert ein neuerer Datenstand vom {formatDateTimeDE(pushConflictAt)}.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handlePull()}
                  disabled={syncing !== null}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  Von Nextcloud laden (empfohlen)
                </button>
                <button
                  type="button"
                  onClick={() => void handlePush(true)}
                  disabled={syncing !== null}
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-[#171126] dark:text-red-300 dark:hover:bg-red-950 cursor-pointer"
                >
                  Trotzdem lokal überschreiben
                </button>
                <button
                  type="button"
                  onClick={onDismissConflict}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40 cursor-pointer"
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
                Verbindung testen
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
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 dark:border-[#3b2d5e] dark:text-slate-300 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
                >
                  <UploadCloud className="h-4 w-4" />
                  {syncing === 'push' ? 'Sichere...' : 'Auf Nextcloud sichern'}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePull()}
                  disabled={syncing !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <DownloadCloud className="h-4 w-4" />
                  {syncing === 'pull' ? 'Lade...' : 'Von Nextcloud laden'}
                </button>
              </div>
            )}
          </div>
        </form>
      </section>

      {/* Company Profile for Invoices */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
          Eigene Firmendaten &amp; Bankverbindung (für Rechnungen)
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Diese Angaben erscheinen im Briefkopf und in der Fußzeile jeder generierten PDF-Rechnung.
        </p>

        <form onSubmit={handleCompanySubmit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Firmenname
            </label>
            <input
              type="text"
              value={companyForm.companyName}
              onChange={(e) =>
                setCompanyForm({ ...companyForm, companyName: e.target.value })
              }
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
              onChange={(e) =>
                setCompanyForm({ ...companyForm, ownerName: e.target.value })
              }
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
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, postalCode: e.target.value })
                }
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
              onChange={(e) =>
                setCompanyForm({ ...companyForm, taxNumber: e.target.value })
              }
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
              Rechnungs-Präfix
            </label>
            <input
              type="text"
              value={companyForm.invoicePrefix}
              onChange={(e) =>
                setCompanyForm({ ...companyForm, invoicePrefix: e.target.value })
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
              onChange={(e) =>
                setCompanyForm({ ...companyForm, bankName: e.target.value })
              }
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
          <div className="flex justify-end md:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
            >
              Firmendaten speichern
            </button>
          </div>
        </form>
      </section>

      {/* Invoice Customization & Numbering Format */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126]">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-[#2e2349] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <FileSliders className="h-5 w-5 text-blue-700 dark:text-violet-400" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Rechnungsgestaltung &amp; Nummernkreis
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Passe Firmenlogo, Darstellung der Rechnungsnummer, Akzentfarbe und Standardtexte für Vorschau, Druck &amp; PDF an.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-[#3b2d5e] dark:bg-[#211936]">
            <span className="text-slate-500 dark:text-slate-400">Nächste Nr.: </span>
            <span className="font-mono font-semibold text-slate-900 dark:text-violet-300">
              {invoiceNumberPreview}
            </span>
          </div>
        </div>

        <form onSubmit={handleCompanySubmit} className="mt-5 space-y-6">
          {/* Logo Upload */}
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 md:grid-cols-12 md:items-center">
            <div className="md:col-span-7 space-y-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Firmenlogo für Rechnungen
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PNG, JPG, WebP oder SVG hochladen — wird automatisch für scharfen A4-PDF-Export optimiert.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-100 dark:hover:bg-[#2a2045] cursor-pointer">
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
                    onClick={() =>
                      setCompanyForm((prev) => ({ ...prev, logoDataUrl: '' }))
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-[#171126] dark:text-red-400 dark:hover:bg-red-950/50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Logo entfernen
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 pt-1 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={companyForm.invoiceShowLogo !== false}
                  onChange={(e) =>
                    setCompanyForm({
                      ...companyForm,
                      invoiceShowLogo: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                />
                Logo oben rechts auf Rechnungen einblenden
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
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  Kein Logo hinterlegt
                </span>
              )}
            </div>
          </div>

          {/* Invoice Numbering Pattern */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-5">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Darstellungsformat der Rechnungsnummer
              </label>
              <input
                type="text"
                value={companyForm.invoiceNumberPattern ?? '{PREFIX}{YYYY}-{NR}'}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    invoiceNumberPattern: e.target.value,
                  })
                }
                placeholder="{PREFIX}{YYYY}-{NR}"
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Platzhalter: <span className="font-mono">{'{PREFIX}'}</span>,{' '}
                <span className="font-mono">{'{YYYY}'}</span>,{' '}
                <span className="font-mono">{'{YY}'}</span>,{' '}
                <span className="font-mono">{'{MM}'}</span>,{' '}
                <span className="font-mono">{'{DD}'}</span>,{' '}
                <span className="font-mono">{'{NR}'}</span>
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Präfix
              </label>
              <input
                type="text"
                value={companyForm.invoicePrefix}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, invoicePrefix: e.target.value })
                }
                placeholder="RE-"
                className={`${inputClass} font-mono`}
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Stellen ({'{NR}'})
              </label>
              <select
                value={companyForm.invoiceSequenceDigits ?? 4}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    invoiceSequenceDigits: Number(e.target.value),
                  })
                }
                className={inputClass}
              >
                {[2, 3, 4, 5, 6].map((digits) => (
                  <option key={digits} value={digits}>
                    {digits} ({String(1).padStart(digits, '0')})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Nächste laufende Nummer
              </label>
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

            <div className="flex flex-wrap items-center gap-2 md:col-span-12">
              <span className="text-xs text-slate-500 dark:text-slate-400">Vorlagen:</span>
              {[
                { label: 'RE-2026-0001', pattern: '{PREFIX}{YYYY}-{NR}' },
                { label: 'RE-2611-0001', pattern: '{PREFIX}{YY}{MM}-{NR}' },
                { label: 'RE-0001', pattern: '{PREFIX}{NR}' },
                { label: '2026/0001', pattern: '{YYYY}/{NR}' },
              ].map((preset) => (
                <button
                  key={preset.pattern}
                  type="button"
                  onClick={() =>
                    setCompanyForm({
                      ...companyForm,
                      invoiceNumberPattern: preset.pattern,
                    })
                  }
                  className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors cursor-pointer ${
                    (companyForm.invoiceNumberPattern ?? '{PREFIX}{YYYY}-{NR}') ===
                    preset.pattern
                      ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-violet-500 dark:bg-violet-950/70 dark:text-violet-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-300 dark:hover:bg-[#2a2045]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Design & Texts */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Akzentfarbe für Kopfzeile &amp; Tabellen
              </label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(INVOICE_ACCENT_STYLES) as InvoiceAccentPreset[]).map(
                  (presetKey) => {
                    const item = INVOICE_ACCENT_STYLES[presetKey];
                    const selected =
                      (companyForm.invoiceAccentColor ?? 'slate') === presetKey;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() =>
                          setCompanyForm({
                            ...companyForm,
                            invoiceAccentColor: presetKey,
                          })
                        }
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          selected
                            ? 'border-slate-900 bg-slate-100 text-slate-900 dark:border-violet-400 dark:bg-[#2a2045] dark:text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-300 dark:hover:bg-[#2a2045]'
                        }`}
                      >
                        <span className={`h-3 w-3 rounded-full ${item.swatchClass}`} />
                        {item.label}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Dokument-Überschrift
              </label>
              <input
                type="text"
                value={companyForm.invoiceHeaderTitle ?? 'Rechnung'}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    invoiceHeaderTitle: e.target.value,
                  })
                }
                placeholder="z. B. Rechnung oder Honorarabrechnung"
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Standard-Einleitungstext
              </label>
              <textarea
                rows={3}
                value={companyForm.invoiceDefaultIntroText ?? ''}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    invoiceDefaultIntroText: e.target.value,
                  })
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Standard-Schlusstext / Zahlungshinweis
              </label>
              <textarea
                rows={3}
                value={companyForm.invoiceDefaultOutroText ?? ''}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    invoiceDefaultOutroText: e.target.value,
                  })
                }
                className={inputClass}
              />
            </div>

            <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 space-y-3">
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
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-violet-600 dark:border-[#3b2d5e] dark:bg-[#211936]"
                />
                <div>
                  <div>Kleinunternehmerregelung (§ 19 UStG) standardmäßig aktivieren</div>
                  <p className="mt-0.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Rechnungen werden ohne Umsatzsteuer-Ausweis (keine MwSt.-Spalte, Gesamtbetrag ohne Steueraufschlag) und mit dem gesetzlichen Hinweis nach § 19 UStG erstellt.
                  </p>
                </div>
              </label>

              {companyForm.smallBusinessMode && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Hinweistext auf der Rechnung (§ 19 UStG)
                  </label>
                  <input
                    type="text"
                    value={
                      companyForm.smallBusinessNotice ??
                      'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'
                    }
                    onChange={(e) =>
                      setCompanyForm({
                        ...companyForm,
                        smallBusinessNotice: e.target.value,
                      })
                    }
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Standard-Zeitrundung bei Abrechnung (Takt)
              </label>
              <select
                value={companyForm.defaultTimeRoundingMinutes ?? 0}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    defaultTimeRoundingMinutes: Number(
                      e.target.value
                    ) as TimeRoundingMinutes,
                  })
                }
                className={inputClass}
              >
                <option value={0}>Keine Rundung (exakt auf die Sekunde)</option>
                <option value={5}>Auf 5-Minuten-Takt aufrunden</option>
                <option value={10}>Auf 10-Minuten-Takt aufrunden</option>
                <option value={15}>Auf 15-Minuten-Takt aufrunden</option>
                <option value={30}>Auf 30-Minuten-Takt aufrunden</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Kann pro Kunde individuell überschrieben werden.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Zusätzlicher Fußzeilen-Hinweis (optional, z. B. Handelsregister / Gerichtsstand)
              </label>
              <input
                type="text"
                value={companyForm.invoiceFooterNote ?? ''}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    invoiceFooterNote: e.target.value,
                  })
                }
                placeholder="z. B. Amtsgericht Hamburg · HRB 12345"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
            >
              Rechnungseinstellungen speichern
            </button>
          </div>
        </form>
      </section>

      {/* CSV Exports, JSON Backup & Database Reset */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-[#2e2349] dark:bg-[#171126] space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 text-slate-600 dark:text-violet-400" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Exporte, Sicherungen &amp; Datenbankverwaltung
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Exportiere Tabellen für Excel/Steuerberater, erstelle lokale Voll-Backups oder lade Beispieldaten.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onLoadSampleData}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Beispieldaten laden
            </button>
            <button
              type="button"
              onClick={onResetEmpty}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-[#171126] dark:text-red-400 dark:hover:bg-red-950/60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Datenbank leeren
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 dark:border-[#2e2349] md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Tabellen-Exporte (Excel-kompatibles CSV)
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleExportTimeCsv()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Arbeitszeiten (CSV)
              </button>
              <button
                type="button"
                onClick={() => void handleExportInvoicesCsv()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Rechnungen (CSV)
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-[#2e2349] dark:bg-[#211936]/50 space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Vollständige Datenbanksicherung (JSON)
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleExportJsonBackup()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Backup sichern (.json)
              </button>
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#171126] dark:text-slate-200 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer">
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
  );
}
