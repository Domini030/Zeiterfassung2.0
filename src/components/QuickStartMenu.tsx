import { ArrowRight, ChevronDown, Clock, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ActiveTimer } from '../types';

export interface QuickStartTaskItem {
  key: string;
  entryType: 'project' | 'internal';
  customerId: string;
  productId: string;
  internalCategory?: string;
  title: string;
  notes: string;
  subtitle: string;
}

interface QuickStartMenuProps {
  recentTasks: QuickStartTaskItem[];
  activeTimer: ActiveTimer | null;
  onStartTask: (task: QuickStartTaskItem) => void;
  onOpenTracker: () => void;
  compactMobile?: boolean;
}

export function QuickStartMenu({
  recentTasks,
  activeTimer,
  onStartTask,
  onOpenTracker,
  compactMobile = false,
}: QuickStartMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={compactMobile ? 'sm:relative' : 'relative'}
      data-no-swipe="true"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Aufgabe schnell starten (letzte 3 Aufträge)"
        className={`inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100 dark:hover:bg-[#2a2045] whitespace-nowrap shrink-0 cursor-pointer ${
          compactMobile
            ? activeTimer
              ? 'h-9 px-2 text-xs'
              : 'h-9 px-2.5 text-xs'
            : 'px-3 py-1.5 text-xs gap-1.5'
        }`}
      >
        <Play className="h-3.5 w-3.5 shrink-0 fill-current text-blue-700 dark:text-violet-400" />
        {compactMobile ? (
          activeTimer ? (
            <span className="hidden sm:inline">Aufgabe</span>
          ) : (
            <>
              <span className="sm:hidden">Aufgabe</span>
              <span className="hidden sm:inline">Aufgabe starten</span>
            </>
          )
        ) : (
          <span>Auftrag starten</span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          data-no-swipe="true"
          className={
            compactMobile
              ? 'absolute inset-x-3 top-full z-50 mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126] sm:inset-x-auto sm:right-0 sm:w-80'
              : 'absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]'
          }
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Letzte 3 Aufträge
            </span>
            <Clock className="h-3.5 w-3.5 text-slate-400" />
          </div>

          {activeTimer && (
            <div className="mx-2 mb-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
              Laufender Timer wird beim Wechsel automatisch gespeichert.
            </div>
          )}

          {recentTasks.length === 0 ? (
            <div className="px-2.5 py-3 text-xs text-slate-500 dark:text-slate-400">
              Noch keine gestarteten Aufträge vorhanden. Starte deinen ersten Auftrag in der Zeiterfassung.
            </div>
          ) : (
            <div className="space-y-1">
              {recentTasks.map((task) => (
                <button
                  key={task.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onStartTask(task);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-[#241b3a] cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {task.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {task.entryType === 'internal' && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                          Intern
                        </span>
                      )}
                      <span className="truncate">{task.subtitle}</span>
                    </div>
                  </div>
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-violet-950/70 dark:text-violet-300">
                    <Play className="h-3.5 w-3.5 fill-current" />
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 border-t border-slate-100 pt-1.5 dark:border-[#2e2349]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenTracker();
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:text-violet-300 dark:hover:bg-[#241b3a] cursor-pointer"
            >
              <span>Neuen Auftrag konfigurieren</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
