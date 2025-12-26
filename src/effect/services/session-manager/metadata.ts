/**
 * Session metadata operations for SessionManager
 * Handles rename, auto-name updates, and metadata queries
 */

import { Effect } from "effect"
import type { SessionStorage } from "../SessionStorage"
import {
  SerializedSession,
  SessionMetadata,
  SessionIndex,
  type SerializedLayoutNode,
} from "../../models"
import type { SessionId } from "../../types"
import { getAutoName } from "./serialization"

export interface MetadataDeps {
  storage: SessionStorage["Type"]
}

/**
 * Create metadata operations for SessionManager
 */
export function createMetadataOperations(deps: MetadataDeps) {
  const { storage } = deps

  const countPanes = (node: SerializedLayoutNode | null): number => {
    if (!node) return 0
    if ((node as { type?: string }).type === "split") {
      const split = node as SerializedLayoutNode & { first: SerializedLayoutNode; second: SerializedLayoutNode }
      return countPanes(split.first) + countPanes(split.second)
    }
    return 1
  }

  const renameSession = Effect.fn("SessionManager.renameSession")(
    function* (id: SessionId, newName: string) {
      // Load and update session
      const session = yield* storage.loadSession(id)
      const updatedMetadata = SessionMetadata.make({
        ...session.metadata,
        name: newName,
        autoNamed: false,
      })
      const updated = SerializedSession.make({
        ...session,
        metadata: updatedMetadata,
      })

      yield* storage.saveSession(updated)

      // Update index
      const currentIndex = yield* storage.loadIndex()
      const updatedSessions = currentIndex.sessions.map((s) =>
        s.id === id ? updatedMetadata : s
      )

      yield* storage.saveIndex(
        SessionIndex.make({
          sessions: updatedSessions,
          activeSessionId: currentIndex.activeSessionId,
        })
      )
    }
  )

  const getSessionMetadata = Effect.fn("SessionManager.getSessionMetadata")(
    function* (id: SessionId) {
      const index = yield* storage.loadIndex()
      return index.sessions.find((s) => s.id === id) ?? null
    }
  )

  const updateAutoName = Effect.fn("SessionManager.updateAutoName")(
    function* (id: SessionId, cwd: string) {
      const index = yield* storage.loadIndex()
      const session = index.sessions.find((s) => s.id === id)

      if (session && session.autoNamed) {
        const newName = getAutoName(cwd)
        if (newName !== session.name) {
          const updated = SessionMetadata.make({ ...session, name: newName })
          const updatedSessions = index.sessions.map((s) =>
            s.id === id ? updated : s
          )
          yield* storage.saveIndex(
            SessionIndex.make({
              sessions: updatedSessions,
              activeSessionId: index.activeSessionId,
            })
          )
        }
      }
    }
  )

  const getSessionSummary = Effect.fn("SessionManager.getSessionSummary")(
    function* (id: SessionId) {
      const exists = yield* storage.sessionExists(id)
      if (!exists) return null

      const session = yield* storage.loadSession(id).pipe(
        Effect.catchAll(() => Effect.succeed(null))
      )
      if (!session) return null

      let paneCount = 0
      let workspaceCount = 0

      for (const ws of session.workspaces) {
        if (ws.mainPane || ws.stackPanes.length > 0) {
          workspaceCount++
          paneCount += countPanes(ws.mainPane)
          for (const pane of ws.stackPanes) {
            paneCount += countPanes(pane)
          }
        }
      }

      return { workspaceCount, paneCount }
    }
  )

  return {
    renameSession,
    getSessionMetadata,
    updateAutoName,
    getSessionSummary,
  }
}
