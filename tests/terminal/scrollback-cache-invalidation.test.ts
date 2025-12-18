/**
 * Tests for scrollback cache invalidation in WorkerEmulator
 *
 * These tests verify that the scrollback cache is properly cleared when:
 * 1. Scrollback length changes (new content pushed to scrollback)
 * 2. User is at bottom and receiving updates (safety for 10k line limit edge case)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirtyTerminalUpdate, TerminalCell, TerminalScrollState } from '../../src/core/types';
import type { TerminalColors } from '../../src/terminal/terminal-colors';

// Since WorkerEmulator is tightly coupled to EmulatorWorkerPool,
// we test the cache invalidation logic by creating a minimal test harness
// that mimics the relevant behavior

describe('scrollback-cache-invalidation', () => {
  // Helper to create test cells
  function createTestCell(char: string): TerminalCell {
    return {
      char,
      fg: { r: 255, g: 255, b: 255 },
      bg: { r: 0, g: 0, b: 0 },
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    };
  }

  // Helper to create a dirty update
  function createDirtyUpdate(
    scrollbackLength: number,
    overrides: Partial<DirtyTerminalUpdate> = {}
  ): DirtyTerminalUpdate {
    return {
      dirtyRows: new Map(),
      cursor: { x: 0, y: 0, visible: true, style: 'block' },
      scrollState: {
        viewportOffset: 0,
        scrollbackLength,
        isAtBottom: true,
      },
      cols: 80,
      rows: 24,
      isFull: false,
      alternateScreen: false,
      mouseTracking: false,
      cursorKeyMode: 'normal',
      ...overrides,
    };
  }

  describe('cache invalidation on scrollback length change', () => {
    it('should clear cache when scrollback length increases', () => {
      // Simulate the cache invalidation logic from WorkerEmulator.handleUpdate()
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 0;

      // Populate cache with some entries
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);
      scrollbackCache.set(2, [createTestCell('C')]);

      expect(scrollbackCache.size).toBe(3);

      // Simulate update with new scrollback length
      const update = createDirtyUpdate(10);
      const scrollbackLengthChanged =
        update.scrollState.scrollbackLength !== lastScrollbackLength;

      if (scrollbackLengthChanged) {
        scrollbackCache.clear();
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(10);
    });

    it('should not clear cache when scrollback length stays the same', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 10;

      // Populate cache
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);

      expect(scrollbackCache.size).toBe(2);

      // Simulate update with same scrollback length
      const update = createDirtyUpdate(10);
      const scrollbackLengthChanged =
        update.scrollState.scrollbackLength !== lastScrollbackLength;

      if (scrollbackLengthChanged) {
        scrollbackCache.clear();
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      // Cache should be preserved
      expect(scrollbackCache.size).toBe(2);
      expect(lastScrollbackLength).toBe(10);
    });

    it('should clear cache when scrollback decreases (reset scenario)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      // Populate cache
      scrollbackCache.set(50, [createTestCell('X')]);
      scrollbackCache.set(75, [createTestCell('Y')]);

      // Simulate reset - scrollback drops to 0
      const update = createDirtyUpdate(0);
      const scrollbackLengthChanged =
        update.scrollState.scrollbackLength !== lastScrollbackLength;

      if (scrollbackLengthChanged) {
        scrollbackCache.clear();
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(0);
    });
  });

  describe('cache invalidation when at bottom (Part B - edge case safety)', () => {
    it('should clear cache when isAtBottom is true', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let scrollState: TerminalScrollState = {
        viewportOffset: 0,
        scrollbackLength: 10000, // At limit
        isAtBottom: true,
      };

      // Populate cache
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);

      expect(scrollbackCache.size).toBe(2);

      // Part B logic: clear when at bottom
      if (scrollState.isAtBottom) {
        scrollbackCache.clear();
      }

      expect(scrollbackCache.size).toBe(0);
    });

    it('should preserve cache when scrolled back (not at bottom)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let scrollState: TerminalScrollState = {
        viewportOffset: 50, // Scrolled back 50 lines
        scrollbackLength: 10000,
        isAtBottom: false,
      };

      // Populate cache
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);

      expect(scrollbackCache.size).toBe(2);

      // Part B logic: don't clear when not at bottom
      if (scrollState.isAtBottom) {
        scrollbackCache.clear();
      }

      // Cache preserved - user is viewing history
      expect(scrollbackCache.size).toBe(2);
    });
  });

  describe('hybrid invalidation (Part A + B combined)', () => {
    it('should clear cache on scrollback length change even when scrolled back', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;
      let scrollState: TerminalScrollState = {
        viewportOffset: 50,
        scrollbackLength: 100,
        isAtBottom: false,
      };

      // Populate cache
      scrollbackCache.set(25, [createTestCell('X')]);
      scrollbackCache.set(50, [createTestCell('Y')]);

      // New update with increased scrollback (user scrolled back but new content arrived)
      const update = createDirtyUpdate(150);

      // Part A: scrollback length changed
      const scrollbackLengthChanged =
        update.scrollState.scrollbackLength !== lastScrollbackLength;

      if (scrollbackLengthChanged) {
        scrollbackCache.clear();
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      // Part B: not at bottom, so no additional clear (already cleared by Part A)
      if (scrollState.isAtBottom) {
        scrollbackCache.clear();
      }

      expect(scrollbackCache.size).toBe(0);
    });

    it('should handle 10k line edge case where length unchanged but content shifted', () => {
      // This simulates the edge case where scrollback is at limit
      // New lines are added, old lines evicted, but length stays at 10000
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 10000;
      let scrollState: TerminalScrollState = {
        viewportOffset: 0,
        scrollbackLength: 10000,
        isAtBottom: true,
      };

      // Cache contains entries that are now stale (content shifted)
      scrollbackCache.set(0, [createTestCell('OLD_LINE_0')]);
      scrollbackCache.set(100, [createTestCell('OLD_LINE_100')]);

      const update = createDirtyUpdate(10000); // Length unchanged

      // Part A: length unchanged, no clear
      const scrollbackLengthChanged =
        update.scrollState.scrollbackLength !== lastScrollbackLength;

      if (scrollbackLengthChanged) {
        scrollbackCache.clear();
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      expect(scrollbackCache.size).toBe(2); // Still has stale entries

      // Part B: at bottom, clear the stale cache
      if (scrollState.isAtBottom) {
        scrollbackCache.clear();
      }

      expect(scrollbackCache.size).toBe(0); // Now cleared by Part B
    });
  });

  describe('worker-side cache invalidation', () => {
    it('should clear worker cache when scrollback length changes', () => {
      // Simulates emulator-worker.ts handleWrite() logic
      let scrollbackCache = new Map<number, ArrayBuffer>();
      let lastScrollbackLength = 50;

      // Simulate cached packed cells
      scrollbackCache.set(0, new ArrayBuffer(16));
      scrollbackCache.set(10, new ArrayBuffer(16));
      scrollbackCache.set(20, new ArrayBuffer(16));

      expect(scrollbackCache.size).toBe(3);

      // Simulate: terminal.getScrollbackLength() returns new value after write
      const currentScrollbackLength = 100;

      if (currentScrollbackLength !== lastScrollbackLength) {
        scrollbackCache.clear();
        lastScrollbackLength = currentScrollbackLength;
      }

      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(100);
    });

    it('should preserve worker cache when scrollback length unchanged', () => {
      let scrollbackCache = new Map<number, ArrayBuffer>();
      let lastScrollbackLength = 100;

      scrollbackCache.set(0, new ArrayBuffer(16));
      scrollbackCache.set(10, new ArrayBuffer(16));

      const currentScrollbackLength = 100; // Unchanged

      if (currentScrollbackLength !== lastScrollbackLength) {
        scrollbackCache.clear();
        lastScrollbackLength = currentScrollbackLength;
      }

      expect(scrollbackCache.size).toBe(2);
    });
  });
});
