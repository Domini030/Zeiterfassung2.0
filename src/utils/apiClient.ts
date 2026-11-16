import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { AppDatabase, NextcloudConfigInfo } from '../types';
import { createEmptyDatabase } from './sampleData';

const SERVER_URL_KEY = 'taktwerk-server-url';
const NATIVE_DB_KEY = 'taktwerk-native-db';
const NATIVE_NC_KEY = 'taktwerk-native-nc';

interface StoredLocalNc {
  url: string;
  username: string;
  appPassword: string;
  folder: string;
  autoSync: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
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
        lastSyncAt: parsed.lastSyncAt ?? null,
        lastSyncError: parsed.lastSyncError ?? null,
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
    lastSyncAt: null,
    lastSyncError: null,
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

function makeAuthHeader(cfg: StoredLocalNc): string {
  const bytes = new TextEncoder().encode(`${cfg.username}:${cfg.appPassword}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

function buildWebDavFileUrl(cfg: StoredLocalNc, relativePath: string): string {
  const baseUrl = cfg.url.trim().replace(/\/+$/, '');
  const davRoot = baseUrl.includes('/remote.php/dav/files/')
    ? baseUrl
    : `${baseUrl}/remote.php/dav/files/${encodeURIComponent(cfg.username)}`;
  const fullPath = `${normalizeFolder(cfg.folder)}/${relativePath.replace(/^\/+/, '')}`;
  const encodedSegments = fullPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${davRoot}/${encodedSegments}`;
}

async function nativePushNextcloud(cfg: StoredLocalNc, db: AppDatabase): Promise<void> {
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const res = await CapacitorHttp.put({
    url: fileUrl,
    headers: {
      Authorization: makeAuthHeader(cfg),
      'Content-Type': 'application/json; charset=utf-8',
    },
    data: JSON.stringify(db, null, 2),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Nextcloud-Upload fehlgeschlagen (HTTP ${res.status}). Prüfe ob der Ordner "${cfg.folder}" in Nextcloud existiert.`
    );
  }
}

async function nativePullNextcloud(cfg: StoredLocalNc): Promise<AppDatabase> {
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const res = await CapacitorHttp.get({
    url: fileUrl,
    headers: {
      Authorization: makeAuthHeader(cfg),
    },
  });
  if (res.status === 404) {
    throw new Error(`Keine Datei "${cfg.folder}/taktwerk-db.json" in Nextcloud gefunden.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentifizierung bei Nextcloud fehlgeschlagen.');
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Laden aus Nextcloud fehlgeschlagen (HTTP ${res.status}).`);
  }
  return typeof res.data === 'string' ? (JSON.parse(res.data) as AppDatabase) : (res.data as AppDatabase);
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
    return { db: data.db, nextcloud: data.nextcloud };
  }

  return {
    db: readNativeDb(),
    nextcloud: toPublicNc(readNativeNc()),
  };
}

export async function apiSaveDb(nextDb: AppDatabase): Promise<{
  db: AppDatabase;
  nextcloud: NextcloudConfigInfo;
  syncWarning: string | null;
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
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Speichern fehlgeschlagen.');
    }
    return {
      db: data.db ?? nextDb,
      nextcloud: data.nextcloud ?? toPublicNc(readNativeNc()),
      syncWarning: data.syncWarning ?? null,
    };
  }

  const updated = { ...nextDb, updatedAt: new Date().toISOString() };
  writeNativeDb(updated);
  const ncCfg = readNativeNc();
  let syncWarning: string | null = null;
  if (ncCfg.url && ncCfg.username && ncCfg.appPassword && ncCfg.autoSync) {
    try {
      await nativePushNextcloud(ncCfg, updated);
      ncCfg.lastSyncAt = new Date().toISOString();
      ncCfg.lastSyncError = null;
      writeNativeNc(ncCfg);
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : 'Nextcloud-Sync fehlgeschlagen.';
      ncCfg.lastSyncError = syncWarning;
      writeNativeNc(ncCfg);
    }
  }
  return {
    db: updated,
    nextcloud: toPublicNc(ncCfg),
    syncWarning,
  };
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
    lastSyncAt: existing.lastSyncAt,
    lastSyncError: null,
  };
  if (!cfg.url || !cfg.username || !cfg.appPassword) {
    throw new Error('Bitte Server-URL, Benutzername und App-Passwort angeben.');
  }
  const probeUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const res = await CapacitorHttp.get({
    url: probeUrl,
    headers: { Authorization: makeAuthHeader(cfg) },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentifizierung bei Nextcloud fehlgeschlagen.');
  }
  if (res.status !== 200 && res.status !== 404) {
    throw new Error(`Nextcloud-Prüfung fehlgeschlagen (HTTP ${res.status}).`);
  }
  return {
    ok: true,
    message: `Nextcloud erreichbar. Stelle sicher, dass der Ordner "${cfg.folder}" in Nextcloud angelegt ist.`,
  };
}

export async function apiSaveNextcloudConfig(payload: {
  url: string;
  username: string;
  appPassword: string;
  folder: string;
  autoSync: boolean;
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
  const updated: StoredLocalNc = {
    url: payload.url.trim().replace(/\/+$/, '') || existing.url,
    username: payload.username.trim() || existing.username,
    appPassword: payload.appPassword.trim() || existing.appPassword,
    folder: normalizeFolder(payload.folder || existing.folder),
    autoSync: payload.autoSync,
    lastSyncAt: existing.lastSyncAt,
    lastSyncError: null,
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
    lastSyncAt: null,
    lastSyncError: null,
  };
  writeNativeNc(empty);
  return toPublicNc(empty);
}

export async function apiSyncNextcloud(direction: 'push' | 'pull'): Promise<{
  db?: AppDatabase;
  nextcloud: NextcloudConfigInfo;
}> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
    const data = (await res.json()) as {
      db?: AppDatabase;
      nextcloud?: NextcloudConfigInfo;
      error?: string;
    };
    if (!res.ok || !data.nextcloud) {
      throw new Error(data.error || 'Nextcloud-Synchronisation fehlgeschlagen.');
    }
    return { db: data.db, nextcloud: data.nextcloud };
  }

  const cfg = readNativeNc();
  if (!cfg.url || !cfg.username || !cfg.appPassword) {
    throw new Error('Nextcloud ist noch nicht konfiguriert.');
  }

  if (direction === 'pull') {
    const remoteDb = await nativePullNextcloud(cfg);
    writeNativeDb(remoteDb);
    cfg.lastSyncAt = new Date().toISOString();
    cfg.lastSyncError = null;
    writeNativeNc(cfg);
    return { db: remoteDb, nextcloud: toPublicNc(cfg) };
  }

  const localDb = readNativeDb();
  await nativePushNextcloud(cfg, localDb);
  cfg.lastSyncAt = new Date().toISOString();
  cfg.lastSyncError = null;
  writeNativeNc(cfg);
  return { db: localDb, nextcloud: toPublicNc(cfg) };
}

export async function apiUploadInvoicePdf(
  filename: string,
  pdfBase64: string
): Promise<{ path: string; uploadedAt: string }> {
  if (shouldUseRemoteServer()) {
    const res = await fetch(apiUrl('/api/nextcloud/upload-invoice'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, pdfBase64 }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      path?: string;
      uploadedAt?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Upload fehlgeschlagen.');
    }
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
  const fileUrl = buildWebDavFileUrl(cfg, `Rechnungen/${safeFilename}`);
  const res = await CapacitorHttp.put({
    url: fileUrl,
    headers: {
      Authorization: makeAuthHeader(cfg),
      'Content-Type': 'application/pdf',
    },
    data: pdfBase64,
    dataType: 'file',
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `PDF-Upload fehlgeschlagen (HTTP ${res.status}). Prüfe ob der Ordner "${cfg.folder}/Rechnungen" existiert.`
    );
  }
  return {
    path: `${cfg.folder}/Rechnungen/${safeFilename}`,
    uploadedAt: new Date().toISOString(),
  };
}
