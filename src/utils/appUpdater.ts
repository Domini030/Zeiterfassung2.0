import { Capacitor } from '@capacitor/core';
import { trackActivity } from './activityProgress';
import { getDesktopBridge } from './desktopBridge';
import { TaktWerkNative } from './taktwerkNative';

export const WEB_APP_VERSION = '1.1.0';
export const WEB_APP_VERSION_CODE = 100;

export interface AppVersionInfo {
  versionName: string;
  versionCode: number;
  isNative: boolean;
  isDesktop: boolean;
}

export interface GithubReleaseUpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  releaseName: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  apkDownloadUrl: string | null;
  apkFileName: string | null;
  apkSizeBytes: number | null;
  windowsInstallerUrl: string | null;
  windowsInstallerFileName: string | null;
  windowsInstallerSizeBytes: number | null;
  windowsPortableUrl: string | null;
  windowsPortableFileName: string | null;
}

export function normalizeVersionParts(version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, '').split('-')[0];
  return cleaned.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersionParts(a);
  const pb = normalizeVersionParts(b);
  const maxLen = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < maxLen; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export function sanitizeGithubRepo(input: string | undefined | null): string {
  if (!input) return '';
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/^\/+|\/+$/g, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return `${parts[0]}/${parts[1]}`;
}

export async function getCurrentAppVersion(): Promise<AppVersionInfo> {
  const desktop = getDesktopBridge();
  if (desktop) {
    try {
      const info = await desktop.getAppVersion();
      return {
        versionName: info.versionName || WEB_APP_VERSION,
        versionCode: WEB_APP_VERSION_CODE,
        isNative: false,
        isDesktop: true,
      };
    } catch {
      return {
        versionName: WEB_APP_VERSION,
        versionCode: WEB_APP_VERSION_CODE,
        isNative: false,
        isDesktop: true,
      };
    }
  }

  const isNative = Capacitor.isNativePlatform();
  if (isNative) {
    try {
      const info = await TaktWerkNative.getAppVersion();
      return {
        versionName: info.versionName || WEB_APP_VERSION,
        versionCode: info.versionCode || WEB_APP_VERSION_CODE,
        isNative: true,
        isDesktop: false,
      };
    } catch {
      // Fallback
    }
  }
  return {
    versionName: WEB_APP_VERSION,
    versionCode: WEB_APP_VERSION_CODE,
    isNative,
    isDesktop: false,
  };
}

export async function checkGithubReleaseUpdate(
  repoInput: string
): Promise<GithubReleaseUpdateInfo> {
  const repo = sanitizeGithubRepo(repoInput);
  if (!repo) {
    throw new Error(
      'Bitte ein gültiges GitHub-Repository im Format „Benutzer/Repository“ angeben.'
    );
  }

  return trackActivity(
    'Prüfe auf neue TaktWerk-Version…',
    async (update) => {
      update(25, repo);
      const current = await getCurrentAppVersion();
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });
      if (res.status === 404) {
        throw new Error(
          `Kein veröffentlichtes GitHub-Release unter „${repo}“ gefunden. Starte zuerst einen Build oder erstelle ein Release.`
        );
      }
      if (!res.ok) {
        throw new Error(`GitHub API antwortet mit HTTP ${res.status}.`);
      }

      update(70, 'Release-Daten werden ausgewertet…');
      const data = (await res.json()) as {
        tag_name?: string;
        name?: string;
        body?: string;
        published_at?: string;
        html_url?: string;
        assets?: {
          name?: string;
          browser_download_url?: string;
          size?: number;
        }[];
      };

      const assets = data.assets || [];
      const tagName = (data.tag_name || '').trim();
      const latestVersion = tagName.replace(/^v/i, '') || '0.0.0';

      const apkAsset = assets.find((a) => (a.name || '').toLowerCase().endsWith('.apk'));
      const exeAssets = assets.filter((a) => (a.name || '').toLowerCase().endsWith('.exe'));
      const setupExeAsset =
        exeAssets.find((a) => /setup|installer/i.test(a.name || '')) ||
        exeAssets.find((a) => !/portable/i.test(a.name || '')) ||
        exeAssets[0];
      const portableExeAsset = exeAssets.find((a) => /portable/i.test(a.name || ''));

      const isNewer = compareVersions(latestVersion, current.versionName) > 0;
      update(100, isNewer ? `Version ${latestVersion} verfügbar` : 'Aktuell');

      return {
        available: isNewer,
        currentVersion: current.versionName,
        latestVersion,
        tagName: tagName || `v${latestVersion}`,
        releaseName: data.name || tagName || `Version ${latestVersion}`,
        body: (data.body || '').trim(),
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || `https://github.com/${repo}/releases`,
        apkDownloadUrl: apkAsset?.browser_download_url || null,
        apkFileName: apkAsset?.name || `TaktWerk-${latestVersion}.apk`,
        apkSizeBytes: typeof apkAsset?.size === 'number' ? apkAsset.size : null,
        windowsInstallerUrl: setupExeAsset?.browser_download_url || null,
        windowsInstallerFileName:
          setupExeAsset?.name || `TaktWerk-Setup-v${latestVersion}.exe`,
        windowsInstallerSizeBytes:
          typeof setupExeAsset?.size === 'number' ? setupExeAsset.size : null,
        windowsPortableUrl: portableExeAsset?.browser_download_url || null,
        windowsPortableFileName:
          portableExeAsset?.name || `TaktWerk-Portable-v${latestVersion}.exe`,
      };
    },
    10,
    repo
  );
}

function triggerBrowserDownload(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function downloadAndInstallReleaseUpdate(
  release: GithubReleaseUpdateInfo,
  target: 'auto' | 'android' | 'windows' = 'auto'
): Promise<{ startedInstall: boolean; needsPermission?: boolean; message: string }> {
  const desktop = getDesktopBridge();
  const isAndroid = Capacitor.isNativePlatform();
  const resolvedTarget: 'android' | 'windows' =
    target === 'auto'
      ? desktop
        ? 'windows'
        : isAndroid
          ? 'android'
          : release.windowsInstallerUrl && !release.apkDownloadUrl
            ? 'windows'
            : 'android'
      : target;

  if (resolvedTarget === 'windows') {
    if (!release.windowsInstallerUrl) {
      throw new Error(
        'Dieses GitHub-Release enthält noch keine Windows-EXE-Datei. Öffne die Release-Seite im Browser.'
      );
    }
    const exeName =
      release.windowsInstallerFileName || `TaktWerk-Setup-v${release.latestVersion}.exe`;

    if (desktop) {
      return trackActivity(
        `Lade Windows-Update ${release.tagName} herunter…`,
        async (update) => {
          update(35, exeName);
          const result = await desktop.downloadAndRunInstaller({
            url: release.windowsInstallerUrl!,
            filename: exeName,
          });
          update(100, 'Installer gestartet');
          return {
            startedInstall: Boolean(result.ok),
            message:
              result.message ||
              `Windows-Installer für ${release.tagName} wurde gestartet. Alle Daten bleiben erhalten.`,
          };
        },
        15,
        exeName
      );
    }

    triggerBrowserDownload(release.windowsInstallerUrl, exeName);
    return {
      startedInstall: true,
      message: `Windows-Installer (${exeName}) wird heruntergeladen.`,
    };
  }

  if (!release.apkDownloadUrl) {
    throw new Error(
      'Dieses GitHub-Release enthält keine Android-APK-Datei. Öffne die Release-Seite im Browser.'
    );
  }

  const apkName = release.apkFileName || `TaktWerk-${release.latestVersion}.apk`;

  if (isAndroid) {
    return trackActivity(
      `Lade Update ${release.tagName} herunter…`,
      async (update) => {
        update(35, apkName);
        const result = await TaktWerkNative.downloadAndInstallApk({
          url: release.apkDownloadUrl!,
          filename: apkName,
        });
        update(100, 'Installationsdialog geöffnet');
        if (result.needsPermission) {
          return {
            startedInstall: false,
            needsPermission: true,
            message:
              result.message ||
              'Bitte erlaube „Apps aus dieser Quelle installieren“ in den Android-Einstellungen und tippe erneut auf Installieren.',
          };
        }
        return {
          startedInstall: true,
          message:
            result.message ||
            `Android-Update-Installer für ${release.tagName} wurde gestartet. Alle Daten bleiben erhalten.`,
        };
      },
      15,
      apkName
    );
  }

  triggerBrowserDownload(release.apkDownloadUrl, apkName);
  return {
    startedInstall: true,
    message: `APK-Download (${apkName}) gestartet. Übertrage und installiere die Datei auf deinem Android-Gerät.`,
  };
}
