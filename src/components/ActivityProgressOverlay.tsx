import { CloudUpload, Loader2 } from 'lucide-react';
import { useActivityProgress } from '../utils/activityProgress';

export function ActivityProgressOverlay() {
  const tasks = useActivityProgress();
  if (tasks.length === 0) return null;

  const primary = tasks[tasks.length - 1];
  const isDeterminate = typeof primary.progress === 'number';
  const pct = isDeterminate ? Math.max(3, Math.min(100, primary.progress ?? 0)) : 0;

  return (
    <>
      {/* Sleek top viewport progress rail */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-x-0 top-0 z-[95] h-1 overflow-hidden bg-slate-200/80 dark:bg-[#241a3d]"
      >
        {isDeterminate ? (
          <svg
            viewBox="0 0 100 4"
            preserveAspectRatio="none"
            className="block h-full w-full"
          >
            <rect
              x="0"
              y="0"
              width={pct}
              height="4"
              className="fill-blue-700 dark:fill-violet-500 transition-all duration-200"
            />
          </svg>
        ) : (
          <div className="h-full w-1/3 rounded-full bg-blue-700 dark:bg-violet-500 tw-progress-indeterminate" />
        )}
      </div>

      {/* Compact floating progress status card */}
      <div
        role="status"
        aria-live="polite"
        className="no-print fixed bottom-4 left-4 right-4 z-[86] sm:left-auto sm:right-5 sm:w-80 rounded-2xl border border-slate-200/90 bg-white/95 p-3.5 shadow-2xl backdrop-blur-md dark:border-[#3b2d5e] dark:bg-[#19122c]/95 tw-popup-enter"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-violet-500/20 dark:text-violet-300">
            {isDeterminate ? (
              <CloudUpload className="h-4 w-4 animate-pulse" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                {primary.label}
              </p>
              {isDeterminate ? (
                <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-blue-700 dark:text-violet-300">
                  {Math.round(primary.progress ?? 0)} %
                </span>
              ) : (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-violet-300/70">
                  Läuft…
                </span>
              )}
            </div>

            {primary.detail && (
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {primary.detail}
              </p>
            )}

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-[#2a2045]">
              {isDeterminate ? (
                <svg
                  viewBox="0 0 100 6"
                  preserveAspectRatio="none"
                  className="block h-full w-full"
                >
                  <rect
                    x="0"
                    y="0"
                    width={pct}
                    height="6"
                    rx="3"
                    className="fill-blue-700 dark:fill-violet-500 transition-all duration-200"
                  />
                </svg>
              ) : (
                <div className="h-full w-2/5 rounded-full bg-blue-700 dark:bg-violet-500 tw-progress-indeterminate" />
              )}
            </div>

            {tasks.length > 1 && (
              <p className="text-[10px] font-medium text-slate-400 dark:text-violet-300/60">
                +{tasks.length - 1} weitere Aktion(en) aktiv
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
