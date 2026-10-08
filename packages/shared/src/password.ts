/** Alphabet without look-alike characters (no 0/O, 1/l/I, 5/S, 2/Z, 8/B) */
export const TEMP_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY34679';

/** Unique random temporary password (default 12 chars). Uses Web Crypto, so it works in browsers, Node 20+ and Deno. */
export function generateTempPassword(length = 12): string {
  if (length < 10) throw new Error('Temporary passwords must be at least 10 characters');
  const alphabet = TEMP_PASSWORD_ALPHABET;
  const out: string[] = [];
  const max = 256 - (256 % alphabet.length); // rejection sampling avoids modulo bias
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < max && out.length < length) out.push(alphabet[b % alphabet.length]!);
    }
  }
  return out.join('');
}
