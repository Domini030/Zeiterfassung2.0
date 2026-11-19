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

export type NotificationPermissionStatus =
  | 'OK'
  | 'PERMISSION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'CHANNEL_DISABLED';

export interface NativeNotificationStatus {
  supported: boolean;
  enabled: boolean;
  permissionGranted: boolean;
  systemEnabled: boolean;
  channelEnabled: boolean;
  status: NotificationPermissionStatus;
  shown?: boolean;
}

export interface NativeTimerNotificationActionEvent {
  action: 'pause' | 'resume' | 'stop';
}

export interface NativeWidgetActionEvent {
  action: string;
  tagUid?: string;
}

export type LocationPermissionOverallStatus =
  | 'OK'
  | 'FOREGROUND_REQUIRED'
  | 'BACKGROUND_REQUIRED'
  | 'GPS_DISABLED';

export interface NativeLocationPermissionStatus {
  supported: boolean;
  foregroundGranted: boolean;
  fineGranted: boolean;
  backgroundGranted: boolean;
  gpsEnabled: boolean;
  batteryOptimizationIgnored: boolean;
  serviceRunning: boolean;
  openedSettings?: boolean;
  status: LocationPermissionOverallStatus;
}

export interface NativeGeoFenceEvent {
  eventId: string;
  type: 'enter' | 'exit_auto' | 'exit_ask';
  ruleId: string;
  ruleName: string;
  taskTitle: string;
  notes: string;
  customerId: string;
  customerName: string;
  productId: string;
  hourlyRateNet: number;
  taxRate: number;
  address: string;
  timestampIso: string;
  timestampMs: number;
  lat: number;
  lng: number;
  accuracyMeters: number;
  distanceMeters: number;
}

export interface NativeSystemSoundItem {
  uri: string;
  title: string;
}

export interface NativePickedSoundResult {
  cancelled: boolean;
  uri?: string;
  title?: string;
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

  webdavUploadBinary(options: {
    folderUrls: string[];
    fileUrl: string;
    username: string;
    appPassword: string;
    contentType: string;
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

  webdavDeleteFiles(options: {
    fileUrls: string[];
    username: string;
    appPassword: string;
  }): Promise<{ deletedCount: number }>;

  caldavRequest(options: {
    method: string;
    url: string;
    username: string;
    appPassword: string;
    depth?: string;
    contentType?: string;
    body?: string;
  }): Promise<{ status: number; body: string }>;

  getLocationPermissionStatus(): Promise<NativeLocationPermissionStatus>;

  requestBackgroundLocationPermission(): Promise<NativeLocationPermissionStatus>;

  openLocationPermissionSettings(): Promise<void>;

  openBatterySettings(): Promise<void>;

  syncGeoFenceMonitoring(options: {
    enabled: boolean;
    intervalSec: number;
    exitConfirmMode: 'ask' | 'auto';
    hasActiveTimer: boolean;
    activeGeoRuleId: string;
    soundPreset: string;
    systemSoundUri: string;
    rulesJson: string;
  }): Promise<NativeLocationPermissionStatus>;

  consumePendingGeoEvents(): Promise<{ events: NativeGeoFenceEvent[] }>;

  getCurrentLocation(): Promise<{
    lat: number;
    lng: number;
    accuracyMeters: number;
  }>;

  openPdf(options: { filename: string; base64: string }): Promise<void>;

  sharePdf(options: { filename: string; base64: string }): Promise<void>;

  shareBinaryFile(options: {
    filename: string;
    mimeType: string;
    base64: string;
  }): Promise<void>;

  shareTextFile(options: {
    filename: string;
    mimeType: string;
    content: string;
  }): Promise<void>;

  printWebView(options: { jobName?: string }): Promise<void>;

  hapticFeedback(options: { pattern: 'start' | 'stop' | 'error' }): Promise<void>;

  getNotificationStatus(): Promise<NativeNotificationStatus>;

  requestNotificationPermission(): Promise<NativeNotificationStatus>;

  openNotificationSettings(): Promise<void>;

  getPendingTimerAction(): Promise<{ action?: string | null }>;

  showActiveTimerNotification(options: {
    title: string;
    customer: string;
    notes?: string;
    startTimeMs: number;
    isPaused: boolean;
    pausedDuration?: string;
  }): Promise<NativeNotificationStatus>;

  clearActiveTimerNotification(): Promise<void>;

  scheduleTimerReminder(options: {
    delayMs: number;
    title: string;
    body: string;
    soundPreset: string;
    systemSoundUri?: string;
  }): Promise<void>;

  cancelTimerReminder(): Promise<void>;

  playReminderTone(options: { preset: string; systemSoundUri?: string }): Promise<void>;

  pickSystemNotificationSound(options?: {
    existingUri?: string;
    ringtoneType?: 'notification' | 'alarm' | 'all';
  }): Promise<NativePickedSoundResult>;

  listSystemNotificationSounds(options?: {
    ringtoneType?: 'notification' | 'alarm';
  }): Promise<{ sounds: NativeSystemSoundItem[] }>;

  updateWidgetState(options: {
    isRunning: boolean;
    isPaused: boolean;
    timerTitle: string;
    customerName: string;
    startTimeMs: number;
    todayHoursLabel: string;
    quickTasksJson: string;
  }): Promise<void>;

  getPendingWidgetAction(): Promise<{ action?: string | null; tagUid?: string | null }>;

  getNfcStatus(): Promise<{
    supported: boolean;
    enabled: boolean;
    status: NativeNfcStatus;
  }>;

  openNfcSettings(): Promise<void>;

  armNfcWrite(options: { uri: string }): Promise<void>;

  cancelNfcWrite(): Promise<void>;

  getPendingLaunchNfc(): Promise<{ uidHex?: string | null; payloads?: string[] }>;

  getAppVersion(): Promise<{ versionName: string; versionCode: number }>;

  downloadAndInstallApk(options: {
    url: string;
    filename?: string;
  }): Promise<{ ok: boolean; needsPermission?: boolean; message?: string }>;

  sharePdfWithEmail(options: {
    filename: string;
    base64: string;
    to?: string;
    subject: string;
    body: string;
  }): Promise<void>;

  getBiometricAvailability(): Promise<{
    available: boolean;
    hasBiometricHardware: boolean;
    status: string;
  }>;

  authenticateBiometric(options?: {
    title?: string;
    subtitle?: string;
  }): Promise<{ authenticated: boolean; cancelled?: boolean; error?: string }>;

  addListener(
    eventName: 'nfcTagScanned',
    listenerFunc: (event: NativeNfcScannedEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'nfcWriteResult',
    listenerFunc: (event: NativeNfcWriteResultEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'timerNotificationAction',
    listenerFunc: (event: NativeTimerNotificationActionEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'widgetActionTriggered',
    listenerFunc: (event: NativeWidgetActionEvent) => void
  ): Promise<PluginListenerHandle>;

  addListener(
    eventName: 'geoFenceEvent',
    listenerFunc: (event: NativeGeoFenceEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const TaktWerkNative =
  registerPlugin<TaktWerkNativePluginInterface>('TaktWerkNative');
