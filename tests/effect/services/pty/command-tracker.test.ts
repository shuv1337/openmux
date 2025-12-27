/**
 * Tests for CommandTracker.
 */
import { describe, it, expect } from "vitest"
import { CommandTracker } from "../../../../src/effect/services/pty/command-tracker"

describe("CommandTracker", () => {
  it("captures a simple command line", () => {
    const tracker = new CommandTracker()
    tracker.feed("claude --dangerously-skip-permissions\r")
    expect(tracker.getLastCommand()).toBe("claude --dangerously-skip-permissions")
  })

  it("handles backspace edits", () => {
    const tracker = new CommandTracker()
    tracker.feed("claudf")
    tracker.feed("\b")
    tracker.feed("e --flag\r")
    expect(tracker.getLastCommand()).toBe("claude --flag")
  })

  it("skips history-driven lines", () => {
    const tracker = new CommandTracker()
    tracker.feed("ls\r")
    tracker.feed("\x1b[A")
    tracker.feed("git status\r")
    expect(tracker.getLastCommand()).toBe("ls")
  })

  it("supports commit filters", () => {
    const tracker = new CommandTracker()
    tracker.feed("claude --flag\r", { allowCommit: false })
    expect(tracker.getLastCommand()).toBeNull()
    tracker.feed("claude --flag\r", { allowCommit: true })
    expect(tracker.getLastCommand()).toBe("claude --flag")
  })
})
