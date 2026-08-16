/**
 * ULID generator — guarantees time-sortable, globally-unique primary keys.
 *
 * The IDEA.xml mandates ULID / UUIDv7 primary keys everywhere. We use the
 * `ulid` package which produces Crockford-base32 ULIDs with 1e10 gen/s
 * monotonicity guarantee and no central coordination.
 */
import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

/**
 * ULID → timestamp (ms since epoch). Useful for freshness/age computations.
 */
export function ulidTimestamp(id: string): number {
  // ULID: 10 Crockford-base32 chars (0-9A-HJKMNP-TV-Z) = 48-bit millisecond timestamp
  const CROCKETT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const tsPart = id.slice(0, 10).toUpperCase();
  let ms = 0;
  for (let i = 0; i < tsPart.length; i++) {
    const char = tsPart[i];
    const val = CROCKETT_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid ULID character at position ${i}: ${char}`);
    }
    ms = ms * 32 + val;
  }
  return ms;
}

/**
 * ULID → Date for human-readable freshness display.
 */
export function ulidToDate(id: string): Date {
  return new Date(ulidTimestamp(id));
}
