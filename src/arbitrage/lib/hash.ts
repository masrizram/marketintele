/**
 * Crypto helpers — SHA-256 checksums for raw document immutability.
 *
 * Every raw crawled payload is stored with a SHA-256 checksum before any
 * normalization occurs. This forms the root of the forensic data lineage
 * chain mandated by the IDEA.xml.
 *
 * Backend implementation uses Node's native `crypto` module.
 */
import { createHash, Hash } from 'crypto';

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 */
export function sha256(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Compute SHA-256 hex digest of a UTF-8 string with an optional per-run
 * salt to prevent rainbow-table preimage attacks on raw payloads.
 */
export function sha256Salted(str: string, salt: string): string {
  return sha256(str + salt);
}

/**
 * Compute SHA-256 hex digest of a JSON-serializable object (deterministic
 * ordering via `JSON.stringify` with sorted keys).
 */
export function sha256Json(obj: unknown, salt?: string): string {
  const serialized = JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {} as Record<string, unknown>);
    }
    return value;
  });
  return salt ? sha256Salted(serialized, salt) : sha256(serialized);
}

/**
 * Verify that a payload matches its stored checksum.
 */
export function verifyChecksum(payload: string, expectedChecksum: string, salt?: string): boolean {
  const actual = salt ? sha256Salted(payload, salt) : sha256(payload);
  return actual === expectedChecksum;
}

/**
 * Subtle helper: compute checksum incrementally for streaming payloads.
 * Returns the hash object so callers can `.update()` more data and then
 * `.digest('hex')` at the end.
 */
export function sha256Init(): Hash {
  return createHash('sha256');
}
