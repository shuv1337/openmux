/**
 * CopyModeContext - manages vim-style copy mode for terminal panes
 *
 * Provides a virtual cursor for scrollback navigation and selection.
 */

import {
  createContext,
  useContext,
  createSignal,
  type ParentProps,
} from 'solid-js';
import type { SelectionBounds, TerminalCell } from '../core/types';
import {
  type SelectionPoint,
  type SelectionRange,
  normalizeSelection,
  calculateBounds,
  isCellInRange,
  extractSelectedText,
} from '../core/coordinates';
import { copyToClipboard } from '../effect/bridge';
import { useTerminal } from './TerminalContext';
import { useSelection } from './SelectionContext';

export type CopyVisualType = 'char' | 'line';

export interface CopyCursor {
  x: number;
  absY: number;
}

interface CopyModeState {
  ptyId: string;
  cursor: CopyCursor;
  anchor: CopyCursor | null;
  visualType: CopyVisualType | null;
  selectionRange: SelectionRange | null;
  bounds: SelectionBounds | null;
}

export interface CopyModeContextValue {
  /** Enter copy mode for a PTY */
  enterCopyMode: (ptyId: string) => void;
  /** Exit copy mode */
  exitCopyMode: () => void;
  /** Whether copy mode is active (optionally for a PTY) */
  isActive: (ptyId?: string) => boolean;
  /** Get active PTY ID */
  getActivePtyId: () => string | null;
  /** Get virtual cursor for a PTY */
  getCursor: (ptyId: string) => CopyCursor | null;
  /** Move cursor by delta */
  moveCursorBy: (dx: number, dy: number) => void;
  /** Move cursor to absolute position */
  moveCursorTo: (cursor: CopyCursor) => void;
  /** Move cursor to top/bottom */
  moveToTop: () => void;
  moveToBottom: () => void;
  /** Move cursor to line start/end */
  moveToLineStart: () => void;
  moveToLineEnd: () => void;
  moveToLineFirstNonBlank: () => void;
  /** Get current viewport row count */
  getViewportRows: () => number;
  /** Word motions */
  moveWordForward: () => void;
  moveWordBackward: () => void;
  moveWordEnd: () => void;
  /** WORD motions (whitespace-delimited) */
  moveWideWordForward: () => void;
  moveWideWordBackward: () => void;
  moveWideWordEnd: () => void;
  /** Toggle visual selection */
  toggleVisual: (type: CopyVisualType) => void;
  /** Start visual selection without toggling off */
  startSelection: (type: CopyVisualType) => void;
  /** Select word under cursor (inner/around) */
  selectWord: (mode: 'inner' | 'around') => void;
  /** Select current line */
  selectLine: () => void;
  /** Copy current selection or line */
  copySelection: () => Promise<void>;
  /** Clear visual selection */
  clearSelection: () => void;
  /** Whether a cell is selected in copy mode */
  isCellSelected: (ptyId: string, x: number, absY: number) => boolean;
  /** Whether selection exists for a PTY */
  hasSelection: (ptyId: string) => boolean;
  /** Version counter for re-render triggers */
  copyModeVersion: number;
}

const CopyModeContext = createContext<CopyModeContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface CopyModeProviderProps extends ParentProps {}

export function CopyModeProvider(props: CopyModeProviderProps) {
  const terminal = useTerminal();
  const selection = useSelection();
  const {
    getScrollState,
    setScrollOffset,
    getEmulatorSync,
    getTerminalStateSync,
  } = terminal;

  const [state, setState] = createSignal<CopyModeState | null>(null);
  const [copyModeVersion, setCopyModeVersion] = createSignal(0);

  const notifyChange = () => setCopyModeVersion((v) => v + 1);

  const isActive = (ptyId?: string): boolean => {
    const current = state();
    if (!current) return false;
    if (!ptyId) return true;
    return current.ptyId === ptyId;
  };

  const getActivePtyId = (): string | null => {
    return state()?.ptyId ?? null;
  };

  const getCursor = (ptyId: string): CopyCursor | null => {
    const current = state();
    if (!current || current.ptyId !== ptyId) return null;
    return current.cursor;
  };

  const getScrollMeta = (ptyId: string) => {
    const terminalState = getTerminalStateSync(ptyId);
    const emulator = getEmulatorSync(ptyId);
    const scrollState = getScrollState(ptyId);
    const scrollbackLength =
      scrollState?.scrollbackLength ?? emulator?.getScrollbackLength() ?? 0;
    const rows = terminalState?.rows ?? 0;
    const cols = terminalState?.cols ?? 0;
    const viewportOffset = scrollState?.viewportOffset ?? 0;
    return { terminalState, emulator, scrollbackLength, rows, cols, viewportOffset };
  };

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(value, max));

  const clampCursor = (ptyId: string, cursor: CopyCursor): CopyCursor | null => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState || meta.rows <= 0 || meta.cols <= 0) return null;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    return {
      x: clamp(cursor.x, 0, Math.max(0, meta.cols - 1)),
      absY: clamp(cursor.absY, 0, maxAbsY),
    };
  };

  const ensureCursorVisible = (ptyId: string, cursor: CopyCursor) => {
    const meta = getScrollMeta(ptyId);
    if (meta.rows <= 0) return;
    const topAbsY = meta.scrollbackLength - meta.viewportOffset;
    const bottomAbsY = topAbsY + meta.rows - 1;

    if (cursor.absY < topAbsY) {
      setScrollOffset(ptyId, meta.scrollbackLength - cursor.absY);
    } else if (cursor.absY > bottomAbsY) {
      setScrollOffset(ptyId, meta.scrollbackLength - (cursor.absY - (meta.rows - 1)));
    }
  };

  const isForwardSelection = (anchor: CopyCursor, cursor: CopyCursor): boolean => {
    return cursor.absY > anchor.absY ||
      (cursor.absY === anchor.absY && cursor.x >= anchor.x);
  };

  const buildCharSelectionRange = (
    anchor: CopyCursor,
    cursor: CopyCursor,
    cols: number
  ): { range: SelectionRange; bounds: SelectionBounds } => {
    const forward = isForwardSelection(anchor, cursor);
    const focusX = forward ? cursor.x + 1 : cursor.x - 1;
    const clampedFocusX = clamp(focusX, -1, Math.max(cols, 0));
    const anchorPoint: SelectionPoint = { x: anchor.x, y: 0, absoluteY: anchor.absY };
    const focusPoint: SelectionPoint = { x: clampedFocusX, y: 0, absoluteY: cursor.absY };
    const range = normalizeSelection(anchorPoint, focusPoint);
    return { range, bounds: calculateBounds(range) };
  };

  const buildLineSelectionRange = (
    anchor: CopyCursor,
    cursor: CopyCursor,
    cols: number
  ): { range: SelectionRange; bounds: SelectionBounds } => {
    const forward = isForwardSelection(anchor, cursor);
    const startY = Math.min(anchor.absY, cursor.absY);
    const endY = Math.max(anchor.absY, cursor.absY);
    const safeCols = Math.max(1, cols);
    const range: SelectionRange = forward
      ? { startX: 0, startY, endX: safeCols, endY, focusAtEnd: true }
      : { startX: -1, startY, endX: Math.max(0, safeCols - 1), endY, focusAtEnd: false };
    return { range, bounds: calculateBounds(range) };
  };

  const recomputeSelection = (next: CopyModeState): CopyModeState => {
    if (!next.visualType || !next.anchor) {
      return { ...next, selectionRange: null, bounds: null };
    }
    const meta = getScrollMeta(next.ptyId);
    const cols = meta.cols || 1;
    const selection =
      next.visualType === 'line'
        ? buildLineSelectionRange(next.anchor, next.cursor, cols)
        : buildCharSelectionRange(next.anchor, next.cursor, cols);
    return {
      ...next,
      selectionRange: selection.range,
      bounds: selection.bounds,
    };
  };

  const updateState = (next: CopyModeState | null) => {
    setState(next);
    notifyChange();
  };

  const enterCopyMode = (ptyId: string) => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState || meta.rows <= 0 || meta.cols <= 0) return;
    const cursorY = meta.terminalState.cursor.y ?? 0;
    const cursorX = meta.terminalState.cursor.x ?? 0;
    const absY = meta.viewportOffset > 0
      ? meta.scrollbackLength - meta.viewportOffset
      : meta.scrollbackLength + cursorY;
    const clamped = clampCursor(ptyId, { x: cursorX, absY });
    if (!clamped) return;

    updateState({
      ptyId,
      cursor: clamped,
      anchor: null,
      visualType: null,
      selectionRange: null,
      bounds: null,
    });
  };

  const exitCopyMode = () => {
    updateState(null);
  };

  const moveCursorTo = (cursor: CopyCursor) => {
    const current = state();
    if (!current) return;
    const clamped = clampCursor(current.ptyId, cursor);
    if (!clamped) return;
    const next = recomputeSelection({
      ...current,
      cursor: clamped,
    });
    updateState(next);
    ensureCursorVisible(current.ptyId, clamped);
  };

  const moveCursorBy = (dx: number, dy: number) => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: current.cursor.x + dx, absY: current.cursor.absY + dy });
  };

  const moveToTop = () => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: current.cursor.x, absY: 0 });
  };

  const moveToBottom = () => {
    const current = state();
    if (!current) return;
    const meta = getScrollMeta(current.ptyId);
    if (meta.rows <= 0) return;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    moveCursorTo({ x: current.cursor.x, absY: maxAbsY });
  };

  const getLineCells = (ptyId: string, absY: number): TerminalCell[] | null => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState) return null;
    if (absY < meta.scrollbackLength) {
      return meta.emulator?.getScrollbackLine(absY) ?? null;
    }
    const liveY = absY - meta.scrollbackLength;
    return meta.terminalState.cells[liveY] ?? null;
  };

  const getLineEndX = (line: TerminalCell[] | null): number => {
    if (!line || line.length === 0) return 0;
    for (let x = line.length - 1; x >= 0; x -= 1) {
      const cell = line[x];
      const char = cell?.char ?? ' ';
      if (char.trim().length > 0) {
        return x;
      }
    }
    return 0;
  };

  const getLineStartX = (line: TerminalCell[] | null): number => {
    if (!line || line.length === 0) return 0;
    for (let x = 0; x < line.length; x += 1) {
      const cell = line[x];
      const char = cell?.char ?? ' ';
      if (char.trim().length > 0) {
        return x;
      }
    }
    return 0;
  };

  const moveToLineStart = () => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: 0, absY: current.cursor.absY });
  };

  const moveToLineEnd = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    moveCursorTo({ x: getLineEndX(line), absY: current.cursor.absY });
  };

  const moveToLineFirstNonBlank = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    moveCursorTo({ x: getLineStartX(line), absY: current.cursor.absY });
  };

  const getViewportRows = () => {
    const current = state();
    if (!current) return 0;
    const meta = getScrollMeta(current.ptyId);
    return meta.rows ?? 0;
  };

  const isWordChar = (char: string): boolean => {
    if (!char) return false;
    const code = char.charCodeAt(0);
    return /[A-Za-z0-9_]/.test(char) || code > 127;
  };

  const isWhitespaceChar = (char: string): boolean => {
    return !char || char.trim().length === 0;
  };

  const isWideWordChar = (char: string): boolean => {
    if (!char) return false;
    return !isWhitespaceChar(char);
  };

  const findSpanAtOrAfter = (
    ptyId: string,
    absY: number,
    startX: number,
    predicate: (char: string) => boolean
  ) => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState) return null;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    for (let y = absY; y <= maxAbsY; y += 1) {
      const line = getLineCells(ptyId, y) ?? [];
      const limit = line.length;
      let x = y === absY ? clamp(startX, 0, Math.max(0, limit - 1)) : 0;
      for (; x < limit; x += 1) {
        const char = line[x]?.char ?? ' ';
        if (predicate(char)) {
          let start = x;
          let end = x;
          while (start > 0 && predicate(line[start - 1]?.char ?? ' ')) start -= 1;
          while (end < limit - 1 && predicate(line[end + 1]?.char ?? ' ')) end += 1;
          return { absY: y, start, end, line };
        }
      }
    }
    return null;
  };

  const findSpanAtOrBefore = (
    ptyId: string,
    absY: number,
    startX: number,
    predicate: (char: string) => boolean
  ) => {
    const meta = getScrollMeta(ptyId);
    if (!meta.terminalState) return null;
    for (let y = absY; y >= 0; y -= 1) {
      const line = getLineCells(ptyId, y) ?? [];
      const limit = line.length;
      let x = y === absY ? clamp(startX, 0, Math.max(0, limit - 1)) : Math.max(0, limit - 1);
      for (; x >= 0; x -= 1) {
        const char = line[x]?.char ?? ' ';
        if (predicate(char)) {
          let start = x;
          let end = x;
          while (start > 0 && predicate(line[start - 1]?.char ?? ' ')) start -= 1;
          while (end < limit - 1 && predicate(line[end + 1]?.char ?? ' ')) end += 1;
          return { absY: y, start, end, line };
        }
      }
    }
    return null;
  };

  const moveWordForward = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrAfter(current.ptyId, current.cursor.absY, current.cursor.x, isWordChar);
    if (!word) return;

    if (isWordChar(currentChar) && word.absY === current.cursor.absY && current.cursor.x <= word.end) {
      const next = findSpanAtOrAfter(current.ptyId, word.absY, word.end + 1, isWordChar);
      if (next) {
        moveCursorTo({ x: next.start, absY: next.absY });
      }
      return;
    }

    moveCursorTo({ x: word.start, absY: word.absY });
  };

  const moveWordBackward = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrBefore(current.ptyId, current.cursor.absY, current.cursor.x, isWordChar);
    if (!word) return;

    if (isWordChar(currentChar) &&
      word.absY === current.cursor.absY &&
      current.cursor.x === word.start) {
      const prev = findSpanAtOrBefore(current.ptyId, word.absY, word.start - 1, isWordChar);
      if (prev) {
        moveCursorTo({ x: prev.start, absY: prev.absY });
      }
      return;
    }

    moveCursorTo({ x: word.start, absY: word.absY });
  };

  const moveWordEnd = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrAfter(current.ptyId, current.cursor.absY, current.cursor.x, isWordChar);
    if (!word) return;

    if (isWordChar(currentChar) &&
      word.absY === current.cursor.absY &&
      current.cursor.x <= word.end) {
      if (current.cursor.x < word.end) {
        moveCursorTo({ x: word.end, absY: word.absY });
        return;
      }
      const next = findSpanAtOrAfter(current.ptyId, word.absY, word.end + 1, isWordChar);
      if (next) {
        moveCursorTo({ x: next.end, absY: next.absY });
      }
      return;
    }

    moveCursorTo({ x: word.end, absY: word.absY });
  };

  const moveWideWordForward = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrAfter(current.ptyId, current.cursor.absY, current.cursor.x, isWideWordChar);
    if (!word) return;

    if (isWideWordChar(currentChar) && word.absY === current.cursor.absY && current.cursor.x <= word.end) {
      const next = findSpanAtOrAfter(current.ptyId, word.absY, word.end + 1, isWideWordChar);
      if (next) {
        moveCursorTo({ x: next.start, absY: next.absY });
      }
      return;
    }

    moveCursorTo({ x: word.start, absY: word.absY });
  };

  const moveWideWordBackward = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrBefore(current.ptyId, current.cursor.absY, current.cursor.x, isWideWordChar);
    if (!word) return;

    if (isWideWordChar(currentChar) &&
      word.absY === current.cursor.absY &&
      current.cursor.x === word.start) {
      const prev = findSpanAtOrBefore(current.ptyId, word.absY, word.start - 1, isWideWordChar);
      if (prev) {
        moveCursorTo({ x: prev.start, absY: prev.absY });
      }
      return;
    }

    moveCursorTo({ x: word.start, absY: word.absY });
  };

  const moveWideWordEnd = () => {
    const current = state();
    if (!current) return;
    const line = getLineCells(current.ptyId, current.cursor.absY);
    const currentChar = line?.[current.cursor.x]?.char ?? ' ';
    const word = findSpanAtOrAfter(current.ptyId, current.cursor.absY, current.cursor.x, isWideWordChar);
    if (!word) return;

    if (isWideWordChar(currentChar) &&
      word.absY === current.cursor.absY &&
      current.cursor.x <= word.end) {
      if (current.cursor.x < word.end) {
        moveCursorTo({ x: word.end, absY: word.absY });
        return;
      }
      const next = findSpanAtOrAfter(current.ptyId, word.absY, word.end + 1, isWideWordChar);
      if (next) {
        moveCursorTo({ x: next.end, absY: next.absY });
      }
      return;
    }

    moveCursorTo({ x: word.end, absY: word.absY });
  };

  const toggleVisual = (type: CopyVisualType) => {
    const current = state();
    if (!current) return;
    if (current.visualType === type) {
      updateState({ ...current, anchor: null, visualType: null, selectionRange: null, bounds: null });
      return;
    }
    updateState(recomputeSelection({
      ...current,
      anchor: current.cursor,
      visualType: type,
    }));
  };

  const startSelection = (type: CopyVisualType) => {
    const current = state();
    if (!current) return;
    updateState(recomputeSelection({
      ...current,
      anchor: current.cursor,
      visualType: type,
    }));
  };

  const selectWord = (mode: 'inner' | 'around') => {
    const current = state();
    if (!current) return;
    const word = findSpanAtOrAfter(current.ptyId, current.cursor.absY, current.cursor.x, isWordChar);
    if (!word) return;

    let start = word.start;
    let end = word.end;
    if (mode === 'around') {
      let hasTrailingSpace = false;
      for (let x = end + 1; x < word.line.length; x += 1) {
        const char = word.line[x]?.char ?? ' ';
        if (isWhitespaceChar(char)) {
          hasTrailingSpace = true;
          end = x;
        } else {
          break;
        }
      }
      if (!hasTrailingSpace) {
        for (let x = start - 1; x >= 0; x -= 1) {
          const char = word.line[x]?.char ?? ' ';
          if (isWhitespaceChar(char)) {
            start = x;
          } else {
            break;
          }
        }
      }
    }

    const anchor: CopyCursor = { x: start, absY: word.absY };
    const cursor: CopyCursor = { x: end, absY: word.absY };
    const next = recomputeSelection({
      ...current,
      cursor,
      anchor,
      visualType: 'char',
    });
    updateState(next);
    ensureCursorVisible(current.ptyId, cursor);
  };

  const selectLine = () => {
    const current = state();
    if (!current) return;
    updateState(recomputeSelection({
      ...current,
      anchor: current.cursor,
      visualType: 'line',
    }));
  };

  const clearSelection = () => {
    const current = state();
    if (!current) return;
    updateState({ ...current, anchor: null, visualType: null, selectionRange: null, bounds: null });
  };

  const hasSelection = (ptyId: string): boolean => {
    const current = state();
    return !!current && current.ptyId === ptyId && !!current.selectionRange;
  };

  const isCellSelected = (ptyId: string, x: number, absY: number): boolean => {
    const current = state();
    if (!current || current.ptyId !== ptyId || !current.selectionRange || !current.bounds) {
      return false;
    }
    const { bounds } = current;
    if (absY < bounds.minY || absY > bounds.maxY) return false;
    if (absY === bounds.minY && absY === bounds.maxY) {
      if (x < bounds.minX || x > bounds.maxX) return false;
    }
    return isCellInRange(x, absY, current.selectionRange);
  };

  const copySelection = async () => {
    const current = state();
    if (!current) return;
    const meta = getScrollMeta(current.ptyId);
    if (!meta.terminalState) return;
    const scrollbackLength = meta.scrollbackLength ?? 0;

    let range = current.selectionRange;
    if (!range) {
      const line = getLineCells(current.ptyId, current.cursor.absY);
      const cols = meta.cols || (line?.length ?? 1);
      range = {
        startX: 0,
        startY: current.cursor.absY,
        endX: Math.max(1, cols),
        endY: current.cursor.absY,
        focusAtEnd: true,
      };
    }

    const getLine = (absY: number) => getLineCells(current.ptyId, absY);
    const text = extractSelectedText(range, scrollbackLength, getLine);
    if (text.length > 0) {
      await copyToClipboard(text);
      selection.notifyCopy(text.length, current.ptyId);
    }
  };

  const value: CopyModeContextValue = {
    enterCopyMode,
    exitCopyMode,
    isActive,
    getActivePtyId,
    getCursor,
    moveCursorBy,
    moveCursorTo,
    moveToTop,
    moveToBottom,
    moveToLineStart,
    moveToLineEnd,
    moveToLineFirstNonBlank,
    getViewportRows,
    moveWordForward,
    moveWordBackward,
    moveWordEnd,
    moveWideWordForward,
    moveWideWordBackward,
    moveWideWordEnd,
    toggleVisual,
    startSelection,
    selectWord,
    selectLine,
    copySelection,
    clearSelection,
    isCellSelected,
    hasSelection,
    get copyModeVersion() { return copyModeVersion(); },
  };

  return (
    <CopyModeContext.Provider value={value}>
      {props.children}
    </CopyModeContext.Provider>
  );
}

export function useCopyMode(): CopyModeContextValue {
  const context = useContext(CopyModeContext);
  if (!context) {
    throw new Error('useCopyMode must be used within CopyModeProvider');
  }
  return context;
}
