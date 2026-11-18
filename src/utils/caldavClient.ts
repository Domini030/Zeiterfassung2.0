import type { CalendarAppointment } from '../types';

export interface DiscoveredCalendar {
  url: string;
  displayName: string;
  color?: string;
}

function unescapeIcsText(val: string): string {
  return val
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

const EU_CET_CEST_TIMEZONES = new Set([
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Luxembourg',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Prague',
  'Europe/Warsaw',
  'Europe/Copenhagen',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Budapest',
  'Europe/Bratislava',
  'Europe/Ljubljana',
  'Europe/Zagreb',
  'Europe/Belgrade',
  'Europe/Vaduz',
]);

function isValidIanaTimeZone(tzid: string): boolean {
  if (!tzid) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

export function resolveLocalTimeZone(preferredTimeZone?: string): string {
  if (preferredTimeZone && isValidIanaTimeZone(preferredTimeZone)) {
    return preferredTimeZone;
  }
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (
      detected &&
      detected !== 'UTC' &&
      detected !== 'Etc/UTC' &&
      detected !== 'Etc/GMT' &&
      detected !== 'GMT' &&
      isValidIanaTimeZone(detected)
    ) {
      return detected;
    }
  } catch {
    // Fallback below
  }
  return 'Europe/Berlin';
}

function getDatePartsInTimeZone(
  date: Date,
  tzid: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = pick('hour');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: hour === 24 ? 0 : hour,
    minute: pick('minute'),
    second: pick('second'),
  };
}

function getTimeZoneOffsetMinutes(date: Date, tzid: string): number {
  const p = getDatePartsInTimeZone(date, tzid);
  const asUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSecMs = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtcMs - wholeSecMs) / 60_000);
}

function formatIcsOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(Math.round(offsetMinutes));
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

function getTimeZoneShortName(date: Date, tzid: string, fallbackOffsetMinutes: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      timeZoneName: 'short',
    }).formatToParts(date);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const cleaned = raw.replace(/[^A-Za-z0-9+-]/g, '');
    if (cleaned) return cleaned;
  } catch {
    // Fallback below
  }
  return formatIcsOffset(fallbackOffsetMinutes);
}

function toIcsLocalString(date: Date, tzid: string): string {
  const p = getDatePartsInTimeZone(date, tzid);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${String(p.year).padStart(4, '0')}${pad(p.month)}${pad(p.day)}T` +
    `${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`
  );
}

function zonedWallClockToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tzid: string
): string {
  const wallUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let guessMs = wallUtcMs;
  for (let i = 0; i < 2; i += 1) {
    const offsetMin = getTimeZoneOffsetMinutes(new Date(guessMs), tzid);
    guessMs = wallUtcMs - offsetMin * 60_000;
  }
  return new Date(guessMs).toISOString();
}

function findOffsetTransitionMs(
  startMs: number,
  endMs: number,
  startOffset: number,
  tzid: string
): number {
  let lo = startMs;
  let hi = endMs;
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (getTimeZoneOffsetMinutes(new Date(mid), tzid) === startOffset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

function buildVTimezoneLines(tzid: string, referenceDate: Date): string[] {
  if (EU_CET_CEST_TIMEZONES.has(tzid)) {
    return [
      'BEGIN:VTIMEZONE',
      `TZID:${tzid}`,
      `X-LIC-LOCATION:${tzid}`,
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'TZNAME:CEST',
      'DTSTART:19700329T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'TZNAME:CET',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
  }

  const year = getDatePartsInTimeZone(referenceDate, tzid).year || new Date().getUTCFullYear();
  const janDate = new Date(Date.UTC(year, 0, 15, 12, 0, 0));
  const julDate = new Date(Date.UTC(year, 6, 15, 12, 0, 0));
  const janOffset = getTimeZoneOffsetMinutes(janDate, tzid);
  const julOffset = getTimeZoneOffsetMinutes(julDate, tzid);

  if (janOffset === julOffset) {
    const offsetStr = formatIcsOffset(janOffset);
    const tzName = getTimeZoneShortName(janDate, tzid, janOffset);
    return [
      'BEGIN:VTIMEZONE',
      `TZID:${tzid}`,
      `X-LIC-LOCATION:${tzid}`,
      'BEGIN:STANDARD',
      `TZOFFSETFROM:${offsetStr}`,
      `TZOFFSETTO:${offsetStr}`,
      `TZNAME:${tzName}`,
      'DTSTART:19700101T000000',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
  }

  const stdOffset = Math.min(janOffset, julOffset);
  const dstOffset = Math.max(janOffset, julOffset);
  const t1Ms = findOffsetTransitionMs(janDate.getTime(), julDate.getTime(), janOffset, tzid);
  const nextJanDate = new Date(Date.UTC(year + 1, 0, 15, 12, 0, 0));
  const t2Ms = findOffsetTransitionMs(julDate.getTime(), nextJanDate.getTime(), julOffset, tzid);

  const dstStartMs = janOffset < julOffset ? t1Ms : t2Ms;
  const stdStartMs = janOffset < julOffset ? t2Ms : t1Ms;
  const stdName = getTimeZoneShortName(new Date(stdStartMs + 3600_000), tzid, stdOffset);
  const dstName = getTimeZoneShortName(new Date(dstStartMs + 3600_000), tzid, dstOffset);

  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    `X-LIC-LOCATION:${tzid}`,
    'BEGIN:DAYLIGHT',
    `TZOFFSETFROM:${formatIcsOffset(stdOffset)}`,
    `TZOFFSETTO:${formatIcsOffset(dstOffset)}`,
    `TZNAME:${dstName}`,
    `DTSTART:${toIcsLocalString(new Date(dstStartMs), tzid)}`,
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    `TZOFFSETFROM:${formatIcsOffset(dstOffset)}`,
    `TZOFFSETTO:${formatIcsOffset(stdOffset)}`,
    `TZNAME:${stdName}`,
    `DTSTART:${toIcsLocalString(new Date(stdStartMs), tzid)}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
}

function extractTzidParam(propHeader: string): string | undefined {
  const segments = propHeader.split(';').slice(1);
  for (const seg of segments) {
    const eqIdx = seg.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = seg.slice(0, eqIdx).trim().toUpperCase();
    if (key === 'TZID') {
      return seg.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
    }
  }
  return undefined;
}

function parseIcsDate(rawVal: string, tzid?: string): string {
  const val = rawVal.trim();
  // Format YYYYMMDD (all-day)
  if (/^\d{8}$/.test(val)) {
    return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T09:00:00`;
  }
  // Format YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const match = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (match) {
    const [, y, m, d, hh, mm, ss, z] = match;
    if (z === 'Z') {
      return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString();
    }
    if (tzid && isValidIanaTimeZone(tzid)) {
      return zonedWallClockToIso(
        Number(y),
        Number(m),
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
        tzid
      );
    }
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toIcsUtcString(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return toIcsUtcString(new Date().toISOString());
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function buildIcsEvent(
  appointment: CalendarAppointment,
  preferredTimeZone?: string
): string {
  const uid = appointment.uid || `${appointment.id}@taktwerk.app`;
  const startDate = new Date(appointment.startTime);
  const safeStartMs = Number.isNaN(startDate.getTime()) ? Date.now() : startDate.getTime();
  const rawEndDate = new Date(appointment.endTime);
  const rawEndMs = Number.isNaN(rawEndDate.getTime()) ? safeStartMs + 60_000 : rawEndDate.getTime();
  const safeEndMs = rawEndMs > safeStartMs ? rawEndMs : safeStartMs + 60_000;

  const tzid = resolveLocalTimeZone(preferredTimeZone);
  const safeStartDate = new Date(safeStartMs);
  const safeEndDate = new Date(safeEndMs);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TaktWerk//DE',
    'CALSCALE:GREGORIAN',
    `X-WR-TIMEZONE:${tzid}`,
    ...buildVTimezoneLines(tzid, safeStartDate),
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtcString(new Date().toISOString())}`,
    `DTSTART;TZID=${tzid}:${toIcsLocalString(safeStartDate, tzid)}`,
    `DTEND;TZID=${tzid}:${toIcsLocalString(safeEndDate, tzid)}`,
    `SUMMARY:${escapeIcsText(appointment.title || 'TaktWerk Termin')}`,
  ];
  if (appointment.location) {
    lines.push(`LOCATION:${escapeIcsText(appointment.location)}`);
  }
  if (appointment.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(appointment.description)}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR', '');
  return lines.join('\r\n');
}

export function parseIcsEvents(
  icsRaw: string,
  calendarName?: string
): CalendarAppointment[] {
  // Unfold folded lines per RFC 5545 (CRLF + space/tab)
  const unfolded = icsRaw.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events: CalendarAppointment[] = [];
  let inEvent = false;
  let inAlarm = false;
  let current: Record<string, string> = {};
  let currentTzids: Record<string, string | undefined> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      inAlarm = false;
      current = {};
      currentTzids = {};
      continue;
    }
    if (trimmed === 'BEGIN:VALARM') {
      inAlarm = true;
      continue;
    }
    if (trimmed === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent && current.SUMMARY && current.DTSTART) {
        const startIso = parseIcsDate(current.DTSTART, currentTzids.DTSTART);
        const endIso = current.DTEND
          ? parseIcsDate(current.DTEND, currentTzids.DTEND)
          : new Date(new Date(startIso).getTime() + 3600 * 1000).toISOString();
        const uid = current.UID || `${startIso}-${current.SUMMARY}`;
        events.push({
          id: `nc-${uid}`,
          uid,
          title: unescapeIcsText(current.SUMMARY),
          startTime: startIso,
          endTime: endIso,
          location: current.LOCATION ? unescapeIcsText(current.LOCATION) : undefined,
          description: current.DESCRIPTION
            ? unescapeIcsText(current.DESCRIPTION)
            : undefined,
          calendarName,
          source: 'nextcloud',
        });
      }
      inEvent = false;
      inAlarm = false;
      current = {};
      currentTzids = {};
      continue;
    }
    if (!inEvent || inAlarm) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const propHeader = line.slice(0, colonIdx);
    const rawKey = propHeader.split(';')[0].toUpperCase();
    const rawVal = line.slice(colonIdx + 1);
    current[rawKey] = rawVal;
    const tzid = extractTzidParam(propHeader);
    if (tzid) {
      currentTzids[rawKey] = tzid;
    }
  }

  return events;
}

export function parseCalDavCalendarsXml(
  xmlText: string,
  baseOrigin: string
): DiscoveredCalendar[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const responses = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'response'
  );
  const calendars: DiscoveredCalendar[] = [];

  for (const resp of responses) {
    const hrefEl = Array.from(resp.getElementsByTagName('*')).find(
      (el) => el.localName === 'href'
    );
    const displayEl = Array.from(resp.getElementsByTagName('*')).find(
      (el) => el.localName === 'displayname'
    );
    const resTypeEl = Array.from(resp.getElementsByTagName('*')).find(
      (el) => el.localName === 'resourcetype'
    );
    const hasCalendarTag = resTypeEl
      ? Array.from(resTypeEl.getElementsByTagName('*')).some(
          (el) => el.localName === 'calendar'
        )
      : false;

    const href = hrefEl?.textContent?.trim() || '';
    const displayName = displayEl?.textContent?.trim() || '';
    if (!href || !hasCalendarTag) continue;
    // Skip inbox/outbox/trashbin special collections
    if (href.includes('/inbox') || href.includes('/outbox') || href.includes('/trashbin')) {
      continue;
    }
    const fullUrl = href.startsWith('http')
      ? href
      : `${baseOrigin.replace(/\/+$/, '')}${href.startsWith('/') ? '' : '/'}${href}`;

    calendars.push({
      url: fullUrl.endsWith('/') ? fullUrl : `${fullUrl}/`,
      displayName: displayName || 'Nextcloud Kalender',
    });
  }

  return calendars;
}

export function parseCalDavCalendarDataXml(
  xmlText: string,
  calendarName?: string
): CalendarAppointment[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const dataNodes = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'calendar-data'
  );
  const all: CalendarAppointment[] = [];
  const seen = new Set<string>();
  for (const node of dataNodes) {
    const raw = node.textContent || '';
    if (!raw.trim()) continue;
    for (const ev of parseIcsEvents(raw, calendarName)) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        all.push(ev);
      }
    }
  }
  return all.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}
