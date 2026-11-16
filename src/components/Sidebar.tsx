import {
  BarChart3,
  Calendar,
  Clock,
  Cloud,
  FileText,
  Menu,
  Moon,
  Nfc,
  Package,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { NavSection, NextcloudConfigInfo } from '../types';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  nextcloud: NextcloudConfigInfo;
  openTimeCount: number;
  unpaidInvoiceCount: number;
  activeTimerTitle: string | null;
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
  { id: 'invoices', label: 'Rechnungen', icon: FileText },
  { id: 'settings', label: 'Nextcloud & Setup', icon: Cloud },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  nextcloud,
  openTimeCount,
  unpaidInvoiceCount,
  activeTimerTitle,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

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
      {/* Mobile Header */}
      <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-[#2e2349] dark:bg-[#171126] lg:hidden">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
          TaktWerk
        </span>
        <div className="flex items-center gap-2">
          {activeTimerTitle && (
            <button
              type="button"
              onClick={() => handleNav('tracker')}
              className="text-xs font-medium text-blue-700 hover:underline dark:text-violet-400 whitespace-nowrap shrink-0 max-w-[120px] truncate cursor-pointer"
            >
              Aktiv: {activeTimerTitle}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={
              theme === 'dark' ? 'Zum Hellmodus wechseln' : 'Zum Dunkelmodus wechseln'
            }
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-200 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Menü öffnen"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-[#3b2d5e] dark:bg-[#211936] dark:text-violet-200 dark:hover:bg-[#2a2045] cursor-pointer"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="no-print border-b border-slate-200 bg-white dark:border-[#2e2349] dark:bg-[#171126] lg:hidden">
          {renderNavList()}
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white dark:lg:border-[#2e2349] dark:lg:bg-[#171126]">
        <div className="flex h-16 items-center border-b border-slate-200 px-6 dark:border-[#2e2349]">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            TaktWerk
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">{renderNavList()}</div>

        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-[#2e2349]">
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
