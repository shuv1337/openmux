/**
 * Tests for Clipboard service.
 * Uses per-test layer provision to ensure fresh state isolation.
 */
import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { Clipboard } from "../../../src/effect/services/Clipboard"

describe("Clipboard", () => {
  describe("testLayer", () => {
    // Provide fresh layer for each test to ensure state isolation
    const runWithFreshLayer = <A, E>(
      effect: Effect.Effect<A, E, Clipboard>
    ): Promise<A> =>
      Effect.runPromise(effect.pipe(Effect.provide(Layer.fresh(Clipboard.testLayer))))

    it("writes and reads text", async () => {
      await runWithFreshLayer(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard

          yield* clipboard.write("Hello, World!")
          const text = yield* clipboard.read()

          expect(text).toBe("Hello, World!")
        })
      )
    })

    it("overwrites previous content", async () => {
      await runWithFreshLayer(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard

          yield* clipboard.write("First")
          yield* clipboard.write("Second")
          const text = yield* clipboard.read()

          expect(text).toBe("Second")
        })
      )
    })

    it("starts empty", async () => {
      await runWithFreshLayer(
        Effect.gen(function* () {
          const clipboard = yield* Clipboard
          const text = yield* clipboard.read()

          expect(text).toBe("")
        })
      )
    })
  })
})
