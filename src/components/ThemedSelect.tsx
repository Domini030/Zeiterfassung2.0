import { Check, ChevronDown, Plus, Tag, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ThemedSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface ThemedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export function ThemedSelect({
  value,
  onChange,
  options,
  placeholder = 'Bitte wählen...',
  disabled = false,
  className = '',
  size = 'md',
  ariaLabel,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selected = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const paddingClass = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#211936] cursor-pointer ${paddingClass} ${
          open
            ? 'ui-accent-ring border-violet-500 ring-2 dark:border-violet-400'
            : 'border-slate-300 text-slate-900 hover:border-slate-400 dark:border-[#3b2d5e] dark:text-slate-100 dark:hover:border-violet-500/70'
        }`}
      >
        <span
          className={`truncate ${
            selected
              ? 'font-medium text-slate-900 dark:text-slate-100'
              : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-violet-300/70 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-1 shadow-xl backdrop-blur-md dark:border-[#3b2d5e] dark:bg-[#1e1730]/95"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              Keine Einträge verfügbar
            </li>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <li key={opt.value} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'ui-accent-selected font-semibold'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.hint && (
                        <span className="block truncate text-[11px] opacity-70">
                          {opt.hint}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

interface CategoryPickerProps {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  placeholder?: string;
}

export function CategoryPicker({
  value,
  onChange,
  categories,
  placeholder = 'Kategorie wählen oder eingeben...',
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const applyCustom = () => {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setCustomDraft('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 transition-colors dark:bg-[#211936] ${
          open
            ? 'ui-accent-ring border-violet-500 ring-2 dark:border-violet-400'
            : 'border-slate-300 hover:border-slate-400 dark:border-[#3b2d5e] dark:hover:border-violet-500/70'
        }`}
      >
        <Tag className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-violet-300/70" />
        <input
          type="text"
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Kategorie leeren"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2a2045] dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Kategorieliste öffnen"
          aria-expanded={open}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-violet-300/80 dark:hover:bg-[#2a2045] cursor-pointer"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md dark:border-[#3b2d5e] dark:bg-[#1e1730]/95">
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {categories.map((cat) => {
              const isSelected = value.trim() === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    onChange(cat);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'ui-accent-selected font-semibold'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#2a2045]'
                  }`}
                >
                  <span className="truncate">{cat}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
            {categories.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                Noch keine Kategorien hinterlegt
              </div>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 border-t border-slate-200 pt-1.5 dark:border-[#3b2d5e]">
            <input
              type="text"
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyCustom();
                }
              }}
              placeholder="Neue Kategorie..."
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-violet-500 focus:outline-none dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-slate-100"
            />
            <button
              type="button"
              onClick={applyCustom}
              className="inline-flex items-center gap-1 rounded-lg ui-accent-btn px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Übernehmen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
