/**
 * Hash Utils Tests (Phase 9 Coverage)
 */
import { sha256, sha256Salted, sha256Json, verifyChecksum, sha256Init } from './hash';

describe('Hash — sha256 (Phase 9)', () => {
  it('produces deterministic SHA-256 hex for same input', () => {
    const h1 = sha256('test');
    const h2 = sha256('test');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(h1).toMatch(/^[0-9a-f]+$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });

  it('handles empty string', () => {
    const h = sha256('');
    expect(h).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('Hash — sha256Salted (Phase 9)', () => {
  it('produces different hash with different salt', () => {
    expect(sha256Salted('test', 'salt1')).not.toBe(sha256Salted('test', 'salt2'));
  });

  it('produces different hash than unsalted', () => {
    expect(sha256Salted('test', 'salt')).not.toBe(sha256('test'));
  });
});

describe('Hash — sha256Json (Phase 9)', () => {
  it('produces deterministic hash for objects with same keys in different order', () => {
    const h1 = sha256Json({ a: 1, b: 2 });
    const h2 = sha256Json({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('produces different hash for different values', () => {
    expect(sha256Json({ a: 1 })).not.toBe(sha256Json({ a: 2 }));
  });

  it('handles salt parameter', () => {
    expect(sha256Json({ a: 1 }, 'salt')).not.toBe(sha256Json({ a: 1 }));
  });

  it('handles arrays', () => {
    const h = sha256Json([1, 2, 3]);
    expect(h).toHaveLength(64);
  });

  it('handles nested objects', () => {
    const h = sha256Json({ a: { b: 1 } });
    expect(h).toHaveLength(64);
  });
});

describe('Hash — verifyChecksum (Phase 9)', () => {
  it('returns true for matching checksum', () => {
    const payload = 'test data';
    const checksum = sha256(payload);
    expect(verifyChecksum(payload, checksum)).toBe(true);
  });

  it('returns false for mismatched checksum', () => {
    expect(verifyChecksum('test', 'wrong_hash')).toBe(false);
  });

  it('works with salt', () => {
    const payload = 'test';
    const salt = 'mysalt';
    const checksum = sha256Salted(payload, salt);
    expect(verifyChecksum(payload, checksum, salt)).toBe(true);
  });
});

describe('Hash — sha256Init (Phase 9)', () => {
  it('returns a Hash object', () => {
    const h = sha256Init();
    expect(h).toBeDefined();
    expect(typeof h.update).toBe('function');
    expect(typeof h.digest).toBe('function');
  });

  it('can compute incrementally', () => {
    const h = sha256Init();
    h.update('part1');
    h.update('part2');
    const digest = h.digest('hex');
    expect(digest).toBe(sha256('part1part2'));
  });
});
