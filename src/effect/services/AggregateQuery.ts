/**
 * AggregateQuery service for querying and filtering PTYs across workspaces.
 * Enables virtual views that aggregate terminals based on filter criteria.
 */
import { Context, Effect, Layer, Ref, Option } from "effect"
import { Pty } from "./Pty"
import { AggregateQueryError } from "../errors"
import { PtyId, WorkspaceId, PaneId } from "../types"
import {
  AggregatedPty,
  type FilterExpression,
  type FilterCondition,
  type AggregateEvent,
} from "../models"

// =============================================================================
// Types
// =============================================================================

/** Input data for a pane (provided by React layer) */
export interface PaneInfo {
  paneId: string
  ptyId: string | undefined
  title: string | undefined
  workspaceId: number
}

// =============================================================================
// Filter Matching
// =============================================================================

/** Check if a PTY matches a single filter condition */
function matchesCondition(
  pty: {
    ptyId: string
    paneId: string
    workspaceId: number
    title?: string
    cwd: string
    foregroundProcess?: string
  },
  condition: FilterCondition
): boolean {
  switch (condition._tag) {
    case "contains": {
      const fieldValue = getFieldValue(pty, condition.field)
      if (fieldValue === undefined) return false
      return fieldValue.toLowerCase().includes(condition.value.toLowerCase())
    }

    case "matches": {
      const fieldValue = getFieldValue(pty, condition.field)
      if (fieldValue === undefined) return false
      try {
        const regex = new RegExp(condition.pattern, "i")
        return regex.test(fieldValue)
      } catch {
        return false
      }
    }

    case "equals": {
      const fieldValue = getFieldValueForEquals(pty, condition.field)
      if (fieldValue === undefined) return false
      return fieldValue === condition.value
    }
  }
}

/** Get field value for contains/matches filters */
function getFieldValue(
  pty: { title?: string; cwd: string; foregroundProcess?: string },
  field: "command" | "title" | "cwd" | "process"
): string | undefined {
  switch (field) {
    case "command":
      // For now, command is approximated by title
      return pty.title
    case "title":
      return pty.title
    case "cwd":
      return pty.cwd
    case "process":
      return pty.foregroundProcess
  }
}

/** Get field value for equals filter */
function getFieldValueForEquals(
  pty: { ptyId: string; paneId: string; workspaceId: number },
  field: "workspaceId" | "ptyId" | "paneId"
): string | undefined {
  switch (field) {
    case "workspaceId":
      return String(pty.workspaceId)
    case "ptyId":
      return pty.ptyId
    case "paneId":
      return pty.paneId
  }
}

/** Check if a PTY matches a filter expression (recursive) */
function matchesFilter(
  pty: {
    ptyId: string
    paneId: string
    workspaceId: number
    title?: string
    cwd: string
    foregroundProcess?: string
  },
  filter: FilterExpression
): boolean {
  switch (filter._tag) {
    case "contains":
    case "matches":
    case "equals":
      return matchesCondition(pty, filter)

    case "and":
      return filter.conditions.every((c) => matchesFilter(pty, c))

    case "or":
      return filter.conditions.some((c) => matchesFilter(pty, c))

    case "not":
      return !matchesFilter(pty, filter.condition)
  }
}

/** Parse a simple search query into a FilterExpression */
export function parseSearchQuery(query: string): FilterExpression | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  // Search in process name, cwd, and title
  return {
    _tag: "or",
    conditions: [
      { _tag: "contains", field: "process", value: trimmed },
      { _tag: "contains", field: "cwd", value: trimmed },
      { _tag: "contains", field: "title", value: trimmed },
    ],
  }
}

// =============================================================================
// AggregateQuery Service
// =============================================================================

export class AggregateQuery extends Context.Tag("@openmux/AggregateQuery")<
  AggregateQuery,
  {
    /**
     * Query PTYs matching a filter expression.
     * Pane info must be provided from the React layer.
     */
    readonly query: (
      panes: readonly PaneInfo[],
      filter: FilterExpression | null
    ) => Effect.Effect<AggregatedPty[], AggregateQueryError>

    /**
     * Subscribe to aggregate events (PTY added/removed/updated).
     * Returns an unsubscribe function.
     */
    readonly subscribe: (
      callback: (event: AggregateEvent) => void
    ) => Effect.Effect<() => void>

    /** Emit an aggregate event to all subscribers */
    readonly emit: (event: AggregateEvent) => Effect.Effect<void>
  }
>() {
  /** Production layer */
  static readonly layer = Layer.effect(
    AggregateQuery,
    Effect.gen(function* () {
      const pty = yield* Pty

      // Subscriber management
      const subscribersRef = yield* Ref.make<
        Set<(event: AggregateEvent) => void>
      >(new Set())

      const query = Effect.fn("AggregateQuery.query")(function* (
        panes: readonly PaneInfo[],
        filter: FilterExpression | null
      ) {
        const results: AggregatedPty[] = []

        for (const pane of panes) {
          // Skip panes without PTY
          if (!pane.ptyId) continue

          const ptyIdTyped = PtyId.make(pane.ptyId)

          // Get CWD from PTY service
          const cwd = yield* pty.getCwd(ptyIdTyped).pipe(
            Effect.catchAll(() => Effect.succeed(process.cwd()))
          )

          // Get git branch for the CWD
          const gitBranch = yield* pty.getGitBranch(ptyIdTyped).pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          )

          // Get foreground process name
          const foregroundProcess = yield* pty.getForegroundProcess(ptyIdTyped).pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          )

          const ptyInfo = {
            ptyId: pane.ptyId,
            paneId: pane.paneId,
            workspaceId: pane.workspaceId,
            title: pane.title,
            cwd,
            foregroundProcess,
          }

          // If no filter, include all PTYs
          if (filter === null || matchesFilter(ptyInfo, filter)) {
            results.push(
              AggregatedPty.make({
                workspaceId: WorkspaceId.make(
                  pane.workspaceId as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
                ),
                paneId: PaneId.make(pane.paneId),
                ptyId: PtyId.make(pane.ptyId),
                title: pane.title,
                cwd,
                gitBranch,
                foregroundProcess,
                lastActivity: Date.now(),
              })
            )
          }
        }

        return results
      })

      const subscribe = Effect.fn("AggregateQuery.subscribe")(function* (
        callback: (event: AggregateEvent) => void
      ) {
        yield* Ref.update(subscribersRef, (subs) => {
          subs.add(callback)
          return subs
        })

        return () => {
          Ref.update(subscribersRef, (subs) => {
            subs.delete(callback)
            return subs
          }).pipe(Effect.runSync)
        }
      })

      const emit = Effect.fn("AggregateQuery.emit")(function* (
        event: AggregateEvent
      ) {
        const subscribers = yield* Ref.get(subscribersRef)
        for (const callback of subscribers) {
          callback(event)
        }
      })

      return AggregateQuery.of({
        query,
        subscribe,
        emit,
      })
    })
  )

  /** Test layer */
  static readonly testLayer = Layer.succeed(AggregateQuery, {
    query: () => Effect.succeed([]),
    subscribe: () => Effect.succeed(() => {}),
    emit: () => Effect.void,
  })
}
