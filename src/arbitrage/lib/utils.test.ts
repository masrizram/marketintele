/**
 * Lib Utils Tests (Phase 9 Coverage)
 *
 * Tests delay, jitter, clamp, debounce utility functions.
 */
import { delay, jitter, clamp, debounce } from './utils';

describe('Utils — delay (Phase 9)', () => {
  it('delay resolves after specified ms', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('delay(0) resolves immediately', async () => {
    await expect(delay(0)).resolves.toBeUndefined();
  });
});

describe('Utils — jitter (Phase 9)', () => {
  it('jitter returns a number >= baseMs', () => {
    const result = jitter(1000);
    expect(result).toBeGreaterThanOrEqual(1000);
  });

  it('jitter with cap returns value <= cap*2', () => {
    const result = jitter(1000, 3000);
    expect(result).toBeLessThanOrEqual(3000);
  });

  it('jitter with no cap uses baseMs*2 as cap', () => {
    const result = jitter(500);
    expect(result).toBeGreaterThanOrEqual(500);
    expect(result).toBeLessThanOrEqual(1000);
  });

  it('jitter with 0 base returns 0', () => {
    const result = jitter(0);
    expect(result).toBe(0);
  });
});

describe('Utils — clamp (Phase 9)', () => {
  it('clamps value below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps value above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns value within range unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps at boundaries', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('Utils — debounce (Phase 9)', () => {
  it('debounce calls function after wait', (done) => {
    let called = 0;
    const fn = debounce(() => { called++; }, 50);
    (fn as any)();
    expect(called).toBe(0);
    setTimeout(() => {
      expect(called).toBe(1);
      done();
    }, 100);
  });

  it('debounce cancel prevents call', (done) => {
    let called = 0;
    const fn = debounce(() => { called++; }, 50);
    (fn as any)();
    fn.cancel();
    setTimeout(() => {
      expect(called).toBe(0);
      done();
    }, 100);
  });

  it('debounce flush calls immediately', () => {
    let called = 0;
    const fn = debounce(() => { called++; }, 100);
    (fn as any)();
    fn.flush();
    expect(called).toBe(1);
  });

  it('debounce handles multiple calls (only last fires)', (done) => {
    let called = 0;
    const fn = debounce(() => { called++; }, 50);
    (fn as any)();
    (fn as any)();
    (fn as any)();
    setTimeout(() => {
      expect(called).toBe(1);
      done();
    }, 100);
  });
});
