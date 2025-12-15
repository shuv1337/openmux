/**
 * Tests for KeyboardRouter service
 */
import { Effect } from "effect"
import { describe, expect, layer } from "@effect/vitest"
import { KeyboardRouter, type KeyEvent, type OverlayType } from "../../../src/effect/services/KeyboardRouter"

// Create a test layer for KeyboardRouter
const TestLayer = KeyboardRouter.layer

describe("KeyboardRouter", () => {
  layer(TestLayer)((it) => {
    describe("registerHandler", () => {
      it.effect("registers a handler for an overlay", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          const handler = () => true

          const unsubscribe = yield* router.registerHandler("sessionPicker", handler)

          const hasHandler = yield* router.hasHandler("sessionPicker")
          expect(hasHandler).toBe(true)

          // Cleanup
          unsubscribe()
        })
      )

      it.effect("unsubscribe removes the handler", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          const handler = () => true

          const unsubscribe = yield* router.registerHandler("sessionPicker", handler)
          expect(yield* router.hasHandler("sessionPicker")).toBe(true)

          unsubscribe()

          expect(yield* router.hasHandler("sessionPicker")).toBe(false)
        })
      )

      it.effect("can register multiple handlers for different overlays", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          const handler1 = () => true
          const handler2 = () => true

          const unsub1 = yield* router.registerHandler("sessionPicker", handler1)
          const unsub2 = yield* router.registerHandler("aggregateView", handler2)

          expect(yield* router.hasHandler("sessionPicker")).toBe(true)
          expect(yield* router.hasHandler("aggregateView")).toBe(true)

          // Cleanup
          unsub1()
          unsub2()
        })
      )
    })

    describe("routeKey", () => {
      it.effect("routes key events to registered handlers", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          let receivedEvent: KeyEvent | null = null

          const handler = (e: KeyEvent) => {
            receivedEvent = e
            return true
          }

          const unsubscribe = yield* router.registerHandler("sessionPicker", handler)

          const event: KeyEvent = { key: "a", ctrl: true }
          const result = yield* router.routeKey(event)

          expect(result.handled).toBe(true)
          expect(result.overlay).toBe("sessionPicker")
          expect(receivedEvent).toEqual(event)

          unsubscribe()
        })
      )

      it.effect("returns handled: false when no handlers registered", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter

          const event: KeyEvent = { key: "a" }
          const result = yield* router.routeKey(event)

          expect(result.handled).toBe(false)
          expect(result.overlay).toBe(null)
        })
      )

      it.effect("returns handled: false when handler returns false", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          const handler = () => false // Handler doesn't handle the event

          const unsubscribe = yield* router.registerHandler("sessionPicker", handler)

          const event: KeyEvent = { key: "a" }
          const result = yield* router.routeKey(event)

          expect(result.handled).toBe(false)
          expect(result.overlay).toBe(null)

          unsubscribe()
        })
      )

      it.effect("respects priority order - confirmationDialog before sessionPicker", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          const calls: OverlayType[] = []

          const sessionHandler = () => {
            calls.push("sessionPicker")
            return false // Don't handle, let others try
          }
          const confirmHandler = () => {
            calls.push("confirmationDialog")
            return true // Handle it
          }

          // Register in reverse priority order
          const unsub1 = yield* router.registerHandler("sessionPicker", sessionHandler)
          const unsub2 = yield* router.registerHandler("confirmationDialog", confirmHandler)

          const result = yield* router.routeKey({ key: "a" })

          // confirmationDialog should be called first (higher priority)
          expect(calls[0]).toBe("confirmationDialog")
          expect(result.overlay).toBe("confirmationDialog")

          unsub1()
          unsub2()
        })
      )

      it.effect("falls through to lower priority handlers if higher doesn't handle", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter
          const calls: OverlayType[] = []

          const sessionHandler = () => {
            calls.push("sessionPicker")
            return true // Handle it
          }
          const confirmHandler = () => {
            calls.push("confirmationDialog")
            return false // Don't handle
          }

          const unsub1 = yield* router.registerHandler("sessionPicker", sessionHandler)
          const unsub2 = yield* router.registerHandler("confirmationDialog", confirmHandler)

          const result = yield* router.routeKey({ key: "a" })

          // Both should be called, but sessionPicker should handle
          expect(calls).toEqual(["confirmationDialog", "sessionPicker"])
          expect(result.overlay).toBe("sessionPicker")

          unsub1()
          unsub2()
        })
      )
    })

    describe("getActiveOverlay", () => {
      it.effect("returns null when no handlers registered", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter

          const active = yield* router.getActiveOverlay()
          expect(active).toBe(null)
        })
      )

      it.effect("returns highest priority overlay", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter

          const unsub1 = yield* router.registerHandler("sessionPicker", () => true)
          const unsub2 = yield* router.registerHandler("aggregateView", () => true)

          // sessionPicker has higher priority than aggregateView
          const active = yield* router.getActiveOverlay()
          expect(active).toBe("sessionPicker")

          unsub1()
          unsub2()
        })
      )

      it.effect("returns confirmationDialog when all are registered", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter

          const unsub1 = yield* router.registerHandler("aggregateView", () => true)
          const unsub2 = yield* router.registerHandler("sessionPicker", () => true)
          const unsub3 = yield* router.registerHandler("confirmationDialog", () => true)

          // confirmationDialog has highest priority
          const active = yield* router.getActiveOverlay()
          expect(active).toBe("confirmationDialog")

          unsub1()
          unsub2()
          unsub3()
        })
      )
    })

    describe("hasHandler", () => {
      it.effect("returns false for unregistered overlays", () =>
        Effect.gen(function* () {
          const router = yield* KeyboardRouter

          expect(yield* router.hasHandler("sessionPicker")).toBe(false)
          expect(yield* router.hasHandler("aggregateView")).toBe(false)
          expect(yield* router.hasHandler("confirmationDialog")).toBe(false)
        })
      )
    })
  })
})
