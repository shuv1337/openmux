/**
 * React hooks for Effect integration.
 */
import { useEffect, useState, useCallback, useRef } from "react"
import { Effect, Exit, Fiber } from "effect"
import { AppRuntime, type AppServices } from "./runtime"

// =============================================================================
// Types
// =============================================================================

interface UseEffectState<A, E> {
  data: A | null
  error: E | null
  loading: boolean
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Run an effect and return its result.
 * Re-runs when dependencies change.
 *
 * @example
 * ```tsx
 * const { data, error, loading } = useEffectResult(
 *   Effect.gen(function* () {
 *     const sessions = yield* SessionManager
 *     return yield* sessions.listSessions()
 *   }),
 *   []
 * )
 * ```
 */
export function useEffectResult<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  deps: unknown[]
): UseEffectState<A, E> {
  const [state, setState] = useState<UseEffectState<A, E>>({
    data: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    let cancelled = false

    setState((prev) => ({ ...prev, loading: true }))

    AppRuntime.runPromiseExit(effect).then((exit) => {
      if (cancelled) return

      if (Exit.isSuccess(exit)) {
        setState({ data: exit.value, error: null, loading: false })
      } else {
        // Extract the error from the cause
        const error = exit.cause._tag === "Fail"
          ? exit.cause.error
          : null
        setState({ data: null, error: error as E, loading: false })
      }
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

/**
 * Create a callback that runs an effect.
 * The callback returns a promise with the result.
 *
 * @example
 * ```tsx
 * const createSession = useEffectCallback(
 *   (name: string) => Effect.gen(function* () {
 *     const sessions = yield* SessionManager
 *     return yield* sessions.createSession(name)
 *   })
 * )
 *
 * // Later:
 * await createSession("My Session")
 * ```
 */
export function useEffectCallback<Args extends unknown[], A, E>(
  fn: (...args: Args) => Effect.Effect<A, E, AppServices>
): (...args: Args) => Promise<A> {
  const fnRef = useRef(fn)
  fnRef.current = fn

  return useCallback(
    (...args: Args) => AppRuntime.runPromise(fnRef.current(...args)),
    []
  )
}

/**
 * Create a callback that runs an effect and ignores errors.
 * Errors are logged but don't throw.
 *
 * @example
 * ```tsx
 * const saveSession = useEffectCallbackIgnore(
 *   () => Effect.gen(function* () {
 *     const sessions = yield* SessionManager
 *     yield* sessions.saveCurrentSession()
 *   })
 * )
 * ```
 */
export function useEffectCallbackIgnore<Args extends unknown[], A, E>(
  fn: (...args: Args) => Effect.Effect<A, E, AppServices>
): (...args: Args) => Promise<void> {
  const fnRef = useRef(fn)
  fnRef.current = fn

  return useCallback(
    (...args: Args) =>
      AppRuntime.runPromise(
        fnRef.current(...args).pipe(
          Effect.catchAll((error) =>
            Effect.logError("Effect callback failed", error).pipe(
              Effect.as(undefined as unknown as A)
            )
          ),
          Effect.asVoid
        )
      ),
    []
  )
}

/**
 * Subscribe to an effect stream or repeated effect.
 * Useful for subscribing to terminal state updates.
 *
 * @example
 * ```tsx
 * useEffectSubscription(
 *   (callback) => Effect.gen(function* () {
 *     const pty = yield* Pty
 *     return yield* pty.subscribe(ptyId, callback)
 *   }),
 *   [ptyId]
 * )
 * ```
 */
export function useEffectSubscription<A, E>(
  subscribe: (
    callback: (value: A) => void
  ) => Effect.Effect<() => void, E, AppServices>,
  deps: unknown[]
): void {
  const callbackRef = useRef<(value: A) => void>(() => {})

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let cancelled = false

    AppRuntime.runPromise(subscribe(callbackRef.current))
      .then((unsub) => {
        if (cancelled) {
          unsub()
        } else {
          unsubscribe = unsub
        }
      })
      .catch((error) => {
        console.error("Subscription failed:", error)
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Run an effect once on mount.
 * Similar to useEffect with empty deps, but for Effect.
 *
 * @example
 * ```tsx
 * useEffectOnMount(
 *   Effect.gen(function* () {
 *     yield* Effect.log("Component mounted")
 *   })
 * )
 * ```
 */
export function useEffectOnMount<A, E>(
  effect: Effect.Effect<A, E, AppServices>
): void {
  useEffect(() => {
    // Fork the effect to get a fiber we can interrupt
    const fiber = AppRuntime.runFork(
      effect.pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => console.error("Mount effect failed:", error))
        )
      )
    )

    // Return cleanup that interrupts the fiber
    return () => {
      AppRuntime.runFork(Fiber.interrupt(fiber))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/**
 * Run an effect on unmount (cleanup).
 *
 * @example
 * ```tsx
 * useEffectOnUnmount(
 *   Effect.gen(function* () {
 *     const pty = yield* Pty
 *     yield* pty.destroyAll()
 *   })
 * )
 * ```
 */
export function useEffectOnUnmount<A, E>(
  effect: Effect.Effect<A, E, AppServices>
): void {
  const effectRef = useRef(effect)
  effectRef.current = effect

  useEffect(() => {
    return () => {
      // Fire and forget the unmount effect - no need to wait for completion
      AppRuntime.runFork(
        effectRef.current.pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => console.error("Unmount effect failed:", error))
          )
        )
      )
    }
  }, [])
}
