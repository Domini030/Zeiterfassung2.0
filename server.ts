import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppDatabase, NextcloudConfigInfo } from './src/types.ts';
import { createEmptyDatabase } from './src/utils/sampleData.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const NC_CONFIG_FILE = path.join(DATA_DIR, 'nextcloud-config.json');

interface StoredNextcloudConfig {
  url: string;
  username: string;
  appPassword: string;
  folder: string;
  autoSync: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastKnownRemoteUpdatedAt?: string | null;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readLocalDb(): Promise<AppDatabase> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    return JSON.parse(raw) as AppDatabase;
  } catch {
    const initial = createEmptyDatabase();
    await fs.writeFile(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
}

async function writeLocalDb(db: AppDatabase): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

async function readStoredNcConfig(): Promise<StoredNextcloudConfig & { fromEnv: boolean }> {
  const envUrl = process.env.NEXTCLOUD_URL?.trim() || '';
  const envUser = process.env.NEXTCLOUD_USERNAME?.trim() || '';
  const envPass = process.env.NEXTCLOUD_APP_PASSWORD?.trim() || '';
  const envFolder = process.env.NEXTCLOUD_FOLDER?.trim() || '/TaktWerk';

  let fileCfg: Partial<StoredNextcloudConfig> = {};
  try {
    const raw = await fs.readFile(NC_CONFIG_FILE, 'utf-8');
    fileCfg = JSON.parse(raw) as Partial<StoredNextcloudConfig>;
  } catch {
    // No saved file config yet
  }

  const useEnv = Boolean(envUrl && envUser && envPass && !fileCfg.url);

  return {
    url: fileCfg.url ?? envUrl,
    username: fileCfg.username ?? envUser,
    appPassword: fileCfg.appPassword ?? envPass,
    folder: normalizeFolder(fileCfg.folder ?? envFolder),
    autoSync: fileCfg.autoSync ?? true,
    lastSyncAt: fileCfg.lastSyncAt ?? null,
    lastSyncError: fileCfg.lastSyncError ?? null,
    lastKnownRemoteUpdatedAt: fileCfg.lastKnownRemoteUpdatedAt ?? null,
    fromEnv: useEnv,
  };
}

async function writeStoredNcConfig(cfg: StoredNextcloudConfig): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(NC_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function normalizeFolder(folder: string): string {
  const trimmed = (folder || '/TaktWerk').trim().replace(/\\/g, '/');
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const cleaned = withLeading.replace(/\/+$/, '');
  return cleaned || '/TaktWerk';
}

function validateHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Nur HTTP- oder HTTPS-URLs sind für Nextcloud zulässig.');
  }
  return trimmed;
}

function buildWebDavFileUrl(cfg: StoredNextcloudConfig, relativePath: string): string {
  const baseUrl = validateHttpUrl(cfg.url);
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

function buildWebDavFolderUrl(cfg: StoredNextcloudConfig, folderPath: string): string {
  const baseUrl = validateHttpUrl(cfg.url);
  const davRoot = baseUrl.includes('/remote.php/dav/files/')
    ? baseUrl
    : `${baseUrl}/remote.php/dav/files/${encodeURIComponent(cfg.username)}`;

  const encodedSegments = folderPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  return encodedSegments ? `${davRoot}/${encodedSegments}` : davRoot;
}

function makeAuthHeader(cfg: StoredNextcloudConfig): string {
  const token = Buffer.from(`${cfg.username}:${cfg.appPassword}`).toString('base64');
  return `Basic ${token}`;
}

async function ensureNextcloudFolderExists(
  cfg: StoredNextcloudConfig,
  folderPath: string
): Promise<void> {
  const segments = normalizeFolder(folderPath).split('/').filter(Boolean);
  let current = '';
  for (const seg of segments) {
    current += `/${seg}`;
    const targetUrl = buildWebDavFolderUrl(cfg, current);
    const propRes = await fetch(targetUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: makeAuthHeader(cfg),
        Depth: '0',
      },
    });

    if (propRes.status === 401 || propRes.status === 403) {
      throw new Error('Authentifizierung bei Nextcloud fehlgeschlagen (Benutzername oder App-Passwort prüfen).');
    }
    if (propRes.status === 404) {
      const mkRes = await fetch(targetUrl, {
        method: 'MKCOL',
        headers: {
          Authorization: makeAuthHeader(cfg),
        },
      });
      if (!mkRes.ok && mkRes.status !== 405) {
        throw new Error(`Ordner "${current}" konnte auf Nextcloud nicht erstellt werden (HTTP ${mkRes.status}).`);
      }
    } else if (!propRes.ok && propRes.status !== 207) {
      throw new Error(`Nextcloud-Ordnerprüfung fehlgeschlagen (HTTP ${propRes.status}).`);
    }
  }
}

async function pushDbToNextcloud(cfg: StoredNextcloudConfig, db: AppDatabase): Promise<void> {
  await ensureNextcloudFolderExists(cfg, cfg.folder);
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const res = await fetch(fileUrl, {
    method: 'PUT',
    headers: {
      Authorization: makeAuthHeader(cfg),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(db, null, 2),
  });
  if (!res.ok) {
    throw new Error(`Speichern in Nextcloud fehlgeschlagen (HTTP ${res.status}).`);
  }
}

async function pullDbFromNextcloud(cfg: StoredNextcloudConfig): Promise<AppDatabase | null> {
  const fileUrl = buildWebDavFileUrl(cfg, 'taktwerk-db.json');
  const res = await fetch(fileUrl, {
    method: 'GET',
    headers: {
      Authorization: makeAuthHeader(cfg),
    },
  });
  if (res.status === 404) {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Authentifizierung bei Nextcloud fehlgeschlagen.');
  }
  if (!res.ok) {
    throw new Error(`Laden aus Nextcloud fehlgeschlagen (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as AppDatabase;
  return data;
}

function toPublicNcInfo(cfg: StoredNextcloudConfig & { fromEnv: boolean }): NextcloudConfigInfo {
  return {
    configured: Boolean(cfg.url && cfg.username && cfg.appPassword),
    url: cfg.url,
    username: cfg.username,
    folder: cfg.folder,
    autoSync: cfg.autoSync,
    hasPassword: Boolean(cfg.appPassword),
    fromEnv: cfg.fromEnv,
    lastSyncAt: cfg.lastSyncAt,
    lastSyncError: cfg.lastSyncError,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Allow Capacitor native Android/iOS apps to talk to a deployed TaktWerk server
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Read full DB
  app.get('/api/db', async (_req, res) => {
    try {
      const db = await readLocalDb();
      const ncCfg = await readStoredNcConfig();
      res.json({ db, nextcloud: toPublicNcInfo(ncCfg) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Datenbank konnte nicht geladen werden.',
      });
    }
  });

  // Save full DB (+ optional auto-sync to Nextcloud WebDAV)
  app.put('/api/db', async (req, res) => {
    try {
      const incoming = req.body as AppDatabase;
      if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.customers)) {
        res.status(400).json({ error: 'Ungültiges Datenbankformat.' });
        return;
      }
      incoming.updatedAt = new Date().toISOString();
      await writeLocalDb(incoming);

      const ncCfg = await readStoredNcConfig();
      let syncWarning: string | null = null;
      if (ncCfg.url && ncCfg.username && ncCfg.appPassword && ncCfg.autoSync) {
        try {
          await pushDbToNextcloud(ncCfg, incoming);
          ncCfg.lastSyncAt = new Date().toISOString();
          ncCfg.lastKnownRemoteUpdatedAt = incoming.updatedAt;
          ncCfg.lastSyncError = null;
          await writeStoredNcConfig(ncCfg);
        } catch (syncErr) {
          syncWarning =
            syncErr instanceof Error ? syncErr.message : 'Nextcloud-Synchronisation fehlgeschlagen.';
          ncCfg.lastSyncError = syncWarning;
          await writeStoredNcConfig(ncCfg);
        }
      }

      res.json({
        db: incoming,
        nextcloud: toPublicNcInfo(ncCfg),
        syncWarning,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Datenbank konnte nicht gespeichert werden.',
      });
    }
  });

  // Get Nextcloud config (without password)
  app.get('/api/nextcloud/config', async (_req, res) => {
    try {
      const ncCfg = await readStoredNcConfig();
      res.json({ nextcloud: toPublicNcInfo(ncCfg) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Konfiguration konnte nicht gelesen werden.',
      });
    }
  });

  // Save Nextcloud config
  app.post('/api/nextcloud/config', async (req, res) => {
    try {
      const body = req.body as {
        url?: string;
        username?: string;
        appPassword?: string;
        folder?: string;
        autoSync?: boolean;
        clear?: boolean;
      };

      if (body.clear) {
        const empty: StoredNextcloudConfig = {
          url: '',
          username: '',
          appPassword: '',
          folder: '/TaktWerk',
          autoSync: true,
          lastSyncAt: null,
          lastSyncError: null,
        };
        await writeStoredNcConfig(empty);
        res.json({ nextcloud: toPublicNcInfo({ ...empty, fromEnv: false }) });
        return;
      }

      const existing = await readStoredNcConfig();
      const url = body.url ? validateHttpUrl(body.url) : existing.url;
      const username = (body.username ?? existing.username).trim();
      const appPassword =
        body.appPassword && body.appPassword.trim().length > 0
          ? body.appPassword.trim()
          : existing.appPassword;
      const folder = normalizeFolder(body.folder ?? existing.folder);
      const autoSync = body.autoSync ?? existing.autoSync;

      const updated: StoredNextcloudConfig = {
        url,
        username,
        appPassword,
        folder,
        autoSync,
        lastSyncAt: existing.lastSyncAt,
        lastSyncError: null,
      };
      await writeStoredNcConfig(updated);
      res.json({ nextcloud: toPublicNcInfo({ ...updated, fromEnv: false }) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Ungültige Nextcloud-Konfiguration.',
      });
    }
  });

  // Test Nextcloud WebDAV connection
  app.post('/api/nextcloud/test', async (req, res) => {
    try {
      const existing = await readStoredNcConfig();
      const body = req.body as {
        url?: string;
        username?: string;
        appPassword?: string;
        folder?: string;
      };

      const testCfg: StoredNextcloudConfig = {
        url: body.url ? validateHttpUrl(body.url) : existing.url,
        username: (body.username ?? existing.username).trim(),
        appPassword:
          body.appPassword && body.appPassword.trim().length > 0
            ? body.appPassword.trim()
            : existing.appPassword,
        folder: normalizeFolder(body.folder ?? existing.folder),
        autoSync: existing.autoSync,
        lastSyncAt: existing.lastSyncAt,
        lastSyncError: null,
      };

      if (!testCfg.url || !testCfg.username || !testCfg.appPassword) {
        res.status(400).json({
          error: 'Bitte Server-URL, Benutzername und App-Passwort angeben.',
        });
        return;
      }

      await ensureNextcloudFolderExists(testCfg, testCfg.folder);
      await ensureNextcloudFolderExists(testCfg, `${testCfg.folder}/Rechnungen`);

      res.json({
        ok: true,
        message: `Verbindung zu Nextcloud erfolgreich. Ordner "${testCfg.folder}" ist bereit.`,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Nextcloud-Verbindungstest fehlgeschlagen.',
      });
    }
  });

  // Check if remote Nextcloud DB is newer than local
  app.get('/api/nextcloud/check', async (_req, res) => {
    try {
      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.json({ hasNewerRemote: false, remoteUpdatedAt: null });
        return;
      }
      const localDb = await readLocalDb();
      const remoteDb = await pullDbFromNextcloud(ncCfg);
      if (!remoteDb?.updatedAt) {
        res.json({ hasNewerRemote: false, remoteUpdatedAt: null });
        return;
      }
      const remoteMs = new Date(remoteDb.updatedAt).getTime();
      const localMs = new Date(localDb.updatedAt).getTime();
      const knownMs = ncCfg.lastKnownRemoteUpdatedAt
        ? new Date(ncCfg.lastKnownRemoteUpdatedAt).getTime()
        : 0;
      const hasNewerRemote =
        Number.isFinite(remoteMs) &&
        remoteMs > knownMs + 1000 &&
        remoteMs > localMs + 1000;
      res.json({
        hasNewerRemote,
        remoteUpdatedAt: remoteDb.updatedAt,
      });
    } catch {
      res.json({ hasNewerRemote: false, remoteUpdatedAt: null });
    }
  });

  // Manual push / pull sync with Nextcloud (with conflict guard)
  app.post('/api/nextcloud/sync', async (req, res) => {
    try {
      const { direction, force } = req.body as {
        direction?: 'push' | 'pull';
        force?: boolean;
      };
      const ncCfg = await readStoredNcConfig();

      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({ error: 'Nextcloud ist noch nicht konfiguriert.' });
        return;
      }

      if (direction === 'pull') {
        await ensureNextcloudFolderExists(ncCfg, ncCfg.folder);
        const remoteDb = await pullDbFromNextcloud(ncCfg);
        if (!remoteDb) {
          res.status(404).json({
            error: `Auf Nextcloud existiert noch keine Datei "${ncCfg.folder}/taktwerk-db.json". Bitte zuerst "Auf Nextcloud sichern" ausführen.`,
          });
          return;
        }
        await writeLocalDb(remoteDb);
        ncCfg.lastSyncAt = new Date().toISOString();
        ncCfg.lastKnownRemoteUpdatedAt = remoteDb.updatedAt || ncCfg.lastSyncAt;
        ncCfg.lastSyncError = null;
        await writeStoredNcConfig(ncCfg);
        res.json({ db: remoteDb, nextcloud: toPublicNcInfo(ncCfg) });
        return;
      }

      // Default: push (check for newer remote data first unless force=true)
      const localDb = await readLocalDb();
      if (!force) {
        const remoteDb = await pullDbFromNextcloud(ncCfg).catch(() => null);
        if (remoteDb?.updatedAt) {
          const remoteMs = new Date(remoteDb.updatedAt).getTime();
          const knownMs = ncCfg.lastKnownRemoteUpdatedAt
            ? new Date(ncCfg.lastKnownRemoteUpdatedAt).getTime()
            : 0;
          const localMs = new Date(localDb.updatedAt).getTime();
          if (Number.isFinite(remoteMs) && remoteMs > knownMs + 1000 && remoteMs > localMs + 1000) {
            res.status(409).json({
              conflict: true,
              remoteUpdatedAt: remoteDb.updatedAt,
              error: `Auf Nextcloud liegt bereits ein neuerer Stand (${remoteDb.updatedAt}) von einem anderen Gerät. Bitte zuerst "Von Nextcloud laden" oder das Überschreiben bestätigen.`,
            });
            return;
          }
        }
      }

      await pushDbToNextcloud(ncCfg, localDb);
      ncCfg.lastSyncAt = new Date().toISOString();
      ncCfg.lastKnownRemoteUpdatedAt = localDb.updatedAt;
      ncCfg.lastSyncError = null;
      await writeStoredNcConfig(ncCfg);
      res.json({ db: localDb, nextcloud: toPublicNcInfo(ncCfg) });
    } catch (err) {
      const ncCfg = await readStoredNcConfig();
      const msg = err instanceof Error ? err.message : 'Synchronisation fehlgeschlagen.';
      ncCfg.lastSyncError = msg;
      await writeStoredNcConfig(ncCfg);
      res.status(500).json({ error: msg, nextcloud: toPublicNcInfo(ncCfg) });
    }
  });

  // Upload generated PDF invoice directly into Nextcloud /Rechnungen/
  app.post('/api/nextcloud/upload-invoice', async (req, res) => {
    try {
      const { filename, pdfBase64 } = req.body as {
        filename?: string;
        pdfBase64?: string;
      };

      if (!filename || !pdfBase64) {
        res.status(400).json({ error: 'Dateiname oder PDF-Daten fehlen.' });
        return;
      }

      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({
          error: 'Nextcloud ist nicht konfiguriert. Bitte zuerst unter "Nextcloud & Setup" verbinden.',
        });
        return;
      }

      const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const invoicesFolder = `${ncCfg.folder}/Rechnungen`;
      await ensureNextcloudFolderExists(ncCfg, invoicesFolder);

      const fileUrl = buildWebDavFileUrl(ncCfg, `Rechnungen/${safeFilename}`);
      const buffer = Buffer.from(pdfBase64, 'base64');

      const uploadRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: {
          Authorization: makeAuthHeader(ncCfg),
          'Content-Type': 'application/pdf',
        },
        body: buffer,
      });

      if (!uploadRes.ok) {
        throw new Error(`PDF-Upload zu Nextcloud fehlgeschlagen (HTTP ${uploadRes.status}).`);
      }

      const uploadedAt = new Date().toISOString();
      res.json({
        ok: true,
        path: `${invoicesFolder}/${safeFilename}`,
        uploadedAt,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'PDF konnte nicht zu Nextcloud hochgeladen werden.',
      });
    }
  });

  // Upload generated XRechnung XML or other text file directly into Nextcloud /Rechnungen/
  app.post('/api/nextcloud/upload-file', async (req, res) => {
    try {
      const { filename, content, contentType } = req.body as {
        filename?: string;
        content?: string;
        contentType?: string;
      };

      if (!filename || !content) {
        res.status(400).json({ error: 'Dateiname oder Dateiinhalt fehlen.' });
        return;
      }

      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({
          error: 'Nextcloud ist nicht konfiguriert. Bitte zuerst unter "Nextcloud & Setup" verbinden.',
        });
        return;
      }

      const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const invoicesFolder = `${ncCfg.folder}/Rechnungen`;
      await ensureNextcloudFolderExists(ncCfg, invoicesFolder);

      const fileUrl = buildWebDavFileUrl(ncCfg, `Rechnungen/${safeFilename}`);
      const uploadRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: {
          Authorization: makeAuthHeader(ncCfg),
          'Content-Type': contentType || 'application/xml; charset=utf-8',
        },
        body: content,
      });

      if (!uploadRes.ok) {
        throw new Error(`Datei-Upload zu Nextcloud fehlgeschlagen (HTTP ${uploadRes.status}).`);
      }

      const uploadedAt = new Date().toISOString();
      res.json({
        ok: true,
        path: `${invoicesFolder}/${safeFilename}`,
        uploadedAt,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Datei konnte nicht zu Nextcloud hochgeladen werden.',
      });
    }
  });

  // Upload automated backup files (JSON, CSV, XLSX, PDF) into Nextcloud subfolder (e.g. Backups)
  app.post('/api/nextcloud/upload-backup', async (req, res) => {
    try {
      const { subFolder, filename, contentOrBase64, isBinary, contentType } = req.body as {
        subFolder?: string;
        filename?: string;
        contentOrBase64?: string;
        isBinary?: boolean;
        contentType?: string;
      };

      if (!filename || !contentOrBase64) {
        res.status(400).json({ error: 'Dateiname oder Backup-Inhalt fehlen.' });
        return;
      }

      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({ error: 'Nextcloud ist nicht konfiguriert.' });
        return;
      }

      const cleanSub = (subFolder || 'Backups').replace(/[^a-zA-Z0-9_/-]/g, '').replace(/^\/+|\/+$/g, '') || 'Backups';
      const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const targetFolder = `${ncCfg.folder}/${cleanSub}`;
      await ensureNextcloudFolderExists(ncCfg, targetFolder);

      const fileUrl = buildWebDavFileUrl(ncCfg, `${cleanSub}/${safeFilename}`);
      const payloadBody = isBinary
        ? Buffer.from(contentOrBase64, 'base64')
        : Buffer.from(contentOrBase64, 'utf-8');

      const uploadRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: {
          Authorization: makeAuthHeader(ncCfg),
          'Content-Type': contentType || 'application/octet-stream',
        },
        body: payloadBody,
      });

      if (!uploadRes.ok) {
        throw new Error(`Backup-Upload zu Nextcloud fehlgeschlagen (HTTP ${uploadRes.status}).`);
      }

      res.json({
        ok: true,
        path: `${targetFolder}/${safeFilename}`,
        uploadedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Backup-Upload fehlgeschlagen.',
      });
    }
  });

  // CalDAV: Discover user calendars on Nextcloud
  app.post('/api/nextcloud/caldav/discover', async (_req, res) => {
    try {
      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({ error: 'Nextcloud ist noch nicht konfiguriert.' });
        return;
      }
      const baseUrl = validateHttpUrl(ncCfg.url).replace(/\/remote\.php\/.*$/, '');
      const homeUrl = `${baseUrl}/remote.php/dav/calendars/${encodeURIComponent(ncCfg.username)}/`;

      const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;

      const calRes = await fetch(homeUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: makeAuthHeader(ncCfg),
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: propfindBody,
      });

      if (calRes.status === 401 || calRes.status === 403) {
        res.status(401).json({ error: 'Nextcloud CalDAV Authentifizierung fehlgeschlagen.' });
        return;
      }
      if (!calRes.ok && calRes.status !== 207) {
        throw new Error(`CalDAV PROPFIND fehlgeschlagen (HTTP ${calRes.status}).`);
      }
      const xml = await calRes.text();
      res.json({ xml, baseOrigin: new URL(baseUrl).origin });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Nextcloud Kalender konnten nicht abgerufen werden.',
      });
    }
  });

  // CalDAV: Query events from a specific calendar collection
  app.post('/api/nextcloud/caldav/events', async (req, res) => {
    try {
      const { calendarUrl, startIso, endIso } = req.body as {
        calendarUrl?: string;
        startIso?: string;
        endIso?: string;
      };
      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({ error: 'Nextcloud ist noch nicht konfiguriert.' });
        return;
      }
      if (!calendarUrl) {
        res.status(400).json({ error: 'Kalender-URL fehlt.' });
        return;
      }
      const validatedTarget = validateHttpUrl(calendarUrl);
      const startCompact = (startIso || new Date(Date.now() - 30 * 86400 * 1000).toISOString())
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
      const endCompact = (endIso || new Date(Date.now() + 90 * 86400 * 1000).toISOString())
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');

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

      const repRes = await fetch(validatedTarget.endsWith('/') ? validatedTarget : `${validatedTarget}/`, {
        method: 'REPORT',
        headers: {
          Authorization: makeAuthHeader(ncCfg),
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: reportBody,
      });

      if (!repRes.ok && repRes.status !== 207) {
        throw new Error(`CalDAV REPORT fehlgeschlagen (HTTP ${repRes.status}).`);
      }
      const xml = await repRes.text();
      res.json({ xml });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Kalendertermine konnten nicht geladen werden.',
      });
    }
  });

  // CalDAV: Put (.ics) event into a Nextcloud calendar collection
  app.post('/api/nextcloud/caldav/push', async (req, res) => {
    try {
      const { calendarUrl, uid, icsContent } = req.body as {
        calendarUrl?: string;
        uid?: string;
        icsContent?: string;
      };
      const ncCfg = await readStoredNcConfig();
      if (!ncCfg.url || !ncCfg.username || !ncCfg.appPassword) {
        res.status(400).json({ error: 'Nextcloud ist noch nicht konfiguriert.' });
        return;
      }
      if (!calendarUrl || !uid || !icsContent) {
        res.status(400).json({ error: 'Kalender-URL, UID oder ICS-Daten fehlen.' });
        return;
      }
      const safeUid = uid.replace(/[^a-zA-Z0-9@._-]/g, '_');
      const baseCal = validateHttpUrl(calendarUrl).replace(/\/+$/, '');
      const eventUrl = `${baseCal}/${encodeURIComponent(safeUid)}.ics`;

      const putRes = await fetch(eventUrl, {
        method: 'PUT',
        headers: {
          Authorization: makeAuthHeader(ncCfg),
          'Content-Type': 'text/calendar; charset=utf-8',
        },
        body: icsContent,
      });

      if (!putRes.ok) {
        throw new Error(`CalDAV PUT fehlgeschlagen (HTTP ${putRes.status}).`);
      }
      res.json({ ok: true, eventUrl });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Termin konnte nicht in Nextcloud gespeichert werden.',
      });
    }
  });


  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`TaktWerk server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
