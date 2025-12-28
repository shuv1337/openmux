/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  createEffect,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore } from 'solid-js/store';

// Types
export type {
  GitDiffStats,
  PtyInfo,
  AggregateViewState,
  AggregateViewContextValue,
} from './aggregate-view-types';
import {
  type AggregateViewState,
  type AggregateViewContextValue,
  initialState,
} from './aggregate-view-types';

// Subscriptions and refresh logic
import {
  createSubscriptionManager,
  createRefreshState,
  createAggregateViewRefreshers,
  createTitleChangeHandler,
  setupSubscriptions,
  cleanupSubscriptions,
} from './aggregate-view-subscriptions';

// Actions
import { createAggregateViewActions } from './aggregate-view-actions';

const AggregateViewContext = createContext<AggregateViewContextValue | null>(null);

interface AggregateViewProviderProps extends ParentProps {}

export function AggregateViewProvider(props: AggregateViewProviderProps) {
  const [state, setState] = createStore<AggregateViewState>(initialState);

  // Subscription and refresh state
  const subscriptions = createSubscriptionManager();
  const subscriptionsEpoch = { value: 0 };
  const refreshState = createRefreshState();

  // Create refreshers
  const { refreshPtys, refreshPtysSubset, refreshSelectedDiffStats } =
    createAggregateViewRefreshers(state, setState, refreshState);

  // Title change handler
  const handleTitleChange = createTitleChangeHandler(setState);

  // Create actions
  const actions = createAggregateViewActions(state, setState);

  // Refresh PTYs when view opens and subscribe to lifecycle/title events
  createEffect(() => {
    if (state.showAggregateView) {
      // Initial refresh then setup subscriptions
      refreshPtys();
      setupSubscriptions(
        state,
        subscriptions,
        subscriptionsEpoch,
        refreshPtys,
        refreshPtysSubset,
        handleTitleChange
      );
    } else {
      cleanupSubscriptions(subscriptions, subscriptionsEpoch);
    }
  });

  // Refresh diff stats for selected PTY
  createEffect(() => {
    if (!state.showAggregateView) return;
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return;
    refreshSelectedDiffStats(selectedPtyId);
  });

  // Cleanup on unmount
  onCleanup(() => {
    cleanupSubscriptions(subscriptions, subscriptionsEpoch);
  });

  const value: AggregateViewContextValue = {
    state,
    ...actions,
    refreshPtys,
  };

  return (
    <AggregateViewContext.Provider value={value}>
      {props.children}
    </AggregateViewContext.Provider>
  );
}

export function useAggregateView(): AggregateViewContextValue {
  const context = useContext(AggregateViewContext);
  if (!context) {
    throw new Error('useAggregateView must be used within AggregateViewProvider');
  }
  return context;
}
