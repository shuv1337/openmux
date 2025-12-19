/**
 * Helper functions for layout reducer
 */

import type { Rectangle, Workspace, WorkspaceId, LayoutMode } from '../../types';
import type { LayoutConfig } from '../../config';
import type { LayoutState, Workspaces } from './types';
import { calculateMasterStackLayout } from '../master-stack-layout';

let paneIdCounter = 0;

/**
 * Generate a unique pane ID
 */
export function generatePaneId(): string {
  return `pane-${++paneIdCounter}`;
}

/**
 * Reset pane ID counter (for testing)
 */
export function resetPaneIdCounter(): void {
  paneIdCounter = 0;
}

/**
 * Sync pane ID counter with loaded panes to avoid ID conflicts
 * Called when loading a session with existing pane IDs
 */
export function syncPaneIdCounter(workspaces: Workspaces): void {
  let maxId = paneIdCounter;
  for (const workspace of Object.values(workspaces)) {
    if (!workspace) continue;
    if (workspace.mainPane) {
      const match = workspace.mainPane.id.match(/^pane-(\d+)$/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1]!, 10));
      }
    }
    for (const pane of workspace.stackPanes) {
      const match = pane.id.match(/^pane-(\d+)$/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1]!, 10));
      }
    }
  }
  paneIdCounter = maxId;
}

/**
 * Create a new empty workspace
 */
export function createWorkspace(id: WorkspaceId, layoutMode: LayoutMode): Workspace {
  return {
    id,
    mainPane: null,
    stackPanes: [],
    focusedPaneId: null,
    activeStackIndex: 0,
    layoutMode,
    zoomed: false,
  };
}

/**
 * Get the active workspace from state
 * Creates a new one if it doesn't exist
 */
export function getActiveWorkspace(state: LayoutState): Workspace {
  let workspace = state.workspaces[state.activeWorkspaceId];
  if (!workspace) {
    workspace = createWorkspace(state.activeWorkspaceId, state.config.defaultLayoutMode);
  }
  return workspace;
}

/**
 * Create a new workspaces object with the updated workspace
 */
export function updateWorkspace(state: LayoutState, workspace: Workspace): Workspaces {
  return {
    ...state.workspaces,
    [workspace.id]: workspace,
  };
}

/**
 * Recalculate layout for a workspace
 */
export function recalculateLayout(workspace: Workspace, viewport: Rectangle, config: LayoutConfig): Workspace {
  return calculateMasterStackLayout(workspace, viewport, config);
}
