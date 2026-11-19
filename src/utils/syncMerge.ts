import type { AppDatabase, CompanyProfile, SyncPairingPayload } from '../types.ts';

const DEVICE_ID_STORAGE_KEY = 'taktwerk-sync-device-id';
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PAIRING_PREFIX = 'TW-SYNC-1:';

type Identifiable = { id: string; createdAt?: string };

const COLLECTION_KEYS = [
  'customers',
  'products',
  'nfcTasks',
  'geoFenceRules',
  'timeEntries',
  'invoices',
  'expenses',
  'recurringExpenses',
  'recurringInvoices',
  'calendarEvents',
] as const;

type CollectionKey = (typeof COLLECTION_KEYS)[number];

export function getOrCreateSyncDeviceId(platformHint?: 'windows' | 'android' | 'web'): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && existing.trim()) return existing.trim();
      const prefix =
        platformHint === 'windows'
          ? 'tw-win'
          : platformHint === 'android'
            ? 'tw-and'
            : 'tw-web';
      const generated = `${prefix}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
      return generated;
    }
  } catch {
    // Fallback below
  }
  return `tw-srv-${Date.now().toString(36)}`;
}

function parseIsoMs(iso: string | undefined | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function getCollection(db: AppDatabase, key: CollectionKey): Identifiable[] {
  const list = db[key];
  return Array.isArray(list) ? (list as Identifiable[]) : [];
}

function pruneTombstones(
  deletedIds: Record<string, string>,
  nowMs: number
): Record<string, string> {
  const pruned: Record<string, string> = {};
  for (const [id, iso] of Object.entries(deletedIds)) {
    const ms = parseIsoMs(iso);
    if (ms > 0 && nowMs - ms <= TOMBSTONE_RETENTION_MS) {
      pruned[id] = iso;
    }
  }
  return pruned;
}

/**
 * Automatically records per-record modification timestamps, deletion tombstones,
 * activeTimerUpdatedAt, and companyUpdatedAt by diffing prevDb against nextDb.
 */
export function stampDatabaseChanges(
  prevDb: AppDatabase,
  nextDb: AppDatabase,
  deviceId?: string
): AppDatabase {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const nextRecordUpdatedAt: Record<string, string> = {
    ...(prevDb.recordUpdatedAt ?? {}),
    ...(nextDb.recordUpdatedAt ?? {}),
  };
  const nextDeletedIds: Record<string, string> = {
    ...(prevDb.deletedIds ?? {}),
    ...(nextDb.deletedIds ?? {}),
  };
  const activeIds = new Set<string>();

  for (const key of COLLECTION_KEYS) {
    const prevList = getCollection(prevDb, key);
    const nextList = getCollection(nextDb, key);
    const prevMap = new Map<string, Identifiable>();
    for (const item of prevList) {
      if (item?.id) prevMap.set(item.id, item);
    }

    const nextIdsInCollection = new Set<string>();
    for (const item of nextList) {
      if (!item?.id) continue;
      activeIds.add(item.id);
      nextIdsInCollection.add(item.id);
      const prevItem = prevMap.get(item.id);
      if (!prevItem) {
        nextRecordUpdatedAt[item.id] = nowIso;
        delete nextDeletedIds[item.id];
      } else if (stableJson(prevItem) !== stableJson(item)) {
        nextRecordUpdatedAt[item.id] = nowIso;
        delete nextDeletedIds[item.id];
      } else if (!nextRecordUpdatedAt[item.id]) {
        nextRecordUpdatedAt[item.id] =
          item.createdAt || prevDb.updatedAt || nowIso;
      }
    }

    for (const prevItem of prevList) {
      if (prevItem?.id && !nextIdsInCollection.has(prevItem.id)) {
        nextDeletedIds[prevItem.id] = nowIso;
        delete nextRecordUpdatedAt[prevItem.id];
      }
    }
  }

  // Keep recordUpdatedAt lean (only IDs that currently exist)
  const cleanRecordUpdatedAt: Record<string, string> = {};
  for (const id of activeIds) {
    if (nextRecordUpdatedAt[id]) {
      cleanRecordUpdatedAt[id] = nextRecordUpdatedAt[id];
    }
  }

  const timerChanged = stableJson(prevDb.activeTimer ?? null) !== stableJson(nextDb.activeTimer ?? null);
  const pausedTimersChanged =
    stableJson(prevDb.pausedTimers ?? []) !== stableJson(nextDb.pausedTimers ?? []);
  const companyChanged = stableJson(prevDb.company) !== stableJson(nextDb.company);

  return {
    ...nextDb,
    updatedAt: nowIso,
    syncDeviceId: deviceId || nextDb.syncDeviceId || prevDb.syncDeviceId,
    activeTimerUpdatedAt: timerChanged
      ? nowIso
      : nextDb.activeTimerUpdatedAt || prevDb.activeTimerUpdatedAt || prevDb.updatedAt,
    pausedTimersUpdatedAt: pausedTimersChanged
      ? nowIso
      : nextDb.pausedTimersUpdatedAt || prevDb.pausedTimersUpdatedAt || prevDb.updatedAt,
    companyUpdatedAt: companyChanged
      ? nowIso
      : nextDb.companyUpdatedAt || prevDb.companyUpdatedAt || prevDb.updatedAt,
    deletedIds: pruneTombstones(nextDeletedIds, nowMs),
    recordUpdatedAt: cleanRecordUpdatedAt,
  };
}

export interface MergeDatabasesResult {
  merged: AppDatabase;
  localChanged: boolean;
  remoteNeedsPush: boolean;
  addedFromRemote: number;
  updatedFromRemote: number;
  removedFromRemote: number;
  summary: string;
}

function getRecordTimestampMs(
  db: AppDatabase,
  item: Identifiable | undefined
): number {
  if (!item) return 0;
  return (
    parseIsoMs(db.recordUpdatedAt?.[item.id]) ||
    parseIsoMs(item.createdAt) ||
    parseIsoMs(db.updatedAt)
  );
}

function mergeCompanyProfiles(
  localDb: AppDatabase,
  remoteDb: AppDatabase
): {
  company: CompanyProfile;
  companyUpdatedAt: string;
  fromRemote: boolean;
  fromLocal: boolean;
} {
  const localMs = parseIsoMs(localDb.companyUpdatedAt || localDb.updatedAt);
  const remoteMs = parseIsoMs(remoteDb.companyUpdatedAt || remoteDb.updatedAt);
  const same = stableJson(localDb.company) === stableJson(remoteDb.company);

  if (same) {
    const newerIso =
      remoteMs >= localMs
        ? remoteDb.companyUpdatedAt || remoteDb.updatedAt
        : localDb.companyUpdatedAt || localDb.updatedAt;
    return {
      company: localDb.company,
      companyUpdatedAt: newerIso,
      fromRemote: false,
      fromLocal: false,
    };
  }

  const remoteWins = remoteMs > localMs;
  const primary = remoteWins ? remoteDb.company : localDb.company;
  const secondary = remoteWins ? localDb.company : remoteDb.company;

  // Monotonic sequence numbers never go backwards across devices
  const mergedCompany: CompanyProfile = {
    ...secondary,
    ...primary,
    nextInvoiceSequence: Math.max(
      localDb.company.nextInvoiceSequence ?? 1,
      remoteDb.company.nextInvoiceSequence ?? 1
    ),
    nextQuoteSequence: Math.max(
      localDb.company.nextQuoteSequence ?? 1,
      remoteDb.company.nextQuoteSequence ?? 1
    ),
    nextProductSequence: Math.max(
      localDb.company.nextProductSequence ?? 1,
      remoteDb.company.nextProductSequence ?? 1
    ),
    autoBackup: primary.autoBackup
      ? {
          ...secondary.autoBackup,
          ...primary.autoBackup,
          lastRunAt:
            parseIsoMs(localDb.company.autoBackup?.lastRunAt) >=
            parseIsoMs(remoteDb.company.autoBackup?.lastRunAt)
              ? localDb.company.autoBackup?.lastRunAt ?? null
              : remoteDb.company.autoBackup?.lastRunAt ?? null,
        }
      : secondary.autoBackup,
  };

  const mergedJson = stableJson(mergedCompany);
  return {
    company: mergedCompany,
    companyUpdatedAt: remoteWins
      ? remoteDb.companyUpdatedAt || remoteDb.updatedAt
      : localDb.companyUpdatedAt || localDb.updatedAt,
    fromRemote: mergedJson !== stableJson(localDb.company),
    fromLocal: mergedJson !== stableJson(remoteDb.company),
  };
}

/**
 * Deterministic bidirectional record-level merge between localDb and remoteDb.
 * Preserves offline additions/edits on both Windows and Smartphone, respects deletions
 * via tombstones, syncs live activeTimer state, and avoids invoice number collisions.
 */
export function mergeDatabases(
  localDb: AppDatabase,
  remoteDb: AppDatabase
): MergeDatabasesResult {
  const nowMs = Date.now();

  // 1. Merge tombstones (newest delete timestamp wins per ID)
  const mergedDeletedIds: Record<string, string> = {};
  const allTombstoneIds = new Set<string>([
    ...Object.keys(localDb.deletedIds ?? {}),
    ...Object.keys(remoteDb.deletedIds ?? {}),
  ]);
  for (const id of allTombstoneIds) {
    const lIso = localDb.deletedIds?.[id];
    const rIso = remoteDb.deletedIds?.[id];
    const lMs = parseIsoMs(lIso);
    const rMs = parseIsoMs(rIso);
    const chosen = rMs >= lMs ? rIso : lIso;
    if (chosen) mergedDeletedIds[id] = chosen;
  }

  let localChanged = false;
  let remoteNeedsPush = false;
  let addedFromRemote = 0;
  let updatedFromRemote = 0;
  let removedFromRemote = 0;

  const mergedRecordUpdatedAt: Record<string, string> = {};
  const mergedCollections: Partial<Record<CollectionKey, Identifiable[]>> = {};

  // 2. Merge each ID-keyed collection
  for (const key of COLLECTION_KEYS) {
    const localList = getCollection(localDb, key);
    const remoteList = getCollection(remoteDb, key);

    const localMap = new Map<string, Identifiable>();
    for (const item of localList) {
      if (item?.id) localMap.set(item.id, item);
    }
    const remoteMap = new Map<string, Identifiable>();
    for (const item of remoteList) {
      if (item?.id) remoteMap.set(item.id, item);
    }

    // Preserve natural ordering: items present in remote/local newest-first
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    const firstList = parseIsoMs(remoteDb.updatedAt) >= parseIsoMs(localDb.updatedAt)
      ? remoteList
      : localList;
    const secondList = firstList === remoteList ? localList : remoteList;
    for (const item of firstList) {
      if (item?.id && !seen.has(item.id)) {
        seen.add(item.id);
        orderedIds.push(item.id);
      }
    }
    for (const item of secondList) {
      if (item?.id && !seen.has(item.id)) {
        seen.add(item.id);
        orderedIds.push(item.id);
      }
    }

    const resultList: Identifiable[] = [];
    for (const id of orderedIds) {
      const localItem = localMap.get(id);
      const remoteItem = remoteMap.get(id);
      const localModMs = getRecordTimestampMs(localDb, localItem);
      const remoteModMs = getRecordTimestampMs(remoteDb, remoteItem);
      const deletedMs = parseIsoMs(mergedDeletedIds[id]);
      const newestModMs = Math.max(localModMs, remoteModMs);

      // Deleted more recently than any modification -> stays deleted
      if (deletedMs > 0 && deletedMs >= newestModMs) {
        if (localItem) {
          localChanged = true;
          removedFromRemote += 1;
        }
        if (remoteItem) {
          remoteNeedsPush = true;
        }
        continue;
      }

      // Active record overrides any older tombstone
      if (deletedMs > 0 && newestModMs > deletedMs) {
        delete mergedDeletedIds[id];
      }

      if (localItem && !remoteItem) {
        resultList.push(localItem);
        mergedRecordUpdatedAt[id] =
          localDb.recordUpdatedAt?.[id] ||
          localItem.createdAt ||
          localDb.updatedAt;
        remoteNeedsPush = true;
      } else if (!localItem && remoteItem) {
        resultList.push(remoteItem);
        mergedRecordUpdatedAt[id] =
          remoteDb.recordUpdatedAt?.[id] ||
          remoteItem.createdAt ||
          remoteDb.updatedAt;
        localChanged = true;
        addedFromRemote += 1;
      } else if (localItem && remoteItem) {
        if (stableJson(localItem) === stableJson(remoteItem)) {
          resultList.push(localItem);
          const bestMs = Math.max(localModMs, remoteModMs);
          mergedRecordUpdatedAt[id] =
            bestMs > 0 ? new Date(bestMs).toISOString() : localDb.updatedAt;
        } else if (remoteModMs > localModMs) {
          resultList.push(remoteItem);
          mergedRecordUpdatedAt[id] =
            remoteDb.recordUpdatedAt?.[id] ||
            remoteItem.createdAt ||
            remoteDb.updatedAt;
          localChanged = true;
          updatedFromRemote += 1;
        } else {
          resultList.push(localItem);
          mergedRecordUpdatedAt[id] =
            localDb.recordUpdatedAt?.[id] ||
            localItem.createdAt ||
            localDb.updatedAt;
          remoteNeedsPush = true;
        }
      }
    }

    mergedCollections[key] = resultList;
  }

  // 3. Merge activeTimer (most recently updated timer state wins)
  const localTimerMs = parseIsoMs(
    localDb.activeTimerUpdatedAt || localDb.activeTimer?.startTime || localDb.updatedAt
  );
  const remoteTimerMs = parseIsoMs(
    remoteDb.activeTimerUpdatedAt || remoteDb.activeTimer?.startTime || remoteDb.updatedAt
  );
  let mergedActiveTimer = localDb.activeTimer ?? null;
  let mergedActiveTimerUpdatedAt =
    localDb.activeTimerUpdatedAt || localDb.updatedAt;

  if (stableJson(localDb.activeTimer ?? null) !== stableJson(remoteDb.activeTimer ?? null)) {
    if (remoteTimerMs > localTimerMs) {
      mergedActiveTimer = remoteDb.activeTimer ?? null;
      mergedActiveTimerUpdatedAt = remoteDb.activeTimerUpdatedAt || remoteDb.updatedAt;
      localChanged = true;
    } else {
      mergedActiveTimer = localDb.activeTimer ?? null;
      mergedActiveTimerUpdatedAt = localDb.activeTimerUpdatedAt || localDb.updatedAt;
      remoteNeedsPush = true;
    }
  } else {
    mergedActiveTimerUpdatedAt =
      remoteTimerMs >= localTimerMs
        ? remoteDb.activeTimerUpdatedAt || remoteDb.updatedAt
        : localDb.activeTimerUpdatedAt || localDb.updatedAt;
  }

  // 3b. Merge pausedTimers stack (most recently updated stack wins)
  const localPausedList = localDb.pausedTimers ?? [];
  const remotePausedList = remoteDb.pausedTimers ?? [];
  const localPausedMs = parseIsoMs(localDb.pausedTimersUpdatedAt || localDb.updatedAt);
  const remotePausedMs = parseIsoMs(remoteDb.pausedTimersUpdatedAt || remoteDb.updatedAt);
  let mergedPausedTimers = localPausedList;
  let mergedPausedTimersUpdatedAt = localDb.pausedTimersUpdatedAt || localDb.updatedAt;

  if (stableJson(localPausedList) !== stableJson(remotePausedList)) {
    if (remotePausedMs > localPausedMs) {
      mergedPausedTimers = remotePausedList;
      mergedPausedTimersUpdatedAt = remoteDb.pausedTimersUpdatedAt || remoteDb.updatedAt;
      localChanged = true;
    } else {
      mergedPausedTimers = localPausedList;
      mergedPausedTimersUpdatedAt = localDb.pausedTimersUpdatedAt || localDb.updatedAt;
      remoteNeedsPush = true;
    }
  } else {
    mergedPausedTimersUpdatedAt =
      remotePausedMs >= localPausedMs
        ? remoteDb.pausedTimersUpdatedAt || remoteDb.updatedAt
        : localDb.pausedTimersUpdatedAt || localDb.updatedAt;
  }

  // 4. Merge company settings
  const companyMerge = mergeCompanyProfiles(localDb, remoteDb);
  if (companyMerge.fromRemote) localChanged = true;
  if (companyMerge.fromLocal) remoteNeedsPush = true;

  const latestUpdatedMs = Math.max(
    parseIsoMs(localDb.updatedAt),
    parseIsoMs(remoteDb.updatedAt),
    localChanged && remoteNeedsPush ? nowMs : 0
  );
  const mergedUpdatedAt =
    latestUpdatedMs > 0 ? new Date(latestUpdatedMs).toISOString() : new Date(nowMs).toISOString();

  const merged: AppDatabase = {
    version: Math.max(localDb.version ?? 2, remoteDb.version ?? 2),
    updatedAt: mergedUpdatedAt,
    syncDeviceId:
      remoteNeedsPush
        ? localDb.syncDeviceId || remoteDb.syncDeviceId
        : remoteDb.syncDeviceId || localDb.syncDeviceId,
    activeTimerUpdatedAt: mergedActiveTimerUpdatedAt,
    pausedTimersUpdatedAt: mergedPausedTimersUpdatedAt,
    companyUpdatedAt: companyMerge.companyUpdatedAt,
    deletedIds: pruneTombstones(mergedDeletedIds, nowMs),
    recordUpdatedAt: mergedRecordUpdatedAt,
    company: companyMerge.company,
    customers: (mergedCollections.customers ?? []) as AppDatabase['customers'],
    products: (mergedCollections.products ?? []) as AppDatabase['products'],
    nfcTasks: (mergedCollections.nfcTasks ?? []) as AppDatabase['nfcTasks'],
    geoFenceRules: (mergedCollections.geoFenceRules ?? []) as AppDatabase['geoFenceRules'],
    timeEntries: (mergedCollections.timeEntries ?? []) as AppDatabase['timeEntries'],
    activeTimer: mergedActiveTimer,
    pausedTimers: mergedPausedTimers,
    invoices: (mergedCollections.invoices ?? []) as AppDatabase['invoices'],
    expenses: (mergedCollections.expenses ?? []) as AppDatabase['expenses'],
    recurringExpenses: (mergedCollections.recurringExpenses ?? []) as AppDatabase['recurringExpenses'],
    recurringInvoices: (mergedCollections.recurringInvoices ?? []) as AppDatabase['recurringInvoices'],
    calendarEvents: (mergedCollections.calendarEvents ?? []) as AppDatabase['calendarEvents'],
  };

  const parts: string[] = [];
  if (addedFromRemote > 0) parts.push(`${addedFromRemote} neu`);
  if (updatedFromRemote > 0) parts.push(`${updatedFromRemote} aktualisiert`);
  if (removedFromRemote > 0) parts.push(`${removedFromRemote} entfernt`);
  const summary =
    parts.length > 0
      ? parts.join(', ')
      : localChanged
        ? 'Gerätestatus & Einstellungen übernommen'
        : remoteNeedsPush
          ? 'Lokale Änderungen hochgeladen'
          : 'Bereits aktuell';

  return {
    merged,
    localChanged,
    remoteNeedsPush,
    addedFromRemote,
    updatedFromRemote,
    removedFromRemote,
    summary,
  };
}

function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUtf8(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const normalized = padded + '='.repeat(padLen);
  if (typeof atob === 'function') {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

export function encodeSyncPairingCode(payload: SyncPairingPayload): string {
  return `${PAIRING_PREFIX}${utf8ToBase64Url(JSON.stringify(payload))}`;
}

export function decodeSyncPairingCode(rawInput: string): SyncPairingPayload {
  const cleaned = rawInput.trim().replace(/\s+/g, '');
  if (!cleaned.startsWith(PAIRING_PREFIX)) {
    throw new Error('Ungültiger Kopplungscode. Der Code muss mit "TW-SYNC-1:" beginnen.');
  }
  const encoded = cleaned.slice(PAIRING_PREFIX.length);
  let parsed: Partial<SyncPairingPayload>;
  try {
    parsed = JSON.parse(base64UrlToUtf8(encoded)) as Partial<SyncPairingPayload>;
  } catch {
    throw new Error('Kopplungscode konnte nicht gelesen werden. Bitte vollständig kopieren.');
  }
  if (!parsed || parsed.v !== 1 || !parsed.url || !parsed.username || !parsed.appPassword) {
    throw new Error('Kopplungscode ist unvollständig (Nextcloud-Zugangsdaten fehlen).');
  }
  return {
    v: 1,
    url: String(parsed.url).trim(),
    username: String(parsed.username).trim(),
    appPassword: String(parsed.appPassword).trim(),
    folder: String(parsed.folder || '/TaktWerk').trim(),
    autoSync: parsed.autoSync !== false,
    syncIntervalSec:
      typeof parsed.syncIntervalSec === 'number' ? parsed.syncIntervalSec : 20,
    calendarUrl: parsed.calendarUrl ? String(parsed.calendarUrl).trim() : undefined,
    calendarName: parsed.calendarName ? String(parsed.calendarName).trim() : undefined,
    autoSyncTimeEntries: Boolean(parsed.autoSyncTimeEntries),
  };
}
