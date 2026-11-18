const PIN_SALT = 'taktwerk-lock-v1::';

function fallbackHash(input: string): string {
  // Deterministic 64-bit FNV-1a double-pass hex fallback when crypto.subtle is unavailable (e.g. non-secure LAN HTTP)
  let h1 = 0x811c9dc5;
  let h2 = 0x6c62272e;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `fb_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export async function hashPin(pin: string): Promise<string> {
  const normalized = pin.trim();
  const payload = `${PIN_SALT}${normalized}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const data = new TextEncoder().encode(payload);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const bytes = Array.from(new Uint8Array(digest));
      return `sha256_${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return fallbackHash(payload);
    }
  }
  return fallbackHash(payload);
}

export async function verifyPin(pin: string, storedHash?: string | null): Promise<boolean> {
  if (!storedHash || !pin.trim()) return false;
  const payload = `${PIN_SALT}${pin.trim()}`;
  if (storedHash.startsWith('fb_')) {
    return fallbackHash(payload) === storedHash;
  }
  const computed = await hashPin(pin);
  return computed === storedHash;
}
