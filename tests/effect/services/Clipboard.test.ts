/**
 * Tests for Clipboard service.
 * Uses per-test layer provision to ensure fresh state isolation.
 */
import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { Clipboard } from "../../../src/effect/services/Clipboard"

describe("Clipboard", () => {
  describe("testLayer", () => {
    // Provide fresh layer for each test to ensure state isolation
    const runWithFreshLayer = <A, E>(
      effect: Effect.Effect<A, E, Clipboard>
    ): Effect.Effect<A, E> =>
      effect.pipe(Effect.provide(Layer.fresh(Clipboard.testLayer)))

    it.effect("writes and reads text", () =>
      runWithFreshLayer(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard

          yield* clipboard.write("Hello, World!")
          const text = yield* clipboard.read()

          expect(text).toBe("Hello, World!")
        })
      )
    )

    it.effect("overwrites previous content", () =>
      runWithFreshLayer(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard

          yield* clipboard.write("First")
          yield* clipboard.write("Second")
          const text = yield* clipboard.read()

          expect(text).toBe("Second")
        })
      )
    )

    it.effect("starts empty", () =>
      runWithFreshLayer(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          const text = yield* clipboard.read()

          expect(text).toBe("")
        })
      )
    )
  })
})
