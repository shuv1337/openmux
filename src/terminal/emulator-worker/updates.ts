/**
 * Update functions for the Emulator Worker
 */

import type { TerminalCell, TerminalScrollState } from '../../core/types';
import type { WorkerSession, SCROLLBACK_LIMIT } from './types';
import { sendMessage, convertLine, getModes } from './helpers';
import { packCells, packDirtyUpdate, getTransferables } from '../cell-serialization';

// Import SCROLLBACK_LIMIT from types
const SCROLLBACK_LIMIT_VALUE = 2000;

/**
 * Check if modes changed and send notification if so
 */
export function checkModeChanges(sessionId: string, session: WorkerSession): void {
  const newModes = getModes(session.terminal);
  if (
    newModes.mouseTracking !== session.lastModes.mouseTracking ||
    newModes.cursorKeyMode !== session.lastModes.cursorKeyMode ||
    newModes.alternateScreen !== session.lastModes.alternateScreen ||
    newModes.inBandResize !== session.lastModes.inBandResize
  ) {
    session.lastModes = newModes;
    sendMessage({ type: 'modeChange', sessionId, modes: newModes });
  }
}

/**
 * Build dirty update and send to main thread
 */
export function sendDirtyUpdate(sessionId: string, session: WorkerSession): void {
  const { terminal, cols, rows, terminalColors } = session;

  // Get dirty lines from terminal
  const ghosttyDirty = terminal.getDirtyLines();
  const cursor = terminal.getCursor();

  // Build dirty rows map
  const dirtyRows = new Map<number, TerminalCell[]>();
  for (const [y, line] of ghosttyDirty) {
    if (y >= 0 && y < rows) {
      dirtyRows.set(y, convertLine(line, cols, terminalColors));
    }
  }

  terminal.clearDirty();

  // Build update
  const scrollbackLength = terminal.getScrollbackLength();
  const scrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit: scrollbackLength >= SCROLLBACK_LIMIT_VALUE,
  };

  const update = {
    dirtyRows,
    cursor: {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: 'block' as const,
    },
    scrollState,
    cols,
    rows,
    isFull: false,
    alternateScreen: terminal.isAlternateScreen(),
    mouseTracking: session.lastModes.mouseTracking,
    cursorKeyMode: session.lastModes.cursorKeyMode,
    inBandResize: session.lastModes.inBandResize,
  };

  // Pack and send
  const packed = packDirtyUpdate(update);
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}

/**
 * Send full refresh update
 */
export function sendFullUpdate(sessionId: string, session: WorkerSession): void {
  const { terminal, cols, rows, terminalColors } = session;

  // Build full cell grid
  const cells: TerminalCell[][] = [];
  for (let y = 0; y < rows; y++) {
    const line = terminal.getLine(y);
    cells.push(convertLine(line, cols, terminalColors));
  }

  terminal.clearDirty();

  const cursor = terminal.getCursor();
  const modes = getModes(terminal);

  const fullState = {
    cols,
    rows,
    cells,
    cursor: {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: 'block' as const,
    },
    alternateScreen: modes.alternateScreen,
    mouseTracking: modes.mouseTracking,
    cursorKeyMode: modes.cursorKeyMode,
  };

  const scrollbackLength = terminal.getScrollbackLength();
  const scrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit: scrollbackLength >= SCROLLBACK_LIMIT_VALUE,
  };

  const update = {
    dirtyRows: new Map<number, TerminalCell[]>(),
    cursor: fullState.cursor,
    scrollState,
    cols,
    rows,
    isFull: true,
    fullState,
    alternateScreen: modes.alternateScreen,
    mouseTracking: modes.mouseTracking,
    cursorKeyMode: modes.cursorKeyMode,
    inBandResize: modes.inBandResize,
  };

  const packed = packDirtyUpdate(update);
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}
