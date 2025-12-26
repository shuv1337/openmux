/**
 * Session list/template refresh helpers.
 */

import type { SessionId, SessionMetadata } from '../core/types';
import type { SessionAction, SessionSummary } from '../core/operations/session-actions';
import type { TemplateSession } from '../effect/models';

export function createSessionRefreshers(params: {
  listSessions: () => Promise<SessionMetadata[]>;
  getSessionSummary: (id: SessionId) => Promise<SessionSummary | null>;
  dispatch: (action: SessionAction) => void;
  listTemplates: () => Promise<TemplateSession[]>;
  setTemplates: (templates: TemplateSession[]) => void;
}) {
  const refreshSessions = async () => {
    const sessions = await params.listSessions();
    params.dispatch({ type: 'SET_SESSIONS', sessions });

    const summaries = new Map<SessionId, SessionSummary>();
    for (const session of sessions) {
      const summary = await params.getSessionSummary(session.id);
      if (summary) {
        summaries.set(session.id, summary);
      }
    }
    params.dispatch({ type: 'SET_SUMMARIES', summaries });
  };

  const refreshTemplates = async () => {
    const list = await params.listTemplates();
    params.setTemplates(list);
  };

  return { refreshSessions, refreshTemplates };
}
