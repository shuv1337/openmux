/**
 * Session manager - high-level session operations
 */

import type {
  SessionId,
  SessionMetadata,
  SerializedSession,
  Workspace,
  WorkspaceId,
} from '../types';
import {
  loadSessionIndex,
  saveSessionIndex,
  loadSession as loadSessionFromDisk,
  saveSession as saveSessionToDisk,
  deleteSessionFile,
  setActiveSessionId,
} from './session-storage';
import {
  serializeSession,
  deserializeSession,
  extractCwdMap,
  countPanes,
  countPopulatedWorkspaces,
} from './session-serializer';

/**
 * Generate a unique session ID
 */
function generateSessionId(): SessionId {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Extract auto-name from a path (last directory component)
 */
export function getAutoName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'untitled';
}

/**
 * Create a new session
 */
export async function createSession(name?: string): Promise<SessionMetadata> {
  const now = Date.now();
  const id = generateSessionId();

  const metadata: SessionMetadata = {
    id,
    name: name ?? getAutoName(process.cwd()),
    createdAt: now,
    lastSwitchedAt: now,
    autoNamed: !name,
  };

  // Add to index
  const index = await loadSessionIndex();
  index.sessions.push(metadata);
  index.activeSessionId = id;
  await saveSessionIndex(index);

  return metadata;
}

/**
 * List all sessions sorted by lastSwitchedAt (most recent first)
 */
export async function listSessions(): Promise<SessionMetadata[]> {
  const index = await loadSessionIndex();
  return [...index.sessions].sort((a, b) => b.lastSwitchedAt - a.lastSwitchedAt);
}

/**
 * Get session metadata by ID
 */
export async function getSessionMetadata(sessionId: SessionId): Promise<SessionMetadata | null> {
  const index = await loadSessionIndex();
  return index.sessions.find(s => s.id === sessionId) ?? null;
}

/**
 * Get the currently active session ID
 */
export async function getActiveSessionId(): Promise<SessionId | null> {
  const index = await loadSessionIndex();
  return index.activeSessionId;
}

/**
 * Rename a session
 */
export async function renameSession(sessionId: SessionId, newName: string): Promise<void> {
  const index = await loadSessionIndex();
  const session = index.sessions.find(s => s.id === sessionId);

  if (session) {
    session.name = newName;
    session.autoNamed = false;
    await saveSessionIndex(index);

    // Also update the session file if it exists
    const sessionData = await loadSessionFromDisk(sessionId);
    if (sessionData) {
      sessionData.metadata.name = newName;
      sessionData.metadata.autoNamed = false;
      await saveSessionToDisk(sessionData);
    }
  }
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: SessionId): Promise<void> {
  const index = await loadSessionIndex();

  // Remove from index
  index.sessions = index.sessions.filter(s => s.id !== sessionId);

  // If this was the active session, switch to another
  if (index.activeSessionId === sessionId) {
    index.activeSessionId = index.sessions[0]?.id ?? null;
  }

  await saveSessionIndex(index);
  await deleteSessionFile(sessionId);
}

/**
 * Save the current session state
 */
export async function saveCurrentSession(
  metadata: SessionMetadata,
  workspaces: Map<WorkspaceId, Workspace>,
  activeWorkspaceId: WorkspaceId,
  getCwd: (ptyId: string) => Promise<string>
): Promise<void> {
  // Build CWD map from PTY sessions
  const cwdMap = new Map<string, string>();

  for (const workspace of workspaces.values()) {
    if (workspace.mainPane?.ptyId) {
      try {
        const cwd = await getCwd(workspace.mainPane.ptyId);
        cwdMap.set(workspace.mainPane.ptyId, cwd);
      } catch {
        cwdMap.set(workspace.mainPane.ptyId, process.cwd());
      }
    }

    for (const pane of workspace.stackPanes) {
      if (pane.ptyId) {
        try {
          const cwd = await getCwd(pane.ptyId);
          cwdMap.set(pane.ptyId, cwd);
        } catch {
          cwdMap.set(pane.ptyId, process.cwd());
        }
      }
    }
  }

  const serialized = serializeSession(metadata, workspaces, activeWorkspaceId, cwdMap);
  await saveSessionToDisk(serialized);

  // Update metadata in index
  const index = await loadSessionIndex();
  const existingIdx = index.sessions.findIndex(s => s.id === metadata.id);
  if (existingIdx >= 0) {
    index.sessions[existingIdx] = metadata;
  } else {
    index.sessions.push(metadata);
  }
  await saveSessionIndex(index);
}

/**
 * Load a session from disk
 * Returns the deserialized data and a CWD map for PTY creation
 */
export async function loadSessionData(
  sessionId: SessionId
): Promise<{
  metadata: SessionMetadata;
  workspaces: Map<WorkspaceId, Workspace>;
  activeWorkspaceId: WorkspaceId;
  cwdMap: Map<string, string>;
} | null> {
  const serialized = await loadSessionFromDisk(sessionId);
  if (!serialized) return null;

  const { metadata, workspaces, activeWorkspaceId } = deserializeSession(serialized);
  const cwdMap = extractCwdMap(serialized);

  return { metadata, workspaces, activeWorkspaceId, cwdMap };
}

/**
 * Switch to a session and update timestamps
 */
export async function switchToSession(sessionId: SessionId): Promise<void> {
  const index = await loadSessionIndex();
  const session = index.sessions.find(s => s.id === sessionId);

  if (session) {
    session.lastSwitchedAt = Date.now();
    index.activeSessionId = sessionId;
    await saveSessionIndex(index);

    // Update in session file too
    const sessionData = await loadSessionFromDisk(sessionId);
    if (sessionData) {
      sessionData.metadata.lastSwitchedAt = Date.now();
      await saveSessionToDisk(sessionData);
    }
  }
}

/**
 * Update the auto-generated name for a session based on cwd
 */
export async function updateAutoName(sessionId: SessionId, cwd: string): Promise<void> {
  const index = await loadSessionIndex();
  const session = index.sessions.find(s => s.id === sessionId);

  if (session && session.autoNamed) {
    const newName = getAutoName(cwd);
    if (newName !== session.name) {
      session.name = newName;
      await saveSessionIndex(index);
    }
  }
}

/**
 * Get session summary info for display
 */
export async function getSessionSummary(sessionId: SessionId): Promise<{
  workspaceCount: number;
  paneCount: number;
} | null> {
  const serialized = await loadSessionFromDisk(sessionId);
  if (!serialized) return null;

  return {
    workspaceCount: countPopulatedWorkspaces(serialized),
    paneCount: countPanes(serialized),
  };
}
