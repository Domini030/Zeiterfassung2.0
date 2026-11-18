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

function parseIcsDate(rawVal: string): string {
  const val = rawVal.trim();
  // Format YYYYMMDD
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

export function buildIcsEvent(appointment: CalendarAppointment): string {
  const uid = appointment.uid || `${appointment.id}@taktwerk.app`;
  const startDate = new Date(appointment.startTime);
  const safeStartMs = Number.isNaN(startDate.getTime()) ? Date.now() : startDate.getTime();
  const rawEndDate = new Date(appointment.endTime);
  const rawEndMs = Number.isNaN(rawEndDate.getTime()) ? safeStartMs + 60_000 : rawEndDate.getTime();
  const safeEndMs = rawEndMs > safeStartMs ? rawEndMs : safeStartMs + 60_000;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TaktWerk//DE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtcString(new Date().toISOString())}`,
    `DTSTART:${toIcsUtcString(new Date(safeStartMs).toISOString())}`,
    `DTEND:${toIcsUtcString(new Date(safeEndMs).toISOString())}`,
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
  let current: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent && current.SUMMARY && current.DTSTART) {
        const startIso = parseIcsDate(current.DTSTART);
        const endIso = current.DTEND
          ? parseIcsDate(current.DTEND)
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
      current = {};
      continue;
    }
    if (!inEvent) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const rawKey = line.slice(0, colonIdx).split(';')[0].toUpperCase();
    const rawVal = line.slice(colonIdx + 1);
    current[rawKey] = rawVal;
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
