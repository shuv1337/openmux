/**
 * Tests for EmulatorPool logic
 * Uses mocks since ghostty WASM requires browser environment
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the ghostty-emulator module
vi.mock('../../src/terminal/ghostty-emulator', () => {
  let initialized = false

  // Create a mock emulator class
  class MockGhosttyEmulator {
    private _cols: number
    private _rows: number
    private _disposed = false
    private _title = ''

    constructor(options: { cols?: number; rows?: number } = {}) {
      this._cols = options.cols ?? 80
      this._rows = options.rows ?? 24
    }

    get cols() { return this._cols }
    get rows() { return this._rows }
    get isDisposed() { return this._disposed }

    resize(cols: number, rows: number) {
      this._cols = cols
      this._rows = rows
    }

    reset() {
      this._title = ''
    }

    write(_data: string) {
      // no-op for mock
    }

    getTitle() {
      return this._title
    }

    dispose() {
      this._disposed = true
    }
  }

  return {
    GhosttyEmulator: MockGhosttyEmulator,
    isGhosttyInitialized: () => initialized,
    initGhostty: async () => {
      initialized = true
      return {}
    },
    // Helper to reset mock state between tests
    __resetMock: () => {
      initialized = false
    },
    __setInitialized: (value: boolean) => {
      initialized = value
    }
  }
})

// Import after mocking
import { EmulatorPool } from '../../src/terminal/emulator-pool'
import { __resetMock, __setInitialized } from '../../src/terminal/ghostty-emulator'

describe('EmulatorPool', () => {
  beforeEach(() => {
    // Reset both pool and mock state
    EmulatorPool.dispose()
    __resetMock()
  })

  afterEach(() => {
    EmulatorPool.dispose()
    __resetMock()
  })

  describe('initialization', () => {
    test('should fail to initialize when ghostty is not loaded', async () => {
      await expect(EmulatorPool.initialize()).rejects.toThrow(
        'Cannot initialize EmulatorPool before Ghostty WASM is loaded'
      )
    })

    test('should initialize with default config', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize()
      expect(EmulatorPool.isInitialized()).toBe(true)
    })

    test('should initialize with custom config', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 5, minSize: 2 })
      expect(EmulatorPool.isInitialized()).toBe(true)
    })

    test('should not initialize twice', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 2 })
      const sizeBefore = EmulatorPool.getPoolSize()

      // Second initialize should be a no-op
      await EmulatorPool.initialize({ targetSize: 5 })
      expect(EmulatorPool.getPoolSize()).toBe(sizeBefore)
    })

    test('should prefill pool to target size', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 3, minSize: 1 })
      // Allow time for async prefill
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(EmulatorPool.getPoolSize()).toBe(3)
    })
  })

  describe('acquire', () => {
    test('should return null when pool is not initialized', () => {
      const emulator = EmulatorPool.acquire(80, 24)
      expect(emulator).toBeNull()
    })

    test('should return emulator from pool when available', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 2, minSize: 1 })
      await new Promise(resolve => setTimeout(resolve, 50))

      const sizeBefore = EmulatorPool.getPoolSize()
      const emulator = EmulatorPool.acquire(80, 24)

      expect(emulator).not.toBeNull()
      expect(EmulatorPool.getPoolSize()).toBe(sizeBefore - 1)
    })

    test('should resize emulator when dimensions differ', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 1, minSize: 0, defaultCols: 80, defaultRows: 24 })
      await new Promise(resolve => setTimeout(resolve, 50))

      const emulator = EmulatorPool.acquire(120, 40)

      expect(emulator).not.toBeNull()
      expect(emulator!.cols).toBe(120)
      expect(emulator!.rows).toBe(40)
    })

    test('should return null when pool is empty', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 1, minSize: 0 })
      await new Promise(resolve => setTimeout(resolve, 50))

      // Acquire the only emulator
      EmulatorPool.acquire(80, 24)

      // Pool should now be empty
      const emulator = EmulatorPool.acquire(80, 24)
      expect(emulator).toBeNull()
    })

    test('should trigger replenishment when below minSize', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 3, minSize: 2 })
      await new Promise(resolve => setTimeout(resolve, 50))

      // Acquire until below minSize
      EmulatorPool.acquire(80, 24)
      EmulatorPool.acquire(80, 24)

      // Wait for replenishment
      await new Promise(resolve => setTimeout(resolve, 50))

      // Pool should be replenished
      expect(EmulatorPool.getPoolSize()).toBeGreaterThanOrEqual(1)
    })
  })

  describe('release', () => {
    test('should add emulator back to pool', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 1, minSize: 0 })
      await new Promise(resolve => setTimeout(resolve, 50))

      const emulator = EmulatorPool.acquire(80, 24)
      expect(EmulatorPool.getPoolSize()).toBe(0)

      EmulatorPool.release(emulator!)
      expect(EmulatorPool.getPoolSize()).toBe(1)
    })

    test('should resize back to default dimensions on release', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 1, minSize: 0, defaultCols: 80, defaultRows: 24 })
      await new Promise(resolve => setTimeout(resolve, 50))

      const emulator = EmulatorPool.acquire(120, 40)
      expect(emulator!.cols).toBe(120)
      expect(emulator!.rows).toBe(40)

      EmulatorPool.release(emulator!)
      const emulator2 = EmulatorPool.acquire(80, 24)

      // Should have been resized back to defaults
      expect(emulator2!.cols).toBe(80)
      expect(emulator2!.rows).toBe(24)
    })

    test('should dispose emulator if pool is at target size', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 1, minSize: 0 })
      await new Promise(resolve => setTimeout(resolve, 50))

      const emulator1 = EmulatorPool.acquire(80, 24)

      // Create another emulator directly (simulating fallback creation)
      const { GhosttyEmulator } = await import('../../src/terminal/ghostty-emulator')
      const emulator2 = new GhosttyEmulator({ cols: 80, rows: 24 })

      // Release first emulator - pool is now at target size
      EmulatorPool.release(emulator1!)
      expect(EmulatorPool.getPoolSize()).toBe(1)

      // Release second emulator - should be disposed, not added to pool
      EmulatorPool.release(emulator2)
      expect(EmulatorPool.getPoolSize()).toBe(1)
    })

    test('should not release disposed emulator', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 2, minSize: 0 })
      await new Promise(resolve => setTimeout(resolve, 50))

      const emulator = EmulatorPool.acquire(80, 24)
      const sizeAfterAcquire = EmulatorPool.getPoolSize()

      emulator!.dispose()
      EmulatorPool.release(emulator!)

      // Pool size should not have changed (disposed emulator not added)
      expect(EmulatorPool.getPoolSize()).toBe(sizeAfterAcquire)
    })

    test('should dispose when pool is not initialized', async () => {
      __setInitialized(true)
      // Create emulator directly without initializing pool
      const { GhosttyEmulator } = await import('../../src/terminal/ghostty-emulator')
      const emulator = new GhosttyEmulator({ cols: 80, rows: 24 })

      // Release should dispose since pool not initialized
      EmulatorPool.release(emulator)
      expect(emulator.isDisposed).toBe(true)
    })
  })

  describe('dispose', () => {
    test('should dispose all pooled emulators', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 3, minSize: 0 })
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(EmulatorPool.getPoolSize()).toBe(3)

      EmulatorPool.dispose()

      expect(EmulatorPool.getPoolSize()).toBe(0)
      expect(EmulatorPool.isInitialized()).toBe(false)
    })

    test('should allow re-initialization after dispose', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 2 })
      await new Promise(resolve => setTimeout(resolve, 50))

      EmulatorPool.dispose()

      await EmulatorPool.initialize({ targetSize: 3 })
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(EmulatorPool.isInitialized()).toBe(true)
      expect(EmulatorPool.getPoolSize()).toBe(3)
    })
  })

  describe('integration scenarios', () => {
    test('should handle rapid acquire/release cycles', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 3, minSize: 1 })
      await new Promise(resolve => setTimeout(resolve, 50))

      // Simulate rapid pane create/close
      for (let i = 0; i < 10; i++) {
        const emulator = EmulatorPool.acquire(80, 24)
        if (emulator) {
          emulator.write(`Test ${i}`)
          EmulatorPool.release(emulator)
        }
      }

      // Pool should still be functional
      expect(EmulatorPool.getPoolSize()).toBeGreaterThan(0)
    })

    test('should handle concurrent acquires', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 5, minSize: 1 })
      await new Promise(resolve => setTimeout(resolve, 50))

      // Acquire multiple emulators at once
      const emulators = [
        EmulatorPool.acquire(80, 24),
        EmulatorPool.acquire(80, 24),
        EmulatorPool.acquire(80, 24),
      ].filter(e => e !== null)

      expect(emulators.length).toBe(3)

      // Release them all
      for (const emulator of emulators) {
        EmulatorPool.release(emulator!)
      }

      // Wait for replenishment
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(EmulatorPool.getPoolSize()).toBeGreaterThanOrEqual(3)
    })

    test('should handle pool exhaustion gracefully', async () => {
      __setInitialized(true)
      await EmulatorPool.initialize({ targetSize: 2, minSize: 0 })
      await new Promise(resolve => setTimeout(resolve, 50))

      // Exhaust the pool
      const e1 = EmulatorPool.acquire(80, 24)
      const e2 = EmulatorPool.acquire(80, 24)
      const e3 = EmulatorPool.acquire(80, 24) // Should be null

      expect(e1).not.toBeNull()
      expect(e2).not.toBeNull()
      expect(e3).toBeNull()

      // Release one back
      EmulatorPool.release(e1!)

      // Now we can acquire again
      const e4 = EmulatorPool.acquire(80, 24)
      expect(e4).not.toBeNull()
    })
  })
})
