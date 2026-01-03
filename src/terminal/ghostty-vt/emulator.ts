/**
 * GhosttyVTEmulator - ITerminalEmulator implementation backed by native libghostty-vt.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from "../../core/types";
import type {
  ITerminalEmulator,
  SearchResult,
  TerminalModes,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from "../emulator-interface";
import type { TerminalColors } from "../terminal-colors";
import { createTitleParser } from "../title-parser";
import { stripProblematicOscSequences } from "./osc-stripping";
import { GhosttyVtTerminal } from "./terminal";
import { DirtyState } from "./types";
import { createEmptyRow } from "../ghostty-emulator/cell-converter";
import {
  ScrollbackCache,
  shouldClearCacheOnUpdate,
  createDefaultModes,
  createDefaultScrollState,
  createEmptyTerminalState,
  createEmptyDirtyUpdate,
} from "../emulator-utils";
import { getModes } from "./utils";
import { searchTerminal } from "./terminal-search";
import { buildDirtyState } from "./dirty-state";
import { mapKittyImageInfo, mapKittyPlacements } from "./kitty";
import { fetchScrollbackLine } from "./scrollback";
import { drainTerminalResponses } from "./responses";
import { getCursorSnapshot } from "./cursor";

const DEFAULT_SCROLLBACK_LIMIT = 2000;
const SCROLLBACK_LIMIT = (() => {
  const raw = process.env.SCROLLBACK_LIMIT;
  if (!raw) return DEFAULT_SCROLLBACK_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCROLLBACK_LIMIT;
  return parsed;
})();

export class GhosttyVTEmulator implements ITerminalEmulator {
  private terminal: GhosttyVtTerminal;
  private _cols: number;
  private _rows: number;
  private _disposed = false;
  private colors: TerminalColors;
  private modes: TerminalModes = createDefaultModes();
  private scrollState: TerminalScrollState = createDefaultScrollState();

  private cachedState: TerminalState | null = null;
  private pendingUpdate: DirtyTerminalUpdate | null = null;

  private titleParser: ReturnType<typeof createTitleParser>;
  private currentTitle = "";
  private titleCallbacks = new Set<(title: string) => void>();
  private updateCallbacks = new Set<() => void>();
  private modeChangeCallbacks = new Set<(modes: TerminalModes, prevModes?: TerminalModes) => void>();
  private updatesEnabled = true;
  private needsFullRefresh = false;

  private scrollbackCache = new ScrollbackCache(1000);
  private scrollbackSnapshotDirty = true;
  private decoder = new TextDecoder();

  constructor(cols: number, rows: number, colors: TerminalColors) {
    this._cols = cols;
    this._rows = rows;
    this.colors = colors;

    const palette = colors.palette.slice(0, 16);
    this.terminal = new GhosttyVtTerminal(cols, rows, {
      scrollbackLimit: SCROLLBACK_LIMIT,
      fgColor: colors.foreground,
      bgColor: colors.background,
      palette,
    });

    this.titleParser = createTitleParser({
      onTitleChange: (title: string) => {
        this.currentTitle = title;
        for (const callback of this.titleCallbacks) {
          callback(title);
        }
      },
    });

    // Clear terminal state to avoid stale memory artifacts.
    this.terminal.write("\x1b[2J\x1b[H");
    this.terminal.update();
    this.terminal.markClean();

    this.modes = getModes(this.terminal);
    this.prepareUpdate(true);
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  write(data: string | Uint8Array): void {
    if (this._disposed) return;

    const text = typeof data === "string" ? data : this.decoder.decode(data);
    if (text.length === 0) return;

    this.titleParser.processData(text);
    const stripped = stripProblematicOscSequences(text);
    if (stripped.length > 0) {
      this.scrollbackSnapshotDirty = true;
      this.terminal.write(stripped);
      if (!this.updatesEnabled) {
        this.needsFullRefresh = true;
        return;
      }
    } else if (!this.updatesEnabled) {
      return;
    }

    this.prepareUpdate(false);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  resize(cols: number, rows: number): void {
    if (this._disposed) return;
    if (cols === this._cols && rows === this._rows) return;

    this._cols = cols;
    this._rows = rows;
    this.scrollbackSnapshotDirty = true;
    this.terminal.resize(cols, rows);
    if (!this.updatesEnabled) {
      this.needsFullRefresh = true;
      return;
    }
    this.prepareUpdate(true);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    if (this._disposed) return;
    this.terminal.setPixelSize(widthPx, heightPx);
  }

  reset(): void {
    if (this._disposed) return;
    this.terminal.write("\x1bc");
    this.currentTitle = "";
    this.scrollbackCache.clear();
    this.scrollbackSnapshotDirty = true;
    if (!this.updatesEnabled) {
      this.needsFullRefresh = true;
      return;
    }
    this.prepareUpdate(true);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.terminal.free();

    this.cachedState = null;
    this.pendingUpdate = null;
    this.titleCallbacks.clear();
    this.updateCallbacks.clear();
    this.modeChangeCallbacks.clear();
    this.scrollbackCache.clear();
  }

  // ==========================================================================
  // State access
  // ==========================================================================

  getScrollbackLength(): number {
    return this.scrollState.scrollbackLength;
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    return this.fetchScrollbackLine(offset);
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    this.scrollState = scrollState;

    if (this.pendingUpdate) {
      const mergedScrollState: TerminalScrollState = {
        ...scrollState,
        isAtScrollbackLimit: this.pendingUpdate.scrollState.isAtScrollbackLimit,
      };
      const update = {
        ...this.pendingUpdate,
        scrollState: mergedScrollState,
      };
      this.pendingUpdate = null;
      return update;
    }

    return createEmptyDirtyUpdate(
      this._cols,
      this._rows,
      scrollState,
      this.modes,
      this.cachedState?.cursor
    );
  }

  getTerminalState(): TerminalState {
    if (this._disposed) {
      if (this.cachedState) {
        return { ...(this.cachedState as TerminalState) };
      }
      return createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
    }
    if (this.cachedState) {
      return { ...(this.cachedState as TerminalState) };
    }

    this.prepareUpdate(true);
    if (this.cachedState) {
      return { ...(this.cachedState as TerminalState) };
    }

    return createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    return getCursorSnapshot({
      disposed: this._disposed,
      cachedState: this.cachedState,
      terminal: this.terminal,
    });
  }

  getCursorKeyMode(): "normal" | "application" {
    return this.modes.cursorKeyMode;
  }

  getKittyKeyboardFlags(): number {
    if (this._disposed) return 0;
    return this.terminal.getKittyKeyboardFlags();
  }

  getKittyImagesDirty(): boolean {
    if (this._disposed) return false;
    return this.terminal.getKittyImagesDirty();
  }

  clearKittyImagesDirty(): void {
    if (this._disposed) return;
    this.terminal.clearKittyImagesDirty();
  }

  getKittyImageIds(): number[] {
    if (this._disposed) return [];
    return this.terminal.getKittyImageIds();
  }

  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null {
    if (this._disposed) return null;
    return mapKittyImageInfo(this.terminal, imageId);
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    if (this._disposed) return null;
    return this.terminal.getKittyImageData(imageId);
  }

  getKittyPlacements(): KittyGraphicsPlacement[] {
    if (this._disposed) return [];
    return mapKittyPlacements(this.terminal);
  }

  drainResponses(): string[] {
    if (this._disposed) return [];
    return drainTerminalResponses(this.terminal);
  }

  isMouseTrackingEnabled(): boolean {
    return this.modes.mouseTracking;
  }

  isAlternateScreen(): boolean {
    return this.modes.alternateScreen;
  }

  getMode(mode: number): boolean {
    if (this._disposed) return false;
    return this.terminal.getMode(mode, false);
  }

  getColors(): TerminalColors {
    return this.colors;
  }

  getTitle(): string {
    return this.currentTitle;
  }

  onTitleChange(callback: (title: string) => void): () => void {
    this.titleCallbacks.add(callback);
    if (this.currentTitle) {
      callback(this.currentTitle);
    }
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): () => void {
    this.updateCallbacks.add(callback);
    if (this.pendingUpdate) {
      callback();
    }
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  setUpdateEnabled(enabled: boolean): void {
    if (this.updatesEnabled === enabled) return;
    this.updatesEnabled = enabled;

    if (!enabled) {
      this.needsFullRefresh = true;
      this.pendingUpdate = null;
      return;
    }

    if (this.needsFullRefresh || !this.cachedState) {
      this.prepareUpdate(true);
    }
    this.needsFullRefresh = false;

    if (this.pendingUpdate) {
      for (const callback of this.updateCallbacks) {
        callback();
      }
    }
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    this.modeChangeCallbacks.add(callback);
    return () => {
      this.modeChangeCallbacks.delete(callback);
    };
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return searchTerminal(query, options, {
      getScrollbackLength: () => this.terminal.getScrollbackLength(),
      getScrollbackLine: (offset) => this.fetchScrollbackLine(offset),
      getTerminalState: () => this.getTerminalState(),
      createEmptyRow: (cols) => createEmptyRow(cols, this.colors),
    });
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private fetchScrollbackLine(offset: number): TerminalCell[] | null {
    if (this._disposed) return null;
    return fetchScrollbackLine({
      terminal: this.terminal,
      offset,
      cols: this._cols,
      colors: this.colors,
      cache: this.scrollbackCache,
      snapshotDirty: this.scrollbackSnapshotDirty,
      setSnapshotDirty: (value) => {
        this.scrollbackSnapshotDirty = value;
      },
    });
  }

  private prepareUpdate(forceFull: boolean): void {
    if (this._disposed) return;
    const dirtyState = this.terminal.update();
    this.scrollbackSnapshotDirty = false;
    const cursor = this.terminal.getCursor();
    const scrollbackLength = this.terminal.getScrollbackLength();
    const kittyKeyboardFlags = this.terminal.getKittyKeyboardFlags();
    const isAtScrollbackLimit = scrollbackLength >= SCROLLBACK_LIMIT;
    const prevModes = this.modes;
    const newModes = getModes(this.terminal);

    const updateScrollState: TerminalScrollState = {
      viewportOffset: 0,
      scrollbackLength,
      isAtBottom: true,
      isAtScrollbackLimit,
    };

    const shouldBuildFull = forceFull || dirtyState === DirtyState.FULL || !this.cachedState;
    const viewport = shouldBuildFull || dirtyState !== DirtyState.NONE
      ? this.terminal.getViewport()
      : null;

    const { cachedState, dirtyRows, fullState } = buildDirtyState({
      terminal: this.terminal,
      viewport,
      cols: this._cols,
      rows: this._rows,
      colors: this.colors,
      cachedState: this.cachedState,
      shouldBuildFull,
      cursor,
      modes: newModes,
      kittyKeyboardFlags,
    });
    this.cachedState = cachedState;

    const update: DirtyTerminalUpdate = {
      dirtyRows,
      cursor: {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: "block",
      },
      scrollState: updateScrollState,
      cols: this._cols,
      rows: this._rows,
      isFull: shouldBuildFull,
      fullState,
      alternateScreen: newModes.alternateScreen,
      mouseTracking: newModes.mouseTracking,
      cursorKeyMode: newModes.cursorKeyMode,
      kittyKeyboardFlags,
      inBandResize: newModes.inBandResize,
    };

    this.scrollState = {
      ...this.scrollState,
      scrollbackLength,
    };

    this.scrollbackCache.handleScrollbackChange(scrollbackLength, isAtScrollbackLimit);
    const shouldClearCache = shouldClearCacheOnUpdate(update, prevModes);
    if (shouldClearCache) {
      this.scrollbackCache.clear();
    }

    if (
      prevModes.mouseTracking !== newModes.mouseTracking ||
      prevModes.cursorKeyMode !== newModes.cursorKeyMode ||
      prevModes.alternateScreen !== newModes.alternateScreen ||
      prevModes.inBandResize !== newModes.inBandResize
    ) {
      this.modes = newModes;
      for (const callback of this.modeChangeCallbacks) {
        callback(newModes, prevModes);
      }
    } else {
      this.modes = newModes;
    }

    this.pendingUpdate = update;
    this.terminal.markClean();
  }
}

export function createGhosttyVTEmulator(
  cols: number,
  rows: number,
  colors: TerminalColors
): GhosttyVTEmulator {
  return new GhosttyVTEmulator(cols, rows, colors);
}
