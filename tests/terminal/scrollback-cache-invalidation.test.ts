/**
 * Tests for scrollback cache invalidation in WorkerEmulator
 *
 * These tests verify that the scrollback cache is properly cleared when:
 * 1. Content shifts (scrollback at limit, old lines evicted) - detected by scrollbackDelta <= 0
 * 2. Scrollback shrinks (reset scenario)
 *
 * The cache is NOT cleared when scrollback simply grows, as existing cached
 * lines remain valid at their absolute offsets. This prevents flicker when
 * the user is scrolled back viewing history while new content arrives.
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

  describe('smart cache invalidation (only on content shift)', () => {
    it('should NOT clear cache when scrollback grows (offsets remain valid)', () => {
      // Simulate the smart cache invalidation logic from WorkerEmulator.handleUpdate()
      // When scrollback grows, existing cached lines at their absolute offsets are still valid
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 0;

      // Populate cache with some entries
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);
      scrollbackCache.set(2, [createTestCell('C')]);

      expect(scrollbackCache.size).toBe(3);

      // Simulate update with new scrollback length (growth)
      const update = createDirtyUpdate(10);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache should be PRESERVED - scrollback grew, offsets still valid
      expect(scrollbackCache.size).toBe(3);
      expect(lastScrollbackLength).toBe(10);
    });

    it('should clear cache when at scrollback limit (content shifts, delta = 0)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 10000; // At limit

      // Populate cache - these entries will become stale when content shifts
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);

      expect(scrollbackCache.size).toBe(2);

      // Simulate update with same scrollback length (at limit, old lines evicted)
      const update = createDirtyUpdate(10000);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache should be cleared - content shifted, offsets now point to different lines
      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(10000);
    });

    it('should clear cache when scrollback decreases (reset scenario)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      // Populate cache
      scrollbackCache.set(50, [createTestCell('X')]);
      scrollbackCache.set(75, [createTestCell('Y')]);

      // Simulate reset - scrollback drops to 0
      const update = createDirtyUpdate(0);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(0);
    });
  });

  describe('cache preservation when scrolled back', () => {
    it('should preserve cache when scrolled back and new content arrives', () => {
      // When user is scrolled back viewing history, cache should be preserved
      // as new content is added (scrollback grows)
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      // Populate cache with valid entries
      scrollbackCache.set(25, [createTestCell('X')]);
      scrollbackCache.set(50, [createTestCell('Y')]);

      expect(scrollbackCache.size).toBe(2);

      // New update with increased scrollback (scrollback grew, user scrolled back)
      const update = createDirtyUpdate(150);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache preserved - scrollback grew, offsets still valid
      expect(scrollbackCache.size).toBe(2);
      expect(lastScrollbackLength).toBe(150);
    });

    it('should handle 10k line edge case where length unchanged but content shifted', () => {
      // This simulates the edge case where scrollback is at limit
      // New lines are added, old lines evicted, but length stays at 10000
      // The smart invalidation detects this via scrollbackDelta = 0
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 10000;

      // Cache contains entries that are now stale (content shifted)
      scrollbackCache.set(0, [createTestCell('OLD_LINE_0')]);
      scrollbackCache.set(100, [createTestCell('OLD_LINE_100')]);

      expect(scrollbackCache.size).toBe(2);

      const update = createDirtyUpdate(10000); // Length unchanged (at limit)
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      // scrollbackDelta = 0, lastScrollbackLength > 0, so contentShifted = true
      expect(scrollbackDelta).toBe(0);
      expect(contentShifted).toBe(true);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache cleared - content shifted, offsets now invalid
      expect(scrollbackCache.size).toBe(0);
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
