import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void;
}

interface ConfirmActionDialogProps {
  dialog: ConfirmDialogState | null;
  onCancel: () => void;
}

export function ConfirmActionDialog({ dialog, onCancel }: ConfirmActionDialogProps) {
  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, onCancel]);

  if (!dialog) return null;

  const isWarning = dialog.tone === 'warning';

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-action-title"
      className="no-print fixed inset-0 z-[96] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#3b2d5e] dark:bg-[#19122c] tw-popup-enter"
      >
        <div className="flex items-start gap-3.5">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isWarning
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
            }`}
          >
            {isWarning ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <Trash2 className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-action-title"
              className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
            >
              {dialog.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {dialog.message}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Dialog schließen"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2.5 border-t border-slate-100 pt-4 dark:border-[#2e2349]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-200 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => {
              const fn = dialog.onConfirm;
              onCancel();
              fn();
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white cursor-pointer ${
              isWarning
                ? 'bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500'
                : 'bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500'
            }`}
          >
            {!isWarning && <Trash2 className="h-3.5 w-3.5" />}
            {dialog.confirmLabel || 'Löschen'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

export interface UndoBannerState {
  id: number;
  label: string;
  durationMs: number;
  expiresAt: number;
  onUndo: () => void;
}

interface UndoDeleteBannerProps {
  undo: UndoBannerState | null;
  onDismiss: () => void;
}

export function UndoDeleteBanner({ undo, onDismiss }: UndoDeleteBannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!undo) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= undo.expiresAt) {
        onDismiss();
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [undo, onDismiss]);

  if (!undo) return null;

  const remainingMs = Math.max(0, undo.expiresAt - nowMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const pct = Math.max(0, Math.min(100, (remainingMs / undo.durationMs) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-4 left-1/2 z-[88] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md dark:border-violet-500/40 dark:bg-[#1d1433]/95 tw-popup-enter"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{undo.label}</p>
          <p className="text-[11px] text-slate-300 dark:text-violet-200/75">
            Noch <span className="font-mono font-semibold tabular-nums">{remainingSec}s</span> zum Rückgängig machen
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const fn = undo.onUndo;
              onDismiss();
              fn();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Rückgängig
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Rückgängig-Hinweis schließen"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="h-1 w-full bg-white/10">
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="block h-full w-full">
          <rect
            x="0"
            y="0"
            width={pct}
            height="4"
            className="fill-violet-400 transition-all duration-100"
          />
        </svg>
      </div>
    </div>
  );
}
