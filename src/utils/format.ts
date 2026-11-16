import type { CompanyProfile, InvoiceAccentPreset } from '../types';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}

export function formatHoursShort(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  return `${formatNumber(hours, 2)} Std.`;
}

export function formatDateDE(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDateTimeDE(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function toInputDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return toInputDate();
  date.setDate(date.getDate() + days);
  return toInputDate(date);
}

export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function formatInvoiceNumber(
  company: CompanyProfile,
  sequenceOverride?: number,
  date: Date = new Date()
): string {
  const seqNum = Math.max(1, sequenceOverride ?? company.nextInvoiceSequence ?? 1);
  const digits = Math.min(8, Math.max(2, company.invoiceSequenceDigits ?? 4));
  const paddedSeq = String(seqNum).padStart(digits, '0');
  const prefix = company.invoicePrefix ?? 'RE-';
  const pattern = (company.invoiceNumberPattern || '').trim();

  if (!pattern) {
    return `${prefix || 'RE-2026-'}${paddedSeq}`;
  }

  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return pattern
    .replace(/\{PREFIX\}/g, prefix)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd)
    .replace(/\{NR\}/g, paddedSeq);
}

export const INVOICE_ACCENT_STYLES: Record<
  InvoiceAccentPreset,
  {
    label: string;
    swatchClass: string;
    borderClass: string;
    textClass: string;
    rgb: [number, number, number];
  }
> = {
  slate: {
    label: 'Anthrazit',
    swatchClass: 'bg-slate-900',
    borderClass: 'border-slate-900',
    textClass: 'text-slate-900',
    rgb: [15, 23, 42],
  },
  blue: {
    label: 'Business Blau',
    swatchClass: 'bg-blue-700',
    borderClass: 'border-blue-700',
    textClass: 'text-blue-700',
    rgb: [29, 78, 216],
  },
  violet: {
    label: 'TaktWerk Violett',
    swatchClass: 'bg-violet-700',
    borderClass: 'border-violet-700',
    textClass: 'text-violet-700',
    rgb: [109, 40, 217],
  },
  emerald: {
    label: 'Smaragd',
    swatchClass: 'bg-emerald-700',
    borderClass: 'border-emerald-700',
    textClass: 'text-emerald-700',
    rgb: [4, 120, 87],
  },
  rose: {
    label: 'Rubinrot',
    swatchClass: 'bg-rose-700',
    borderClass: 'border-rose-700',
    textClass: 'text-rose-700',
    rgb: [190, 18, 60],
  },
};
