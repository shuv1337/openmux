/**
 * Subscription management for AggregateViewContext.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';
import type { PtyInfo, AggregateViewState } from './aggregate-view-types';
import {
  debounce,
  buildPtyIndex,
  recomputeMatches,
  syncGitFields,
  applyRepoUpdate,
  isActivePty,
} from './aggregate-view-helpers';
import {
  listAllPtysWithMetadata,
  getPtyMetadata,
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
} from '../effect/bridge';

export interface SubscriptionManager {
  lifecycle: (() => void) | null;
  titleChange: (() => void) | null;
  pollingActive: ReturnType<typeof setInterval> | null;
  pollingInactive: ReturnType<typeof setInterval> | null;
}

export interface RefreshState {
  refreshInProgress: boolean;
  subsetRefreshInProgress: boolean;
  selectedDiffRefreshInProgress: boolean;
}

export function createSubscriptionManager(): SubscriptionManager {
  return {
    lifecycle: null,
    titleChange: null,
    pollingActive: null,
    pollingInactive: null,
  };
}

export function createRefreshState(): RefreshState {
  return {
    refreshInProgress: false,
    subsetRefreshInProgress: false,
    selectedDiffRefreshInProgress: false,
  };
}

export function createAggregateViewRefreshers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  refreshState: RefreshState
) {
  const refreshPtys = async () => {
    if (refreshState.refreshInProgress) return;
    refreshState.refreshInProgress = true;

    try {
      setState('isLoading', true);
      const ptys = await listAllPtysWithMetadata({ skipGitDiffStats: true });

      setState(produce((s) => {
        const merged = ptys.map((pty) => {
          const prevIndex = s.allPtysIndex.get(pty.ptyId);
          if (prevIndex === undefined) return pty;
          const prev = s.allPtys[prevIndex];
          const repoChanged =
            prev.cwd !== pty.cwd ||
            prev.gitBranch !== pty.gitBranch ||
            prev.gitDirty !== pty.gitDirty ||
            prev.gitStaged !== pty.gitStaged ||
            prev.gitUnstaged !== pty.gitUnstaged ||
            prev.gitUntracked !== pty.gitUntracked ||
            prev.gitConflicted !== pty.gitConflicted ||
            prev.gitRepoKey !== pty.gitRepoKey;
          const gitDiffStats =
            pty.gitDiffStats ?? (repoChanged ? undefined : prev.gitDiffStats);
          return { ...pty, gitDiffStats };
        });

        s.allPtys = merged;
        s.allPtysIndex = buildPtyIndex(merged);
        s.isLoading = false;
        recomputeMatches(s);
      }));
    } finally {
      refreshState.refreshInProgress = false;
    }
  };

  const refreshPtysSubset = async (ptyIds: string[]) => {
    if (refreshState.subsetRefreshInProgress || ptyIds.length === 0) return;
    refreshState.subsetRefreshInProgress = true;

    try {
      const results = await Promise.all(
        ptyIds.map((id) => getPtyMetadata(id, { skipGitDiffStats: true }))
      );
      const updates = results.filter((result): result is PtyInfo => result !== null);

      if (updates.length === 0) return;

      setState(produce((s) => {
        const updatedRepos = new Set<string>();
        for (const update of updates) {
          const index = s.allPtysIndex.get(update.ptyId);
          if (index === undefined || !s.allPtys[index]) continue;
          if (s.allPtys[index].foregroundProcess !== update.foregroundProcess) {
            s.allPtys[index].foregroundProcess = update.foregroundProcess;
          }
          syncGitFields(s.allPtys[index], update);
          if (update.gitRepoKey && !updatedRepos.has(update.gitRepoKey)) {
            updatedRepos.add(update.gitRepoKey);
            applyRepoUpdate(s.allPtys, update);
          }
        }

        recomputeMatches(s);
      }));
    } finally {
      refreshState.subsetRefreshInProgress = false;
    }
  };

  const refreshSelectedDiffStats = async (ptyId: string) => {
    if (refreshState.selectedDiffRefreshInProgress) return;
    refreshState.selectedDiffRefreshInProgress = true;

    try {
      const update = await getPtyMetadata(ptyId, { skipGitDiffStats: false });
      if (!update) return;

      setState(produce((s) => {
        const index = s.allPtysIndex.get(update.ptyId);
        if (index !== undefined && s.allPtys[index]) {
          syncGitFields(s.allPtys[index], update);
          s.allPtys[index].gitDiffStats = update.gitDiffStats;
        }
        const matchedIndex = s.matchedPtysIndex.get(update.ptyId);
        if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
          syncGitFields(s.matchedPtys[matchedIndex], update);
          s.matchedPtys[matchedIndex].gitDiffStats = update.gitDiffStats;
        }

        applyRepoUpdate(s.allPtys, update, { applyDiffStats: true });
        applyRepoUpdate(s.matchedPtys, update, { applyDiffStats: true });
      }));
    } finally {
      refreshState.selectedDiffRefreshInProgress = false;
    }
  };

  return { refreshPtys, refreshPtysSubset, refreshSelectedDiffStats };
}

export function createTitleChangeHandler(
  setState: SetStoreFunction<AggregateViewState>
) {
  return (event: { ptyId: string; title: string }) => {
    setState(produce((s) => {
      // Update in allPtys using O(1) lookup
      const allIndex = s.allPtysIndex.get(event.ptyId);
      if (allIndex !== undefined && s.allPtys[allIndex]) {
        s.allPtys[allIndex] = { ...s.allPtys[allIndex], foregroundProcess: event.title };
      }
      // Update in matchedPtys using O(1) lookup
      const matchedIndex = s.matchedPtysIndex.get(event.ptyId);
      if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
        s.matchedPtys[matchedIndex] = { ...s.matchedPtys[matchedIndex], foregroundProcess: event.title };
      }
    }));
  };
}

export async function setupSubscriptions(
  state: AggregateViewState,
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number },
  refreshPtys: () => Promise<void>,
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>,
  handleTitleChange: (event: { ptyId: string; title: string }) => void
): Promise<void> {
  const epoch = ++subscriptionsEpoch.value;
  const debouncedRefreshPtys = debounce(() => refreshPtys(), 100);

  // Subscribe to PTY lifecycle events for auto-refresh (created/destroyed)
  const lifecycleUnsub = await subscribeToPtyLifecycle(() => {
    debouncedRefreshPtys();
  });
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    lifecycleUnsub();
    return;
  }
  subscriptions.lifecycle = lifecycleUnsub;

  // Subscribe to title changes - use incremental update instead of full refresh
  const titleUnsub = await subscribeToAllTitleChanges(handleTitleChange);
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    titleUnsub();
    return;
  }
  subscriptions.titleChange = titleUnsub;

  // Dynamic polling: active PTYs update faster, inactive slower.
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }
  const activePollMs = 2000;
  const inactivePollMs = 10000;

  subscriptions.pollingActive = setInterval(() => {
    if (!state.showAggregateView || state.allPtys.length === 0) return;
    const activeIds = new Set(state.allPtys.filter(isActivePty).map((pty) => pty.ptyId));
    if (state.selectedPtyId) activeIds.add(state.selectedPtyId);
    refreshPtysSubset(Array.from(activeIds));
  }, activePollMs);

  subscriptions.pollingInactive = setInterval(() => {
    if (!state.showAggregateView || state.allPtys.length === 0) return;
    const activeIds = new Set(state.allPtys.filter(isActivePty).map((pty) => pty.ptyId));
    if (state.selectedPtyId) activeIds.add(state.selectedPtyId);
    const inactiveIds = state.allPtys
      .filter((pty) => !activeIds.has(pty.ptyId))
      .map((pty) => pty.ptyId);
    refreshPtysSubset(inactiveIds);
  }, inactivePollMs);
}

export function cleanupSubscriptions(
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number }
): void {
  subscriptionsEpoch.value += 1;
  subscriptions.lifecycle?.();
  subscriptions.titleChange?.();
  if (subscriptions.pollingActive) clearInterval(subscriptions.pollingActive);
  if (subscriptions.pollingInactive) clearInterval(subscriptions.pollingInactive);
  subscriptions.lifecycle = null;
  subscriptions.titleChange = null;
  subscriptions.pollingActive = null;
  subscriptions.pollingInactive = null;
}
