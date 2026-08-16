/**
 * Cancellable delay promise — used by scraper delays and retry backoffs.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Jitter a base delay (in ms) for exponential backoff with full jitter.
 *
 * Reference: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function jitter(baseMs: number, capMs?: number): number {
  const capped = capMs ?? baseMs * 2;
  const range = Math.min(capped, baseMs * 2) - baseMs;
  return baseMs + Math.floor(Math.random() * (range + 1));
}

/**
 * Clamp a number between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Debounce a function call — returns a function that, when called, schedules
 * `fn` to run after `waitMs`. Repeated calls reset the timer. The returned
 * function also exposes `.cancel()` and `.flush()`.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  waitMs: number,
): { (args: Parameters<T>): void; cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: Parameters<T> | undefined;

  const debounced = (...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...lastArgs!);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (lastArgs) fn(...lastArgs);
  };

  return debounced as unknown as { (args: Parameters<T>): void; cancel(): void; flush(): void };
}
