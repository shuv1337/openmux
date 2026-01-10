import type {
  DirtyTerminalUpdate,
  TerminalScrollState,
  TerminalState,
} from '../../core/types';
import type { TerminalModes } from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import type { ScrollbackCache } from '../emulator-utils';
import { shouldClearCacheOnUpdate } from '../emulator-utils';
import { DirtyState } from './types';
import { getModes } from './utils';
import { buildDirtyState } from './dirty-state';
import type { GhosttyVtTerminal } from './terminal';

export interface PrepareEmulatorUpdateParams {
  terminal: GhosttyVtTerminal;
  cols: number;
  rows: number;
  colors: TerminalColors;
  cachedState: TerminalState | null;
  modes: TerminalModes;
  scrollState: TerminalScrollState;
  scrollbackCache: ScrollbackCache;
  forceFull: boolean;
  scrollbackLimit: number;
}

export interface PrepareEmulatorUpdateResult {
  cachedState: TerminalState | null;
  pendingUpdate: DirtyTerminalUpdate;
  modes: TerminalModes;
  prevModes: TerminalModes;
  scrollState: TerminalScrollState;
  scrollbackSnapshotDirty: boolean;
}

export function prepareEmulatorUpdate(params: PrepareEmulatorUpdateParams): PrepareEmulatorUpdateResult {
  const {
    terminal,
    cols,
    rows,
    colors,
    cachedState,
    modes,
    scrollState,
    scrollbackCache,
    forceFull,
    scrollbackLimit,
  } = params;

  const dirtyState = terminal.update();
  const cursor = terminal.getCursor();
  const scrollbackLength = terminal.getScrollbackLength();
  const kittyKeyboardFlags = terminal.getKittyKeyboardFlags();
  const isAtScrollbackLimit = scrollbackLength >= scrollbackLimit;
  const prevModes = modes;
  const newModes = getModes(terminal);

  const updateScrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit,
  };

  const shouldBuildFull = forceFull || dirtyState === DirtyState.FULL || !cachedState;
  const viewport = shouldBuildFull || dirtyState !== DirtyState.NONE
    ? terminal.getViewport()
    : null;

  const { cachedState: nextCachedState, dirtyRows, fullState } = buildDirtyState({
    terminal,
    viewport,
    cols,
    rows,
    colors,
    cachedState,
    shouldBuildFull,
    cursor,
    modes: newModes,
    kittyKeyboardFlags,
  });

  const update: DirtyTerminalUpdate = {
    dirtyRows,
    cursor: {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: 'block',
    },
    scrollState: updateScrollState,
    cols,
    rows,
    isFull: shouldBuildFull,
    fullState,
    alternateScreen: newModes.alternateScreen,
    mouseTracking: newModes.mouseTracking,
    cursorKeyMode: newModes.cursorKeyMode,
    kittyKeyboardFlags,
    inBandResize: newModes.inBandResize,
  };

  const nextScrollState: TerminalScrollState = {
    ...scrollState,
    scrollbackLength,
  };

  scrollbackCache.handleScrollbackChange(scrollbackLength, isAtScrollbackLimit);
  const shouldClearCache = shouldClearCacheOnUpdate(update, prevModes);
  if (shouldClearCache) {
    scrollbackCache.clear();
  }

  terminal.markClean();

  return {
    cachedState: nextCachedState,
    pendingUpdate: update,
    modes: newModes,
    prevModes,
    scrollState: nextScrollState,
    scrollbackSnapshotDirty: false,
  };
}
