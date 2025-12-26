/**
 * NAVIGATE action handler
 */

import type { Direction, Rectangle, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';
import { getAllWorkspacePanes } from '../master-stack-layout';
import { containsPane, getFirstPane } from '../../layout-tree';

function getOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function getCandidateScore(
  current: Rectangle,
  candidate: Rectangle,
  direction: Direction
): number | null {
  let primaryDistance = 0;
  let secondaryDistance = 0;
  let overlap = 0;

  if (direction === 'west') {
    primaryDistance = current.x - (candidate.x + candidate.width);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height);
    secondaryDistance = Math.abs(
      current.y + current.height / 2 - (candidate.y + candidate.height / 2)
    );
  } else if (direction === 'east') {
    primaryDistance = candidate.x - (current.x + current.width);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height);
    secondaryDistance = Math.abs(
      current.y + current.height / 2 - (candidate.y + candidate.height / 2)
    );
  } else if (direction === 'north') {
    primaryDistance = current.y - (candidate.y + candidate.height);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width);
    secondaryDistance = Math.abs(
      current.x + current.width / 2 - (candidate.x + candidate.width / 2)
    );
  } else {
    primaryDistance = candidate.y - (current.y + current.height);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width);
    secondaryDistance = Math.abs(
      current.x + current.width / 2 - (candidate.x + candidate.width / 2)
    );
  }

  const overlapPenalty = overlap > 0 ? 0 : 1000;
  return primaryDistance * 1000 + secondaryDistance + overlapPenalty;
}

/**
 * Handle NAVIGATE action
 * Moves focus between panes based on geometry
 */
export function handleNavigate(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  const isStackedMode = workspace.layoutMode === 'stacked';
  const stackCount = workspace.stackPanes.length;

  if (isStackedMode && (direction === 'north' || direction === 'south') && stackCount > 0) {
    const delta = direction === 'north' ? -1 : 1;
    const nextIndex =
      stackCount > 1
        ? (workspace.activeStackIndex + delta + stackCount) % stackCount
        : 0;
    const targetEntry = workspace.stackPanes[nextIndex];
    const targetPane = targetEntry ? getFirstPane(targetEntry) : null;

    if (!targetPane) return state;

    const stackIndexChanged = nextIndex !== workspace.activeStackIndex;
    if (!stackIndexChanged && targetPane.id === workspace.focusedPaneId) {
      return state;
    }

    let updated: Workspace = {
      ...workspace,
      focusedPaneId: targetPane.id,
      activeStackIndex: nextIndex,
    };

    if (workspace.zoomed || stackIndexChanged) {
      updated = recalculateLayout(updated, state.viewport, state.config);
    }

    return { ...state, workspaces: updateWorkspace(state, updated) };
  }

  const allPanes = getAllWorkspacePanes(workspace).filter(p => p.rectangle);
  if (allPanes.length === 0) return state;
  if (!workspace.focusedPaneId) return state;

  const currentPane = allPanes.find(p => p.id === workspace.focusedPaneId);
  if (!currentPane?.rectangle) return state;

  let bestPane = currentPane;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of allPanes) {
    if (pane.id === currentPane.id || !pane.rectangle) continue;
    const score = getCandidateScore(currentPane.rectangle, pane.rectangle, direction);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane;
    }
  }

  if (bestPane.id === currentPane.id) return state;

  const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, bestPane.id));
  const activeStackIndex = stackIndex >= 0 ? stackIndex : workspace.activeStackIndex;
  const stackIndexChanged = stackIndex >= 0 && stackIndex !== workspace.activeStackIndex;

  let updated: Workspace = {
    ...workspace,
    focusedPaneId: bestPane.id,
    activeStackIndex,
  };

  const needsStackedRecalc = workspace.layoutMode === 'stacked' && stackIndexChanged;
  if (workspace.zoomed || needsStackedRecalc) {
    updated = recalculateLayout(updated, state.viewport, state.config);
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}
