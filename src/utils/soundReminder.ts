import type { ReminderSoundPreset } from '../types';

export interface ReminderSoundOption {
  label: string;
  description: string;
  group: 'system' | 'pixel' | 'melodic' | 'alert';
}

export const REMINDER_SOUND_OPTIONS: Record<ReminderSoundPreset, ReminderSoundOption> = {
  device: {
    label: 'Pixel- / Smartphone-Systemton',
    description: 'Nutzt einen direkt gewählten Google Pixel- oder Android-Benachrichtigungston.',
    group: 'system',
  },
  popcorn: {
    label: 'Popcorn (Pixel-Stil)',
    description: 'Fröhliche, leicht hüpfende 3-Ton-Folge im Stil klassischer Pixel-Sounds.',
    group: 'pixel',
  },
  eureka: {
    label: 'Eureka (Pixel-Stil)',
    description: 'Heller, optimistischer Aufwärts-Akzent für klare Erinnerungen.',
    group: 'pixel',
  },
  chord: {
    label: 'Akkord (Pixel-Stil)',
    description: 'Weicher, warmer Major-7-Klang im modernen Material-Design-Stil.',
    group: 'pixel',
  },
  droplet: {
    label: 'Wassertropfen',
    description: 'Klarer, unaufdringlicher Tropfen-Impuls mit sanftem Frequenz-Aufstieg.',
    group: 'pixel',
  },
  crystal: {
    label: 'Kristall-Glockenspiel',
    description: 'Feiner, brillanter Oberton-Klang mit sanftem Nachhall.',
    group: 'melodic',
  },
  marimba: {
    label: 'Marimba (Warm)',
    description: 'Natürlicher, holziger Dreiklang mit angenehmem Volumen.',
    group: 'melodic',
  },
  piano: {
    label: 'Klavier-Hinweis',
    description: 'Kurzer, eleganter Klavier-Akkord mit warmem Ausklang.',
    group: 'melodic',
  },
  chime: {
    label: 'Dreiklang (Sanft)',
    description: 'Angenehmer, klassisch aufsteigender Dreiklang.',
    group: 'melodic',
  },
  bell: {
    label: 'Glocke (Klar)',
    description: 'Heller, länger ausklingender Glockenton.',
    group: 'melodic',
  },
  woodblock: {
    label: 'Holzklang (Minimal)',
    description: 'Sehr dezenter Doppel-Klick für ruhige Arbeitsumgebungen.',
    group: 'melodic',
  },
  sonar: {
    label: 'Sonar-Echo',
    description: 'Weicher, mitteltiefer Impuls mit leisem Echo.',
    group: 'melodic',
  },
  fanfare: {
    label: 'Erfolgs-Signal',
    description: 'Kräftige, aufsteigende Vierklang-Melodie.',
    group: 'alert',
  },
  pulse: {
    label: 'Doppel-Signal',
    description: 'Kurzer, moderner Doppel-Impuls.',
    group: 'alert',
  },
  alarm: {
    label: 'Deutlicher Hinweiston',
    description: 'Gut hörbare Tonfolge bei lauter Umgebung.',
    group: 'alert',
  },
  silent: {
    label: 'Lautlos (nur Banner / Vibration)',
    description: 'Kein Ton, nur sichtbarer Hinweis & Vibration.',
    group: 'system',
  },
};

export const REMINDER_SOUND_PRESET_ORDER: ReminderSoundPreset[] = [
  'device',
  'popcorn',
  'eureka',
  'chord',
  'droplet',
  'crystal',
  'marimba',
  'piano',
  'chime',
  'bell',
  'woodblock',
  'sonar',
  'fanfare',
  'pulse',
  'alarm',
  'silent',
];

let activeAudioCtx: AudioContext | null = null;
let activeCleanupTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (activeCleanupTimer) {
      clearTimeout(activeCleanupTimer);
      activeCleanupTimer = null;
    }
    if (activeAudioCtx) {
      void activeAudioCtx.close().catch(() => {});
      activeAudioCtx = null;
    }

    const ctx = new AudioCtx();
    activeAudioCtx = ctx;
    const now = ctx.currentTime;

    const scheduleNote = (
      freq: number,
      startOffset: number,
      duration: number,
      type: OscillatorType = 'sine',
      peakGain = 0.2,
      attack = 0.015
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, peakGain),
        now + startOffset + Math.min(attack, duration * 0.4)
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.03);
    };

    const scheduleGlide = (
      startFreq: number,
      endFreq: number,
      startOffset: number,
      duration: number,
      type: OscillatorType = 'sine',
      peakGain = 0.22
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, now + startOffset);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + startOffset + duration);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.03);
    };

    switch (preset) {
      case 'popcorn':
        // Bouncy staccato triad inspired by Pixel's Popcorn notification
        scheduleNote(698.46, 0.0, 0.09, 'sine', 0.22, 0.006);
        scheduleNote(1396.91, 0.0, 0.05, 'triangle', 0.07, 0.004);
        scheduleNote(880.0, 0.095, 0.09, 'sine', 0.24, 0.006);
        scheduleNote(1046.5, 0.19, 0.22, 'sine', 0.22, 0.008);
        scheduleNote(2093.0, 0.19, 0.12, 'sine', 0.06, 0.006);
        break;

      case 'eureka':
        // Bright ascending Pixel-like sparkle
        scheduleNote(659.25, 0.0, 0.14, 'sine', 0.18, 0.01);
        scheduleNote(830.61, 0.08, 0.16, 'sine', 0.19, 0.01);
        scheduleNote(987.77, 0.16, 0.2, 'sine', 0.2, 0.01);
        scheduleNote(1318.51, 0.24, 0.42, 'sine', 0.22, 0.012);
        scheduleNote(2637.02, 0.24, 0.22, 'sine', 0.05, 0.01);
        break;

      case 'chord':
        // Warm Major-7 pad swell
        scheduleNote(523.25, 0.0, 0.65, 'sine', 0.14, 0.04);
        scheduleNote(659.25, 0.03, 0.65, 'sine', 0.13, 0.04);
        scheduleNote(783.99, 0.06, 0.65, 'sine', 0.12, 0.04);
        scheduleNote(987.77, 0.09, 0.7, 'triangle', 0.08, 0.05);
        break;

      case 'droplet':
        // Liquid upward chirp
        scheduleGlide(520, 1240, 0.0, 0.14, 'sine', 0.22);
        scheduleGlide(680, 1520, 0.16, 0.16, 'sine', 0.18);
        break;

      case 'crystal':
        // High crystalline chime with harmonics
        scheduleNote(1318.51, 0.0, 0.55, 'sine', 0.16, 0.008);
        scheduleNote(2637.02, 0.0, 0.35, 'sine', 0.06, 0.006);
        scheduleNote(1975.53, 0.12, 0.65, 'sine', 0.17, 0.008);
        scheduleNote(3951.07, 0.12, 0.3, 'sine', 0.04, 0.006);
        break;

      case 'marimba':
        // Woody warm percussive triad
        scheduleNote(587.33, 0.0, 0.16, 'triangle', 0.25, 0.005);
        scheduleNote(1174.66, 0.0, 0.06, 'sine', 0.08, 0.004);
        scheduleNote(739.99, 0.13, 0.16, 'triangle', 0.24, 0.005);
        scheduleNote(880.0, 0.26, 0.34, 'triangle', 0.24, 0.005);
        break;

      case 'piano':
        // Crisp piano chord with warm harmonic decay
        scheduleNote(523.25, 0.0, 0.5, 'triangle', 0.16, 0.008);
        scheduleNote(659.25, 0.0, 0.5, 'triangle', 0.14, 0.008);
        scheduleNote(783.99, 0.0, 0.5, 'sine', 0.14, 0.008);
        scheduleNote(1046.5, 0.18, 0.58, 'triangle', 0.16, 0.008);
        break;

      case 'woodblock':
        // Minimal subtle double tap
        scheduleNote(720, 0.0, 0.055, 'triangle', 0.24, 0.003);
        scheduleNote(1440, 0.0, 0.03, 'sine', 0.09, 0.002);
        scheduleNote(960, 0.12, 0.065, 'triangle', 0.22, 0.003);
        break;

      case 'sonar':
        // Soft mellow ping + quiet echo
        scheduleNote(440, 0.0, 0.45, 'sine', 0.22, 0.015);
        scheduleNote(880, 0.0, 0.22, 'sine', 0.06, 0.015);
        scheduleNote(440, 0.38, 0.5, 'sine', 0.1, 0.02);
        break;

      case 'fanfare':
        // Confident 4-note ascending chime
        scheduleNote(523.25, 0.0, 0.14, 'triangle', 0.2, 0.008);
        scheduleNote(659.25, 0.11, 0.14, 'triangle', 0.2, 0.008);
        scheduleNote(783.99, 0.22, 0.16, 'triangle', 0.22, 0.008);
        scheduleNote(1046.5, 0.34, 0.46, 'triangle', 0.24, 0.01);
        scheduleNote(1046.5, 0.34, 0.46, 'sine', 0.12, 0.01);
        break;

      case 'bell':
        scheduleNote(880, 0.0, 0.75, 'triangle', 0.24, 0.01);
        scheduleNote(1760, 0.0, 0.4, 'sine', 0.1, 0.008);
        break;

      case 'pulse':
        scheduleNote(660, 0.0, 0.14, 'sine', 0.22, 0.01);
        scheduleNote(660, 0.2, 0.18, 'sine', 0.22, 0.01);
        break;

      case 'alarm':
        scheduleNote(740, 0.0, 0.18, 'triangle', 0.25, 0.01);
        scheduleNote(987.77, 0.2, 0.18, 'triangle', 0.25, 0.01);
        scheduleNote(740, 0.42, 0.18, 'triangle', 0.25, 0.01);
        scheduleNote(987.77, 0.62, 0.26, 'triangle', 0.25, 0.01);
        break;

      case 'device':
      case 'chime':
      default:
        scheduleNote(523.25, 0.0, 0.25, 'sine', 0.18, 0.015);
        scheduleNote(659.25, 0.14, 0.28, 'sine', 0.18, 0.015);
        scheduleNote(783.99, 0.28, 0.45, 'sine', 0.2, 0.015);
        break;
    }

    activeCleanupTimer = setTimeout(() => {
      if (activeAudioCtx === ctx) {
        activeAudioCtx = null;
      }
      void ctx.close().catch(() => {});
    }, 1600);
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
