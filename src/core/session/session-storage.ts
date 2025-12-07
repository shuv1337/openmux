/**
 * Session storage layer - handles file I/O for session persistence
 */

import { DEFAULT_CONFIG } from '../config';
import type { SessionId, SessionIndex, SerializedSession, SessionMetadata } from '../types';

const SESSION_INDEX_FILE = 'sessions.json';

/**
 * Ensure the session storage directory exists
 */
export async function ensureSessionDir(): Promise<void> {
  const dir = DEFAULT_CONFIG.sessionStoragePath;
  const file = Bun.file(dir);

  // Check if directory exists by trying to get its stats
  if (!(await file.exists())) {
    await Bun.$`mkdir -p ${dir}`;
  }
}

/**
 * Get the full path for a session file
 */
function getSessionFilePath(sessionId: SessionId): string {
  return `${DEFAULT_CONFIG.sessionStoragePath}/${sessionId}.json`;
}

/**
 * Get the full path for the session index file
 */
function getIndexFilePath(): string {
  return `${DEFAULT_CONFIG.sessionStoragePath}/${SESSION_INDEX_FILE}`;
}

/**
 * Load the session index from disk
 */
export async function loadSessionIndex(): Promise<SessionIndex> {
  await ensureSessionDir();

  const indexPath = getIndexFilePath();
  const file = Bun.file(indexPath);

  if (await file.exists()) {
    try {
      const content = await file.text();
      return JSON.parse(content) as SessionIndex;
    } catch {
      // Corrupted file, return empty index
      return { sessions: [], activeSessionId: null };
    }
  }

  return { sessions: [], activeSessionId: null };
}

/**
 * Save the session index to disk
 */
export async function saveSessionIndex(index: SessionIndex): Promise<void> {
  await ensureSessionDir();

  const indexPath = getIndexFilePath();
  await Bun.write(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Load a session from disk
 */
export async function loadSession(sessionId: SessionId): Promise<SerializedSession | null> {
  const filePath = getSessionFilePath(sessionId);
  const file = Bun.file(filePath);

  if (await file.exists()) {
    try {
      const content = await file.text();
      return JSON.parse(content) as SerializedSession;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Save a session to disk
 */
export async function saveSession(session: SerializedSession): Promise<void> {
  await ensureSessionDir();

  const filePath = getSessionFilePath(session.metadata.id);
  await Bun.write(filePath, JSON.stringify(session, null, 2));
}

/**
 * Delete a session file from disk
 */
export async function deleteSessionFile(sessionId: SessionId): Promise<void> {
  const filePath = getSessionFilePath(sessionId);
  const file = Bun.file(filePath);

  if (await file.exists()) {
    await Bun.$`rm ${filePath}`;
  }
}

/**
 * Update session metadata in the index
 */
export async function updateSessionMetadata(metadata: SessionMetadata): Promise<void> {
  const index = await loadSessionIndex();
  const existingIndex = index.sessions.findIndex(s => s.id === metadata.id);

  if (existingIndex >= 0) {
    index.sessions[existingIndex] = metadata;
  } else {
    index.sessions.push(metadata);
  }

  await saveSessionIndex(index);
}

/**
 * Remove session metadata from the index
 */
export async function removeSessionFromIndex(sessionId: SessionId): Promise<void> {
  const index = await loadSessionIndex();
  index.sessions = index.sessions.filter(s => s.id !== sessionId);

  if (index.activeSessionId === sessionId) {
    index.activeSessionId = index.sessions[0]?.id ?? null;
  }

  await saveSessionIndex(index);
}

/**
 * Set the active session in the index
 */
export async function setActiveSessionId(sessionId: SessionId): Promise<void> {
  const index = await loadSessionIndex();
  index.activeSessionId = sessionId;
  await saveSessionIndex(index);
}
