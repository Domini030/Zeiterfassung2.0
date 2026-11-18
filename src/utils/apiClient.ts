import { Capacitor } from '@capacitor/core';
import type {
  ActiveTimer,
  AppDatabase,
  AutoBackupFormat,
  CalendarAppointment,
  NextcloudCalendarConfig,
  NextcloudConfigInfo,
  ReminderSoundPreset,
  SyncPairingPayload,
} from '../types';
import {
  buildIcsEvent,
  parseCalDavCalendarDataXml,
  parseCalDavCalendarsXml,
  type DiscoveredCalendar,
} from './caldavClient';
import {
  downloadOrShareBinaryFile,
  downloadOrShareTextFile,
  generateBackupArtifacts,
} from './exportBackup';
import { formatDuration, getActiveTimerElapsedMs } from './format';
import { createEmptyDatabase, normalizeDatabase } from './sampleData';
import {
  decodeSyncPairingCode,
  encodeSyncPairingCode,
  mergeDatabases,
} from './syncMerge';
import { TaktWerkNative, type NativeNotificationStatus } from './taktwerkNative';
import { trackActivity } from './activityProgress';

const SERVER_URL_KEY = 'taktwerk-server-url';
const NATIVE_DB_KEY = 'taktwerk-native-db';
const NATIVE_NC_KEY = 'taktwerk-native-nc';

interface StoredLocalNc {
  url: string;
  username: string;
  appPassword: string;
  folder: string;
  autoSync: boolean;
  syncIntervalSec: number;
  pendingPush: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastKnownRemoteUpdatedAt?: string | null;
  lastKnownRemoteEtag?: string | null;
}

export class NextcloudConflictError extends Error {
  remoteUpdatedAt: string;
  constructor(message: string, remoteUpdatedAt: string) {
    super(message);
    this.name = 'NextcloudConflictError';
    this.remoteUpdatedAt = remoteUpdatedAt;
  }
}

export function isNativeCapacitor(): boolean {
  return Capacitor.isNativePlatform();
}

export function getBackendServerUrl(): string {
  try {
    return (localStorage.getItem(SERVER_URL_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setBackendServerUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      localStorage.setItem(SERVER_URL_KEY, cleaned);
    } else {
      localStorage.removeItem(SERVER_URL_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
  return cleaned;
}

function shouldUseRemoteServer(): boolean {
  if (!isNativeCapacitor()) return true;
  return Boolean(getBackendServerUrl());
}

function apiUrl(path: string): string {
  const base = isNativeCapacitor() ? getBackendServerUrl() : '';
  return `${base}${path}`;
}

function readNativeDb(): AppDatabase {
  try {
    const raw = localStorage.getItem(NATIVE_DB_KEY);
    if (raw) return JSON.parse(raw) as AppDatabase;
  } catch {
    // Fallback to empty DB
  }
  const initial = createEmptyDatabase();
  localStorage.setItem(NATIVE_DB_KEY, JSON.stringify(initial));
  return initial;
}

function writeNativeDb(db: AppDatabase): void {
  localStorage.setItem(NATIVE_DB_KEY, JSON.stringify(db));
}

function readNativeNc(): StoredLocalNc {
  try {
    const raw = localStorage.getItem(NATIVE_NC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredLocalNc>;
      return {
        url: parsed.url ?? '',
        username: parsed.username ?? '',
        appPassword: parsed.appPassword ?? '',
        folder: normalizeFolder(parsed.folder ?? '/TaktWerk'),
        autoSync: parsed.autoSync ?? true,
        syncIntervalSec:
          typeof parsed.syncIntervalSec === 'number' ? parsed.syncIntervalSec : 20,
        pendingPush: Boolean(parsed.pendingPush),
        lastSyncAt: parsed.lastSyncAt ?? null,
        lastSyncError: parsed.lastSyncError ?? null,
        lastKnownRemoteUpdatedAt: parsed.lastKnownRemoteUpdatedAt ?? null,
        lastKnownRemoteEtag: parsed.lastKnownRemoteEtag ?? null,
      };
    }
  } catch {
    // Fallback
  }
  return {
    url: '',
    username: '',
    appPassword: '',
    folder: '/TaktWerk',
    autoSync: true,
    syncIntervalSec: 20,
    pendingPush: false,
    lastSyncAt: null,
    lastSyncError: null,
    lastKnownRemoteUpdatedAt: null,
    lastKnownRemoteEtag: null,
  };
}

function writeNativeNc(cfg: StoredLocalNc): void {
  localStorage.setItem(NATIVE_NC_KEY, JSON.stringify(cfg));
}

function toPublicNc(cfg: StoredLocalNc): NextcloudConfigInfo {
  return {
    configured: Boolean(cfg.url && cfg.username && cfg.appPassword),
    url: cfg.url,
    username: cfg.username,
    folder: cfg.folder,
    autoSync: cfg.autoSync,
    syncIntervalSec: cfg.syncIntervalSec ?? 20,
    pendingPush: Boolean(cfg.pendingPush),
    hasPassword: Boolean(cfg.appPassword),
    fromEnv: false,
    lastSyncAt: cfg.lastSyncAt,
    lastSyncError: cfg.lastSyncError,
  };
}

function normalizeFolder(folder: string): string {
  const trimmed = (folder || '/TaktWerk').trim().replace(/\\/g, '/');
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '') || '/TaktWerk';
}

function buildDavRoot(cfg: StoredLocalNc): string {
  const baseUrl = cfg.url.trim().replace(/\/+$/, '').replace(/\/index\.php$/, '');
  if (
    baseUrl.includes('/remote.php/dav/files/') ||
    baseUrl.endsWith('/remote.php/webdav')
  ) {
    return baseUrl;
  }
  return `${baseUrl}/remote.php/dav/files/${encodeURIComponent(cfg.username)}`;
}

function buildWebDavFolderUrls(cfg: StoredLocalNc, subFolder?: string): string[] {
  const davRoot = buildDavRoot(cfg);
  const fullFolder = subFolder
    ? `${normalizeFolder(cfg.folder)}/${subFolder.replace(/^\/+/, '')}`
    : normalizeFolder(cfg.folder);
  const segments = fullFolder.split('/').filter(Boolean);
  const urls: string[] = [];
  let current = davRoot;
  for (const seg of segments) {
    current = `${current}/${encodeURIComponent(seg)}`;
    urls.push(current);
  }
  return urls;
}

function buildWebDavFileUrl(cfg: StoredLocalNc, relativePath: string): string {
  const davRoot = buildDavRoot(cfg);
  const fullPath = `${normalizeFolder(cfg.folder)}/${relativePath.replace(/^\/+/, '')}`;
  const encodedSegments = fullPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${davRoot}/${encodedSegments}`;
}

async function nativeProbeNextcloudDbMeta(cfg: StoredLocalNc): Promise<{
  exists: boolean;
  etag: string | null;
  lastModified: string | null;
}> {
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
    <d:getlastmodified />
  </d:prop>
</d:propfind>`;
  const res = await TaktWerkNative.caldavRequest({
    method: 'PROPFIND',
    url: fileUrl,
    username: cfg.username,
    appPassword: cfg.appPassword,
    depth: '0',
    contentType: 'application/xml; charset=utf-8',
    body: propfindBody,
  });
  if (res.status === 404) {
    return { exists: false, etag: null, lastModified: null };
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentifizierung bei Nextcloud fehlgeschlagen.');
  }
  if (res.status !== 207 && (res.status < 200 || res.status >= 300)) {
    throw new Error(`Nextcloud-Prüfung fehlgeschlagen (HTTP ${res.status}).`);
  }

  let etag: string | null = null;
  let lastModified: string | null = null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(res.body || '', 'application/xml');
    const nodes = Array.from(doc.getElementsByTagName('*'));
    const etagNode = nodes.find((n) => n.localName === 'getetag');
    const lmNode = nodes.find((n) => n.localName === 'getlastmodified');
    etag = etagNode?.textContent?.trim() || null;
    lastModified = lmNode?.textContent?.trim() || null;
  } catch {
    const etagMatch = (res.body || '').match(/<[^>]*getetag[^>]*>([^<]+)<\/[^>]*getetag>/i);
    etag = etagMatch?.[1]?.trim() || null;
  }
  return { exists: true, etag, lastModified };
}

async function nativePushNextcloud(cfg: StoredLocalNc, db: AppDatabase): Promise<string | null> {
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const folderUrls = buildWebDavFolderUrls(cfg);
  await TaktWerkNative.webdavUploadJson({
    folderUrls,
    fileUrl,
    username: cfg.username,
    appPassword: cfg.appPassword,
    json: JSON.stringify(db, null, 2),
  });
  try {
    const meta = await nativeProbeNextcloudDbMeta(cfg);
    return meta.etag;
  } catch {
    return null;
  }
}

async function nativePullNextcloudOptional(cfg: StoredLocalNc): Promise<AppDatabase | null> {
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const res = await TaktWerkNative.webdavDownloadJson({
    fileUrl,
    username: cfg.username,
    appPassword: cfg.appPassword,
  });
  if (!res.found || !res.json) return null;
  return JSON.parse(res.json) as AppDatabase;
}

export async function apiLoadDb(): Promise<{
  db: AppDatabase;
  nextcloud: NextcloudConfigInfo;
}> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/db'));
    const data = (await res.json()) as {
      db?: AppDatabase;
      nextcloud?: NextcloudConfigInfo;
      error?: string;
    };
    if (!res.ok || !data.db || !data.nextcloud) {
      throw new Error(data.error || 'Datenbank konnte nicht geladen werden.');
    }
    return { db: normalizeDatabase(data.db), nextcloud: data.nextcloud };
  }

  return {
    db: normalizeDatabase(readNativeDb()),
    nextcloud: toPublicNc(readNativeNc()),
  };
}

export async function apiSaveDb(nextDb: AppDatabase): Promise<{
  db: AppDatabase;
  nextcloud: NextcloudConfigInfo;
  syncWarning: string | null;
  mergedRemoteChanges?: boolean;
}> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/db'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextDb),
    });
    const data = (await res.json()) as {
      db?: AppDatabase;
      nextcloud?: NextcloudConfigInfo;
      syncWarning?: string | null;
      mergedRemoteChanges?: boolean;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Speichern fehlgeschlagen.');
    }
    return {
      db: data.db ? normalizeDatabase(data.db) : nextDb,
      nextcloud: data.nextcloud ?? toPublicNc(readNativeNc()),
      syncWarning: data.syncWarning ?? null,
      mergedRemoteChanges: Boolean(data.mergedRemoteChanges),
    };
  }

  const updated: AppDatabase = {
    ...nextDb,
    updatedAt: nextDb.updatedAt || new Date().toISOString(),
  };
  writeNativeDb(updated);
  const ncCfg = readNativeNc();
  let syncWarning: string | null = null;
  let finalDb: AppDatabase = updated;
  let mergedRemoteChanges = false;

  if (ncCfg.url && ncCfg.username && ncCfg.appPassword && ncCfg.autoSync) {
    try {
      const meta = await nativeProbeNextcloudDbMeta(ncCfg);
      const remoteChangedSinceLastSync =
        meta.exists &&
        (!ncCfg.lastKnownRemoteEtag ||
          !meta.etag ||
          meta.etag !== ncCfg.lastKnownRemoteEtag);

      if (remoteChangedSinceLastSync) {
        const remoteDbRaw = await nativePullNextcloudOptional(ncCfg);
        if (remoteDbRaw) {
          const mergeRes = mergeDatabases(
            normalizeDatabase(updated),
            normalizeDatabase(remoteDbRaw)
          );
          finalDb = mergeRes.merged;
          mergedRemoteChanges = mergeRes.localChanged;
          if (mergedRemoteChanges) {
            writeNativeDb(finalDb);
          }
        }
      }

      const newEtag = await nativePushNextcloud(ncCfg, finalDb);
      ncCfg.lastSyncAt = new Date().toISOString();
      ncCfg.lastKnownRemoteUpdatedAt = finalDb.updatedAt;
      if (newEtag) ncCfg.lastKnownRemoteEtag = newEtag;
      ncCfg.pendingPush = false;
      ncCfg.lastSyncError = null;
      writeNativeNc(ncCfg);
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : 'Nextcloud-Sync fehlgeschlagen.';
      ncCfg.pendingPush = true;
      ncCfg.lastSyncError = syncWarning;
      writeNativeNc(ncCfg);
    }
  }
  return {
    db: finalDb,
    nextcloud: toPublicNc(ncCfg),
    syncWarning,
    mergedRemoteChanges,
  };
}

export async function apiCheckNextcloudRemote(): Promise<{
  hasNewerRemote: boolean;
  remoteUpdatedAt: string | null;
}> {
  try {
    if (shouldUseRemoteServer()) {
      const res = await fetch(apiUrl('/api/nextcloud/check'));
      if (!res.ok) return { hasNewerRemote: false, remoteUpdatedAt: null };
      return (await res.json()) as {
        hasNewerRemote: boolean;
        remoteUpdatedAt: string | null;
      };
    }

    const cfg = readNativeNc();
    if (!cfg.url || !cfg.username || !cfg.appPassword) {
      return { hasNewerRemote: false, remoteUpdatedAt: null };
    }
    const localDb = readNativeDb();
    const remoteDb = await nativePullNextcloudOptional(cfg);
    if (!remoteDb?.updatedAt) {
      return { hasNewerRemote: false, remoteUpdatedAt: null };
    }
    const remoteMs = new Date(remoteDb.updatedAt).getTime();
    const localMs = new Date(localDb.updatedAt).getTime();
    const knownMs = cfg.lastKnownRemoteUpdatedAt
      ? new Date(cfg.lastKnownRemoteUpdatedAt).getTime()
      : 0;
    return {
      hasNewerRemote:
        Number.isFinite(remoteMs) &&
        remoteMs > knownMs + 1000 &&
        remoteMs > localMs + 1000,
      remoteUpdatedAt: remoteDb.updatedAt,
    };
  } catch {
    return { hasNewerRemote: false, remoteUpdatedAt: null };
  }
}

export async function apiTestNextcloud(payload: {
  url: string;
  username: string;
  appPassword: string;
  folder: string;
}): Promise<{ ok: boolean; message: string }> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/test'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Verbindungstest fehlgeschlagen.');
    }
    return { ok: true, message: data.message || 'Verbindung erfolgreich.' };
  }

  const existing = readNativeNc();
  const cfg: StoredLocalNc = {
    url: payload.url.trim().replace(/\/+$/, '') || existing.url,
    username: payload.username.trim() || existing.username,
    appPassword: payload.appPassword.trim() || existing.appPassword,
    folder: normalizeFolder(payload.folder || existing.folder),
    autoSync: existing.autoSync,
    syncIntervalSec: existing.syncIntervalSec ?? 20,
    pendingPush: existing.pendingPush,
    lastSyncAt: existing.lastSyncAt,
    lastSyncError: null,
    lastKnownRemoteUpdatedAt: existing.lastKnownRemoteUpdatedAt,
    lastKnownRemoteEtag: existing.lastKnownRemoteEtag,
  };
  if (!cfg.url || !cfg.username || !cfg.appPassword) {
    throw new Error('Bitte Server-URL, Benutzername und App-Passwort angeben.');
  }
  const folderUrls = buildWebDavFolderUrls(cfg, 'Rechnungen');
  await TaktWerkNative.webdavEnsureFolders({
    folderUrls,
    username: cfg.username,
    appPassword: cfg.appPassword,
  });
  return {
    ok: true,
    message: `Verbindung zu Nextcloud erfolgreich. Ordner "${cfg.folder}/Rechnungen" ist bereit.`,
  };
}

export async function apiSaveNextcloudConfig(payload: {
  url: string;
  username: string;
  appPassword: string;
  folder: string;
  autoSync: boolean;
  syncIntervalSec?: number;
}): Promise<NextcloudConfigInfo> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { nextcloud?: NextcloudConfigInfo; error?: string };
    if (!res.ok || !data.nextcloud) {
      throw new Error(data.error || 'Speichern fehlgeschlagen.');
    }
    return data.nextcloud;
  }

  const existing = readNativeNc();
  const nextUrl = payload.url.trim().replace(/\/+$/, '') || existing.url;
  const nextUser = payload.username.trim() || existing.username;
  const nextFolder = normalizeFolder(payload.folder || existing.folder);
  const targetChanged =
    nextUrl !== existing.url || nextUser !== existing.username || nextFolder !== existing.folder;

  const updated: StoredLocalNc = {
    url: nextUrl,
    username: nextUser,
    appPassword: payload.appPassword.trim() || existing.appPassword,
    folder: nextFolder,
    autoSync: payload.autoSync,
    syncIntervalSec:
      typeof payload.syncIntervalSec === 'number'
        ? Math.max(0, Math.min(3600, Math.round(payload.syncIntervalSec)))
        : existing.syncIntervalSec ?? 20,
    pendingPush: targetChanged ? false : existing.pendingPush,
    lastSyncAt: existing.lastSyncAt,
    lastSyncError: null,
    lastKnownRemoteUpdatedAt: targetChanged ? null : existing.lastKnownRemoteUpdatedAt,
    lastKnownRemoteEtag: targetChanged ? null : existing.lastKnownRemoteEtag,
  };
  writeNativeNc(updated);
  return toPublicNc(updated);
}

export async function apiClearNextcloudConfig(): Promise<NextcloudConfigInfo> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    });
    const data = (await res.json()) as { nextcloud?: NextcloudConfigInfo };
    if (!data.nextcloud) {
      throw new Error('Verbindung konnte nicht getrennt werden.');
    }
    return data.nextcloud;
  }

  const empty: StoredLocalNc = {
    url: '',
    username: '',
    appPassword: '',
    folder: '/TaktWerk',
    autoSync: true,
    syncIntervalSec: 20,
    pendingPush: false,
    lastSyncAt: null,
    lastSyncError: null,
    lastKnownRemoteUpdatedAt: null,
    lastKnownRemoteEtag: null,
  };
  writeNativeNc(empty);
  return toPublicNc(empty);
}

export interface AutoSyncResult {
  status: 'unconfigured' | 'up-to-date' | 'synced';
  localChanged: boolean;
  pushed: boolean;
  summary: string;
  db?: AppDatabase;
  nextcloud: NextcloudConfigInfo;
}

export async function apiAutoSyncNextcloud(options?: {
  force?: boolean;
  silent?: boolean;
}): Promise<AutoSyncResult> {
  const force = Boolean(options?.force);
  const silent = Boolean(options?.silent);

  const execute = async (
    update?: (pct: number, detail?: string) => void
  ): Promise<AutoSyncResult> => {
    update?.(20, 'Prüfe Datenstand auf Nextcloud…');

    if (shouldUseRemoteServer()) {
      const res = await fetch(apiUrl('/api/nextcloud/auto-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: force ? 'force' : 'poll' }),
      });
      update?.(80, 'Verarbeite Änderungen…');
      const data = (await res.json()) as {
        status?: 'unconfigured' | 'up-to-date' | 'synced';
        localChanged?: boolean;
        pushed?: boolean;
        summary?: string;
        db?: AppDatabase;
        nextcloud?: NextcloudConfigInfo;
        error?: string;
      };
      if (!res.ok || !data.nextcloud) {
        throw new Error(data.error || 'Automatische Synchronisation fehlgeschlagen.');
      }
      update?.(100, data.summary || 'Synchronisiert');
      return {
        status: data.status ?? 'synced',
        localChanged: Boolean(data.localChanged),
        pushed: Boolean(data.pushed),
        summary: data.summary ?? '',
        db: data.db ? normalizeDatabase(data.db) : undefined,
        nextcloud: data.nextcloud,
      };
    }

    const cfg = readNativeNc();
    if (!cfg.url || !cfg.username || !cfg.appPassword) {
      return {
        status: 'unconfigured',
        localChanged: false,
        pushed: false,
        summary: '',
        nextcloud: toPublicNc(cfg),
      };
    }

    // Fast 0-byte ETag probe during background polling on Android
    const meta = await nativeProbeNextcloudDbMeta(cfg);
    if (!force && !cfg.pendingPush && cfg.lastKnownRemoteEtag && meta.exists && meta.etag) {
      if (meta.etag === cfg.lastKnownRemoteEtag) {
        update?.(100, 'Bereits aktuell');
        return {
          status: 'up-to-date',
          localChanged: false,
          pushed: false,
          summary: 'Bereits aktuell',
          nextcloud: toPublicNc(cfg),
        };
      }
    }

    const localDb = normalizeDatabase(readNativeDb());
    if (!meta.exists) {
      update?.(65, 'Erstupload nach Nextcloud…');
      const newEtag = await nativePushNextcloud(cfg, localDb);
      cfg.lastSyncAt = new Date().toISOString();
      cfg.lastKnownRemoteUpdatedAt = localDb.updatedAt;
      if (newEtag) cfg.lastKnownRemoteEtag = newEtag;
      cfg.pendingPush = false;
      cfg.lastSyncError = null;
      writeNativeNc(cfg);
      update?.(100, 'Abgeschlossen');
      return {
        status: 'synced',
        localChanged: false,
        pushed: true,
        summary: 'Erstupload abgeschlossen',
        db: localDb,
        nextcloud: toPublicNc(cfg),
      };
    }

    update?.(50, 'Lade Änderungen von Nextcloud…');
    const remoteDbRaw = await nativePullNextcloudOptional(cfg);
    if (!remoteDbRaw) {
      update?.(100, 'Bereits aktuell');
      return {
        status: 'up-to-date',
        localChanged: false,
        pushed: false,
        summary: 'Bereits aktuell',
        nextcloud: toPublicNc(cfg),
      };
    }

    update?.(70, 'Führe Geräte-Änderungen zusammen…');
    const mergeRes = mergeDatabases(localDb, normalizeDatabase(remoteDbRaw));
    if (mergeRes.localChanged) {
      writeNativeDb(mergeRes.merged);
    }

    let pushed = false;
    let finalEtag = meta.etag;
    if (mergeRes.remoteNeedsPush || cfg.pendingPush) {
      update?.(85, 'Übertrage lokale Änderungen…');
      finalEtag = (await nativePushNextcloud(cfg, mergeRes.merged)) ?? meta.etag;
      pushed = true;
    }

    cfg.lastSyncAt = new Date().toISOString();
    cfg.lastKnownRemoteUpdatedAt = mergeRes.merged.updatedAt;
    if (finalEtag) cfg.lastKnownRemoteEtag = finalEtag;
    cfg.pendingPush = false;
    cfg.lastSyncError = null;
    writeNativeNc(cfg);

    update?.(100, mergeRes.summary || 'Synchronisiert');
    return {
      status: 'synced',
      localChanged: mergeRes.localChanged,
      pushed,
      summary: mergeRes.summary,
      db: mergeRes.merged,
      nextcloud: toPublicNc(cfg),
    };
  };

  if (silent) {
    return execute();
  }
  return trackActivity('Synchronisiere Geräte mit Nextcloud…', (update) => execute(update), 15);
}

export async function apiExportSyncPairingCode(
  calendarConfig?: NextcloudCalendarConfig
): Promise<string> {
  let creds: {
    url: string;
    username: string;
    appPassword: string;
    folder: string;
    autoSync: boolean;
    syncIntervalSec?: number;
  };

  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/pairing-code'));
    const data = (await res.json()) as {
      url?: string;
      username?: string;
      appPassword?: string;
      folder?: string;
      autoSync?: boolean;
      syncIntervalSec?: number;
      error?: string;
    };
    if (!res.ok || !data.url || !data.username || !data.appPassword) {
      throw new Error(data.error || 'Nextcloud ist noch nicht verbunden.');
    }
    creds = {
      url: data.url,
      username: data.username,
      appPassword: data.appPassword,
      folder: data.folder || '/TaktWerk',
      autoSync: data.autoSync !== false,
      syncIntervalSec: data.syncIntervalSec ?? 20,
    };
  } else {
    const cfg = readNativeNc();
    if (!cfg.url || !cfg.username || !cfg.appPassword) {
      throw new Error('Nextcloud ist noch nicht verbunden.');
    }
    creds = {
      url: cfg.url,
      username: cfg.username,
      appPassword: cfg.appPassword,
      folder: cfg.folder,
      autoSync: cfg.autoSync,
      syncIntervalSec: cfg.syncIntervalSec ?? 20,
    };
  }

  const payload: SyncPairingPayload = {
    v: 1,
    url: creds.url,
    username: creds.username,
    appPassword: creds.appPassword,
    folder: creds.folder,
    autoSync: true,
    syncIntervalSec: creds.syncIntervalSec ?? 20,
    calendarUrl: calendarConfig?.selectedCalendarUrl || undefined,
    calendarName: calendarConfig?.selectedCalendarName || undefined,
    autoSyncTimeEntries: Boolean(calendarConfig?.autoSyncTimeEntries),
  };
  return encodeSyncPairingCode(payload);
}

export async function apiApplySyncPairingCode(rawCode: string): Promise<{
  payload: SyncPairingPayload;
  syncResult: AutoSyncResult;
}> {
  const payload = decodeSyncPairingCode(rawCode);
  return trackActivity(
    'Kopple Gerät & synchronisiere Daten…',
    async (update) => {
      update(20, 'Prüfe Nextcloud-Verbindung…');
      await apiTestNextcloud({
        url: payload.url,
        username: payload.username,
        appPassword: payload.appPassword,
        folder: payload.folder,
      });

      update(45, 'Speichere Verbindung & Auto-Sync…');
      await apiSaveNextcloudConfig({
        url: payload.url,
        username: payload.username,
        appPassword: payload.appPassword,
        folder: payload.folder,
        autoSync: true,
        syncIntervalSec: payload.syncIntervalSec ?? 20,
      });

      update(70, 'Lade gemeinsamen Datenstand…');
      const syncResult = await apiAutoSyncNextcloud({ force: true, silent: true });
      update(100, 'Gerät erfolgreich gekoppelt');
      return { payload, syncResult };
    },
    10
  );
}

export async function apiSyncNextcloud(
  direction: 'push' | 'pull',
  force = false
): Promise<{
  db?: AppDatabase;
  nextcloud: NextcloudConfigInfo;
}> {
  const label =
    direction === 'push'
      ? 'Datenbank wird auf Nextcloud hochgeladen…'
      : 'Datenbank wird von Nextcloud geladen…';

  return trackActivity(
    label,
    async (update) => {
      update(20, 'Verbindung zu Nextcloud…');
      if (shouldUseRemoteServer()) {
        update(45, direction === 'push' ? 'Übertrage Datenstand…' : 'Lade Datenstand…');
        const res = await fetch(apiUrl('/api/nextcloud/sync'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction, force }),
        });
        update(80, 'Verarbeite Antwort…');
        const data = (await res.json()) as {
          db?: AppDatabase;
          nextcloud?: NextcloudConfigInfo;
          conflict?: boolean;
          remoteUpdatedAt?: string;
          error?: string;
        };
        if (res.status === 409 && data.conflict && data.remoteUpdatedAt) {
          throw new NextcloudConflictError(
            data.error || 'Konflikt mit neueren Nextcloud-Daten.',
            data.remoteUpdatedAt
          );
        }
        if (!res.ok || !data.nextcloud) {
          throw new Error(data.error || 'Nextcloud-Synchronisation fehlgeschlagen.');
        }
        update(100, 'Abgeschlossen');
        return { db: data.db ? normalizeDatabase(data.db) : undefined, nextcloud: data.nextcloud };
      }

      const cfg = readNativeNc();
      if (!cfg.url || !cfg.username || !cfg.appPassword) {
        throw new Error('Nextcloud ist noch nicht konfiguriert.');
      }

      if (direction === 'pull') {
        update(50, 'Lade taktwerk-db.json via WebDAV…');
        const meta = await nativeProbeNextcloudDbMeta(cfg).catch(() => ({
          exists: true,
          etag: null,
          lastModified: null,
        }));
        const remoteDb = await nativePullNextcloudOptional(cfg);
        if (!remoteDb) {
          throw new Error(`Keine Datei "${cfg.folder}/taktwerk-db.json" in Nextcloud gefunden.`);
        }
        update(85, 'Speichere lokal…');
        const normalized = normalizeDatabase(remoteDb);
        writeNativeDb(normalized);
        cfg.lastSyncAt = new Date().toISOString();
        cfg.lastKnownRemoteUpdatedAt = normalized.updatedAt || cfg.lastSyncAt;
        if (meta.etag) cfg.lastKnownRemoteEtag = meta.etag;
        cfg.pendingPush = false;
        cfg.lastSyncError = null;
        writeNativeNc(cfg);
        update(100, 'Fertig');
        return { db: normalized, nextcloud: toPublicNc(cfg) };
      }

      const localDb = readNativeDb();
      if (!force) {
        update(40, 'Prüfe Remote-Stand auf Konflikte…');
        const remoteDb = await nativePullNextcloudOptional(cfg).catch(() => null);
        if (remoteDb?.updatedAt) {
          const remoteMs = new Date(remoteDb.updatedAt).getTime();
          const knownMs = cfg.lastKnownRemoteUpdatedAt
            ? new Date(cfg.lastKnownRemoteUpdatedAt).getTime()
            : 0;
          const localMs = new Date(localDb.updatedAt).getTime();
          if (Number.isFinite(remoteMs) && remoteMs > knownMs + 1000 && remoteMs > localMs + 1000) {
            throw new NextcloudConflictError(
              'Auf Nextcloud liegt bereits ein neuerer Stand von einem anderen Gerät. Bitte zuerst "Von Nextcloud laden" oder das Überschreiben bestätigen.',
              remoteDb.updatedAt
            );
          }
        }
      }

      update(70, 'Lade taktwerk-db.json via WebDAV hoch…');
      const newEtag = await nativePushNextcloud(cfg, localDb);
      cfg.lastSyncAt = new Date().toISOString();
      cfg.lastKnownRemoteUpdatedAt = localDb.updatedAt;
      if (newEtag) cfg.lastKnownRemoteEtag = newEtag;
      cfg.pendingPush = false;
      cfg.lastSyncError = null;
      writeNativeNc(cfg);
      update(100, 'Fertig');
      return { db: localDb, nextcloud: toPublicNc(cfg) };
    },
    10
  );
}

export async function apiUploadInvoicePdf(
  filename: string,
  pdfBase64: string
): Promise<{ path: string; uploadedAt: string }> {
  return trackActivity(
    'PDF wird auf Nextcloud hochgeladen…',
    async (update) => {
      update(30, filename);
      if (shouldUseRemoteServer()) {
        const res = await fetch(apiUrl('/api/nextcloud/upload-invoice'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, pdfBase64 }),
        });
        update(85, 'Prüfe Bestätigung…');
        const data = (await res.json()) as {
          ok?: boolean;
          path?: string;
          uploadedAt?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Upload fehlgeschlagen.');
        }
        update(100, 'Hochgeladen');
        return {
          path: data.path || filename,
          uploadedAt: data.uploadedAt || new Date().toISOString(),
        };
      }

      const cfg = readNativeNc();
      if (!cfg.url || !cfg.username || !cfg.appPassword) {
        throw new Error('Nextcloud ist nicht konfiguriert.');
      }
      const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const folderUrls = buildWebDavFolderUrls(cfg, 'Rechnungen');
      const fileUrl = buildWebDavFileUrl(cfg, `Rechnungen/${safeFilename}`);
      update(60, `${cfg.folder}/Rechnungen/${safeFilename}`);
      await TaktWerkNative.webdavUploadPdf({
        folderUrls,
        fileUrl,
        username: cfg.username,
        appPassword: cfg.appPassword,
        base64: pdfBase64,
      });
      update(100, 'Hochgeladen');
      return {
        path: `${cfg.folder}/Rechnungen/${safeFilename}`,
        uploadedAt: new Date().toISOString(),
      };
    },
    15,
    filename
  );
}

export async function apiUploadInvoiceTextFile(
  filename: string,
  content: string,
  contentType = 'application/xml; charset=utf-8'
): Promise<{ path: string; uploadedAt: string }> {
  return trackActivity(
    'Datei wird auf Nextcloud hochgeladen…',
    async (update) => {
      update(30, filename);
      if (shouldUseRemoteServer()) {
        const res = await fetch(apiUrl('/api/nextcloud/upload-file'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, content, contentType }),
        });
        update(85, 'Prüfe Bestätigung…');
        const data = (await res.json()) as {
          ok?: boolean;
          path?: string;
          uploadedAt?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Datei-Upload fehlgeschlagen.');
        }
        update(100, 'Hochgeladen');
        return {
          path: data.path || filename,
          uploadedAt: data.uploadedAt || new Date().toISOString(),
        };
      }

      const cfg = readNativeNc();
      if (!cfg.url || !cfg.username || !cfg.appPassword) {
        throw new Error('Nextcloud ist nicht konfiguriert.');
      }
      const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const folderUrls = buildWebDavFolderUrls(cfg, 'Rechnungen');
      const fileUrl = buildWebDavFileUrl(cfg, `Rechnungen/${safeFilename}`);
      update(60, `${cfg.folder}/Rechnungen/${safeFilename}`);
      await TaktWerkNative.webdavUploadFile({
        folderUrls,
        fileUrl,
        username: cfg.username,
        appPassword: cfg.appPassword,
        contentType,
        content,
      });
      update(100, 'Hochgeladen');
      return {
        path: `${cfg.folder}/Rechnungen/${safeFilename}`,
        uploadedAt: new Date().toISOString(),
      };
    },
    15,
    filename
  );
}

export async function apiDeleteNextcloudInvoiceFiles(
  invoiceNumber: string
): Promise<{ deletedCount: number }> {
  const cleaned = invoiceNumber.trim();
  if (!cleaned) return { deletedCount: 0 };

  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/delete-invoice-files'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNumber: cleaned }),
    });
    const data = (await res.json()) as { deletedCount?: number; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Nextcloud-Dateien konnten nicht gelöscht werden.');
    }
    return { deletedCount: data.deletedCount ?? 0 };
  }

  const cfg = readNativeNc();
  if (!cfg.url || !cfg.username || !cfg.appPassword) {
    return { deletedCount: 0 };
  }
  const safeBase = cleaned.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const fileUrls = [
    buildWebDavFileUrl(cfg, `Rechnungen/${safeBase}.pdf`),
    buildWebDavFileUrl(cfg, `Rechnungen/XRechnung-${safeBase}.xml`),
    buildWebDavFileUrl(cfg, `Rechnungen/Abnahme-${safeBase}.pdf`),
  ];
  return TaktWerkNative.webdavDeleteFiles({
    fileUrls,
    username: cfg.username,
    appPassword: cfg.appPassword,
  });
}

export interface ScannedReceiptResult {
  vendor: string;
  date: string;
  description: string;
  category: string;
  netAmount: number;
  grossAmount: number;
  taxRate: 19 | 7 | 0;
  notes: string;
}

export async function apiScanReceiptWithAi(imageDataUrl: string): Promise<ScannedReceiptResult> {
  if (!shouldUseRemoteServer()) {
    throw new Error(
      'Für den KI-Belegscanner bitte in "Nextcloud & Setup" eine Server-URL verbinden oder Belegdaten manuell eingeben.'
    );
  }
  return trackActivity(
    'Beleg wird analysiert…',
    async (update) => {
      update(25, 'Belegbild wird übertragen…');
      const match = /^data:([^;]+);base64,(.+)$/.exec(imageDataUrl);
      const mimeType = match?.[1] || 'image/jpeg';
      const imageBase64 = match?.[2] || imageDataUrl;

      const res = await fetch(apiUrl('/api/receipts/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      update(85, 'Werte Beträge & Datum aus…');
      const data = (await res.json()) as Partial<ScannedReceiptResult> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'KI-Belegauswertung fehlgeschlagen.');
      }
      update(100, 'Beleg erkannt');
      return {
        vendor: data.vendor || '',
        date: data.date || new Date().toISOString().slice(0, 10),
        description: data.description || '',
        category: data.category || 'Sonstiges',
        netAmount: typeof data.netAmount === 'number' ? data.netAmount : 0,
        grossAmount: typeof data.grossAmount === 'number' ? data.grossAmount : 0,
        taxRate: data.taxRate === 7 || data.taxRate === 0 ? data.taxRate : 19,
        notes: data.notes || '',
      };
    },
    15
  );
}

export function triggerNfcHaptic(pattern: 'start' | 'stop' | 'error'): void {
  if (isNativeCapacitor()) {
    void TaktWerkNative.hapticFeedback({ pattern }).catch(() => {});
    return;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    if (pattern === 'stop') {
      navigator.vibrate([60, 70, 60]);
    } else if (pattern === 'error') {
      navigator.vibrate([40, 50, 40, 50, 40]);
    } else {
      navigator.vibrate(80);
    }
  }
}

export async function getNativeNotificationStatus(): Promise<NativeNotificationStatus | null> {
  if (!isNativeCapacitor()) return null;
  try {
    return await TaktWerkNative.getNotificationStatus();
  } catch {
    return null;
  }
}

export async function requestNativeNotificationPermission(): Promise<NativeNotificationStatus | null> {
  if (!isNativeCapacitor()) return null;
  try {
    return await TaktWerkNative.requestNotificationPermission();
  } catch {
    return null;
  }
}

export async function openNativeNotificationSettings(): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    await TaktWerkNative.openNotificationSettings();
  } catch {
    // Ignore error
  }
}

export async function syncActiveTimerNotification(
  timer: ActiveTimer | null,
  customerName: string
): Promise<NativeNotificationStatus | null> {
  if (!isNativeCapacitor()) return null;
  if (!timer) {
    void TaktWerkNative.clearActiveTimerNotification().catch(() => {});
    return null;
  }
  const elapsedMs = getActiveTimerElapsedMs(timer);
  const adjustedStartMs = Date.now() - elapsedMs;
  try {
    return await TaktWerkNative.showActiveTimerNotification({
      title: timer.title,
      customer: customerName,
      notes: timer.notes,
      startTimeMs: adjustedStartMs,
      isPaused: Boolean(timer.pausedAt),
      pausedDuration: timer.pausedAt
        ? formatDuration(Math.floor(elapsedMs / 1000))
        : undefined,
    });
  } catch {
    return null;
  }
}

export async function apiUploadNextcloudFile(options: {
  subFolder?: string;
  filename: string;
  contentOrBase64: string;
  isBinary: boolean;
  contentType: string;
  silentProgress?: boolean;
}): Promise<{ path: string; uploadedAt: string }> {
  const subFolder = options.subFolder || 'Backups';
  const runUpload = async (
    update?: (progress: number | null, detail?: string) => void
  ): Promise<{ path: string; uploadedAt: string }> => {
    update?.(30, `${subFolder}/${options.filename}`);
    if (shouldUseRemoteServer()) {
      const res = await fetch(apiUrl('/api/nextcloud/upload-backup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subFolder,
          filename: options.filename,
          contentOrBase64: options.contentOrBase64,
          isBinary: options.isBinary,
          contentType: options.contentType,
        }),
      });
      update?.(85, 'Prüfe Server-Antwort…');
      const data = (await res.json()) as {
        ok?: boolean;
        path?: string;
        uploadedAt?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Backup-Upload fehlgeschlagen.');
      }
      update?.(100, 'Hochgeladen');
      return {
        path: data.path || `${subFolder}/${options.filename}`,
        uploadedAt: data.uploadedAt || new Date().toISOString(),
      };
    }

    const cfg = readNativeNc();
    if (!cfg.url || !cfg.username || !cfg.appPassword) {
      throw new Error('Nextcloud ist nicht konfiguriert.');
    }
    const safeFilename = options.filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const folderUrls = buildWebDavFolderUrls(cfg, subFolder);
    const fileUrl = buildWebDavFileUrl(cfg, `${subFolder}/${safeFilename}`);
    update?.(60, `${cfg.folder}/${subFolder}/${safeFilename}`);
    if (options.isBinary) {
      await TaktWerkNative.webdavUploadBinary({
        folderUrls,
        fileUrl,
        username: cfg.username,
        appPassword: cfg.appPassword,
        contentType: options.contentType,
        base64: options.contentOrBase64,
      });
    } else {
      await TaktWerkNative.webdavUploadFile({
        folderUrls,
        fileUrl,
        username: cfg.username,
        appPassword: cfg.appPassword,
        contentType: options.contentType,
        content: options.contentOrBase64,
      });
    }
    update?.(100, 'Hochgeladen');
    return {
      path: `${cfg.folder}/${subFolder}/${safeFilename}`,
      uploadedAt: new Date().toISOString(),
    };
  };

  if (options.silentProgress) {
    return runUpload();
  }
  return trackActivity(
    'Datei wird auf Nextcloud hochgeladen…',
    (update) => runUpload(update),
    15,
    options.filename
  );
}

export async function apiRunMultiFormatBackup(
  db: AppDatabase,
  formats: AutoBackupFormat[],
  options: { uploadToNextcloud: boolean; localDownload: boolean }
): Promise<{ uploadedCount: number; downloadedCount: number; summary: string }> {
  return trackActivity(
    'Multi-Format-Backup wird erstellt…',
    async (update) => {
      update(10, 'Erzeuge Exportdateien…');
      const artifacts = await generateBackupArtifacts(db, formats);
      let uploadedCount = 0;
      let downloadedCount = 0;
      const errors: string[] = [];

      const totalSteps =
        artifacts.length *
        ((options.uploadToNextcloud ? 1 : 0) + (options.localDownload ? 1 : 0));
      let completedSteps = 0;
      const advanceStep = (detail: string, nextLabel?: string) => {
        completedSteps += 1;
        const pct =
          totalSteps > 0 ? Math.min(98, 15 + Math.round((completedSteps / totalSteps) * 82)) : 95;
        update(pct, detail, nextLabel);
      };

      for (let i = 0; i < artifacts.length; i += 1) {
        const file = artifacts[i];
        if (options.uploadToNextcloud) {
          update(
            totalSteps > 0 ? Math.min(95, 15 + Math.round((completedSteps / totalSteps) * 82)) : 40,
            `Datei ${i + 1}/${artifacts.length}: ${file.filename}`,
            'Backup wird auf Nextcloud hochgeladen…'
          );
          try {
            await apiUploadNextcloudFile({
              subFolder: 'Backups',
              filename: file.filename,
              contentOrBase64: file.data,
              isBinary: file.isBinary,
              contentType: file.mimeType,
              silentProgress: true,
            });
            uploadedCount += 1;
          } catch (err) {
            errors.push(
              `${file.filename}: ${err instanceof Error ? err.message : 'Upload fehlgeschlagen'}`
            );
          }
          advanceStep(`Hochgeladen: ${file.filename}`);
        }
        if (options.localDownload) {
          if (file.isBinary) {
            await downloadOrShareBinaryFile(file.filename, file.data, file.mimeType);
          } else {
            await downloadOrShareTextFile(file.filename, file.data, file.mimeType);
          }
          downloadedCount += 1;
          advanceStep(`Lokal gesichert: ${file.filename}`, 'Backup wird gespeichert…');
        }
      }

      if (options.uploadToNextcloud && uploadedCount === 0 && errors.length > 0) {
        throw new Error(errors[0]);
      }

      update(100, 'Backup abgeschlossen');
      const parts: string[] = [];
      if (uploadedCount > 0) parts.push(`${uploadedCount} Datei(en) nach Nextcloud/Backups`);
      if (downloadedCount > 0) parts.push(`${downloadedCount} Datei(en) lokal gesichert`);
      const summary = parts.length > 0 ? parts.join(' · ') : 'Keine Formate ausgewählt';
      return { uploadedCount, downloadedCount, summary };
    },
    5,
    `${formats.length} Format(e)`
  );
}

export async function apiDiscoverNextcloudCalendars(): Promise<DiscoveredCalendar[]> {
  return trackActivity(
    'Suche Nextcloud-Kalender…',
    async (update) => {
      update(35, 'CalDAV PROPFIND…');
      if (shouldUseRemoteServer()) {
        const res = await fetch(apiUrl('/api/nextcloud/caldav/discover'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        update(80, 'Lese Kalenderliste…');
        const data = (await res.json()) as {
          xml?: string;
          baseOrigin?: string;
          error?: string;
        };
        if (!res.ok || !data.xml) {
          throw new Error(data.error || 'Nextcloud-Kalender konnten nicht abgerufen werden.');
        }
        update(100);
        return parseCalDavCalendarsXml(data.xml, data.baseOrigin || '');
      }

      const cfg = readNativeNc();
      if (!cfg.url || !cfg.username || !cfg.appPassword) {
        throw new Error('Nextcloud ist noch nicht konfiguriert.');
      }
      const baseUrl = cfg.url.trim().replace(/\/+$/, '').replace(/\/remote\.php\/.*$/, '');
      const homeUrl = `${baseUrl}/remote.php/dav/calendars/${encodeURIComponent(cfg.username)}/`;
      const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;

      const res = await TaktWerkNative.caldavRequest({
        method: 'PROPFIND',
        url: homeUrl,
        username: cfg.username,
        appPassword: cfg.appPassword,
        depth: '1',
        contentType: 'application/xml; charset=utf-8',
        body: propfindBody,
      });
      update(85, 'Lese Kalenderliste…');
      if (res.status !== 207 && (res.status < 200 || res.status >= 300)) {
        throw new Error(`CalDAV PROPFIND fehlgeschlagen (HTTP ${res.status}).`);
      }
      const origin = new URL(baseUrl).origin;
      update(100);
      return parseCalDavCalendarsXml(res.body, origin);
    },
    15
  );
}

export async function apiFetchNextcloudCalendarEvents(
  calendarUrl: string,
  calendarName?: string
): Promise<CalendarAppointment[]> {
  return trackActivity(
    'Lade Nextcloud-Kalendertermine…',
    async (update) => {
      const startIso = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const endIso = new Date(Date.now() + 90 * 86400 * 1000).toISOString();
      update(35, calendarName || 'CalDAV-Synchronisation');

      if (shouldUseRemoteServer()) {
        const res = await fetch(apiUrl('/api/nextcloud/caldav/events'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calendarUrl, startIso, endIso }),
        });
        update(80, 'Verarbeite Termine…');
        const data = (await res.json()) as { xml?: string; error?: string };
        if (!res.ok || !data.xml) {
          throw new Error(data.error || 'Termine konnten nicht aus Nextcloud geladen werden.');
        }
        update(100);
        return parseCalDavCalendarDataXml(data.xml, calendarName);
      }

      const cfg = readNativeNc();
      if (!cfg.url || !cfg.username || !cfg.appPassword) {
        throw new Error('Nextcloud ist noch nicht konfiguriert.');
      }
      const startCompact = startIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const endCompact = endIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startCompact}" end="${endCompact}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

      const target = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
      const res = await TaktWerkNative.caldavRequest({
        method: 'REPORT',
        url: target,
        username: cfg.username,
        appPassword: cfg.appPassword,
        depth: '1',
        contentType: 'application/xml; charset=utf-8',
        body: reportBody,
      });
      update(80, 'Verarbeite Termine…');
      if (res.status !== 207 && (res.status < 200 || res.status >= 300)) {
        throw new Error(`CalDAV REPORT fehlgeschlagen (HTTP ${res.status}).`);
      }
      update(100);
      return parseCalDavCalendarDataXml(res.body, calendarName);
    },
    15
  );
}

export async function apiPushNextcloudCalendarEvent(
  calendarUrl: string,
  appointment: CalendarAppointment
): Promise<void> {
  return trackActivity(
    'Übertrage Termin in Nextcloud-Kalender…',
    async (update) => {
      const uid = appointment.uid || `${appointment.id}@taktwerk.app`;
      const icsContent = buildIcsEvent({ ...appointment, uid });
      update(40, appointment.title);

      if (shouldUseRemoteServer()) {
        const res = await fetch(apiUrl('/api/nextcloud/caldav/push'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calendarUrl, uid, icsContent }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Termin konnte nicht in Nextcloud gespeichert werden.');
        }
        update(100, 'Synchronisiert');
        return;
      }

      const cfg = readNativeNc();
      if (!cfg.url || !cfg.username || !cfg.appPassword) {
        throw new Error('Nextcloud ist noch nicht konfiguriert.');
      }
      const safeUid = uid.replace(/[^a-zA-Z0-9@._-]/g, '_');
      const eventUrl = `${calendarUrl.replace(/\/+$/, '')}/${encodeURIComponent(safeUid)}.ics`;
      const res = await TaktWerkNative.caldavRequest({
        method: 'PUT',
        url: eventUrl,
        username: cfg.username,
        appPassword: cfg.appPassword,
        contentType: 'text/calendar; charset=utf-8',
        body: icsContent,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`CalDAV PUT fehlgeschlagen (HTTP ${res.status}).`);
      }
      update(100, 'Synchronisiert');
    },
    20,
    appointment.title
  );
}

export async function playNativeReminderTone(
  preset: ReminderSoundPreset,
  systemSoundUri?: string
): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    await TaktWerkNative.playReminderTone({
      preset,
      systemSoundUri: systemSoundUri?.trim() || undefined,
    });
  } catch {
    // Ignore native tone errors
  }
}

export async function pickNativeSystemSound(options?: {
  existingUri?: string;
  ringtoneType?: 'notification' | 'alarm' | 'all';
}): Promise<{ cancelled: boolean; uri?: string; title?: string }> {
  if (!isNativeCapacitor()) {
    throw new Error('Smartphone-Systemtöne sind direkt in der Android-App verfügbar.');
  }
  return await TaktWerkNative.pickSystemNotificationSound({
    existingUri: options?.existingUri?.trim() || undefined,
    ringtoneType: options?.ringtoneType ?? 'notification',
  });
}

export async function listNativeSystemSounds(
  ringtoneType: 'notification' | 'alarm' = 'notification'
): Promise<Array<{ uri: string; title: string }>> {
  if (!isNativeCapacitor()) return [];
  try {
    const res = await TaktWerkNative.listSystemNotificationSounds({ ringtoneType });
    return Array.isArray(res?.sounds) ? res.sounds : [];
  } catch {
    return [];
  }
}

export async function scheduleNativeTimerReminder(options: {
  delayMs: number;
  title: string;
  body: string;
  soundPreset: ReminderSoundPreset;
  systemSoundUri?: string;
}): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    await TaktWerkNative.scheduleTimerReminder(options);
  } catch {
    // Ignore scheduling errors
  }
}

export async function cancelNativeTimerReminder(): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    await TaktWerkNative.cancelTimerReminder();
  } catch {
    // Ignore cancel errors
  }
}

export async function syncNativeWidgetState(db: AppDatabase): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todaySecs = db.timeEntries
      .filter((e) => e.startTime.slice(0, 10) === todayStr)
      .reduce((acc, e) => acc + e.durationSeconds, 0);
    const todayHours = (todaySecs / 3600).toFixed(1).replace('.', ',');
    const custName = db.activeTimer
      ? db.activeTimer.entryType === 'internal' || !db.activeTimer.customerId
        ? `Intern · ${db.activeTimer.internalCategory || 'Sonstiges'}`
        : db.customers.find((c) => c.id === db.activeTimer?.customerId)?.companyName ?? ''
      : '';
    const quickTasks = db.nfcTasks.slice(0, 2).map((t) => ({
      tagUid: t.tagUid,
      title: t.title,
    }));

    const elapsedMs = db.activeTimer ? getActiveTimerElapsedMs(db.activeTimer) : 0;
    await TaktWerkNative.updateWidgetState({
      isRunning: Boolean(db.activeTimer),
      isPaused: Boolean(db.activeTimer?.pausedAt),
      timerTitle: db.activeTimer?.title || '',
      customerName: custName,
      startTimeMs: db.activeTimer ? Date.now() - elapsedMs : 0,
      todayHoursLabel: `${todayHours} Std.`,
      quickTasksJson: JSON.stringify(quickTasks),
    });
  } catch {
    // Ignore widget update failures
  }
}
