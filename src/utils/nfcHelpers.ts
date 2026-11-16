export interface NdefRecordPayload {
  tnf?: number;
  type?: number[];
  id?: number[];
  payload?: number[];
}

const URI_PREFIXES: Record<number, string> = {
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
  0x05: 'tel:',
  0x06: 'mailto:',
};

export function extractTagIdFromPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (trimmed.toLowerCase().startsWith('taktwerk://nfc/')) {
    const rest = trimmed.slice('taktwerk://nfc/'.length).split(/[?#]/)[0];
    try {
      return decodeURIComponent(rest).trim();
    } catch {
      return rest.trim();
    }
  }

  if (trimmed.includes('nfc=')) {
    try {
      const parsed = new URL(trimmed);
      const param = parsed.searchParams.get('nfc');
      if (param) return param.trim();
    } catch {
      const match = trimmed.match(/nfc=([^&\s#]+)/);
      if (match?.[1]) {
        try {
          return decodeURIComponent(match[1]).trim();
        } catch {
          return match[1].trim();
        }
      }
    }
  }

  return trimmed;
}

export function decodeNdefRecordBytes(record: NdefRecordPayload): string {
  const payload = record.payload ?? [];
  if (payload.length === 0) return '';

  const typeStr = record.type ? String.fromCharCode(...record.type) : '';
  const bytes = new Uint8Array(payload);

  // NDEF Well-Known Text record ('T')
  if (record.tnf === 1 && typeStr === 'T' && bytes.length > 1) {
    const langLength = bytes[0] & 0x3f;
    const textBytes = bytes.slice(1 + langLength);
    return new TextDecoder().decode(textBytes).trim();
  }

  // NDEF Well-Known URI record ('U')
  if (record.tnf === 1 && typeStr === 'U' && bytes.length >= 1) {
    const prefix = URI_PREFIXES[bytes[0]] ?? '';
    const rest = new TextDecoder().decode(bytes.slice(1)).trim();
    return `${prefix}${rest}`;
  }

  return new TextDecoder().decode(bytes).trim();
}

export function encodeNdefUriRecord(uri: string): {
  tnf: number;
  type: number[];
  id: number[];
  payload: number[];
} {
  let prefixCode = 0x00;
  let remainder = uri;

  if (uri.startsWith('https://www.')) {
    prefixCode = 0x02;
    remainder = uri.slice('https://www.'.length);
  } else if (uri.startsWith('http://www.')) {
    prefixCode = 0x01;
    remainder = uri.slice('http://www.'.length);
  } else if (uri.startsWith('https://')) {
    prefixCode = 0x04;
    remainder = uri.slice('https://'.length);
  } else if (uri.startsWith('http://')) {
    prefixCode = 0x03;
    remainder = uri.slice('http://'.length);
  }

  const encoded = Array.from(new TextEncoder().encode(remainder));
  return {
    tnf: 1, // Well-known
    type: [0x55], // 'U'
    id: [],
    payload: [prefixCode, ...encoded],
  };
}

export function buildAppNfcUri(tagUid: string): string {
  return `taktwerk://nfc/${encodeURIComponent(tagUid)}`;
}
