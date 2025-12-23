/**
 * SessionBridge - bridges SessionContext with Layout and Terminal contexts
 * This component lives inside all contexts and provides callbacks to SessionContext
 */

import type { ParentProps } from 'solid-js';
import { useLayout } from '../contexts/LayoutContext';
import { useTerminal } from '../contexts/TerminalContext';
import { SessionProvider } from '../contexts/SessionContext';
import type { WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import {
  clearPtyTracking,
  setSessionCwdMap,
  clearSessionCwdMap,
} from '../effect/bridge';

interface SessionBridgeProps extends ParentProps {}

export function SessionBridge(props: SessionBridgeProps) {
  const layout = useLayout();
  const { loadSession } = layout;
  const { suspendSession, resumeSession, cleanupSessionPtys, getSessionCwd } = useTerminal();

  // In Solid, we don't need refs for stable callbacks - there are no stale closures

  // Callbacks for SessionProvider
  const getCwd = async (ptyId: string) => {
    return getSessionCwd(ptyId);
  };

  const getWorkspaces = () => {
    return layout.state.workspaces;
  };

  const getActiveWorkspaceId = () => {
    return layout.state.activeWorkspaceId;
  };

  const onSessionLoad = async (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    sessionId: string
  ) => {
    // Try to resume PTYs for this session (if we've visited it before)
    const restoredPtys = await resumeSession(sessionId);

    // If we have restored PTYs, assign them to the panes
    if (restoredPtys && restoredPtys.size > 0) {
      for (const workspace of Object.values(workspaces)) {
        if (!workspace) continue;
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
    clearPtyTracking();

    // IMPORTANT: Store cwdMap BEFORE loading session
    // This ensures CWDs are available when PTY creation effect runs
    setSessionCwdMap(cwdMap);

    // Load workspaces into layout (this triggers reactive effects)
    loadSession({ workspaces, activeWorkspaceId });
  };

  const onBeforeSwitch = async (currentSessionId: string) => {
    // Suspend PTYs for current session (save mapping, unsubscribe but don't destroy)
    suspendSession(currentSessionId);
    // Clear PTY tracking and CWD map to prevent stale state
    clearPtyTracking();
    clearSessionCwdMap();
  };

  const onDeleteSession = (sessionId: string) => {
    // Clean up PTYs for deleted session
    cleanupSessionPtys(sessionId);
  };

  return (
    <SessionProvider
      getCwd={getCwd}
      getWorkspaces={getWorkspaces}
      getActiveWorkspaceId={getActiveWorkspaceId}
      onSessionLoad={onSessionLoad}
      onBeforeSwitch={onBeforeSwitch}
      onDeleteSession={onDeleteSession}
      layoutVersion={() => layout.layoutVersion}
    >
      {props.children}
    </SessionProvider>
  );
}
