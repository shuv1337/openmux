/**
 * Session management handlers for TerminalContext
 * Handles suspend, resume, and cleanup of PTY sessions across session switches
 */

import type { MutableRefObject } from 'react';
import { destroyPty } from '../../effect/bridge';
import { subscribeToPtyWithCaches, clearAllPtyCaches, type PtyCaches } from '../../hooks/usePtySubscription';

export interface SessionHandlerDeps {
  /** Map of ptyId -> paneId for current session */
  ptyToPaneMap: MutableRefObject<Map<string, string>>;
  /** Map of sessionId -> Map<paneId, ptyId> for all sessions */
  sessionPtyMapRef: MutableRefObject<Map<string, Map<string, string>>>;
  /** Unified caches for PTY state */
  ptyCaches: MutableRefObject<PtyCaches>;
  /** Map of ptyId -> unsubscribe function */
  unsubscribeFns: MutableRefObject<Map<string, () => void>>;
  /** Handler for PTY exit events */
  handlePtyExit: (ptyId: string, paneId: string) => void;
}

/**
 * Creates session management handlers for TerminalContext
 */
export function createSessionHandlers(deps: SessionHandlerDeps) {
  const {
    ptyToPaneMap,
    sessionPtyMapRef,
    ptyCaches,
    unsubscribeFns,
    handlePtyExit,
  } = deps;

  /**
   * Suspend a session: save PTY mapping and unsubscribe (but don't destroy PTYs)
   * This allows PTYs to stay alive during session switches
   */
  const handleSuspendSession = (sessionId: string): void => {
    // Save current pane→pty mapping for this session
    const mapping = new Map<string, string>();
    for (const [ptyId, paneId] of ptyToPaneMap.current) {
      mapping.set(paneId, ptyId);
    }
    sessionPtyMapRef.current.set(sessionId, mapping);

    // Unsubscribe from all PTYs (stop rendering, but keep alive)
    for (const unsub of unsubscribeFns.current.values()) {
      unsub();
    }
    unsubscribeFns.current.clear();
    clearAllPtyCaches(ptyCaches.current);
    ptyToPaneMap.current.clear();
    // Note: DO NOT call destroyAllPtys() - PTYs stay alive
  };

  /**
   * Resume a session: resubscribe to saved PTYs
   * Returns the paneId -> ptyId mapping for the resumed session
   */
  const handleResumeSession = async (
    sessionId: string
  ): Promise<Map<string, string> | undefined> => {
    const savedMapping = sessionPtyMapRef.current.get(sessionId);
    if (!savedMapping || savedMapping.size === 0) {
      return undefined;
    }

    // Resubscribe to each PTY
    for (const [paneId, ptyId] of savedMapping) {
      try {
        // Subscribe to PTY with unified caches
        const unsub = await subscribeToPtyWithCaches(
          ptyId,
          paneId,
          ptyCaches.current,
          handlePtyExit
        );

        // Store unsubscribe function
        unsubscribeFns.current.set(ptyId, unsub);

        // Restore pty→pane mapping
        ptyToPaneMap.current.set(ptyId, paneId);
      } catch (err) {
        // PTY may have exited while suspended - remove from mapping
        savedMapping.delete(paneId);
      }
    }

    return savedMapping;
  };

  /**
   * Cleanup PTYs for a deleted session
   * Destroys all PTYs associated with the session
   */
  const handleCleanupSessionPtys = (sessionId: string): void => {
    const savedMapping = sessionPtyMapRef.current.get(sessionId);
    if (savedMapping) {
      for (const ptyId of savedMapping.values()) {
        // Unsubscribe if currently subscribed
        const unsub = unsubscribeFns.current.get(ptyId);
        if (unsub) {
          unsub();
          unsubscribeFns.current.delete(ptyId);
        }
        // Destroy the PTY
        destroyPty(ptyId);
      }
      sessionPtyMapRef.current.delete(sessionId);
    }
  };

  /**
   * Find which session owns a PTY
   * Returns sessionId and paneId, or null if not found
   */
  const findSessionForPty = (
    ptyId: string
  ): { sessionId: string; paneId: string } | null => {
    // First check current session's ptyToPaneMap (active PTYs)
    const currentPaneId = ptyToPaneMap.current.get(ptyId);
    if (currentPaneId) {
      // PTY is in the current session - find which session that is
      // by checking sessionPtyMapRef for a session that has this mapping
      for (const [sessionId, mapping] of sessionPtyMapRef.current) {
        for (const [paneId, mappedPtyId] of mapping) {
          if (mappedPtyId === ptyId) {
            return { sessionId, paneId };
          }
        }
      }
      // If not found in sessionPtyMapRef, it's in the current unsaved session
      // Return null for now - the caller should handle current session separately
      return null;
    }

    // Search through all session PTY mappings
    for (const [sessionId, mapping] of sessionPtyMapRef.current) {
      for (const [paneId, mappedPtyId] of mapping) {
        if (mappedPtyId === ptyId) {
          return { sessionId, paneId };
        }
      }
    }

    return null;
  };

  return {
    handleSuspendSession,
    handleResumeSession,
    handleCleanupSessionPtys,
    findSessionForPty,
  };
}
