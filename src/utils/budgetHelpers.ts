import type { ActiveTimer, Customer, TimeEntry } from '../types';
import { getActiveTimerElapsedMs } from './format';

export interface CustomerBudgetStatus {
  hasBudget: boolean;
  period: 'monthly' | 'total';
  periodLabel: string;
  budgetHours: number | null;
  budgetAmountNet: number | null;
  usedHours: number;
  usedAmountNet: number;
  hoursPct: number | null;
  amountPct: number | null;
  primaryPct: number;
  remainingHours: number | null;
  remainingAmountNet: number | null;
  severity: 'ok' | 'warning' | 'exceeded';
}

function getMonthPrefix(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function computeCustomerBudgetStatus(
  customer: Customer | undefined | null,
  timeEntries: TimeEntry[],
  activeTimer?: ActiveTimer | null,
  nowMs = Date.now()
): CustomerBudgetStatus {
  const budgetHours =
    customer?.budgetHours && customer.budgetHours > 0 ? customer.budgetHours : null;
  const budgetAmountNet =
    customer?.budgetAmountNet && customer.budgetAmountNet > 0
      ? customer.budgetAmountNet
      : null;
  const period: 'monthly' | 'total' = customer?.budgetPeriod ?? 'monthly';
  const periodLabel = period === 'monthly' ? 'Diesen Monat' : 'Gesamtprojekt';

  if (!customer || (!budgetHours && !budgetAmountNet)) {
    return {
      hasBudget: false,
      period,
      periodLabel,
      budgetHours: null,
      budgetAmountNet: null,
      usedHours: 0,
      usedAmountNet: 0,
      hoursPct: null,
      amountPct: null,
      primaryPct: 0,
      remainingHours: null,
      remainingAmountNet: null,
      severity: 'ok',
    };
  }

  const monthPrefix = getMonthPrefix(new Date(nowMs));
  let totalSeconds = 0;
  let totalNet = 0;

  for (const entry of timeEntries) {
    if (entry.entryType === 'internal' || entry.customerId !== customer.id) continue;
    if (period === 'monthly' && !entry.startTime.startsWith(monthPrefix)) continue;
    totalSeconds += entry.durationSeconds;
    if (entry.billable) {
      totalNet += (entry.durationSeconds / 3600) * entry.hourlyRateNet;
    }
  }

  if (
    activeTimer &&
    activeTimer.entryType !== 'internal' &&
    activeTimer.customerId === customer.id
  ) {
    if (period === 'total' || activeTimer.startTime.startsWith(monthPrefix)) {
      const activeSecs = Math.floor(getActiveTimerElapsedMs(activeTimer, nowMs) / 1000);
      totalSeconds += activeSecs;
      totalNet += (activeSecs / 3600) * activeTimer.hourlyRateNet;
    }
  }

  const usedHours = totalSeconds / 3600;
  const usedAmountNet = Math.round(totalNet * 100) / 100;

  const hoursPct = budgetHours ? Math.round((usedHours / budgetHours) * 100) : null;
  const amountPct = budgetAmountNet
    ? Math.round((usedAmountNet / budgetAmountNet) * 100)
    : null;

  const primaryPct = Math.max(hoursPct ?? 0, amountPct ?? 0);
  const severity: 'ok' | 'warning' | 'exceeded' =
    primaryPct >= 100 ? 'exceeded' : primaryPct >= 80 ? 'warning' : 'ok';

  return {
    hasBudget: true,
    period,
    periodLabel,
    budgetHours,
    budgetAmountNet,
    usedHours,
    usedAmountNet,
    hoursPct,
    amountPct,
    primaryPct,
    remainingHours: budgetHours !== null ? budgetHours - usedHours : null,
    remainingAmountNet:
      budgetAmountNet !== null
        ? Math.round((budgetAmountNet - usedAmountNet) * 100) / 100
        : null,
    severity,
  };
}
