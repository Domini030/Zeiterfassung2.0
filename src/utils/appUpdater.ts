import { Capacitor } from '@capacitor/core';
import { trackActivity } from './activityProgress';
import { TaktWerkNative } from './taktwerkNative';

export const WEB_APP_VERSION = '1.1.0';
export const WEB_APP_VERSION_CODE = 100;

export interface AppVersionInfo {
  versionName: string;
  versionCode: number;
  isNative: boolean;
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
}

export function normalizeVersionParts(version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, '').split('-')[0];
  return cleaned
    .split('.')
    .map((p) => {
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
  const isNative = Capacitor.isNativePlatform();
  if (isNative) {
    try {
      const info = await TaktWerkNative.getAppVersion();
      return {
        versionName: info.versionName || WEB_APP_VERSION,
        versionCode: info.versionCode || WEB_APP_VERSION_CODE,
        isNative: true,
      };
    } catch {
      // Fallback
    }
  }
  return {
    versionName: WEB_APP_VERSION,
    versionCode: WEB_APP_VERSION_CODE,
    isNative,
  };
}

export async function checkGithubReleaseUpdate(
  repoInput: string
): Promise<GithubReleaseUpdateInfo> {
  const repo = sanitizeGithubRepo(repoInput);
  if (!repo) {
    throw new Error('Bitte ein gültiges GitHub-Repository im Format „Benutzer/Repository“ angeben.');
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
          `Kein veröffentlichtes GitHub-Release unter „${repo}“ gefunden. Starte zuerst einen Android-Build oder erstelle ein Release mit APK.`
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

      const tagName = (data.tag_name || '').trim();
      const latestVersion = tagName.replace(/^v/i, '') || '0.0.0';
      const apkAsset = (data.assets || []).find((a) =>
        (a.name || '').toLowerCase().endsWith('.apk')
      );

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
      };
    },
    10,
    repo
  );
}

export async function downloadAndInstallReleaseUpdate(
  release: GithubReleaseUpdateInfo
): Promise<{ startedInstall: boolean; needsPermission?: boolean; message: string }> {
  if (!release.apkDownloadUrl) {
    throw new Error(
      'Dieses GitHub-Release enthält keine APK-Datei. Öffne die Release-Seite im Browser.'
    );
  }

  if (Capacitor.isNativePlatform()) {
    return trackActivity(
      `Lade Update ${release.tagName} herunter…`,
      async (update) => {
        update(35, release.apkFileName || 'TaktWerk.apk');
        const result = await TaktWerkNative.downloadAndInstallApk({
          url: release.apkDownloadUrl!,
          filename: release.apkFileName || `TaktWerk-${release.latestVersion}.apk`,
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
      release.apkFileName || 'APK'
    );
  }

  // Web fallback: trigger direct APK download via anchor
  const link = document.createElement('a');
  link.href = release.apkDownloadUrl;
  link.download = release.apkFileName || `TaktWerk-${release.latestVersion}.apk`;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return {
    startedInstall: true,
    message: `APK-Download (${release.apkFileName}) gestartet. Übertrage und installiere die Datei auf deinem Android-Gerät.`,
  };
}
