const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, timestamps);
  return timestamps.length >= MAX_ATTEMPTS;
}

export function recordAttempt(key: string): void {
  const timestamps = attempts.get(key) ?? [];
  timestamps.push(Date.now());
  attempts.set(key, timestamps);
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
