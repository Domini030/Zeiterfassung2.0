import {
  BarChart3,
  Calendar,
  Clock,
  Cloud,
  FilePlus2,
  FileText,
  Menu,
  Moon,
  Nfc,
  Package,
  Receipt,
  Repeat,
  Square,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActiveTimer, NavSection, NextcloudConfigInfo } from '../types';
import { formatDuration } from '../utils/format';
import { PWAInstallButton } from './PWAInstallButton';
import { QuickStartMenu, type QuickStartTaskItem } from './QuickStartMenu';

interface SidebarProps {
  activeSection: NavSection;
  sectionTitle: string;
  onSelectSection: (section: NavSection) => void;
  nextcloud: NextcloudConfigInfo;
  openTimeCount: number;
  unpaidInvoiceCount: number;
  dueRecurringCount?: number;
  activeTimer: ActiveTimer | null;
  elapsedSeconds: number;
  recentQuickTasks: QuickStartTaskItem[];
  onQuickStartTask: (task: QuickStartTaskItem) => void;
  onStopTimer: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const NAV_ITEMS: { id: NavSection; label: string; icon: typeof Clock }[] = [
  { id: 'tracker', label: 'Zeiterfassung', icon: Clock },
  { id: 'calendar', label: 'Kalender', icon: Calendar },
  { id: 'analytics', label: 'Auswertung', icon: BarChart3 },
  { id: 'nfc', label: 'NFC-Aufgaben', icon: Nfc },
  { id: 'customers', label: 'Kunden', icon: Users },
  { id: 'products', label: 'Produkte', icon: Package },
  { id: 'expenses', label: 'Belege & Kosten', icon: Receipt },
  { id: 'recurring', label: 'Wiederkehrend', icon: Repeat },
  { id: 'invoices', label: 'Rechnungen', icon: FileText },
  { id: 'settings', label: 'Nextcloud & Setup', icon: Cloud },
];

export function Sidebar({
  activeSection,
  sectionTitle,
  onSelectSection,
  nextcloud,
  openTimeCount,
  unpaidInvoiceCount,
  dueRecurringCount = 0,
  activeTimer,
  elapsedSeconds,
  recentQuickTasks,
  onQuickStartTask,
  onStopTimer,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const handleNav = (id: NavSection) => {
    onSelectSection(id);
    setMobileOpen(false);
  };

  const renderNavList = () => (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeSection === item.id;
        let countText = '';
        if (item.id === 'tracker' && openTimeCount > 0) countText = String(openTimeCount);
        if (item.id === 'invoices' && unpaidInvoiceCount > 0)
          countText = String(unpaidInvoiceCount);
        if (item.id === 'recurring' && dueRecurringCount > 0)
          countText = String(dueRecurringCount);

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleNav(item.id)}
            className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isActive
                ? 'ui-accent-active text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#231b38] dark:hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2.5 truncate">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
            {countText && (
              <span
                className={`font-mono text-xs tabular-nums ${
                  isActive
                    ? 'text-slate-300 dark:text-violet-100'
                    : 'text-slate-400 dark:text-violet-300/60'
                }`}
              >
                {countText}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Sticky Mobile Top Header (Hamburger + Brand + Aufgabe starten + Rechnung erstellen) */}
      <header
        data-no-swipe="true"
        className="no-print sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-slate-200/90 bg-white/95 px-2.5 shadow-xs backdrop-blur-md dark:border-[#2e2349] dark:bg-[#171126]/95 sm:px-4 lg:hidden"
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={mobileOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-200 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => handleNav('tracker')}
            className="min-w-0 text-left cursor-pointer"
          >
            <div className="font-display text-sm font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 sm:text-base whitespace-nowrap">
              TaktWerk
            </div>
            <div className="truncate text-[10px] font-medium leading-tight text-slate-500 dark:text-slate-400 max-w-[100px] sm:max-w-[180px]">
              {sectionTitle}
            </div>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Quick-Start Dropdown (Last 3 Tasks) */}
          <QuickStartMenu
            recentTasks={recentQuickTasks}
            activeTimer={activeTimer}
            onStartTask={(task) => {
              setMobileOpen(false);
              onQuickStartTask(task);
            }}
            onOpenTracker={() => handleNav('tracker')}
            compactMobile={true}
          />

          {activeTimer ? (
            <>
              <button
                type="button"
                onClick={onStopTimer}
                title={`Laufende Aufgabe "${activeTimer.title}" stoppen`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-2.5 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="h-3 w-3 shrink-0 fill-current" />
                <span className="font-mono tabular-nums">{formatDuration(elapsedSeconds)}</span>
              </button>
              <button
                type="button"
                onClick={() => handleNav('invoices')}
                title="Rechnung erstellen"
                aria-label="Rechnung erstellen"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#2a2045] dark:text-violet-100 dark:hover:bg-[#352857] cursor-pointer"
              >
                <FilePlus2 className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleNav('invoices')}
              title="Rechnung erstellen"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-violet-600 dark:hover:bg-violet-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FilePlus2 className="h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">Rechnung</span>
              <span className="hidden sm:inline">Rechnung erstellen</span>
            </button>
          )}
        </div>
      </header>

      {/* Fixed Mobile Navigation Drawer (always opens right below the sticky header) */}
      {mobileOpen && (
        <div className="no-print fixed inset-x-0 top-14 bottom-0 z-40 flex flex-col lg:hidden">
          <div
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 top-14 bg-slate-950/40 backdrop-blur-[1px]"
            aria-hidden="true"
          />
          <div className="relative z-10 max-h-full overflow-y-auto border-b border-slate-200 bg-white shadow-2xl dark:border-[#2e2349] dark:bg-[#171126]">
            {activeTimer && (
              <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-lg border border-blue-200/80 bg-blue-50/70 px-3 py-2 text-xs dark:border-violet-800/60 dark:bg-violet-950/40">
                <button
                  type="button"
                  onClick={() => handleNav('tracker')}
                  className="min-w-0 flex-1 truncate text-left font-semibold text-blue-800 dark:text-violet-200 cursor-pointer"
                >
                  Läuft: {activeTimer.title}
                </button>
                <span className="font-mono font-semibold text-blue-700 dark:text-violet-300 tabular-nums shrink-0">
                  {formatDuration(elapsedSeconds)}
                </span>
              </div>
            )}

            {renderNavList()}

            <div className="space-y-2 border-t border-slate-200 p-3 dark:border-[#2e2349]">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="flex flex-1 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:bg-[#2a2045] cursor-pointer"
                >
                  <span>Erscheinungsbild</span>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    {theme === 'dark' ? (
                      <>
                        <Moon className="h-3.5 w-3.5 text-violet-400" />
                        Dunkel
                      </>
                    ) : (
                      <>
                        <Sun className="h-3.5 w-3.5 text-amber-500" />
                        Hell
                      </>
                    )}
                  </span>
                </button>
                <PWAInstallButton />
              </div>

              <button
                type="button"
                onClick={() => handleNav('settings')}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:border-[#3b2d5e] dark:bg-[#211936] dark:hover:bg-[#2a2045] cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Speicherziel
                  </span>
                  <span className="text-xs font-medium text-slate-600 dark:text-violet-300">
                    {nextcloud.configured ? 'Nextcloud' : 'Lokal'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {nextcloud.configured
                    ? nextcloud.url.replace(/^https?:\/\//, '')
                    : 'Nextcloud jetzt verbinden'}
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Desktop Sidebar */}
      <aside className="no-print hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white dark:lg:border-[#2e2349] dark:lg:bg-[#171126]">
        <div className="flex h-16 shrink-0 items-center border-b border-slate-200 px-6 dark:border-[#2e2349]">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            TaktWerk
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">{renderNavList()}</div>

        <div className="shrink-0 space-y-2 border-t border-slate-200 p-4 dark:border-[#2e2349]">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-100 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            <span>Erscheinungsbild</span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              {theme === 'dark' ? (
                <>
                  <Moon className="h-3.5 w-3.5 text-violet-400" />
                  Dunkel
                </>
              ) : (
                <>
                  <Sun className="h-3.5 w-3.5" />
                  Hell
                </>
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleNav('settings')}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:bg-slate-100 dark:border-[#3b2d5e] dark:bg-[#211936] dark:hover:bg-[#2a2045] cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Speicherziel
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-violet-300">
                {nextcloud.configured ? 'Nextcloud' : 'Lokal'}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {nextcloud.configured
                ? nextcloud.url.replace(/^https?:\/\//, '')
                : 'Nextcloud jetzt verbinden'}
            </p>
          </button>
        </div>
      </aside>
    </>
  );
}
