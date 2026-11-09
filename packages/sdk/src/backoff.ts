export interface BackoffOptions {
  /** First wait. Default 1,000 ms. */
  initialMs?: number;
  /** Longest wait. Default 30,000 ms. */
  maxMs?: number;
}

/**
 * Wait before reconnect number `attempt` (0 based): exponential growth with "equal jitter",
 * half fixed and half random, so many clients that lost the server at once do not return at once.
 */
export function backoffDelay(attempt: number, options: BackoffOptions = {}, random: () => number = Math.random): number {
  const initial = options.initialMs ?? 1000;
  const max = options.maxMs ?? 30_000;
  const ceiling = Math.min(max, initial * 2 ** Math.min(attempt, 30));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
