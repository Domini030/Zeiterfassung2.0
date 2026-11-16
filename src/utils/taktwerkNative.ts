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

  webdavUploadJson(options: {
    folderUrls: string[];
    fileUrl: string;
    username: string;
    appPassword: string;
    json: string;
  }): Promise<{ ok: boolean; status: number }>;

  openPdf(options: { filename: string; base64: string }): Promise<void>;

  sharePdf(options: { filename: string; base64: string }): Promise<void>;

  printWebView(options: { jobName?: string }): Promise<void>;
}

export const TaktWerkNative =
  registerPlugin<TaktWerkNativePluginInterface>('TaktWerkNative');
