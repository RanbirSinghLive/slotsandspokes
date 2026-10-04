/**
 * The sync code: the whole "account" for cloud saves. A random 100-bit
 * code made on the player's device and never stored in the clear by the
 * server (it keeps only a SHA-256 of it), so whoever holds the code holds
 * the save, and there is no password, email or sign-in to set up.
 *
 * Shared by the browser (ui/cloudSave.ts) and the Worker (worker/saveRoutes.ts);
 * it touches nothing but `crypto`, which both have.
 */

// 32 letters and digits with the look-alikes (0/O, 1/I) left out, so a
// code read off one screen and typed on another survives.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 20;

/** A fresh code, 20 characters; `formatSyncCode` groups it as XXXXX-XXXXX-XXXXX-XXXXX for display. */
export function newSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const letters = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  return letters.join('');
}

/** Group a normalised code in fives for reading aloud and typing. */
export function formatSyncCode(code: string): string {
  return code.match(/.{1,5}/g)?.join('-') ?? code;
}

/**
 * What the player typed or pasted, as a code, or null if it isn't one.
 * Case, dashes and spaces don't matter; a pasted link with `#sync=` does.
 */
export function readSyncCode(text: string): string | null {
  const afterMarker = text.includes('sync=') ? text.split('sync=')[1] : text;
  const compact = afterMarker.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pattern = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);
  return pattern.test(compact) ? compact : null;
}

/** The key a code's save lives under: the code itself never leaves the browser except as a bearer token. */
export async function syncCodeKey(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`slotsandspokes:${code}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
