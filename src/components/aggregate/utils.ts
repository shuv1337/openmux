/**
 * Utility functions for AggregateView
 */

import type { WorkspaceId } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';

/**
 * Get the last segment of a path (directory name)
 */
export function getDirectoryName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Find which workspace and pane contains a given PTY ID
 */
export function findPtyLocation(
  ptyId: string,
  workspaces: Workspaces
): { workspaceId: WorkspaceId; paneId: string } | null {
  for (const [idStr, workspace] of Object.entries(workspaces)) {
    if (!workspace) continue;
    const workspaceId = Number(idStr) as WorkspaceId;
    // Check main pane
    if (workspace.mainPane?.ptyId === ptyId) {
      return { workspaceId, paneId: workspace.mainPane.id };
    }
    // Check stack panes
    for (const pane of workspace.stackPanes) {
      if (pane.ptyId === ptyId) {
        return { workspaceId, paneId: pane.id };
      }
    }
  }
  return null;
}

/**
 * Find which workspace contains a given pane ID
 */
export function findPaneLocation(
  paneId: string,
  workspaces: Workspaces
): { workspaceId: WorkspaceId } | null {
  for (const [idStr, workspace] of Object.entries(workspaces)) {
    if (!workspace) continue;
    const workspaceId = Number(idStr) as WorkspaceId;
    if (workspace.mainPane?.id === paneId) {
      return { workspaceId };
    }
    for (const pane of workspace.stackPanes) {
      if (pane.id === paneId) {
        return { workspaceId };
      }
    }
  }
  return null;
}
