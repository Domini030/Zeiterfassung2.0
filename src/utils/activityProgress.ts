import { useEffect, useState } from 'react';

export interface ActivityTask {
  id: string;
  label: string;
  detail?: string;
  /** 0..100 for determinate progress, null for indeterminate */
  progress: number | null;
  startedAt: number;
}

type Listener = (tasks: ActivityTask[]) => void;

let tasks: ActivityTask[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit() {
  const snapshot = [...tasks];
  for (const fn of listeners) {
    fn(snapshot);
  }
}

export function startActivity(
  label: string,
  progress: number | null = null,
  detail?: string
): string {
  seq += 1;
  const id = `act_${Date.now()}_${seq}`;
  tasks = [
    ...tasks,
    {
      id,
      label,
      detail,
      progress: progress === null ? null : Math.max(0, Math.min(100, Math.round(progress))),
      startedAt: Date.now(),
    },
  ];
  emit();
  return id;
}

export function updateActivity(
  id: string,
  patch: { label?: string; detail?: string; progress?: number | null }
): void {
  let changed = false;
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    changed = true;
    return {
      ...t,
      label: patch.label !== undefined ? patch.label : t.label,
      detail: patch.detail !== undefined ? patch.detail : t.detail,
      progress:
        patch.progress === undefined
          ? t.progress
          : patch.progress === null
            ? null
            : Math.max(0, Math.min(100, Math.round(patch.progress))),
    };
  });
  if (changed) emit();
}

export function finishActivity(id: string): void {
  const next = tasks.filter((t) => t.id !== id);
  if (next.length !== tasks.length) {
    tasks = next;
    emit();
  }
}

export async function trackActivity<T>(
  label: string,
  fn: (update: (progress: number | null, detail?: string, nextLabel?: string) => void) => Promise<T>,
  initialProgress: number | null = null,
  initialDetail?: string
): Promise<T> {
  const id = startActivity(label, initialProgress, initialDetail);
  try {
    return await fn((progress, detail, nextLabel) => {
      updateActivity(id, {
        progress,
        detail,
        label: nextLabel,
      });
    });
  } finally {
    finishActivity(id);
  }
}

export function useActivityProgress(): ActivityTask[] {
  const [current, setCurrent] = useState<ActivityTask[]>(() => [...tasks]);

  useEffect(() => {
    const handler: Listener = (next) => setCurrent(next);
    listeners.add(handler);
    setCurrent([...tasks]);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return current;
}
