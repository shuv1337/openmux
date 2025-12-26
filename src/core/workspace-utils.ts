/**
 * Workspace utility functions
 * Centralizes common operations on workspaces to avoid duplication
 */

import type { Workspace, PaneData, NodeId } from './types';
import { collectPanes, containsPane, findPane } from './layout-tree';

/**
 * Get the focused pane from a workspace
 * Returns null if no pane is focused or workspace has no panes
 */
export function getFocusedPane(workspace: Workspace): PaneData | null {
  const { focusedPaneId, mainPane, stackPanes } = workspace;
  if (!focusedPaneId) return null;

  if (mainPane) {
    const pane = findPane(mainPane, focusedPaneId);
    if (pane) return pane;
  }

  for (const pane of stackPanes) {
    const found = findPane(pane, focusedPaneId);
    if (found) return found;
  }

  return null;
}

/**
 * Get the PTY ID of the focused pane
 * Returns undefined if no pane is focused or pane has no PTY
 */
export function getFocusedPtyId(workspace: Workspace): string | undefined {
  return getFocusedPane(workspace)?.ptyId;
}

/**
 * Check if the main pane is focused
 */
export function isMainPaneFocused(workspace: Workspace): boolean {
  if (!workspace.mainPane || !workspace.focusedPaneId) return false;
  return containsPane(workspace.mainPane, workspace.focusedPaneId);
}

/**
 * Get the index of a pane in the stack, or -1 if not found
 */
export function getStackPaneIndex(workspace: Workspace, paneId: NodeId): number {
  return workspace.stackPanes.findIndex(p => containsPane(p, paneId));
}

/**
 * Get all panes in a workspace (main + stack)
 */
export function getAllPanes(workspace: Workspace): PaneData[] {
  const panes: PaneData[] = [];
  if (workspace.mainPane) {
    collectPanes(workspace.mainPane, panes);
  }
  for (const pane of workspace.stackPanes) {
    collectPanes(pane, panes);
  }
  return panes;
}

/**
 * Get a pane by ID from the workspace
 */
export function getPaneById(workspace: Workspace, paneId: NodeId): PaneData | null {
  if (workspace.mainPane) {
    const pane = findPane(workspace.mainPane, paneId);
    if (pane) return pane;
  }
  for (const pane of workspace.stackPanes) {
    const found = findPane(pane, paneId);
    if (found) return found;
  }
  return null;
}
