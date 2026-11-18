import type {
  ActiveTimer,
  CompanyProfile,
  DiscountType,
  Invoice,
  InvoiceAccentPreset,
  InvoiceFontFamily,
  InvoiceLayoutStyle,
  InvoiceLineItem,
  TimeRoundingMinutes,
} from '../types';

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

export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity === 0) {
    return formatNumber(0, 2);
  }
  const rounded2 = Math.round(quantity * 100) / 100;
  if (Math.abs(quantity - rounded2) >= 0.00005) {
    return new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(quantity);
  }
  return formatNumber(quantity, 2);
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
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = safe / 3600;
  if (safe > 0 && Math.round(hours * 100) === 0) {
    return `${safe} Sek.`;
  }
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

export function toInputTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '09:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

export function roundDurationSeconds(
  totalSeconds: number,
  roundingMinutes?: TimeRoundingMinutes | null
): number {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (!roundingMinutes || roundingMinutes <= 0) return safe;
  const blockSeconds = roundingMinutes * 60;
  return Math.ceil(safe / blockSeconds) * blockSeconds;
}

export function getActiveTimerElapsedMs(
  timer: ActiveTimer,
  nowMs: number = Date.now()
): number {
  const startMs = new Date(timer.startTime).getTime();
  const accPaused = timer.accumulatedPausedMs ?? 0;
  const effectiveEndMs = timer.pausedAt
    ? new Date(timer.pausedAt).getTime()
    : nowMs;
  return Math.max(0, effectiveEndMs - startMs - accPaused);
}

export function getOverdueDays(invoice: Invoice, todayIso: string = toInputDate()): number {
  if (invoice.documentType === 'quote') return 0;
  if (invoice.status !== 'Gesendet' || !invoice.dueDate) return 0;
  const due = new Date(`${invoice.dueDate}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(due.getTime()) || Number.isNaN(today.getTime())) return 0;
  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function isInvoiceOverdue(invoice: Invoice, todayIso: string = toInputDate()): boolean {
  return getOverdueDays(invoice, todayIso) > 0;
}

function applyNumberPattern(
  patternInput: string | undefined,
  prefix: string,
  seqNum: number,
  digits: number,
  fallbackPrefix: string,
  date: Date = new Date()
): string {
  const paddedSeq = String(Math.max(1, seqNum)).padStart(
    Math.min(8, Math.max(2, digits)),
    '0'
  );
  const pattern = (patternInput || '').trim();
  if (!pattern) {
    return `${prefix || fallbackPrefix}${paddedSeq}`;
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

export function formatInvoiceNumber(
  company: CompanyProfile,
  sequenceOverride?: number,
  date: Date = new Date()
): string {
  return applyNumberPattern(
    company.invoiceNumberPattern,
    company.invoicePrefix ?? 'RE-',
    sequenceOverride ?? company.nextInvoiceSequence ?? 1,
    company.invoiceSequenceDigits ?? 4,
    'RE-2026-',
    date
  );
}

export function formatQuoteNumber(
  company: CompanyProfile,
  sequenceOverride?: number,
  date: Date = new Date()
): string {
  return applyNumberPattern(
    company.quoteNumberPattern ?? company.invoiceNumberPattern,
    company.quotePrefix ?? 'ANG-',
    sequenceOverride ?? company.nextQuoteSequence ?? 1,
    company.invoiceSequenceDigits ?? 4,
    'ANG-2026-',
    date
  );
}

export function formatProductSku(
  company: CompanyProfile,
  sequenceOverride?: number,
  date: Date = new Date()
): string {
  return applyNumberPattern(
    company.productNumberPattern ?? '{PREFIX}{NR}',
    company.productPrefix ?? 'ART-',
    sequenceOverride ?? company.nextProductSequence ?? 1,
    company.productSequenceDigits ?? 3,
    'ART-',
    date
  );
}

export function calculateDocumentTotals(
  lineItems: InvoiceLineItem[],
  isSmallBusiness: boolean,
  discountType: DiscountType = 'percent',
  discountValue = 0
): {
  subtotalNetBeforeDiscount: number;
  discountNetAmount: number;
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
  taxBreakdown: { rate: number; taxable: number; tax: number }[];
} {
  const subtotalNet = Math.round(
    lineItems.reduce((acc, i) => acc + i.netTotal, 0) * 100
  ) / 100;

  const cleanVal = Math.max(0, Number.isFinite(discountValue) ? discountValue : 0);
  let discountNet = 0;
  if (subtotalNet > 0 && cleanVal > 0) {
    if (discountType === 'percent') {
      const clampedPct = Math.min(100, cleanVal);
      discountNet = Math.round(subtotalNet * (clampedPct / 100) * 100) / 100;
    } else {
      discountNet = Math.min(subtotalNet, Math.round(cleanVal * 100) / 100);
    }
  }

  const netAfterDiscount = Math.max(0, Math.round((subtotalNet - discountNet) * 100) / 100);
  const netFactor = subtotalNet > 0 ? netAfterDiscount / subtotalNet : 1;

  const rawRateNetMap = new Map<number, number>();
  for (const item of lineItems) {
    const rate = isSmallBusiness ? 0 : item.taxRate;
    const prevNet = rawRateNetMap.get(rate) ?? 0;
    rawRateNetMap.set(rate, Math.round((prevNet + item.netTotal) * 100) / 100);
  }

  const taxBreakdown = Array.from(rawRateNetMap.entries())
    .map(([rate, rawNet]) => {
      const taxable = Math.round(rawNet * netFactor * 100) / 100;
      return { rate, taxable, tax: 0 };
    })
    .sort((a, b) => b.rate - a.rate);

  // Reconcile any 1-cent rounding residual across multiple tax buckets so sum(taxable) === netAfterDiscount
  if (taxBreakdown.length > 0) {
    const taxableSum =
      Math.round(taxBreakdown.reduce((acc, g) => acc + g.taxable, 0) * 100) / 100;
    const residual = Math.round((netAfterDiscount - taxableSum) * 100) / 100;
    if (residual !== 0) {
      let largestIdx = 0;
      for (let i = 1; i < taxBreakdown.length; i++) {
        if (taxBreakdown[i].taxable > taxBreakdown[largestIdx].taxable) {
          largestIdx = i;
        }
      }
      taxBreakdown[largestIdx].taxable = Math.max(
        0,
        Math.round((taxBreakdown[largestIdx].taxable + residual) * 100) / 100
      );
    }
    for (const grp of taxBreakdown) {
      grp.tax = isSmallBusiness
        ? 0
        : Math.round(grp.taxable * (grp.rate / 100) * 100) / 100;
    }
  }

  const taxTotal = isSmallBusiness
    ? 0
    : Math.round(taxBreakdown.reduce((acc, g) => acc + g.tax, 0) * 100) / 100;
  const grossTotal = Math.round((netAfterDiscount + taxTotal) * 100) / 100;

  return {
    subtotalNetBeforeDiscount: subtotalNet,
    discountNetAmount: discountNet,
    netTotal: netAfterDiscount,
    taxTotal,
    grossTotal,
    taxBreakdown,
  };
}

export function hexToRgbTuple(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null;
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return [r, g, b];
}

export function resolveInvoiceAccentRgb(company: CompanyProfile): [number, number, number] {
  const preset = company.invoiceAccentColor ?? 'slate';
  if (preset === 'custom') {
    return hexToRgbTuple(company.invoiceCustomAccentHex) ?? [15, 23, 42];
  }
  return INVOICE_ACCENT_STYLES[preset]?.rgb ?? [15, 23, 42];
}

export const INVOICE_ACCENT_STYLES: Record<
  InvoiceAccentPreset,
  {
    label: string;
    swatchClass: string;
    borderClass: string;
    textClass: string;
    bgClass: string;
    rgb: [number, number, number];
  }
> = {
  slate: {
    label: 'Anthrazit',
    swatchClass: 'bg-slate-900',
    borderClass: 'border-slate-900',
    textClass: 'text-slate-900',
    bgClass: 'bg-slate-900',
    rgb: [15, 23, 42],
  },
  blue: {
    label: 'Business Blau',
    swatchClass: 'bg-blue-700',
    borderClass: 'border-blue-700',
    textClass: 'text-blue-700',
    bgClass: 'bg-blue-700',
    rgb: [29, 78, 216],
  },
  violet: {
    label: 'TaktWerk Violett',
    swatchClass: 'bg-violet-700',
    borderClass: 'border-violet-700',
    textClass: 'text-violet-700',
    bgClass: 'bg-violet-700',
    rgb: [109, 40, 217],
  },
  emerald: {
    label: 'Smaragd',
    swatchClass: 'bg-emerald-700',
    borderClass: 'border-emerald-700',
    textClass: 'text-emerald-700',
    bgClass: 'bg-emerald-700',
    rgb: [4, 120, 87],
  },
  rose: {
    label: 'Rubinrot',
    swatchClass: 'bg-rose-700',
    borderClass: 'border-rose-700',
    textClass: 'text-rose-700',
    bgClass: 'bg-rose-700',
    rgb: [190, 18, 60],
  },
  teal: {
    label: 'Petrol / Ozean',
    swatchClass: 'bg-teal-700',
    borderClass: 'border-teal-700',
    textClass: 'text-teal-700',
    bgClass: 'bg-teal-700',
    rgb: [15, 118, 110],
  },
  amber: {
    label: 'Bernstein / Gold',
    swatchClass: 'bg-amber-700',
    borderClass: 'border-amber-700',
    textClass: 'text-amber-700',
    bgClass: 'bg-amber-700',
    rgb: [180, 83, 9],
  },
  indigo: {
    label: 'Indigo',
    swatchClass: 'bg-indigo-700',
    borderClass: 'border-indigo-700',
    textClass: 'text-indigo-700',
    bgClass: 'bg-indigo-700',
    rgb: [67, 56, 202],
  },
  custom: {
    label: 'Individuell',
    swatchClass: 'invoice-custom-swatch',
    borderClass: 'invoice-custom-border',
    textClass: 'invoice-custom-text',
    bgClass: 'invoice-custom-bg',
    rgb: [15, 23, 42],
  },
};

export const INVOICE_FONT_OPTIONS: Record<
  InvoiceFontFamily,
  { label: string; previewClass: string; pdfFont: 'helvetica' | 'times' | 'courier' }
> = {
  sans: {
    label: 'Modern Sans (Helvetica / DM Sans)',
    previewClass: 'font-sans',
    pdfFont: 'helvetica',
  },
  serif: {
    label: 'Klassisch Serif (Times / Georgia)',
    previewClass: 'font-serif',
    pdfFont: 'times',
  },
  mono: {
    label: 'Technisch Mono (Courier / JetBrains)',
    previewClass: 'font-mono',
    pdfFont: 'courier',
  },
};

export const INVOICE_LAYOUT_OPTIONS: Record<
  InvoiceLayoutStyle,
  { label: string; description: string }
> = {
  classic: {
    label: 'Klassisch DIN',
    description: 'Dezenter Briefkopf mit Infobox rechts und farbiger Tabellenkopfzeile.',
  },
  modern: {
    label: 'Modern Balken',
    description: 'Kräftige Farbakzent-Kopfzeile und klare Akzent-Trennlinien.',
  },
  minimal: {
    label: 'Minimalistisch',
    description: 'Viel Weißraum, schmale Linien und ruhige typografische Struktur.',
  },
};
