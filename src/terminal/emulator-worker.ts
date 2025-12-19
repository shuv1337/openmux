/**
 * Emulator Worker - Web Worker for terminal emulation
 *
 * This worker handles all VT parsing using ghostty-web WASM,
 * freeing the main thread for smooth rendering and user interaction.
 *
 * Communication:
 * - Main thread sends: init, write, resize, reset, getScrollbackLine, search, destroy
 * - Worker sends: ready, update, titleChange, modeChange, scrollbackLine, searchResults, error
 *
 * Module structure:
 * - types.ts: WorkerSession type
 * - helpers.ts: sendMessage, convertLine, getModes
 * - updates.ts: sendDirtyUpdate, sendFullUpdate
 * - osc-stripping.ts: stripProblematicOscSequences
 * - handlers.ts: Message handlers for each operation
 */

import { Ghostty } from 'ghostty-web';
import type { WorkerInbound } from './emulator-interface';
import type { WorkerSession } from './emulator-worker/types';
import { sendMessage, sendError } from './emulator-worker/helpers';
import {
  handleInit,
  handleWrite,
  handleResize,
  handleReset,
  handleGetScrollbackLine,
  handleGetScrollbackLines,
  handleGetTerminalState,
  handleSearch,
  handleDestroy,
} from './emulator-worker/handlers';

// ============================================================================
// Global State
// ============================================================================

let ghostty: Ghostty | null = null;
const sessions = new Map<string, WorkerSession>();

// Typed self for worker context
declare const self: Worker;

// ============================================================================
// Main Message Handler
// ============================================================================

self.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init':
      await handleInit(msg.sessionId, msg.cols, msg.rows, msg.colors, ghostty, sessions);
      break;

    case 'write':
      await handleWrite(msg.sessionId, msg.data, sessions);
      break;

    case 'resize':
      handleResize(msg.sessionId, msg.cols, msg.rows, sessions);
      break;

    case 'reset':
      handleReset(msg.sessionId, sessions);
      break;

    case 'getScrollbackLine':
      handleGetScrollbackLine(msg.sessionId, msg.offset, msg.requestId, sessions);
      break;

    case 'getScrollbackLines':
      handleGetScrollbackLines(msg.sessionId, msg.startOffset, msg.count, msg.requestId, sessions);
      break;

    case 'getTerminalState':
      handleGetTerminalState(msg.sessionId, msg.requestId, sessions);
      break;

    case 'search':
      handleSearch(msg.sessionId, msg.query, msg.requestId, msg.limit ?? 500, sessions);
      break;

    case 'destroy':
      handleDestroy(msg.sessionId, sessions);
      break;

    default:
      sendError(`Unknown message type: ${(msg as { type: string }).type}`);
  }
};

// ============================================================================
// Initialization
// ============================================================================

async function init(): Promise<void> {
  try {
    ghostty = await Ghostty.load();
    sendMessage({ type: 'ready' });
  } catch (error) {
    sendError(`Failed to initialize ghostty: ${error}`);
  }
}

init();
