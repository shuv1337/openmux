/**
 * Subscription management utilities for PTY service.
 * Provides Effect-based subscription tracking with synchronous cleanup support.
 */

import { Effect, Ref, HashMap, Scope } from "effect"

// =============================================================================
// Types
// =============================================================================

/** Branded subscription ID for type safety */
export type SubscriptionId = string & { readonly _tag: "SubscriptionId" }

export const makeSubscriptionId = (): SubscriptionId =>
  `sub_${Date.now()}_${Math.random().toString(36).slice(2)}` as SubscriptionId

export interface Subscription<T> {
  readonly id: SubscriptionId
  readonly callback: (value: T) => void
  readonly createdAt: number
}

// =============================================================================
// SubscriptionRegistry
// =============================================================================

/**
 * Create a subscription registry for a specific event type.
 *
 * Provides three subscription modes:
 * - `subscribe`: Returns manual cleanup function (for SolidJS bridge)
 * - `subscribeScoped`: Uses acquireRelease (for Effect-pure code)
 * - `notify`/`notifySync`: Event broadcasting
 */
export const makeSubscriptionRegistry = <T>() =>
  Effect.gen(function* () {
    const subscriptionsRef = yield* Ref.make(
      HashMap.empty<SubscriptionId, Subscription<T>>()
    )

    /**
     * Subscribe with manual cleanup function.
     * Use this for bridging to non-Effect code (e.g., SolidJS).
     * The returned cleanup function is synchronous.
     */
    const subscribe = (callback: (value: T) => void) =>
      Effect.gen(function* () {
        const id = makeSubscriptionId()
        yield* Ref.update(subscriptionsRef, HashMap.set(id, {
          id,
          callback,
          createdAt: Date.now(),
        }))

        // Return SYNCHRONOUS cleanup function
        // This is safe because Ref.update with HashMap.remove is synchronous
        return () => {
          Effect.runSync(
            Ref.update(subscriptionsRef, HashMap.remove(id))
          )
        }
      })

    /**
     * Subscribe using acquireRelease - cleanup happens automatically when Scope closes.
     * Use this for Effect-pure code paths.
     */
    const subscribeScoped = (callback: (value: T) => void) =>
      Effect.acquireRelease(
        // Acquire: add subscription
        Effect.gen(function* () {
          const id = makeSubscriptionId()
          yield* Ref.update(subscriptionsRef, HashMap.set(id, {
            id,
            callback,
            createdAt: Date.now(),
          }))
          return id
        }),
        // Release: remove subscription (runs when Scope closes)
        (id) => Ref.update(subscriptionsRef, HashMap.remove(id))
      )

    /**
     * Notify all subscribers asynchronously (for Effect contexts).
     * Errors in individual callbacks are logged but don't affect other subscribers.
     */
    const notify = (value: T) =>
      Effect.gen(function* () {
        const subs = yield* Ref.get(subscriptionsRef)
        for (const [_, sub] of HashMap.entries(subs)) {
          try {
            sub.callback(value)
          } catch (error) {
            yield* Effect.logWarning("Subscription callback error", { error })
          }
        }
      })

    /**
     * Notify all subscribers synchronously (for non-Effect contexts).
     * Use this when called from plain JavaScript callbacks (e.g., emulator events).
     */
    const notifySync = (value: T) => {
      const subs = Effect.runSync(Ref.get(subscriptionsRef))
      for (const [_, sub] of HashMap.entries(subs)) {
        try {
          sub.callback(value)
        } catch (error) {
          console.warn("Subscription callback error:", error)
        }
      }
    }

    /**
     * Get current subscriber count (for debugging/monitoring).
     */
    const getSubscriberCount = () =>
      Effect.map(Ref.get(subscriptionsRef), HashMap.size)

    return {
      subscribe,
      subscribeScoped,
      notify,
      notifySync,
      getSubscriberCount,
    }
  })

/** Type helper for SubscriptionRegistry */
export type SubscriptionRegistry<T> = Effect.Effect.Success<
  ReturnType<typeof makeSubscriptionRegistry<T>>
>
