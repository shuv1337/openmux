/**
 * Terminal operations for the Worker Pool
 */

import type { WorkerInbound } from '../emulator-interface';
import type { SessionState } from './types';

/**
 * Write data to a session
 */
export function write(
  sessionId: string,
  data: string | Uint8Array,
  workers: Worker[],
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
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
  workers[state.workerIndex].postMessage(msg, [buffer]);
}

/**
 * Resize a session
 */
export function resize(
  sessionId: string,
  cols: number,
  rows: number,
  workers: Worker[],
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (!state) return;

  const msg: WorkerInbound = { type: 'resize', sessionId, cols, rows };
  workers[state.workerIndex].postMessage(msg);
}

/**
 * Reset a session
 */
export function reset(
  sessionId: string,
  workers: Worker[],
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (!state) return;

  const msg: WorkerInbound = { type: 'reset', sessionId };
  workers[state.workerIndex].postMessage(msg);
}
