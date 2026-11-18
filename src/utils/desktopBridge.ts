export interface DesktopTrayTimerState {
  running: boolean;
  paused: boolean;
  title: string;
  durationText: string;
}

export type DesktopTrayAction = 'pause' | 'resume' | 'stop' | 'search';

export interface TaktWerkDesktopBridge {
  isDesktop: true;
  platform: string;
  getAppVersion: () => Promise<{
    versionName: string;
    isDesktop: true;
    platform: string;
  }>;
  downloadAndRunInstaller: (options: {
    url: string;
    filename: string;
  }) => Promise<{ ok: boolean; message: string }>;
  openDataFolder: () => Promise<void>;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  printPage: () => Promise<void>;
  updateTrayState: (state: DesktopTrayTimerState) => void;
  onTrayAction: (callback: (action: DesktopTrayAction) => void) => () => void;
}

declare global {
  interface Window {
    taktwerkDesktop?: TaktWerkDesktopBridge;
  }
}

export function getDesktopBridge(): TaktWerkDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.taktwerkDesktop;
  return bridge && bridge.isDesktop ? bridge : null;
}

export function isDesktopElectron(): boolean {
  return getDesktopBridge() !== null;
}
