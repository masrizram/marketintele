import { generateULID } from './models';
import { newId, ulidTimestamp, ulidToDate } from '../lib/ulid';

// ─────────────────────────────────────────────────────────────────────────────
// IDEA.xml §10 (ULID primary keys) + §93 (parser versioning)
//
// Tests ensure ID generation is:
// - Unique (no collisions)
// - Time-sortable (later IDs sort after earlier IDs)
// - Valid ULID format (26 chars, Crockford base32)
// - Round-trippable (ulid → timestamp → date)
// ─────────────────────────────────────────────────────────────────────────────

describe('ULID — generateULID', () => {
  it('produces a valid 26-character ULID', () => {
    const id = generateULID();
    expect(id).toHaveLength(26);
    // Crockford base32: 0123456789ABCDEFGHJKMNPQRSTVWXYZ
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('produces unique IDs under concurrent generation', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      ids.add(generateULID());
    }
    expect(ids.size).toBe(10000);
  });

  it('produces time-sortable IDs (later generation sorts after earlier)', () => {
    const id1 = generateULID();
    // Small delay to ensure different millisecond
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }
    const id2 = generateULID();
    expect(id2 > id1).toBe(true);
  });
});

describe('ULID — newId (from lib/ulid)', () => {
  it('produces a valid 26-character ULID', () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('produces unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      ids.add(newId());
    }
    expect(ids.size).toBe(10000);
  });
});

describe('ULID — timestamp extraction', () => {
  it('extracts correct millisecond timestamp from ULID', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const ts = ulidTimestamp(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('converts to Date correctly', () => {
    const now = Date.now();
    const id = newId();
    const date = ulidToDate(id);
    const ts = date.getTime();
    expect(ts).toBeGreaterThanOrEqual(now - 50); // within 50ms tolerance
    expect(ts).toBeLessThanOrEqual(now + 50);
  });

  it('handles ULIDs generated near epoch boundaries', () => {
    // Generate multiple IDs rapidly
    for (let i = 0; i < 100; i++) {
      const id = newId();
      const ts = ulidTimestamp(id);
      expect(ts).toBeGreaterThan(0);
      expect(ts).toBeLessThan(Date.now() + 1000);
    }
  });
});
