export interface RetryDecision {
  shouldRetry: boolean;
  availableAt: string | null;
}

const RETRY_DELAYS_MS = [30_000, 120_000];

export function retryDecision(attemptNumber: number, now: Date, jitter: () => number): RetryDecision {
  if (attemptNumber >= 3) return { shouldRetry: false, availableAt: null };
  const baseDelay = RETRY_DELAYS_MS[attemptNumber - 1] ?? 0;
  return { shouldRetry: true, availableAt: new Date(now.getTime() + baseDelay + Math.max(0, jitter())).toISOString() };
}
