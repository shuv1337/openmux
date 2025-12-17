/**
 * Emulator Pool - Pre-initializes GhosttyEmulator instances for instant pane creation
 *
 * This eliminates the 10-20ms blocking time of emulator initialization from the
 * critical path of pane creation, reducing animation stutter.
 *
 * Behavior:
 * 1. At startup (after WASM loads), prefill pool with emulators
 * 2. On pane create: acquire from pool (instant) or create new (fallback)
 * 3. On pane close: release emulator back to pool (reset + reuse)
 * 4. Background replenishment when pool drops below threshold
 */

import { GhosttyEmulator, isGhosttyInitialized } from './ghostty-emulator';
import type { TerminalColors } from './terminal-colors';

export interface EmulatorPoolConfig {
  /** Target pool size to maintain */
  targetSize: number;
  /** Minimum pool size before triggering background replenishment */
  minSize: number;
  /** Default columns for pooled emulators */
  defaultCols: number;
  /** Default rows for pooled emulators */
  defaultRows: number;
}

const DEFAULT_CONFIG: EmulatorPoolConfig = {
  targetSize: 3,
  minSize: 1,
  defaultCols: 80,
  defaultRows: 24,
};

interface PooledEmulator {
  emulator: GhosttyEmulator;
  cols: number;
  rows: number;
}

/**
 * EmulatorPool manages a pool of pre-initialized GhosttyEmulator instances.
 * This is a singleton to ensure consistent pool management across the app.
 */
class EmulatorPoolImpl {
  private pool: PooledEmulator[] = [];
  private config: EmulatorPoolConfig = DEFAULT_CONFIG;
  private colors: TerminalColors | undefined;
  private replenishScheduled = false;
  private initialized = false;

  /**
   * Initialize the pool with optional configuration and colors.
   * Should be called once after ghostty WASM is loaded.
   */
  async initialize(options?: Partial<EmulatorPoolConfig>, colors?: TerminalColors): Promise<void> {
    if (this.initialized) return;
    if (!isGhosttyInitialized()) {
      throw new Error('Cannot initialize EmulatorPool before Ghostty WASM is loaded');
    }

    this.config = { ...DEFAULT_CONFIG, ...options };
    this.colors = colors;
    this.initialized = true;

    // Prefill pool asynchronously to avoid blocking startup
    await this.prefillAsync(this.config.targetSize);
  }

  /**
   * Prefill the pool with emulators in the background.
   * Uses setImmediate/setTimeout to avoid blocking the main thread.
   */
  private async prefillAsync(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      // Yield to event loop between each emulator creation
      await new Promise<void>(resolve => {
        if (typeof setImmediate !== 'undefined') {
          setImmediate(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });

      // Don't exceed target size
      if (this.pool.length >= this.config.targetSize) break;

      this.createAndAdd();
    }
  }

  /**
   * Create a new emulator and add it to the pool.
   */
  private createAndAdd(): void {
    if (!isGhosttyInitialized()) return;

    try {
      const emulator = new GhosttyEmulator({
        cols: this.config.defaultCols,
        rows: this.config.defaultRows,
        colors: this.colors,
      });

      this.pool.push({
        emulator,
        cols: this.config.defaultCols,
        rows: this.config.defaultRows,
      });
    } catch (error) {
      console.warn('[EmulatorPool] Failed to create emulator:', error);
    }
  }

  /**
   * Acquire an emulator from the pool.
   * If the pool is empty, returns null (caller should create a new emulator).
   * The emulator will be resized to the requested dimensions.
   */
  acquire(cols: number, rows: number): GhosttyEmulator | null {
    if (!this.initialized || this.pool.length === 0) {
      return null;
    }

    const pooled = this.pool.pop()!;
    const { emulator } = pooled;

    // Resize if dimensions differ
    if (pooled.cols !== cols || pooled.rows !== rows) {
      emulator.resize(cols, rows);
    }

    // Schedule background replenishment if we're running low
    if (this.pool.length < this.config.minSize && !this.replenishScheduled) {
      this.scheduleReplenishment();
    }

    return emulator;
  }

  /**
   * Release an emulator back to the pool for reuse.
   * The emulator will be reset to a clean state.
   */
  release(emulator: GhosttyEmulator): void {
    if (!this.initialized) {
      emulator.dispose();
      return;
    }

    // Don't exceed target size
    if (this.pool.length >= this.config.targetSize) {
      emulator.dispose();
      return;
    }

    // Don't reuse disposed emulators
    if (emulator.isDisposed) {
      return;
    }

    // Reset the emulator to a clean state
    emulator.reset();

    // Resize back to default dimensions
    if (emulator.cols !== this.config.defaultCols || emulator.rows !== this.config.defaultRows) {
      emulator.resize(this.config.defaultCols, this.config.defaultRows);
    }

    this.pool.push({
      emulator,
      cols: this.config.defaultCols,
      rows: this.config.defaultRows,
    });
  }

  /**
   * Schedule background replenishment of the pool.
   */
  private scheduleReplenishment(): void {
    if (this.replenishScheduled) return;
    this.replenishScheduled = true;

    const replenish = () => {
      this.replenishScheduled = false;

      // Add emulators until we reach target size
      while (this.pool.length < this.config.targetSize) {
        this.createAndAdd();
      }
    };

    // Use setImmediate if available, otherwise setTimeout
    if (typeof setImmediate !== 'undefined') {
      setImmediate(replenish);
    } else {
      setTimeout(replenish, 0);
    }
  }

  /**
   * Get the current pool size (for debugging/monitoring).
   */
  getPoolSize(): number {
    return this.pool.length;
  }

  /**
   * Check if the pool has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose all pooled emulators and reset the pool.
   * Call this on app shutdown.
   */
  dispose(): void {
    for (const { emulator } of this.pool) {
      emulator.dispose();
    }
    this.pool = [];
    this.initialized = false;
    this.replenishScheduled = false;
  }
}

// Singleton instance
export const EmulatorPool = new EmulatorPoolImpl();
