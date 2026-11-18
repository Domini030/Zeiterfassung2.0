import type { AppDatabase, BackupVersionEntry } from '../types';
import { trackActivity } from './activityProgress';
import { apiUploadNextcloudFile } from './apiClient';
import {
  downloadOrShareTextFile,
  toBackupTimestamp,
  validateImportedDatabase,
} from './exportBackup';
import { createId } from './format';

const INDEX_KEY = 'taktwerk_backup_versions_index_v1';
const SNAP_PREFIX = 'taktwerk_backup_version_snap_v1_';
const DEFAULT_MAX_VERSIONS = 10;

function readIndex(): BackupVersionEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as BackupVersionEntry[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

function writeIndex(list: BackupVersionEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage write errors
  }
}

export function listBackupVersions(): BackupVersionEntry[] {
  return readIndex();
}

export function loadBackupVersionSnapshot(id: string): AppDatabase | null {
  try {
    const raw = localStorage.getItem(`${SNAP_PREFIX}${id}`);
    if (!raw) return null;
    return validateImportedDatabase(raw);
  } catch {
    return null;
  }
}

export function deleteBackupVersion(id: string): BackupVersionEntry[] {
  try {
    localStorage.removeItem(`${SNAP_PREFIX}${id}`);
  } catch {
    // Ignore
  }
  const next = readIndex().filter((entry) => entry.id !== id);
  writeIndex(next);
  return next;
}

export async function downloadBackupVersion(entry: BackupVersionEntry): Promise<boolean> {
  const raw = localStorage.getItem(`${SNAP_PREFIX}${entry.id}`);
  if (!raw) return false;
  await downloadOrShareTextFile(entry.filename, raw, 'application/json; charset=utf-8');
  return true;
}

export async function createBackupVersion(
  db: AppDatabase,
  options: {
    label?: string;
    source?: 'manual' | 'auto' | 'pre-restore';
    maxVersions?: number;
    uploadToNextcloud?: boolean;
  } = {}
): Promise<{ entry: BackupVersionEntry; versions: BackupVersionEntry[]; uploadError?: string }> {
  const maxVersions = Math.max(2, Math.min(50, options.maxVersions ?? DEFAULT_MAX_VERSIONS));
  const now = new Date();
  const stamp = toBackupTimestamp(now);
  const safeSlug = options.label
    ? `-${options.label.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 24)}`
    : '';
  const filename = `taktwerk-backup-${stamp}${safeSlug}.json`;
  const id = createId('bkv');
  const json = JSON.stringify(db, null, 2);
  const sizeBytes = new Blob([json]).size;

  return trackActivity(
    options.uploadToNextcloud
      ? 'Backup-Version wird erstellt & hochgeladen…'
      : 'Backup-Version wird erstellt…',
    async (update) => {
      update(20, filename);

      let list = readIndex();

      // Prune oldest versions if exceeding limit BEFORE saving new snapshot
      while (list.length >= maxVersions) {
        const oldest = list[list.length - 1];
        if (!oldest) break;
        try {
          localStorage.removeItem(`${SNAP_PREFIX}${oldest.id}`);
        } catch {
          // Ignore
        }
        list = list.slice(0, -1);
      }

      // Attempt to save snapshot; on storage quota error, prune oldest entries and retry
      let savedLocally = false;
      while (!savedLocally) {
        try {
          localStorage.setItem(`${SNAP_PREFIX}${id}`, json);
          savedLocally = true;
        } catch {
          const oldest = list[list.length - 1];
          if (!oldest) {
            throw new Error(
              'Lokaler Speicher voll — bitte lösche ältere Backup-Versionen oder speichere direkt als JSON-Datei.'
            );
          }
          try {
            localStorage.removeItem(`${SNAP_PREFIX}${oldest.id}`);
          } catch {
            // Ignore
          }
          list = list.slice(0, -1);
        }
      }

      update(55, 'Lokaler Snapshot gespeichert');

      let nextcloudPath: string | undefined;
      let uploadError: string | undefined;

      if (options.uploadToNextcloud) {
        update(70, `Upload nach Nextcloud/Backups/Versionen/${filename}`);
        try {
          const uploaded = await apiUploadNextcloudFile({
            subFolder: 'Backups/Versionen',
            filename,
            contentOrBase64: json,
            isBinary: false,
            contentType: 'application/json; charset=utf-8',
            silentProgress: true,
          });
          nextcloudPath = uploaded.path;
        } catch (err) {
          uploadError =
            err instanceof Error
              ? err.message
              : 'Upload der Backup-Version nach Nextcloud fehlgeschlagen.';
        }
      }

      update(95, 'Versionsliste aktualisieren');

      const entry: BackupVersionEntry = {
        id,
        label:
          options.label?.trim() ||
          (options.source === 'auto'
            ? 'Automatisches Backup'
            : options.source === 'pre-restore'
              ? 'Sicherung vor Wiederherstellung'
              : 'Manuelle Sicherung'),
        createdAt: now.toISOString(),
        filename,
        sizeBytes,
        source: options.source ?? 'manual',
        nextcloudPath,
        counts: {
          timeEntries: db.timeEntries.length,
          invoices: db.invoices.length,
          customers: db.customers.length,
          products: db.products.length,
        },
      };

      const updatedList = [entry, ...list];
      writeIndex(updatedList);
      update(100, 'Fertig');

      return { entry, versions: updatedList, uploadError };
    },
    10,
    filename
  );
}
