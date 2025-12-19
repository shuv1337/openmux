/**
 * Layout context for workspace and master-stack layout management
 */

import {
  createContext,
  useContext,
  createMemo,
  batch,
  type ParentProps,
} from 'solid-js';
import { createStore, unwrap, reconcile } from 'solid-js/store';
import type { Workspace, WorkspaceId, PaneData, Direction, LayoutMode } from '../core/types';
import { LayoutConfig, DEFAULT_CONFIG } from '../core/config';
import {
  getAllWorkspacePanes,
  getWorkspacePaneCount,
} from '../core/operations/master-stack-layout';
import {
  layoutReducer,
  getActiveWorkspace,
  type LayoutState,
  type LayoutAction,
  type Workspaces,
} from '../core/operations/layout-actions';

// =============================================================================
// Context Value Interface
// =============================================================================

interface LayoutContextValue {
  state: LayoutState;
  activeWorkspace: Workspace;
  paneCount: number;
  panes: PaneData[];
  populatedWorkspaces: WorkspaceId[];
  /** Version counter that increments on save-worthy layout changes */
  layoutVersion: number;
  // Actions
  focusPane: (paneId: string) => void;
  navigate: (direction: Direction) => void;
  newPane: (title?: string) => void;
  closePane: () => void;
  closePaneById: (paneId: string) => void;
  setViewport: (viewport: { x: number; y: number; width: number; height: number }) => void;
  switchWorkspace: (workspaceId: WorkspaceId) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setPanePty: (paneId: string, ptyId: string) => void;
  setPaneTitle: (paneId: string, title: string) => void;
  swapMain: () => void;
  toggleZoom: () => void;
  loadSession: (params: { workspaces: Workspaces; activeWorkspaceId: WorkspaceId }) => void;
  clearAll: () => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface LayoutProviderProps extends ParentProps {
  config?: Partial<LayoutConfig>;
}

export function LayoutProvider(props: LayoutProviderProps) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...props.config };

  const initialState: LayoutState = {
    workspaces: {},
    activeWorkspaceId: 1,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: mergedConfig,
    layoutVersion: 0,
  };

  // We use createStore but apply the existing reducer for state transitions
  // This preserves the well-tested reducer logic
  const [state, setState] = createStore<LayoutState>(initialState);

  // Debug timing flag - set to true to see layout timing
  const DEBUG_LAYOUT_TIMING = false;

  // Apply state update using batch to group all updates into a single render cycle
  const applyState = (newState: LayoutState) => {
    const start = DEBUG_LAYOUT_TIMING ? performance.now() : 0;

    // Batch all updates into a single render cycle
    batch(() => {
      // Use reconcile with merge:true for workspaces to preserve object references
      // where possible - this minimizes re-renders when only some properties change
      setState('workspaces', reconcile(newState.workspaces, { merge: true }));
      setState('activeWorkspaceId', newState.activeWorkspaceId);
      setState('viewport', newState.viewport);
      setState('config', newState.config);
      setState('layoutVersion', newState.layoutVersion);
    });

    if (DEBUG_LAYOUT_TIMING) {
      const elapsed = performance.now() - start;
      if (elapsed > 1) {
        console.log(`[LAYOUT] setState took ${elapsed.toFixed(2)}ms`);
      }
    }
  };

  // Queue for batching rapid actions (like spam creating panes)
  let pendingActions: LayoutAction[] = [];
  let flushScheduled = false;

  // Flush pending actions in a batch
  const flushActions = () => {
    if (pendingActions.length === 0) return;

    const actions = pendingActions;
    pendingActions = [];
    flushScheduled = false;

    // Apply all actions to get final state
    let currentState = unwrap(state);
    for (const action of actions) {
      currentState = layoutReducer(currentState, action);
    }

    // Apply state update
    applyState(currentState);
  };

  // Helper to dispatch actions through the reducer
  // Uses reconcile for efficient diffing
  const dispatch = (action: LayoutAction) => {
    // Actions that affect layout (can cause expensive re-renders) are batched
    // to reduce stutter when rapidly creating/closing panes
    const batchableActions = ['NEW_PANE', 'CLOSE_PANE', 'CLOSE_PANE_BY_ID'];

    if (batchableActions.includes(action.type)) {
      pendingActions.push(action);
      if (!flushScheduled) {
        flushScheduled = true;
        // Use queueMicrotask for faster batching - processes before next render
        // This is faster than setTimeout(0) while still allowing multiple
        // rapid actions to be batched together
        queueMicrotask(flushActions);
      }
      return;
    }

    // Non-batchable actions apply directly
    const currentState = unwrap(state);
    const newState = layoutReducer(currentState, action);
    applyState(newState);
  };

  // Computed values using createMemo
  const activeWorkspace = createMemo(() => getActiveWorkspace(state));

  const populatedWorkspaces = createMemo(() => {
    const result: WorkspaceId[] = [];
    for (const [idStr, workspace] of Object.entries(state.workspaces)) {
      if (workspace?.mainPane) {
        result.push(Number(idStr) as WorkspaceId);
      }
    }
    if (!result.includes(state.activeWorkspaceId)) {
      result.push(state.activeWorkspaceId);
    }
    result.sort((a, b) => a - b);
    return result;
  });

  const paneCount = createMemo(() => getWorkspacePaneCount(activeWorkspace()));
  const panes = createMemo(() => getAllWorkspacePanes(activeWorkspace()));

  // Action functions
  const focusPane = (paneId: string) => dispatch({ type: 'FOCUS_PANE', paneId });
  const navigate = (direction: Direction) => dispatch({ type: 'NAVIGATE', direction });
  const newPane = (title?: string) => dispatch({ type: 'NEW_PANE', title });
  const closePane = () => dispatch({ type: 'CLOSE_PANE' });
  const closePaneById = (paneId: string) => dispatch({ type: 'CLOSE_PANE_BY_ID', paneId });
  const setViewport = (viewport: { x: number; y: number; width: number; height: number }) =>
    dispatch({ type: 'SET_VIEWPORT', viewport });
  const switchWorkspace = (workspaceId: WorkspaceId) =>
    dispatch({ type: 'SWITCH_WORKSPACE', workspaceId });
  const setLayoutMode = (mode: LayoutMode) => dispatch({ type: 'SET_LAYOUT_MODE', mode });
  const setPanePty = (paneId: string, ptyId: string) =>
    dispatch({ type: 'SET_PANE_PTY', paneId, ptyId });
  const setPaneTitle = (paneId: string, title: string) =>
    dispatch({ type: 'SET_PANE_TITLE', paneId, title });
  const swapMain = () => dispatch({ type: 'SWAP_MAIN' });
  const toggleZoom = () => dispatch({ type: 'TOGGLE_ZOOM' });
  const loadSession = (params: { workspaces: Workspaces; activeWorkspaceId: WorkspaceId }) =>
    dispatch({ type: 'LOAD_SESSION', workspaces: params.workspaces, activeWorkspaceId: params.activeWorkspaceId });
  const clearAll = () => dispatch({ type: 'CLEAR_ALL' });

  // Build context value - note: computed values need to be accessed as functions in Solid
  const value: LayoutContextValue = {
    get state() { return state; },
    get activeWorkspace() { return activeWorkspace(); },
    get paneCount() { return paneCount(); },
    get panes() { return panes(); },
    get populatedWorkspaces() { return populatedWorkspaces(); },
    get layoutVersion() { return state.layoutVersion; },
    focusPane,
    navigate,
    newPane,
    closePane,
    closePaneById,
    setViewport,
    switchWorkspace,
    setLayoutMode,
    setPanePty,
    setPaneTitle,
    swapMain,
    toggleZoom,
    loadSession,
    clearAll,
  };

  return (
    <LayoutContext.Provider value={value}>
      {props.children}
    </LayoutContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}
