/**
 * Helper functions for the Emulator Worker
 */

import type { GhosttyTerminal } from 'ghostty-web';
import type { WorkerOutbound, TerminalModes } from '../emulator-interface';
import type { TerminalCell } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import {
  convertLine as convertGhosttyLine,
  createEmptyRow,
} from '../ghostty-emulator/cell-converter';

// Typed self for worker context
declare const self: Worker;

/**
 * Send a message to the main thread
 */
export function sendMessage(msg: WorkerOutbound, transfer?: ArrayBuffer[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

/**
 * Send an error message to the main thread
 */
export function sendError(message: string, sessionId?: string, requestId?: number): void {
  sendMessage({ type: 'error', message, sessionId, requestId });
}

/**
 * Convert GhosttyCell line to TerminalCell array using the shared cell converter
 */
export function convertLine(
  line: ReturnType<GhosttyTerminal['getLine']>,
  cols: number,
  colors: TerminalColors
): TerminalCell[] {
  if (!line) {
    return createEmptyRow(cols, colors);
  }
  return convertGhosttyLine(line, cols, colors);
}

/**
 * Extract text from a row of terminal cells, skipping wide character placeholders
 */
export function extractLineText(cells: TerminalCell[]): string {
  const chars: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    chars.push(cells[i].char);
    // Skip placeholder for wide characters (width=2 takes two cells)
    if (cells[i].width === 2) {
      i++;
    }
  }
  return chars.join('');
}

/**
 * Get current terminal modes
 */
export function getModes(terminal: GhosttyTerminal): TerminalModes {
  return {
    mouseTracking:
      terminal.getMode(1000, false) ||
      terminal.getMode(1002, false) ||
      terminal.getMode(1003, false),
    cursorKeyMode: terminal.getMode(1, false) ? 'application' : 'normal',
    alternateScreen: terminal.isAlternateScreen(),
    inBandResize: terminal.getMode(2048, false),
  };
}
