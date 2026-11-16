import { Download, Share, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5 text-blue-700 dark:text-violet-400" />
        App installieren
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="h-3.5 w-3.5 text-blue-700 dark:text-violet-400" />
          Installieren
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-[#3b2d5e] dark:bg-[#171126]">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Auf iPhone / iPad installieren
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Anleitung schließen"
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#231b38] dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="font-mono text-xs font-bold text-blue-700 dark:text-violet-400 mt-0.5">
                    1.
                  </span>
                  <span>
                    Tippe unten in Safari auf das{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100">
                      <Share className="h-3.5 w-3.5" /> Teilen-Symbol
                    </span>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono text-xs font-bold text-blue-700 dark:text-violet-400 mt-0.5">
                    2.
                  </span>
                  <span>
                    Scrolle nach unten und wähle{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      Zum Home-Bildschirm
                    </strong>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono text-xs font-bold text-blue-700 dark:text-violet-400 mt-0.5">
                    3.
                  </span>
                  <span>
                    Tippe oben rechts auf{' '}
                    <strong className="text-slate-900 dark:text-slate-100">Hinzufügen</strong>.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 cursor-pointer"
              >
                Verstanden
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
