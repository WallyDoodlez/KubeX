/**
 * LoadingContext — global loading state for the progress bar.
 *
 * Uses a module-level counter + useSyncExternalStore so the GlobalProgressBar
 * can subscribe without prop-drilling or heavy context re-renders.
 *
 * Usage:
 *   const { startLoading, stopLoading } = useLoading();
 */

import { useSyncExternalStore } from 'react';

// ── Module-level state (singleton) ──────────────────────────────────────────

let activeCount = 0;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
}

function getSnapshot(): number {
  return activeCount;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Increment the active fetch counter. Call before an API request. */
export function startLoading(): void {
  activeCount += 1;
  notifySubscribers();
}

/** Decrement the active fetch counter. Call when a request completes (success or error). */
export function stopLoading(): void {
  activeCount = Math.max(0, activeCount - 1);
  notifySubscribers();
}

/** Reset counter to 0 (useful in tests). */
export function resetLoading(): void {
  activeCount = 0;
  notifySubscribers();
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/** Returns the current active fetch count, subscribed via useSyncExternalStore. */
export function useLoadingCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Convenience hook — returns startLoading / stopLoading for components. */
export function useLoading(): { startLoading: () => void; stopLoading: () => void } {
  return { startLoading, stopLoading };
}
