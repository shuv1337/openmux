import type { TerminalState } from '../../core/types';
import type { GhosttyVtTerminal } from './terminal';

export function getCursorSnapshot(params: {
  disposed: boolean;
  cachedState: TerminalState | null;
  terminal: GhosttyVtTerminal;
}): { x: number; y: number; visible: boolean } {
  const { disposed, cachedState, terminal } = params;
  if (disposed) {
    if (cachedState?.cursor) {
      return {
        x: cachedState.cursor.x,
        y: cachedState.cursor.y,
        visible: cachedState.cursor.visible,
      };
    }
    return { x: 0, y: 0, visible: false };
  }
  if (cachedState?.cursor) {
    return {
      x: cachedState.cursor.x,
      y: cachedState.cursor.y,
      visible: cachedState.cursor.visible,
    };
  }
  terminal.update();
  return terminal.getCursor();
}
