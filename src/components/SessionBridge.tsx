/**
 * SessionBridge - bridges SessionContext with Layout and Terminal contexts
 * This component lives inside all contexts and provides callbacks to SessionContext
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useLayout } from '../contexts/LayoutContext';
import { useTerminal } from '../contexts/TerminalContext';
import { SessionProvider } from '../contexts/SessionContext';
import type { Workspace, WorkspaceId } from '../core/types';
import {
  clearPtyTracking,
  setSessionCwdMap,
} from '../effect/bridge';

interface SessionBridgeProps {
  children: React.ReactNode;
}

export function SessionBridge({ children }: SessionBridgeProps) {
  const { dispatch: layoutDispatch, state: layoutState, layoutVersion } = useLayout();
  const { createPTY, destroyAllPTYs, suspendSession, resumeSession, cleanupSessionPtys, getSessionCwd, isInitialized } = useTerminal();

  // Refs for stable callbacks
  const layoutStateRef = useRef(layoutState);
  const createPTYRef = useRef(createPTY);
  const destroyAllPTYsRef = useRef(destroyAllPTYs);
  const suspendSessionRef = useRef(suspendSession);
  const resumeSessionRef = useRef(resumeSession);
  const cleanupSessionPtysRef = useRef(cleanupSessionPtys);
  const getSessionCwdRef = useRef(getSessionCwd);
  const layoutDispatchRef = useRef(layoutDispatch);

  useEffect(() => {
    layoutStateRef.current = layoutState;
    createPTYRef.current = createPTY;
    destroyAllPTYsRef.current = destroyAllPTYs;
    suspendSessionRef.current = suspendSession;
    resumeSessionRef.current = resumeSession;
    cleanupSessionPtysRef.current = cleanupSessionPtys;
    getSessionCwdRef.current = getSessionCwd;
    layoutDispatchRef.current = layoutDispatch;
  }, [layoutState, createPTY, destroyAllPTYs, suspendSession, resumeSession, cleanupSessionPtys, getSessionCwd, layoutDispatch]);

  // Callbacks for SessionProvider
  const getCwd = useCallback(async (ptyId: string) => {
    return getSessionCwdRef.current(ptyId);
  }, []);

  const getWorkspaces = useCallback(() => {
    return layoutStateRef.current.workspaces;
  }, []);

  const getActiveWorkspaceId = useCallback(() => {
    return layoutStateRef.current.activeWorkspaceId;
  }, []);

  const onSessionLoad = useCallback(async (
    workspaces: Map<WorkspaceId, Workspace>,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    sessionId: string
  ) => {
    // Try to resume PTYs for this session (if we've visited it before)
    const restoredPtys = await resumeSessionRef.current(sessionId);

    // If we have restored PTYs, assign them to the panes
    if (restoredPtys && restoredPtys.size > 0) {
      for (const [, workspace] of workspaces) {
        if (workspace.mainPane) {
          const ptyId = restoredPtys.get(workspace.mainPane.id);
          if (ptyId) {
            workspace.mainPane.ptyId = ptyId;
          }
        }
        for (const pane of workspace.stackPanes) {
          const ptyId = restoredPtys.get(pane.id);
          if (ptyId) {
            pane.ptyId = ptyId;
          }
        }
      }
    }

    // Clear PTY tracking to allow new PTYs to be created for panes without restored PTYs
    await clearPtyTracking();

    // Load workspaces into layout
    layoutDispatchRef.current({ type: 'LOAD_SESSION', workspaces, activeWorkspaceId });

    // Store cwdMap in AppCoordinator for AppContent to use (for panes without restored PTYs)
    await setSessionCwdMap(cwdMap);
  }, []);

  const onBeforeSwitch = useCallback(async (currentSessionId: string) => {
    // Suspend PTYs for current session (save mapping, unsubscribe but don't destroy)
    suspendSessionRef.current(currentSessionId);
    layoutDispatchRef.current({ type: 'CLEAR_ALL' });
    // Clear PTY tracking
    await clearPtyTracking();
  }, []);

  const onDeleteSession = useCallback((sessionId: string) => {
    // Clean up PTYs for deleted session
    cleanupSessionPtysRef.current(sessionId);
  }, []);

  return (
    <SessionProvider
      getCwd={getCwd}
      getWorkspaces={getWorkspaces}
      getActiveWorkspaceId={getActiveWorkspaceId}
      onSessionLoad={onSessionLoad}
      onBeforeSwitch={onBeforeSwitch}
      onDeleteSession={onDeleteSession}
      layoutVersion={layoutVersion}
    >
      {children}
    </SessionProvider>
  );
}
