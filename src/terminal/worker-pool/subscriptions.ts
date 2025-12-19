/**
 * Subscription management for the Worker Pool
 */

import type { TerminalScrollState } from '../../core/types';
import type {
  SessionState,
  UpdateCallback,
  TitleCallback,
  ModeCallback,
} from './types';

/**
 * Subscribe to terminal updates
 */
export function onUpdate(
  sessionId: string,
  callback: UpdateCallback,
  sessionToState: Map<string, SessionState>
): () => void {
  const state = sessionToState.get(sessionId);
  if (!state) {
    return () => {};
  }

  state.updateCallback = callback;

  // Deliver any buffered update that arrived before callback was set
  if (state.pendingUpdate) {
    const pending = state.pendingUpdate;
    state.pendingUpdate = null;
    // Use queueMicrotask to ensure callback runs after current stack completes
    queueMicrotask(() => callback(pending));
  }

  return () => {
    if (state.updateCallback === callback) {
      state.updateCallback = null;
    }
  };
}

/**
 * Subscribe to title changes
 */
export function onTitleChange(
  sessionId: string,
  callback: TitleCallback,
  sessionToState: Map<string, SessionState>
): () => void {
  const state = sessionToState.get(sessionId);
  if (!state) {
    return () => {};
  }

  state.titleCallback = callback;
  return () => {
    if (state.titleCallback === callback) {
      state.titleCallback = null;
    }
  };
}

/**
 * Subscribe to mode changes
 */
export function onModeChange(
  sessionId: string,
  callback: ModeCallback,
  sessionToState: Map<string, SessionState>
): () => void {
  const state = sessionToState.get(sessionId);
  if (!state) {
    return () => {};
  }

  state.modeCallback = callback;
  return () => {
    if (state.modeCallback === callback) {
      state.modeCallback = null;
    }
  };
}

/**
 * Update scroll state for a session (called from main thread)
 */
export function setScrollState(
  sessionId: string,
  scrollState: TerminalScrollState,
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (state) {
    state.scrollState = scrollState;
  }
}

/**
 * Get current scroll state for a session
 */
export function getScrollState(
  sessionId: string,
  sessionToState: Map<string, SessionState>
): TerminalScrollState | null {
  const state = sessionToState.get(sessionId);
  return state?.scrollState ?? null;
}
