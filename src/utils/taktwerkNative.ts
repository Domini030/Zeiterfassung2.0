import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeNfcStatus = 'NFC_OK' | 'NFC_DISABLED' | 'NO_NFC';

export interface NativeNfcScannedEvent {
  uidHex: string;
  payloads: string[];
}

export interface NativeNfcWriteResultEvent {
  success: boolean;
  uri: string;
  error?: string;
}

export interface TaktWerkNativePluginInterface {
  webdavEnsureFolders(options: {
    folderUrls: string[];
    username: string;
    appPassword: string;
  }): Promise<{ ok: boolean }>;

  webdavUploadPdf(options: {
    folderUrls: string[];
    fileUrl: string;
    username: string;
    appPassword: string;
    base64: string;
  }): Promise<{ ok: boolean; status: number }>;

  webdavUploadFile(options: {
    folderUrls: string[];
    fileUrl: string;
    username: string;
    appPassword: string;
    contentType: string;
    content: string;
  }): Promise<{ ok: boolean; status: number }>;

  webdavUploadJson(options: {
    folderUrls: string[];
    fileUrl: string;
    username: string;
    appPassword: string;
    json: string;
  }): Promise<{ ok: boolean; status: number }>;

  webdavDownloadJson(options: {
    fileUrl: string;
    username: string;
    appPassword: string;
  }): Promise<{ found: boolean; json?: string }>;

  openPdf(options: { filename: string; base64: string }): Promise<void>;

  sharePdf(options: { filename: string; base64: string }): Promise<void>;

  shareTextFile(options: {
    filename: string;
    mimeType: string;
    content: string;
  }): Promise<void>;

  printWebView(options: { jobName?: string }): Promise<void>;

  hapticFeedback(options: { pattern: 'start' | 'stop' | 'error' }): Promise<void>;

  showActiveTimerNotification(options: {
    title: string;
    customer: string;
    startTimeMs: number;
    isPaused: boolean;
    pausedDuration?: string;
  }): Promise<void>;

  clearActiveTimerNotification(): Promise<void>;

  getNfcStatus(): Promise<{
    supported: boolean;
    enabled: boolean;
    status: NativeNfcStatus;
  }>;

  openNfcSettings(): Promise<void>;

  armNfcWrite(options: { uri: string }): Promise<void>;

  cancelNfcWrite(): Promise<void>;

  addListener(
    eventName: 'nfcTagScanned',
    listenerFunc: (event: NativeNfcScannedEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'nfcWriteResult',
    listenerFunc: (event: NativeNfcWriteResultEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const TaktWerkNative =
  registerPlugin<TaktWerkNativePluginInterface>('TaktWerkNative');
