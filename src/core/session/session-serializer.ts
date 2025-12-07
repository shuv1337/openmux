/**
 * Session serializer - converts between in-memory and serialized session formats
 */

import type {
  Workspace,
  WorkspaceId,
  PaneData,
  SerializedSession,
  SerializedWorkspace,
  SerializedPaneData,
  SessionMetadata,
  LayoutMode,
} from '../types';

/**
 * Serialize a pane to a persistable format
 */
function serializePane(
  pane: PaneData,
  cwdMap: Map<string, string>
): SerializedPaneData {
  return {
    id: pane.id,
    title: pane.title,
    cwd: pane.ptyId ? (cwdMap.get(pane.ptyId) ?? process.cwd()) : process.cwd(),
  };
}

/**
 * Serialize a workspace to a persistable format
 */
function serializeWorkspace(
  workspace: Workspace,
  cwdMap: Map<string, string>
): SerializedWorkspace {
  return {
    id: workspace.id,
    mainPane: workspace.mainPane ? serializePane(workspace.mainPane, cwdMap) : null,
    stackPanes: workspace.stackPanes.map(p => serializePane(p, cwdMap)),
    focusedPaneId: workspace.focusedPaneId,
    activeStackIndex: workspace.activeStackIndex,
    layoutMode: workspace.layoutMode,
    zoomed: workspace.zoomed,
  };
}

/**
 * Serialize an entire session (workspaces map + metadata)
 */
export function serializeSession(
  metadata: SessionMetadata,
  workspaces: Map<WorkspaceId, Workspace>,
  activeWorkspaceId: WorkspaceId,
  cwdMap: Map<string, string>
): SerializedSession {
  const serializedWorkspaces: SerializedWorkspace[] = [];

  for (const workspace of workspaces.values()) {
    // Only serialize workspaces that have panes
    if (workspace.mainPane || workspace.stackPanes.length > 0) {
      serializedWorkspaces.push(serializeWorkspace(workspace, cwdMap));
    }
  }

  return {
    metadata,
    workspaces: serializedWorkspaces,
    activeWorkspaceId,
  };
}

/**
 * Deserialize a pane from persisted format
 * Note: PTY IDs are not restored - they'll be created fresh
 */
function deserializePane(serialized: SerializedPaneData): PaneData {
  return {
    id: serialized.id,
    title: serialized.title,
    // ptyId is intentionally omitted - will be created on session load
    // cwd is used by the caller to create new PTY
  };
}

/**
 * Deserialize a workspace from persisted format
 */
function deserializeWorkspace(serialized: SerializedWorkspace): Workspace {
  return {
    id: serialized.id,
    mainPane: serialized.mainPane ? deserializePane(serialized.mainPane) : null,
    stackPanes: serialized.stackPanes.map(deserializePane),
    focusedPaneId: serialized.focusedPaneId,
    activeStackIndex: serialized.activeStackIndex,
    layoutMode: serialized.layoutMode,
    zoomed: serialized.zoomed,
  };
}

/**
 * Deserialize a session from persisted format
 * Returns the workspaces map and active workspace ID
 */
export function deserializeSession(
  serialized: SerializedSession
): {
  metadata: SessionMetadata;
  workspaces: Map<WorkspaceId, Workspace>;
  activeWorkspaceId: WorkspaceId;
} {
  const workspaces = new Map<WorkspaceId, Workspace>();

  for (const ws of serialized.workspaces) {
    workspaces.set(ws.id, deserializeWorkspace(ws));
  }

  return {
    metadata: serialized.metadata,
    workspaces,
    activeWorkspaceId: serialized.activeWorkspaceId,
  };
}

/**
 * Extract cwd map from serialized session
 * Maps pane ID to cwd for PTY creation
 */
export function extractCwdMap(serialized: SerializedSession): Map<string, string> {
  const cwdMap = new Map<string, string>();

  for (const ws of serialized.workspaces) {
    if (ws.mainPane) {
      cwdMap.set(ws.mainPane.id, ws.mainPane.cwd);
    }
    for (const pane of ws.stackPanes) {
      cwdMap.set(pane.id, pane.cwd);
    }
  }

  return cwdMap;
}

/**
 * Count total panes across all workspaces in a serialized session
 */
export function countPanes(serialized: SerializedSession): number {
  let count = 0;
  for (const ws of serialized.workspaces) {
    if (ws.mainPane) count++;
    count += ws.stackPanes.length;
  }
  return count;
}

/**
 * Count workspaces with at least one pane
 */
export function countPopulatedWorkspaces(serialized: SerializedSession): number {
  return serialized.workspaces.filter(
    ws => ws.mainPane || ws.stackPanes.length > 0
  ).length;
}
