import fs from 'fs/promises';
import path from 'path';

import type { SessionMetadata } from '../core/types';
import { makeSessionId } from '../effect/types';
import { getAutoName } from '../effect/services/session-manager/serialization';

export type SessionIndex = {
  sessions: SessionMetadata[];
  activeSessionId: string | null;
};

const DEFAULT_SESSION_INDEX: SessionIndex = {
  sessions: [],
  activeSessionId: null,
};

function getSessionStoragePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  return path.join(home, '.config', 'openmux', 'sessions');
}

function getIndexPath(storagePath: string): string {
  return path.join(storagePath, 'index.json');
}

function getSessionPath(storagePath: string, sessionId: string): string {
  return path.join(storagePath, `${sessionId}.json`);
}

function normalizeIndex(raw: unknown): SessionIndex {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SESSION_INDEX };
  const index = raw as SessionIndex;
  const sessions = Array.isArray(index.sessions) ? index.sessions : [];
  const activeSessionId = typeof index.activeSessionId === 'string' ? index.activeSessionId : null;
  return { sessions, activeSessionId };
}

export async function loadSessionIndex(): Promise<SessionIndex> {
  const storagePath = getSessionStoragePath();
  const indexPath = getIndexPath(storagePath);

  try {
    const content = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return normalizeIndex(parsed);
  } catch {
    return { ...DEFAULT_SESSION_INDEX };
  }
}

export async function saveSessionIndex(index: SessionIndex): Promise<void> {
  const storagePath = getSessionStoragePath();
  const indexPath = getIndexPath(storagePath);

  await fs.mkdir(storagePath, { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

export async function listSessionsOnDisk(): Promise<{ sessions: SessionMetadata[]; activeSessionId: string | null }> {
  const index = await loadSessionIndex();
  const sessions = [...index.sessions].sort((a, b) => b.lastSwitchedAt - a.lastSwitchedAt);
  return { sessions, activeSessionId: index.activeSessionId };
}

export async function createSessionOnDisk(name?: string): Promise<SessionMetadata> {
  const storagePath = getSessionStoragePath();
  await fs.mkdir(storagePath, { recursive: true });

  const id = makeSessionId();
  const now = Date.now();
  const trimmed = name?.trim() ?? '';
  const sessionName = trimmed.length > 0 ? trimmed : getAutoName(process.cwd());

  const metadata: SessionMetadata = {
    id,
    name: sessionName,
    createdAt: now,
    lastSwitchedAt: now,
    autoNamed: trimmed.length === 0,
  };

  const sessionPayload = {
    metadata,
    workspaces: [],
    activeWorkspaceId: 1,
  };

  const sessionPath = getSessionPath(storagePath, id);
  await fs.writeFile(sessionPath, JSON.stringify(sessionPayload, null, 2), 'utf8');

  const index = await loadSessionIndex();
  const sessions = [...index.sessions.filter((s) => s.id !== id), metadata];
  await saveSessionIndex({ sessions, activeSessionId: id });

  return metadata;
}
