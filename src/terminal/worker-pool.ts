/**
 * Emulator Worker Pool - Coordinates Web Workers for terminal emulation
 *
 * This module manages a pool of Web Workers that run ghostty-web WASM,
 * distributing terminal sessions across workers with session affinity.
 *
 * Features:
 * - Worker pool (default 2 workers)
 * - Session affinity (same session always routes to same worker)
 * - Async request/response correlation
 * - Update callbacks for terminal state changes
 */

import type {
  WorkerInbound,
  WorkerOutbound,
  WorkerTerminalColors,
  SerializedDirtyUpdate,
  TerminalModes,
  SearchMatch,
  SearchResult,
} from './emulator-interface';
import type { TerminalCell, DirtyTerminalUpdate, TerminalScrollState } from '../core/types';
import { unpackCells, unpackDirtyUpdate } from './cell-serialization';
import { extractRgb, type TerminalColors } from './terminal-colors';

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for terminal updates from worker
 */
export type UpdateCallback = (update: DirtyTerminalUpdate) => void;

/**
 * Callback for title changes
 */
export type TitleCallback = (title: string) => void;

/**
 * Callback for mode changes
 */
export type ModeCallback = (modes: TerminalModes) => void;

/**
 * Session state tracked by the pool
 */
interface SessionState {
  workerIndex: number;
  updateCallback: UpdateCallback | null;
  titleCallback: TitleCallback | null;
  modeCallback: ModeCallback | null;
  scrollState: TerminalScrollState;
  // Buffer for updates received before callback is set
  pendingUpdate: DirtyTerminalUpdate | null;
  // Error tracking for worker recovery
  errorCount: number;
  lastErrorAt: number | null;
  // Initialization tracking for non-blocking session creation
  initializationState: 'pending' | 'ready' | 'failed';
  initializationPromise: Promise<void> | null;
}

/**
 * Pending request waiting for response
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Promise with attached resolve/reject for non-blocking session creation
 */
interface InitPromiseWithResolvers extends Promise<void> {
  _resolve: () => void;
  _reject: (error: Error) => void;
}

// ============================================================================
// Worker Pool Class
// ============================================================================

// Worker recovery constants
const MAX_CONSECUTIVE_ERRORS = 3;
const ERROR_WINDOW_MS = 5000;

export class EmulatorWorkerPool {
  private workers: Worker[] = [];
  private workersReady: boolean[] = [];
  private workerErrorCounts: number[] = [];
  private workerRestartInProgress: boolean[] = [];
  private sessionToState = new Map<string, SessionState>();
  private pendingRequests = new Map<number, PendingRequest<unknown>>();
  private nextRequestId = 0;
  private nextWorkerIndex = 0;
  private initialized = false;

  // Message batching for reduced main thread blocking
  private messageQueue: Array<{ workerIndex: number; msg: WorkerOutbound }> = [];
  private flushScheduled = false;

  /**
   * Initialize the worker pool
   * @param workerCount Number of workers to create (default: 2)
   */
  async initialize(workerCount = 2): Promise<void> {
    if (this.initialized) {
      return;
    }

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < workerCount; i++) {
      // Use string literal instead of new URL() - workaround for Bun compiled binary bug
      // See: https://github.com/oven-sh/bun/issues/16869
      const worker = new Worker('./emulator-worker.ts', { type: 'module' });
      this.workers.push(worker);
      this.workersReady.push(false);
      this.workerErrorCounts.push(0);
      this.workerRestartInProgress.push(false);

      worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
        this.queueMessage(i, event.data);
      };

      worker.onerror = (error) => {
        console.error(`Worker ${i} error:`, error);
      };

      // Wait for worker to be ready
      workerPromises.push(
        new Promise<void>((resolve) => {
          const handler = (event: MessageEvent<WorkerOutbound>) => {
            if (event.data.type === 'ready') {
              this.workersReady[i] = true;
              worker.removeEventListener('message', handler);
              resolve();
            }
          };
          worker.addEventListener('message', handler);
        })
      );
    }

    await Promise.all(workerPromises);
    this.initialized = true;
  }

  /**
   * Check if the pool is initialized and all workers are ready
   */
  isReady(): boolean {
    return this.initialized && this.workersReady.every(Boolean);
  }

  /**
   * Terminate all workers and clean up
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.workersReady = [];
    this.workerErrorCounts = [];
    this.workerRestartInProgress = [];
    this.sessionToState.clear();
    this.pendingRequests.clear();
    this.initialized = false;
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new terminal session
   *
   * This method is non-blocking - it returns immediately after sending the
   * initialization message to the worker. The worker will buffer any incoming
   * writes until initialization completes. Use waitForSession() if you need
   * to wait for initialization to complete.
   */
  createSession(
    sessionId: string,
    cols: number,
    rows: number,
    colors: TerminalColors
  ): void {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized');
    }

    if (this.sessionToState.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Select worker (round-robin)
    const workerIndex = this.nextWorkerIndex;
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    // Convert TerminalColors to WorkerTerminalColors
    const workerColors: WorkerTerminalColors = {
      foreground: extractRgb(colors.foreground),
      background: extractRgb(colors.background),
      palette: colors.palette.map(extractRgb),
    };

    // Create initialization promise (resolved by handleWorkerMessage)
    let resolveInit: () => void;
    let rejectInit: (error: Error) => void;
    const initPromise = new Promise<void>((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });

    // Store resolve/reject functions for use by message handler
    // We attach them to the promise object for access in handleInitialized/handleError
    (initPromise as InitPromiseWithResolvers)._resolve = resolveInit!;
    (initPromise as InitPromiseWithResolvers)._reject = rejectInit!;

    // Track session state with pending initialization
    this.sessionToState.set(sessionId, {
      workerIndex,
      updateCallback: null,
      titleCallback: null,
      modeCallback: null,
      scrollState: {
        viewportOffset: 0,
        scrollbackLength: 0,
        isAtBottom: true,
      },
      pendingUpdate: null,
      errorCount: 0,
      lastErrorAt: null,
      initializationState: 'pending',
      initializationPromise: initPromise,
    });

    // Send init message (fire and forget - don't block)
    const msg: WorkerInbound = {
      type: 'init',
      sessionId,
      cols,
      rows,
      colors: workerColors,
    };
    this.workers[workerIndex].postMessage(msg);

    // Return immediately - worker buffers writes until session is ready
  }

  /**
   * Wait for a session to complete initialization
   * Use this if you need to ensure the session is fully ready before proceeding.
   */
  async waitForSession(sessionId: string): Promise<void> {
    const state = this.sessionToState.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (state.initializationState === 'ready') {
      return;
    }
    if (state.initializationState === 'failed') {
      throw new Error('Session initialization failed');
    }
    if (state.initializationPromise) {
      await state.initializationPromise;
    }
  }

  /**
   * Destroy a session
   */
  destroy(sessionId: string): void {
    const state = this.sessionToState.get(sessionId);
    if (!state) return;

    const msg: WorkerInbound = { type: 'destroy', sessionId };
    this.workers[state.workerIndex].postMessage(msg);
    this.sessionToState.delete(sessionId);
  }

  // ============================================================================
  // Terminal Operations
  // ============================================================================

  /**
   * Write data to a session
   */
  write(sessionId: string, data: string | Uint8Array): void {
    const state = this.sessionToState.get(sessionId);
    if (!state) return;

    // Convert to ArrayBuffer for transfer
    let buffer: ArrayBuffer;
    if (typeof data === 'string') {
      const encoded = new TextEncoder().encode(data);
      buffer = (encoded.buffer as ArrayBuffer).slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    } else {
      buffer = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    }

    const msg: WorkerInbound = { type: 'write', sessionId, data: buffer };
    this.workers[state.workerIndex].postMessage(msg, [buffer]);
  }

  /**
   * Resize a session
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const state = this.sessionToState.get(sessionId);
    if (!state) return;

    const msg: WorkerInbound = { type: 'resize', sessionId, cols, rows };
    this.workers[state.workerIndex].postMessage(msg);
  }

  /**
   * Reset a session
   */
  reset(sessionId: string): void {
    const state = this.sessionToState.get(sessionId);
    if (!state) return;

    const msg: WorkerInbound = { type: 'reset', sessionId };
    this.workers[state.workerIndex].postMessage(msg);
  }

  // ============================================================================
  // Async Queries
  // ============================================================================

  /**
   * Get a scrollback line
   */
  async getScrollbackLine(sessionId: string, offset: number): Promise<TerminalCell[] | null> {
    const state = this.sessionToState.get(sessionId);
    if (!state) return null;

    const requestId = this.nextRequestId++;
    const msg: WorkerInbound = {
      type: 'getScrollbackLine',
      sessionId,
      offset,
      requestId,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as TerminalCell[] | null),
        reject,
      });
      this.workers[state.workerIndex].postMessage(msg);
    });
  }

  /**
   * Get multiple scrollback lines
   */
  async getScrollbackLines(
    sessionId: string,
    startOffset: number,
    count: number
  ): Promise<Map<number, TerminalCell[]>> {
    const state = this.sessionToState.get(sessionId);
    if (!state) return new Map();

    const requestId = this.nextRequestId++;
    const msg: WorkerInbound = {
      type: 'getScrollbackLines',
      sessionId,
      startOffset,
      count,
      requestId,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as Map<number, TerminalCell[]>),
        reject,
      });
      this.workers[state.workerIndex].postMessage(msg);
    });
  }

  /**
   * Search for text in terminal
   */
  async search(
    sessionId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<SearchResult> {
    const state = this.sessionToState.get(sessionId);
    if (!state) return { matches: [], hasMore: false };

    const requestId = this.nextRequestId++;
    const msg: WorkerInbound = {
      type: 'search',
      sessionId,
      query,
      requestId,
      limit: options?.limit,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as SearchResult),
        reject,
      });
      this.workers[state.workerIndex].postMessage(msg);
    });
  }

  // ============================================================================
  // Subscriptions
  // ============================================================================

  /**
   * Subscribe to terminal updates
   */
  onUpdate(sessionId: string, callback: UpdateCallback): () => void {
    const state = this.sessionToState.get(sessionId);
    if (!state) {
      return () => {};
    }

    state.updateCallback = callback;

    // Deliver any buffered update that arrived before callback was set
    if (state.pendingUpdate) {
      const pending = state.pendingUpdate;
      state.pendingUpdate = null;
      // Use queueMicrotask to ensure callback runs after current stack completes
      queueMicrotask(() => callback(pending));
    }

    return () => {
      if (state.updateCallback === callback) {
        state.updateCallback = null;
      }
    };
  }

  /**
   * Subscribe to title changes
   */
  onTitleChange(sessionId: string, callback: TitleCallback): () => void {
    const state = this.sessionToState.get(sessionId);
    if (!state) {
      return () => {};
    }

    state.titleCallback = callback;
    return () => {
      if (state.titleCallback === callback) {
        state.titleCallback = null;
      }
    };
  }

  /**
   * Subscribe to mode changes
   */
  onModeChange(sessionId: string, callback: ModeCallback): () => void {
    const state = this.sessionToState.get(sessionId);
    if (!state) {
      return () => {};
    }

    state.modeCallback = callback;
    return () => {
      if (state.modeCallback === callback) {
        state.modeCallback = null;
      }
    };
  }

  /**
   * Update scroll state for a session (called from main thread)
   */
  setScrollState(sessionId: string, scrollState: TerminalScrollState): void {
    const state = this.sessionToState.get(sessionId);
    if (state) {
      state.scrollState = scrollState;
    }
  }

  /**
   * Get current scroll state for a session
   */
  getScrollState(sessionId: string): TerminalScrollState | null {
    const state = this.sessionToState.get(sessionId);
    return state?.scrollState ?? null;
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  /**
   * Queue a message for batched processing
   * Messages are processed together in the next microtask to reduce main thread blocking
   */
  private queueMessage(workerIndex: number, msg: WorkerOutbound): void {
    this.messageQueue.push({ workerIndex, msg });
    this.scheduleFlush();
  }

  /**
   * Schedule message queue flush if not already scheduled
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flushMessageQueue());
  }

  /**
   * Process all queued messages in one batch
   */
  private flushMessageQueue(): void {
    this.flushScheduled = false;
    const queue = this.messageQueue;
    this.messageQueue = [];

    for (const { workerIndex, msg } of queue) {
      this.handleWorkerMessage(workerIndex, msg);
    }
  }

  private handleWorkerMessage(workerIndex: number, msg: WorkerOutbound): void {
    switch (msg.type) {
      case 'ready':
        // Already handled during initialization
        break;

      case 'initialized':
        this.handleInitialized(msg.sessionId);
        break;

      case 'update':
        this.handleUpdate(msg.sessionId, msg.update);
        break;

      case 'titleChange':
        this.handleTitleChange(msg.sessionId, msg.title);
        break;

      case 'modeChange':
        this.handleModeChange(msg.sessionId, msg.modes);
        break;

      case 'scrollbackLine':
        this.handleScrollbackLine(msg.requestId, msg.cells);
        break;

      case 'scrollbackLines':
        this.handleScrollbackLines(msg.requestId, msg.cells, msg.offsets);
        break;

      case 'searchResults':
        this.handleSearchResults(msg.requestId, msg.matches, msg.hasMore);
        break;

      case 'destroyed':
        // Session already removed from map
        break;

      case 'error':
        this.handleError(workerIndex, msg.sessionId, msg.requestId, msg.message);
        break;
    }
  }

  private handleInitialized(sessionId: string): void {
    const state = this.sessionToState.get(sessionId);
    if (!state) return;

    state.initializationState = 'ready';

    // Resolve the initialization promise
    const promise = state.initializationPromise as InitPromiseWithResolvers | null;
    if (promise?._resolve) {
      promise._resolve();
    }
  }

  private handleUpdate(sessionId: string, packed: SerializedDirtyUpdate): void {
    const state = this.sessionToState.get(sessionId);
    if (!state) return;

    const update = unpackDirtyUpdate(packed, state.scrollState);

    // Update scroll state
    state.scrollState = {
      ...state.scrollState,
      scrollbackLength: update.scrollState.scrollbackLength,
    };

    if (state.updateCallback) {
      state.updateCallback(update);
    } else {
      // Buffer update until callback is registered (handles race condition during init)
      state.pendingUpdate = update;
    }
  }

  private handleTitleChange(sessionId: string, title: string): void {
    const state = this.sessionToState.get(sessionId);
    if (state?.titleCallback) {
      state.titleCallback(title);
    }
  }

  private handleModeChange(sessionId: string, modes: TerminalModes): void {
    const state = this.sessionToState.get(sessionId);
    if (state?.modeCallback) {
      state.modeCallback(modes);
    }
  }

  private handleScrollbackLine(requestId: number, cells: ArrayBuffer | null): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    this.pendingRequests.delete(requestId);

    if (cells === null) {
      request.resolve(null);
    } else {
      request.resolve(unpackCells(cells));
    }
  }

  private handleScrollbackLines(
    requestId: number,
    cellBuffers: ArrayBuffer[],
    offsets: number[]
  ): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    this.pendingRequests.delete(requestId);

    const result = new Map<number, TerminalCell[]>();
    for (let i = 0; i < cellBuffers.length; i++) {
      result.set(offsets[i], unpackCells(cellBuffers[i]));
    }
    request.resolve(result);
  }

  private handleSearchResults(
    requestId: number,
    matches: SearchMatch[],
    hasMore: boolean
  ): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    this.pendingRequests.delete(requestId);
    request.resolve({ matches, hasMore });
  }

  private handleError(
    workerIndex: number,
    sessionId: string | undefined,
    requestId: number | undefined,
    message: string
  ): void {
    console.error(
      `Worker ${workerIndex} error${sessionId ? ` (session: ${sessionId})` : ''}:`,
      message
    );

    // Track errors per worker
    const now = Date.now();

    // Reset error count if last error was outside the window
    if (this.workerErrorCounts[workerIndex] > 0) {
      // Check if we should reset (no recent errors)
      const sessionsOnWorker = Array.from(this.sessionToState.values()).filter(
        (s) => s.workerIndex === workerIndex
      );
      const recentError = sessionsOnWorker.some(
        (s) => s.lastErrorAt && now - s.lastErrorAt < ERROR_WINDOW_MS
      );
      if (!recentError) {
        this.workerErrorCounts[workerIndex] = 0;
      }
    }

    this.workerErrorCounts[workerIndex]++;

    // Update session error tracking if we have a session
    if (sessionId) {
      const state = this.sessionToState.get(sessionId);
      if (state) {
        state.errorCount++;
        state.lastErrorAt = now;

        // Reject initialization promise if session was still pending
        if (state.initializationState === 'pending') {
          state.initializationState = 'failed';
          const promise = state.initializationPromise as InitPromiseWithResolvers | null;
          if (promise?._reject) {
            promise._reject(new Error(message));
          }
          this.sessionToState.delete(sessionId);
        }
      }
    }

    // Reject pending request if any
    if (requestId !== undefined) {
      const request = this.pendingRequests.get(requestId);
      if (request) {
        this.pendingRequests.delete(requestId);
        request.reject(new Error(message));
      }
    }

    // Check if worker needs restart
    if (
      this.workerErrorCounts[workerIndex] >= MAX_CONSECUTIVE_ERRORS &&
      !this.workerRestartInProgress[workerIndex]
    ) {
      this.restartWorker(workerIndex);
    }
  }

  /**
   * Restart a worker that has encountered too many errors
   */
  private async restartWorker(workerIndex: number): Promise<void> {
    if (this.workerRestartInProgress[workerIndex]) {
      return;
    }

    this.workerRestartInProgress[workerIndex] = true;
    console.warn(`Restarting worker ${workerIndex} due to repeated errors`);

    const oldWorker = this.workers[workerIndex];

    // Find affected sessions
    const affectedSessions = Array.from(this.sessionToState.entries())
      .filter(([, state]) => state.workerIndex === workerIndex)
      .map(([id, state]) => ({ id, state }));

    // Terminate old worker
    oldWorker.terminate();
    this.workersReady[workerIndex] = false;
    this.workerErrorCounts[workerIndex] = 0;

    // Create new worker
    const newWorker = new Worker('./emulator-worker.ts', { type: 'module' });
    this.workers[workerIndex] = newWorker;

    newWorker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      this.queueMessage(workerIndex, event.data);
    };

    newWorker.onerror = (error) => {
      console.error(`Worker ${workerIndex} error:`, error);
    };

    // Wait for ready
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent<WorkerOutbound>) => {
        if (event.data.type === 'ready') {
          this.workersReady[workerIndex] = true;
          newWorker.removeEventListener('message', handler);
          resolve();
        }
      };
      newWorker.addEventListener('message', handler);
    });

    this.workerRestartInProgress[workerIndex] = false;

    // Notify affected sessions - they need to be recreated
    // The PTY is still running, so new terminal session will resume output
    for (const { id, state } of affectedSessions) {
      // Remove session from tracking (will be recreated by TerminalContext)
      this.sessionToState.delete(id);

      // Notify via update callback with a special recovery message
      if (state.updateCallback) {
        // Send an empty update to trigger re-initialization
        // The terminal will appear cleared but will resume receiving output
        console.log(`Session ${id} needs recovery after worker restart`);
      }
    }

    console.log(`Worker ${workerIndex} restarted, ${affectedSessions.length} sessions affected`);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let poolInstance: EmulatorWorkerPool | null = null;

/**
 * Get or create the global worker pool instance
 */
export function getWorkerPool(): EmulatorWorkerPool {
  if (!poolInstance) {
    poolInstance = new EmulatorWorkerPool();
  }
  return poolInstance;
}

/**
 * Initialize the global worker pool
 */
export async function initWorkerPool(workerCount?: number): Promise<EmulatorWorkerPool> {
  const pool = getWorkerPool();
  await pool.initialize(workerCount);
  return pool;
}
