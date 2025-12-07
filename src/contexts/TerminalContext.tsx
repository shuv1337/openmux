/**
 * Terminal context for managing PTY sessions and keyboard forwarding
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { initGhostty, isGhosttyInitialized, ptyManager, inputHandler, detectHostCapabilities } from '../terminal';
import type { TerminalScrollState } from '../core/types';
import { useLayout } from './LayoutContext';
import { readFromClipboard } from '../utils/clipboard';

interface TerminalContextValue {
  /** Create a new PTY session for a pane */
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => string;
  /** Destroy a PTY session */
  destroyPTY: (ptyId: string) => void;
  /** Destroy all PTY sessions */
  destroyAllPTYs: () => void;
  /** Write input to the focused pane's PTY */
  writeToFocused: (data: string) => void;
  /** Write input to a specific PTY */
  writeToPTY: (ptyId: string, data: string) => void;
  /** Paste from clipboard to the focused pane's PTY */
  pasteToFocused: () => Promise<boolean>;
  /** Resize a PTY session */
  resizePTY: (ptyId: string, cols: number, rows: number) => void;
  /** Update pane position for graphics passthrough */
  setPanePosition: (ptyId: string, x: number, y: number) => void;
  /** Get the current working directory of the focused pane */
  getFocusedCwd: () => Promise<string | null>;
  /** Get the CWD for a specific PTY session */
  getSessionCwd: (ptyId: string) => Promise<string>;
  /** Get the cursor key mode (DECCKM) from the focused pane */
  getFocusedCursorKeyMode: () => 'normal' | 'application';
  /** Check if mouse tracking is enabled for a PTY */
  isMouseTrackingEnabled: (ptyId: string) => boolean;
  /** Check if terminal is in alternate screen mode (vim, htop, etc.) */
  isAlternateScreen: (ptyId: string) => boolean;
  /** Get scroll state for a PTY */
  getScrollState: (ptyId: string) => TerminalScrollState | undefined;
  /** Scroll terminal by delta lines (positive = scroll up into history) */
  scrollTerminal: (ptyId: string, delta: number) => void;
  /** Set absolute scroll offset for a PTY */
  setScrollOffset: (ptyId: string, offset: number) => void;
  /** Scroll terminal to bottom (live content) */
  scrollToBottom: (ptyId: string) => void;
  /** Check if ghostty is initialized */
  isInitialized: boolean;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

interface TerminalProviderProps {
  children: ReactNode;
}

let ptyIdCounter = 0;
function generatePtyId(): string {
  return `pty-${++ptyIdCounter}`;
}

export function TerminalProvider({ children }: TerminalProviderProps) {
  const { activeWorkspace, dispatch } = useLayout();
  const initializedRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize ghostty and detect host terminal capabilities on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Detect host capabilities first (for graphics passthrough)
    detectHostCapabilities()
      .then(() => initGhostty())
      .then(() => {
        setIsInitialized(true);
      })
      .catch((err) => {
        console.error('Failed to initialize terminal:', err);
      });
  }, []);

  // Track ptyId -> paneId mapping for exit handling
  const ptyToPaneMap = useRef<Map<string, string>>(new Map());

  // Create a PTY session
  const createPTY = useCallback((paneId: string, cols: number, rows: number, cwd?: string): string => {
    if (!isGhosttyInitialized()) {
      throw new Error('Ghostty not initialized');
    }

    const ptyId = generatePtyId();
    ptyManager.createSession(ptyId, { cols, rows, cwd });

    // Track the mapping
    ptyToPaneMap.current.set(ptyId, paneId);

    // Register exit callback to close pane when shell exits
    ptyManager.onExit(ptyId, () => {
      const mappedPaneId = ptyToPaneMap.current.get(ptyId);
      if (mappedPaneId) {
        dispatch({ type: 'CLOSE_PANE_BY_ID', paneId: mappedPaneId });
        ptyToPaneMap.current.delete(ptyId);
      }
    });

    // Update the pane with the PTY ID
    dispatch({ type: 'SET_PANE_PTY', paneId, ptyId });

    return ptyId;
  }, [dispatch]);

  // Destroy a PTY session
  const destroyPTY = useCallback((ptyId: string) => {
    ptyManager.destroySession(ptyId);
    ptyToPaneMap.current.delete(ptyId);
  }, []);

  // Destroy all PTY sessions
  const destroyAllPTYs = useCallback(() => {
    ptyManager.destroyAll();
    ptyToPaneMap.current.clear();
  }, []);

  // Get CWD for a specific PTY session
  const getSessionCwd = useCallback(async (ptyId: string): Promise<string> => {
    const cwd = await ptyManager.getSessionCwd(ptyId);
    return cwd ?? process.cwd();
  }, []);

  // Write to the focused pane's PTY
  const writeToFocused = useCallback((data: string) => {
    const focusedPaneId = activeWorkspace.focusedPaneId;
    if (!focusedPaneId) return;

    // Find the focused pane
    let focusedPtyId: string | undefined;

    if (activeWorkspace.mainPane?.id === focusedPaneId) {
      focusedPtyId = activeWorkspace.mainPane.ptyId;
    } else {
      const stackPane = activeWorkspace.stackPanes.find(p => p.id === focusedPaneId);
      focusedPtyId = stackPane?.ptyId;
    }

    if (focusedPtyId) {
      ptyManager.write(focusedPtyId, data);
    }
  }, [activeWorkspace]);

  // Resize a PTY session
  const resizePTY = useCallback((ptyId: string, cols: number, rows: number) => {
    ptyManager.resize(ptyId, cols, rows);
  }, []);

  // Update pane position for graphics passthrough
  const setPanePosition = useCallback((ptyId: string, x: number, y: number) => {
    ptyManager.setPanePosition(ptyId, x, y);
  }, []);

  // Write to a specific PTY
  const writeToPTY = useCallback((ptyId: string, data: string) => {
    ptyManager.write(ptyId, data);
  }, []);

  // Get the current working directory of the focused pane
  const getFocusedCwd = useCallback(async (): Promise<string | null> => {
    const focusedPaneId = activeWorkspace.focusedPaneId;
    if (!focusedPaneId) return null;

    // Find the focused pane's PTY ID
    let focusedPtyId: string | undefined;
    if (activeWorkspace.mainPane?.id === focusedPaneId) {
      focusedPtyId = activeWorkspace.mainPane.ptyId;
    } else {
      const stackPane = activeWorkspace.stackPanes.find(p => p.id === focusedPaneId);
      focusedPtyId = stackPane?.ptyId;
    }

    if (!focusedPtyId) return null;

    return ptyManager.getSessionCwd(focusedPtyId);
  }, [activeWorkspace]);

  // Paste from clipboard to the focused PTY
  const pasteToFocused = useCallback(async (): Promise<boolean> => {
    const focusedPaneId = activeWorkspace.focusedPaneId;
    if (!focusedPaneId) return false;

    // Find the focused pane's PTY
    let focusedPtyId: string | undefined;

    if (activeWorkspace.mainPane?.id === focusedPaneId) {
      focusedPtyId = activeWorkspace.mainPane.ptyId;
    } else {
      const stackPane = activeWorkspace.stackPanes.find(p => p.id === focusedPaneId);
      focusedPtyId = stackPane?.ptyId;
    }

    if (!focusedPtyId) return false;

    // Read from clipboard
    const clipboardText = await readFromClipboard();
    if (!clipboardText) return false;

    // Write to PTY
    ptyManager.write(focusedPtyId, clipboardText);
    return true;
  }, [activeWorkspace]);

  // Get the cursor key mode from the focused pane
  const getFocusedCursorKeyMode = useCallback((): 'normal' | 'application' => {
    const focusedPaneId = activeWorkspace.focusedPaneId;
    if (!focusedPaneId) return 'normal';

    // Find the focused pane's PTY ID
    let focusedPtyId: string | undefined;
    if (activeWorkspace.mainPane?.id === focusedPaneId) {
      focusedPtyId = activeWorkspace.mainPane.ptyId;
    } else {
      const stackPane = activeWorkspace.stackPanes.find(p => p.id === focusedPaneId);
      focusedPtyId = stackPane?.ptyId;
    }

    if (!focusedPtyId) return 'normal';

    // Get terminal state which includes cursor key mode
    const terminalState = ptyManager.getTerminalState(focusedPtyId);
    return terminalState?.cursorKeyMode ?? 'normal';
  }, [activeWorkspace]);

  // Check if mouse tracking is enabled for a PTY
  // This is used to determine if mouse events should be forwarded to the child process
  const isMouseTrackingEnabled = useCallback((ptyId: string): boolean => {
    const terminalState = ptyManager.getTerminalState(ptyId);
    return terminalState?.mouseTracking ?? false;
  }, []);

  // Check if terminal is in alternate screen mode (vim, htop, etc.)
  const isAlternateScreen = useCallback((ptyId: string): boolean => {
    const terminalState = ptyManager.getTerminalState(ptyId);
    return terminalState?.alternateScreen ?? false;
  }, []);

  // Get scroll state for a PTY
  const getScrollState = useCallback((ptyId: string): TerminalScrollState | undefined => {
    return ptyManager.getScrollState(ptyId);
  }, []);

  // Scroll terminal by delta lines (positive = scroll up into history)
  const scrollTerminal = useCallback((ptyId: string, delta: number): void => {
    const state = ptyManager.getScrollState(ptyId);
    if (state) {
      const newOffset = state.viewportOffset + delta;
      ptyManager.setScrollOffset(ptyId, newOffset);
    }
  }, []);

  // Set absolute scroll offset
  const setScrollOffset = useCallback((ptyId: string, offset: number): void => {
    ptyManager.setScrollOffset(ptyId, offset);
  }, []);

  // Scroll terminal to bottom (live content)
  const scrollToBottom = useCallback((ptyId: string): void => {
    ptyManager.scrollToBottom(ptyId);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ptyManager.destroyAll();
    };
  }, []);

  const value: TerminalContextValue = {
    createPTY,
    destroyPTY,
    destroyAllPTYs,
    writeToFocused,
    writeToPTY,
    pasteToFocused,
    resizePTY,
    setPanePosition,
    getFocusedCwd,
    getSessionCwd,
    getFocusedCursorKeyMode,
    isMouseTrackingEnabled,
    isAlternateScreen,
    getScrollState,
    scrollTerminal,
    setScrollOffset,
    scrollToBottom,
    isInitialized,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within TerminalProvider');
  }
  return context;
}
