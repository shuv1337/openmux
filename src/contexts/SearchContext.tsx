/**
 * SearchContext - manages terminal search state
 *
 * Provides vim-style search functionality with:
 * - Case-insensitive substring search
 * - Match highlighting (all matches + current match)
 * - Navigation between matches with auto-scroll
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getEmulator, getTerminalState, getScrollState } from '../effect/bridge';
import { useTerminal } from './TerminalContext';

// Import extracted search utilities
import type { SearchState, SearchContextValue } from './search/types';
import {
  performSearch,
  isCellInMatch,
  calculateScrollOffset,
  buildMatchLookup,
} from './search/helpers';

// =============================================================================
// Context
// =============================================================================

const SearchContext = createContext<SearchContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SearchProviderProps {
  children: ReactNode;
}

// Search debounce delay in ms
const SEARCH_DEBOUNCE_MS = 150;

export function SearchProvider({ children }: SearchProviderProps) {
  // Get setScrollOffset from TerminalContext (updates cache for immediate rendering)
  const { setScrollOffset } = useTerminal();

  // Store search state - use state so context consumers get updates
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  // Also keep a ref for synchronous access in render callbacks (isSearchMatch/isCurrentMatch)
  const searchStateRef = useRef<SearchState | null>(null);

  // Version counter to trigger re-renders when search state changes
  const [searchVersion, setSearchVersion] = useState(0);

  // Debounce timer for search
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending query for debounced search
  const pendingQueryRef = useRef<string>('');

  // Spatial index for O(1) match lookup by line
  // Map<lineIndex, Array<{startCol, endCol}>>
  const matchLookupRef = useRef<Map<number, Array<{ startCol: number; endCol: number }>>>(new Map());

  // Update both state and ref, and rebuild spatial index
  const updateSearchState = useCallback((newState: SearchState | null) => {
    searchStateRef.current = newState;
    setSearchState(newState);
    setSearchVersion((v) => v + 1);

    // Rebuild spatial index for fast lookup using extracted helper
    matchLookupRef.current = newState?.matches
      ? buildMatchLookup(newState.matches)
      : new Map();
  }, []);

  // Enter search mode
  const enterSearchMode = useCallback(async (ptyId: string) => {
    // Get emulator and terminal state
    const emulator = await getEmulator(ptyId);
    const terminalState = await getTerminalState(ptyId);
    const scrollState = await getScrollState(ptyId);

    if (!emulator || !terminalState) {
      return;
    }

    updateSearchState({
      query: '',
      matches: [],
      currentMatchIndex: -1,
      ptyId,
      emulator,
      terminalState,
      scrollbackLength: emulator.getScrollbackLength(),
      originalScrollOffset: scrollState?.viewportOffset ?? 0,
    });
  }, [updateSearchState]);

  // Exit search mode
  const exitSearchMode = useCallback((restorePosition = false) => {
    const state = searchStateRef.current;
    if (!state) return;

    // Clear any pending debounced search
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    // Restore original scroll position if requested (on Escape)
    if (restorePosition && state.originalScrollOffset !== undefined) {
      setScrollOffset(state.ptyId, state.originalScrollOffset);
    }

    updateSearchState(null);
  }, [updateSearchState, setScrollOffset]);

  // Update search query (debounced)
  const setSearchQuery = useCallback((query: string) => {
    const state = searchStateRef.current;
    if (!state || !state.emulator || !state.terminalState) return;

    pendingQueryRef.current = query;

    // Clear existing debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // Update query immediately for display (show typing instantly)
    updateSearchState({
      ...state,
      query,
      // Keep previous matches while debouncing (reduces flicker)
    });

    // Debounce the actual search
    searchDebounceRef.current = setTimeout(() => {
      const currentState = searchStateRef.current;
      if (!currentState || !currentState.emulator || !currentState.terminalState) return;
      if (pendingQueryRef.current !== query) return; // Query changed, skip

      // Perform search
      const matches = performSearch(query, currentState.emulator, currentState.terminalState);

      // Start at the most recent match (last in array = closest to bottom of terminal)
      const initialIndex = matches.length > 0 ? matches.length - 1 : -1;

      // Update state with matches
      updateSearchState({
        ...currentState,
        query,
        matches,
        currentMatchIndex: initialIndex,
      });

      // Auto-scroll to the initial match (most recent)
      if (matches.length > 0) {
        const match = matches[initialIndex];
        const offset = calculateScrollOffset(
          match.lineIndex,
          currentState.scrollbackLength,
          currentState.terminalState.rows
        );
        setScrollOffset(currentState.ptyId, offset);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, [updateSearchState, setScrollOffset]);

  // Navigate to next match
  const nextMatch = useCallback(() => {
    const state = searchStateRef.current;
    if (!state || state.matches.length === 0 || !state.terminalState) return;

    const newIndex = (state.currentMatchIndex + 1) % state.matches.length;
    const match = state.matches[newIndex];

    updateSearchState({
      ...state,
      currentMatchIndex: newIndex,
    });

    // Scroll to show match
    const offset = calculateScrollOffset(
      match.lineIndex,
      state.scrollbackLength,
      state.terminalState.rows
    );
    setScrollOffset(state.ptyId, offset);
  }, [updateSearchState]);

  // Navigate to previous match
  const prevMatch = useCallback(() => {
    const state = searchStateRef.current;
    if (!state || state.matches.length === 0 || !state.terminalState) return;

    const newIndex = state.currentMatchIndex <= 0
      ? state.matches.length - 1
      : state.currentMatchIndex - 1;
    const match = state.matches[newIndex];

    updateSearchState({
      ...state,
      currentMatchIndex: newIndex,
    });

    // Scroll to show match
    const offset = calculateScrollOffset(
      match.lineIndex,
      state.scrollbackLength,
      state.terminalState.rows
    );
    setScrollOffset(state.ptyId, offset);
  }, [updateSearchState]);

  // Check if cell is any search match (optimized with spatial index)
  const isSearchMatch = useCallback(
    (ptyId: string, x: number, absoluteY: number): boolean => {
      const state = searchStateRef.current;
      if (!state || state.ptyId !== ptyId) {
        return false;
      }

      // O(1) lookup by line using spatial index
      const lineMatches = matchLookupRef.current.get(absoluteY);
      if (!lineMatches) return false;

      // Check matches on this line (usually very few per line)
      for (const { startCol, endCol } of lineMatches) {
        if (x >= startCol && x < endCol) return true;
      }
      return false;
    },
    []
  );

  // Check if cell is the current match
  const isCurrentMatch = useCallback(
    (ptyId: string, x: number, absoluteY: number): boolean => {
      const state = searchStateRef.current;
      if (
        !state ||
        state.ptyId !== ptyId ||
        state.currentMatchIndex < 0 ||
        state.currentMatchIndex >= state.matches.length
      ) {
        return false;
      }

      const currentMatch = state.matches[state.currentMatchIndex];
      return isCellInMatch(x, absoluteY, currentMatch);
    },
    []
  );

  const value: SearchContextValue = {
    searchState,
    enterSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    isSearchMatch,
    isCurrentMatch,
    searchVersion,
  };

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useSearch(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
