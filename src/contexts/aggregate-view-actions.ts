/**
 * Action creators for AggregateViewContext.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';
import type { PtyInfo, AggregateViewState } from './aggregate-view-types';
import {
  filterPtys,
  getBasePtys,
  buildPtyIndex,
} from './aggregate-view-helpers';

export function createAggregateViewActions(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>
) {
  const openAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = true;
      s.filterQuery = '';
      s.selectedIndex = 0;
      const basePtys = getBasePtys(s.allPtys, s.showInactive);
      s.matchedPtys = basePtys;
      s.matchedPtysIndex = buildPtyIndex(basePtys);
      s.selectedPtyId = basePtys[0]?.ptyId ?? null;
    }));
  };

  const closeAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = false;
      s.filterQuery = '';
      s.selectedIndex = 0;
      s.previewMode = false;
    }));
  };

  const setFilterQuery = (query: string) => {
    const basePtys = getBasePtys(state.allPtys, state.showInactive);
    const matchedPtys = filterPtys(basePtys, query);
    const matchedPtysIndex = buildPtyIndex(matchedPtys);
    setState(produce((s) => {
      s.filterQuery = query;
      s.matchedPtys = matchedPtys;
      s.matchedPtysIndex = matchedPtysIndex;
      s.selectedIndex = 0;
      s.selectedPtyId = matchedPtys[0]?.ptyId ?? null;
    }));
  };

  const toggleShowInactive = () => {
    setState(produce((s) => {
      s.showInactive = !s.showInactive;
      const basePtys = getBasePtys(s.allPtys, s.showInactive);
      const matchedPtys = filterPtys(basePtys, s.filterQuery);
      const matchedPtysIndex = buildPtyIndex(matchedPtys);
      const currentSelectedPtyId = s.selectedPtyId;
      const currentPtyIndex = currentSelectedPtyId ? matchedPtysIndex.get(currentSelectedPtyId) : undefined;
      const currentPtyStillExists = currentPtyIndex !== undefined;
      const newSelectedIndex = currentPtyStillExists
        ? currentPtyIndex
        : Math.min(s.selectedIndex, Math.max(0, matchedPtys.length - 1));
      const selectedPtyId = matchedPtys[newSelectedIndex]?.ptyId ?? null;

      s.matchedPtys = matchedPtys;
      s.matchedPtysIndex = matchedPtysIndex;
      s.selectedIndex = newSelectedIndex;
      s.selectedPtyId = selectedPtyId;
      if (!currentPtyStillExists || selectedPtyId === null) {
        s.previewMode = false;
      }
    }));
  };

  const navigateUp = () => {
    const newIndex = Math.max(0, state.selectedIndex - 1);
    setState(produce((s) => {
      s.selectedIndex = newIndex;
      s.selectedPtyId = s.matchedPtys[newIndex]?.ptyId ?? null;
    }));
  };

  const navigateDown = () => {
    const newIndex = Math.min(state.matchedPtys.length - 1, state.selectedIndex + 1);
    setState(produce((s) => {
      s.selectedIndex = newIndex;
      s.selectedPtyId = s.matchedPtys[newIndex]?.ptyId ?? null;
    }));
  };

  const setSelectedIndex = (index: number) => {
    const maxIndex = Math.max(0, state.matchedPtys.length - 1);
    const clamped = Math.min(maxIndex, Math.max(0, index));
    setState(produce((s) => {
      s.selectedIndex = clamped;
      s.selectedPtyId = s.matchedPtys[clamped]?.ptyId ?? null;
    }));
  };

  const selectPty = (ptyId: string) => {
    setState(produce((s) => {
      s.selectedPtyId = ptyId;
      // O(1) lookup instead of findIndex
      s.selectedIndex = s.matchedPtysIndex.get(ptyId) ?? -1;
    }));
  };

  const getSelectedPty = (): PtyInfo | null => {
    if (state.selectedPtyId === null) return null;
    // O(1) lookup using index then direct access
    const index = state.matchedPtysIndex.get(state.selectedPtyId);
    return index !== undefined ? state.matchedPtys[index] ?? null : null;
  };

  const enterPreviewMode = () => {
    setState('previewMode', true);
  };

  const exitPreviewMode = () => {
    setState('previewMode', false);
  };

  return {
    openAggregateView,
    closeAggregateView,
    setFilterQuery,
    toggleShowInactive,
    navigateUp,
    navigateDown,
    setSelectedIndex,
    selectPty,
    getSelectedPty,
    enterPreviewMode,
    exitPreviewMode,
  };
}
