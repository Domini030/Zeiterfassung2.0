import { registerPlugin } from '@capacitor/core';

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
}

export const TaktWerkNative =
  registerPlugin<TaktWerkNativePluginInterface>('TaktWerkNative');
