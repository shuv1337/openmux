/**
 * Interactive terminal preview component for aggregate view
 * Renders terminal using direct buffer access for performance
 * Uses the same approach as the main TerminalView (renderAfter callback)
 */

import { useCallback, useEffect, useState, useRef } from 'react';
import { type OptimizedBuffer } from '@opentui/core';
import { resizePty, subscribeUnifiedToPty } from '../../effect/bridge';
import {
  WHITE,
  BLACK,
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
} from '../../terminal/rendering';
import type { TerminalState, TerminalCell, UnifiedTerminalUpdate } from '../../core/types';

interface InteractivePreviewProps {
  ptyId: string | null;
  width: number;
  height: number;
  isInteractive: boolean;
  offsetX?: number;
  offsetY?: number;
}

export function InteractivePreview({
  ptyId,
  width,
  height,
  isInteractive,
  offsetX = 0,
  offsetY = 0,
}: InteractivePreviewProps) {
  const lastResizeRef = useRef<{ ptyId: string; width: number; height: number } | null>(null);
  const terminalStateRef = useRef<TerminalState | null>(null);
  const renderRequestedRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const [version, setVersion] = useState(0);

  // Resize PTY when previewing to match preview dimensions
  useEffect(() => {
    if (!ptyId) return;

    // Only resize if dimensions actually changed
    const lastResize = lastResizeRef.current;
    if (lastResize && lastResize.ptyId === ptyId && lastResize.width === width && lastResize.height === height) {
      return;
    }

    // Resize the PTY to match the preview dimensions
    // When aggregate view closes, App.tsx will restore the original pane dimensions
    resizePty(ptyId, width, height);
    lastResizeRef.current = { ptyId, width, height };
  }, [ptyId, width, height]);

  // Subscribe to terminal updates
  useEffect(() => {
    // Clean up previous subscription first
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!ptyId) {
      terminalStateRef.current = null;
      setVersion(v => v + 1);
      return;
    }

    let mounted = true;
    let cachedRows: TerminalCell[][] = [];

    // Batched render request
    const requestRender = () => {
      if (!renderRequestedRef.current && mounted) {
        renderRequestedRef.current = true;
        queueMicrotask(() => {
          if (mounted) {
            renderRequestedRef.current = false;
            setVersion(v => v + 1);
          }
        });
      }
    };

    const init = async () => {
      const unsub = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
        if (!mounted) return;

        const { terminalUpdate } = update;

        if (terminalUpdate.isFull && terminalUpdate.fullState) {
          terminalStateRef.current = terminalUpdate.fullState;
          cachedRows = [...terminalUpdate.fullState.cells];
        } else {
          const existingState = terminalStateRef.current;
          if (existingState) {
            for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
              cachedRows[rowIdx] = newRow;
            }
            terminalStateRef.current = {
              ...existingState,
              cells: cachedRows,
              cursor: terminalUpdate.cursor,
              alternateScreen: terminalUpdate.alternateScreen,
              mouseTracking: terminalUpdate.mouseTracking,
              cursorKeyMode: terminalUpdate.cursorKeyMode,
            };
          }
        }

        requestRender();
      });

      if (mounted) {
        unsubscribeRef.current = unsub;
      } else {
        unsub();
      }

      if (mounted) {
        requestRender();
      }
    };

    init();

    return () => {
      mounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      terminalStateRef.current = null;
      cachedRows = [];
    };
  }, [ptyId]);

  // Direct buffer render callback (same approach as TerminalView)
  const renderTerminal = useCallback((buffer: OptimizedBuffer) => {
    const state = terminalStateRef.current;
    if (!state) {
      // Clear buffer when no state
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, BLACK, 0);
        }
      }
      return;
    }

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    const cursor = state.cursor;

    // Get fallback colors from top-left cell
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);

    for (let y = 0; y < rows; y++) {
      const row = state.cells[y];

      for (let x = 0; x < cols; x++) {
        const cell = row?.[x];

        if (!cell) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, fallbackBg, 0);
          continue;
        }

        // Check cursor position (show cursor in interactive mode)
        const isCursor = isInteractive && cursor.visible && cursor.y === y && cursor.x === x;

        let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b;
        let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b;

        // Apply dim
        if (cell.dim) {
          fgR = Math.floor(fgR * 0.5);
          fgG = Math.floor(fgG * 0.5);
          fgB = Math.floor(fgB * 0.5);
        }

        // Apply inverse
        if (cell.inverse) {
          const tmpR = fgR; fgR = bgR; bgR = tmpR;
          const tmpG = fgG; fgG = bgG; bgG = tmpG;
          const tmpB = fgB; fgB = bgB; bgB = tmpB;
        }

        let fg = getCachedRGBA(fgR, fgG, fgB);
        let bg = getCachedRGBA(bgR, bgG, bgB);

        // Cursor styling
        if (isCursor) {
          fg = bg ?? BLACK;
          bg = WHITE;
        }

        // Calculate attributes
        let attributes = 0;
        if (cell.bold) attributes |= ATTR_BOLD;
        if (cell.italic) attributes |= ATTR_ITALIC;
        if (cell.underline) attributes |= ATTR_UNDERLINE;
        if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;

        buffer.setCell(x + offsetX, y + offsetY, cell.char || ' ', fg, bg, attributes);
      }
    }

    // Fill unused area
    if (cols < width || rows < height) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < rows && x < cols) continue;
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, fallbackBg, 0);
        }
      }
    }
  }, [width, height, isInteractive, offsetX, offsetY]);

  if (!ptyId) {
    return (
      <box style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <text fg="#666666">No terminal selected</text>
      </box>
    );
  }

  if (!terminalStateRef.current) {
    return (
      <box style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <text fg="#666666">Loading...</text>
      </box>
    );
  }

  return (
    <box style={{ width, height }} renderAfter={renderTerminal} />
  );
}
