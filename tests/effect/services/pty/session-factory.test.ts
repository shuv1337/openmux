/**
 * Tests for PTY session factory exit hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import type { TerminalColors } from "../../../../src/terminal/terminal-colors"
import { Cols, Rows } from "../../../../src/effect/types"
import { ScrollbackArchiveManager } from "../../../../src/terminal/scrollback-archive"
import { spawnAsync } from "../../../../native/zig-pty/ts/index"

const { mockCreateGhosttyVTEmulator, mockGhosttySymbols } = vi.hoisted(() => ({
  mockCreateGhosttyVTEmulator: vi.fn(),
  mockGhosttySymbols: new Proxy(
    {},
    {
      get: () => vi.fn(),
    }
  ),
}))

let createSession: typeof import("../../../../src/effect/services/pty/session-factory").createSession

vi.mock("../../../../native/zig-pty/ts/index", () => ({
  spawnAsync: vi.fn(),
}))

vi.mock("../../../../src/terminal/ghostty-vt/emulator", () => ({
  createGhosttyVTEmulator: mockCreateGhosttyVTEmulator,
}))

vi.mock("../../../../src/terminal/ghostty-vt/ffi", () => ({
  ghostty: {
    symbols: mockGhosttySymbols,
  },
}))

vi.mock("../../../../src/terminal/capabilities", () => ({
  getCapabilityEnvironment: vi.fn(() => ({})),
}))

vi.mock("../../../../src/effect/services/pty/notification", () => ({
  notifySubscribers: vi.fn(),
}))

vi.mock("../../../../src/effect/services/pty/data-handler", () => ({
  createDataHandler: vi.fn(() => ({ handleData: vi.fn() })),
}))

vi.mock("../../../../src/effect/services/pty/query-setup", () => ({
  setupQueryPassthrough: vi.fn(),
}))

describe("createSession", () => {
  beforeEach(async () => {
    ;({ createSession } = await import("../../../../src/effect/services/pty/session-factory"))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("notifies onExit hook when the PTY exits", async () => {
    let exitHandler: ((event: { exitCode: number }) => void) | null = null

    const fakePty = {
      onExit: (cb: (event: { exitCode: number }) => void) => {
        exitHandler = cb
        return { dispose: () => {} }
      },
      onData: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      getCwd: vi.fn(() => "/"),
      getForegroundProcessName: vi.fn(),
      pid: 123,
    }

    vi.mocked(spawnAsync).mockResolvedValue(
      fakePty as Awaited<ReturnType<typeof spawnAsync>>
    )

    const emulator = {
      setUpdateEnabled: vi.fn(),
      onTitleChange: vi.fn(),
      onUpdate: vi.fn(),
      onModeChange: vi.fn(),
      getMode: vi.fn(() => false),
      resize: vi.fn(),
      getTerminalState: vi.fn(),
      dispose: vi.fn(),
      getTitle: vi.fn(() => ""),
    }

    mockCreateGhosttyVTEmulator.mockReturnValue(emulator)

    const scrollbackArchiveRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmux-scrollback-")
    )

    const onExit = vi.fn()
    const { id, session } = await Effect.runPromise(
      createSession(
        {
          colors: {} as TerminalColors,
          defaultShell: "/bin/sh",
          scrollbackArchiveManager: new ScrollbackArchiveManager(1024 * 1024),
          scrollbackArchiveRoot,
          onLifecycleEvent: vi.fn(() => Effect.void),
          onTitleChange: vi.fn(),
          onExit,
        },
        { cols: Cols.make(80), rows: Rows.make(24) }
      )
    )

    const exitCallback = vi.fn()
    session.exitCallbacks.add(exitCallback)

    expect(exitHandler).not.toBeNull()
    exitHandler?.({ exitCode: 0 })

    expect(exitCallback).toHaveBeenCalledWith(0)
    expect(onExit).toHaveBeenCalledWith(id, 0)
  })

  it("applies initial pixel sizing when provided", async () => {
    const resizeWithPixels = vi.fn()
    const fakePty = {
      onExit: vi.fn(() => ({ dispose: () => {} })),
      onData: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      resizeWithPixels,
      kill: vi.fn(),
      getCwd: vi.fn(() => "/"),
      getForegroundProcessName: vi.fn(),
      pid: 123,
    }

    vi.mocked(spawnAsync).mockResolvedValue(
      fakePty as Awaited<ReturnType<typeof spawnAsync>>
    )

    const emulator = {
      setUpdateEnabled: vi.fn(),
      onTitleChange: vi.fn(),
      onUpdate: vi.fn(),
      onModeChange: vi.fn(),
      getMode: vi.fn(() => false),
      resize: vi.fn(),
      getTerminalState: vi.fn(),
      dispose: vi.fn(),
      getTitle: vi.fn(() => ""),
    }

    mockCreateGhosttyVTEmulator.mockReturnValue(emulator)

    const scrollbackArchiveRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "openmux-scrollback-")
    )

    const { session } = await Effect.runPromise(
      createSession(
        {
          colors: {} as TerminalColors,
          defaultShell: "/bin/sh",
          scrollbackArchiveManager: new ScrollbackArchiveManager(1024 * 1024),
          scrollbackArchiveRoot,
          onLifecycleEvent: vi.fn(() => Effect.void),
          onTitleChange: vi.fn(),
        },
        {
          cols: Cols.make(80),
          rows: Rows.make(24),
          pixelWidth: 800,
          pixelHeight: 480,
        }
      )
    )

    expect(resizeWithPixels).toHaveBeenCalledWith(80, 24, 800, 480)
    expect(session.pixelWidth).toBe(800)
    expect(session.pixelHeight).toBe(480)
    expect(session.cellWidth).toBe(10)
    expect(session.cellHeight).toBe(20)
  })
})
