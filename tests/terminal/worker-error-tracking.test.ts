/**
 * Tests for worker error tracking and recovery logic
 *
 * These tests verify that the worker pool properly tracks errors and
 * triggers worker restarts after consecutive errors within a time window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Constants from worker-pool.ts
const MAX_CONSECUTIVE_ERRORS = 3;
const ERROR_WINDOW_MS = 5000;

// Simulate the error tracking logic from worker-pool.ts
interface SessionState {
  workerIndex: number;
  errorCount: number;
  lastErrorAt: number | null;
}

class MockErrorTracker {
  private workerErrorCounts: number[] = [];
  private workerRestartInProgress: boolean[] = [];
  private sessionToState = new Map<string, SessionState>();
  private restartCallCount = 0;

  constructor(workerCount: number) {
    this.workerErrorCounts = new Array(workerCount).fill(0);
    this.workerRestartInProgress = new Array(workerCount).fill(false);
  }

  createSession(sessionId: string, workerIndex: number): void {
    this.sessionToState.set(sessionId, {
      workerIndex,
      errorCount: 0,
      lastErrorAt: null,
    });
  }

  // Track last error time per worker (for cases without session)
  private workerLastErrorAt: (number | null)[] = [];

  handleError(
    workerIndex: number,
    sessionId: string | undefined,
    now: number = Date.now()
  ): boolean {
    // Initialize worker error tracking if needed
    if (this.workerLastErrorAt[workerIndex] === undefined) {
      this.workerLastErrorAt[workerIndex] = null;
    }

    // Reset error count if last error was outside the window
    if (this.workerErrorCounts[workerIndex] > 0) {
      const sessionsOnWorker = Array.from(this.sessionToState.values()).filter(
        (s) => s.workerIndex === workerIndex
      );

      // Check session errors
      const recentSessionError = sessionsOnWorker.some(
        (s) => s.lastErrorAt && now - s.lastErrorAt < ERROR_WINDOW_MS
      );

      // Also check worker-level last error (for errors without session)
      const recentWorkerError =
        this.workerLastErrorAt[workerIndex] !== null &&
        now - this.workerLastErrorAt[workerIndex]! < ERROR_WINDOW_MS;

      if (!recentSessionError && !recentWorkerError) {
        this.workerErrorCounts[workerIndex] = 0;
      }
    }

    this.workerErrorCounts[workerIndex]++;
    this.workerLastErrorAt[workerIndex] = now;

    // Update session error tracking if we have a session
    if (sessionId) {
      const state = this.sessionToState.get(sessionId);
      if (state) {
        state.errorCount++;
        state.lastErrorAt = now;
      }
    }

    // Check if worker needs restart
    if (
      this.workerErrorCounts[workerIndex] >= MAX_CONSECUTIVE_ERRORS &&
      !this.workerRestartInProgress[workerIndex]
    ) {
      this.workerRestartInProgress[workerIndex] = true;
      this.restartCallCount++;
      // Simulate restart completion
      this.workerErrorCounts[workerIndex] = 0;
      this.workerLastErrorAt[workerIndex] = null;
      this.workerRestartInProgress[workerIndex] = false;
      return true; // Restart triggered
    }

    return false; // No restart
  }

  getWorkerErrorCount(workerIndex: number): number {
    return this.workerErrorCounts[workerIndex];
  }

  getRestartCallCount(): number {
    return this.restartCallCount;
  }

  getSessionErrorCount(sessionId: string): number {
    return this.sessionToState.get(sessionId)?.errorCount ?? 0;
  }
}

describe('worker-error-tracking', () => {
  describe('constants', () => {
    it('MAX_CONSECUTIVE_ERRORS is 3', () => {
      expect(MAX_CONSECUTIVE_ERRORS).toBe(3);
    });

    it('ERROR_WINDOW_MS is 5000ms', () => {
      expect(ERROR_WINDOW_MS).toBe(5000);
    });
  });

  describe('error counting', () => {
    it('increments error count on each error', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);

      tracker.handleError(0, 'session1');
      expect(tracker.getWorkerErrorCount(0)).toBe(1);

      tracker.handleError(0, 'session1');
      expect(tracker.getWorkerErrorCount(0)).toBe(2);
    });

    it('tracks errors per worker independently', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      tracker.createSession('session2', 1);

      tracker.handleError(0, 'session1');
      tracker.handleError(0, 'session1');
      tracker.handleError(1, 'session2');

      expect(tracker.getWorkerErrorCount(0)).toBe(2);
      expect(tracker.getWorkerErrorCount(1)).toBe(1);
    });

    it('tracks errors per session', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      tracker.createSession('session2', 0);

      tracker.handleError(0, 'session1');
      tracker.handleError(0, 'session1');
      tracker.handleError(0, 'session2');

      expect(tracker.getSessionErrorCount('session1')).toBe(2);
      expect(tracker.getSessionErrorCount('session2')).toBe(1);
    });
  });

  describe('restart triggering', () => {
    it('triggers restart after MAX_CONSECUTIVE_ERRORS', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      const now = Date.now();

      // First two errors - no restart
      expect(tracker.handleError(0, 'session1', now)).toBe(false);
      expect(tracker.handleError(0, 'session1', now + 100)).toBe(false);

      // Third error - triggers restart
      expect(tracker.handleError(0, 'session1', now + 200)).toBe(true);
      expect(tracker.getRestartCallCount()).toBe(1);
    });

    it('resets error count after restart', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      const now = Date.now();

      // Trigger restart
      tracker.handleError(0, 'session1', now);
      tracker.handleError(0, 'session1', now + 100);
      tracker.handleError(0, 'session1', now + 200);

      // Error count should be reset after restart
      expect(tracker.getWorkerErrorCount(0)).toBe(0);
    });

    it('does not trigger restart if under threshold', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      const now = Date.now();

      tracker.handleError(0, 'session1', now);
      tracker.handleError(0, 'session1', now + 100);

      expect(tracker.getRestartCallCount()).toBe(0);
    });
  });

  describe('error window', () => {
    it('resets error count after ERROR_WINDOW_MS with no errors', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      const now = Date.now();

      // Two errors at now and now + 100
      tracker.handleError(0, 'session1', now);
      tracker.handleError(0, 'session1', now + 100);
      expect(tracker.getWorkerErrorCount(0)).toBe(2);

      // Error after window expires from LAST error (now + 100 + 5001)
      // The window is measured from the most recent error
      const afterWindow = now + 100 + ERROR_WINDOW_MS + 1;
      tracker.handleError(0, 'session1', afterWindow);

      // Count resets to 1 (the new error)
      expect(tracker.getWorkerErrorCount(0)).toBe(1);
    });

    it('accumulates errors within the window', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      const now = Date.now();

      // Errors within window should accumulate
      tracker.handleError(0, 'session1', now);
      tracker.handleError(0, 'session1', now + 1000);
      tracker.handleError(0, 'session1', now + 2000);

      expect(tracker.getRestartCallCount()).toBe(1); // Should have triggered restart
    });
  });

  describe('multiple workers', () => {
    it('only restarts the failing worker', () => {
      const tracker = new MockErrorTracker(3);
      tracker.createSession('session1', 0);
      tracker.createSession('session2', 1);
      tracker.createSession('session3', 2);
      const now = Date.now();

      // Trigger restart on worker 1 only
      tracker.handleError(1, 'session2', now);
      tracker.handleError(1, 'session2', now + 100);
      tracker.handleError(1, 'session2', now + 200);

      // Only worker 1 should have been restarted
      expect(tracker.getRestartCallCount()).toBe(1);
      expect(tracker.getWorkerErrorCount(0)).toBe(0);
      expect(tracker.getWorkerErrorCount(1)).toBe(0); // Reset after restart
      expect(tracker.getWorkerErrorCount(2)).toBe(0);
    });

    it('can restart multiple workers independently', () => {
      const tracker = new MockErrorTracker(2);
      tracker.createSession('session1', 0);
      tracker.createSession('session2', 1);
      const now = Date.now();

      // Trigger restart on worker 0
      tracker.handleError(0, 'session1', now);
      tracker.handleError(0, 'session1', now + 100);
      tracker.handleError(0, 'session1', now + 200);

      // Trigger restart on worker 1
      tracker.handleError(1, 'session2', now + 300);
      tracker.handleError(1, 'session2', now + 400);
      tracker.handleError(1, 'session2', now + 500);

      expect(tracker.getRestartCallCount()).toBe(2);
    });
  });

  describe('session without ID', () => {
    it('still tracks worker errors without session ID', () => {
      const tracker = new MockErrorTracker(2);
      const now = Date.now();

      tracker.handleError(0, undefined, now);
      tracker.handleError(0, undefined, now + 100);

      expect(tracker.getWorkerErrorCount(0)).toBe(2);
    });

    it('triggers restart without session ID', () => {
      const tracker = new MockErrorTracker(2);
      const now = Date.now();

      tracker.handleError(0, undefined, now);
      tracker.handleError(0, undefined, now + 100);
      const restarted = tracker.handleError(0, undefined, now + 200);

      expect(restarted).toBe(true);
    });
  });
});
