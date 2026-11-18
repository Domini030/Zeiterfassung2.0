import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X } from 'lucide-react';

interface InfoHintPopupProps {
  text: React.ReactNode;
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const InfoHintPopup: React.FC<InfoHintPopupProps> = ({
  text,
  title,
  size = 'md',
  className = '',
}) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const btnSizeClass = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const iconSizeClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={title ? `Info zu ${title}` : 'Beschreibung anzeigen'}
        aria-expanded={open}
        title="Beschreibung anzeigen"
        className={`inline-flex ${btnSizeClass} shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-500 dark:hover:bg-[#2a2045] dark:hover:text-violet-300 cursor-pointer ${
          open
            ? 'bg-slate-100 text-slate-900 dark:bg-[#2a2045] dark:text-violet-300'
            : ''
        } ${className}`}
      >
        <HelpCircle className={iconSizeClass} />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title || 'Hinweis'}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#3b2d5e] dark:bg-[#171126]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <HelpCircle className="h-4 w-4 shrink-0 text-blue-700 dark:text-violet-400" />
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {title || 'Hinweis'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Popup schließen"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-[#2a2045] dark:hover:text-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {text}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
