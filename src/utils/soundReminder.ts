import type { ReminderSoundPreset } from '../types';

export const REMINDER_SOUND_OPTIONS: Record<
  ReminderSoundPreset,
  { label: string; description: string }
> = {
  chime: {
    label: 'Dreiklang (Sanft)',
    description: 'Angenehmer, aufsteigender Dreiklang.',
  },
  bell: {
    label: 'Glocke (Klar)',
    description: 'Heller, länger ausklingender Glockenton.',
  },
  pulse: {
    label: 'Doppel-Signal',
    description: 'Kurzer, moderner Doppel-Impuls.',
  },
  alarm: {
    label: 'Deutlicher Hinweiston',
    description: 'Gut hörbare Tonfolge bei lauter Umgebung.',
  },
  silent: {
    label: 'Lautlos (nur Banner / Vibration)',
    description: 'Kein Ton, nur sichtbarer Hinweis & Vibration.',
  },
};

export function playReminderSound(preset: ReminderSoundPreset): void {
  if (preset === 'silent') {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 80, 120]);
    }
    return;
  }

  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const scheduleNote = (
      freq: number,
      startOffset: number,
      duration: number,
      type: OscillatorType = 'sine',
      peakGain = 0.2
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    if (preset === 'chime') {
      scheduleNote(523.25, 0, 0.25, 'sine', 0.18);
      scheduleNote(659.25, 0.14, 0.28, 'sine', 0.18);
      scheduleNote(783.99, 0.28, 0.45, 'sine', 0.2);
    } else if (preset === 'bell') {
      scheduleNote(880, 0, 0.75, 'triangle', 0.24);
      scheduleNote(1760, 0, 0.4, 'sine', 0.1);
    } else if (preset === 'pulse') {
      scheduleNote(660, 0, 0.14, 'sine', 0.22);
      scheduleNote(660, 0.2, 0.18, 'sine', 0.22);
    } else if (preset === 'alarm') {
      scheduleNote(740, 0, 0.18, 'triangle', 0.25);
      scheduleNote(987.77, 0.2, 0.18, 'triangle', 0.25);
      scheduleNote(740, 0.42, 0.18, 'triangle', 0.25);
      scheduleNote(987.77, 0.62, 0.26, 'triangle', 0.25);
    }

    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1500);
  } catch {
    // Ignore autoplay blocking errors
  }
}

export async function showWebReminderNotification(
  title: string,
  body: string
): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'taktwerk-timer-reminder' });
    }
  } catch {
    // Ignore browser notification errors
  }
}
