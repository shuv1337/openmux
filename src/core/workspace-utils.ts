/**
 * Workspace utility functions
 * Centralizes common operations on workspaces to avoid duplication
 */

import type { Workspace, PaneData, NodeId } from './types';

/**
 * Get the focused pane from a workspace
 * Returns null if no pane is focused or workspace has no panes
 */
export function getFocusedPane(workspace: Workspace): PaneData | null {
  const { focusedPaneId, mainPane, stackPanes } = workspace;
  if (!focusedPaneId) return null;

  if (mainPane?.id === focusedPaneId) {
    return mainPane;
  }

  return stackPanes.find(p => p.id === focusedPaneId) ?? null;
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
  return workspace.mainPane?.id === workspace.focusedPaneId;
}

/**
 * Get the index of a pane in the stack, or -1 if not found
 */
export function getStackPaneIndex(workspace: Workspace, paneId: NodeId): number {
  return workspace.stackPanes.findIndex(p => p.id === paneId);
}

/**
 * Get all panes in a workspace (main + stack)
 */
export function getAllPanes(workspace: Workspace): PaneData[] {
  const panes: PaneData[] = [];
  if (workspace.mainPane) {
    panes.push(workspace.mainPane);
  }
  panes.push(...workspace.stackPanes);
  return panes;
}

/**
 * Get a pane by ID from the workspace
 */
export function getPaneById(workspace: Workspace, paneId: NodeId): PaneData | null {
  if (workspace.mainPane?.id === paneId) {
    return workspace.mainPane;
  }
  return workspace.stackPanes.find(p => p.id === paneId) ?? null;
}
