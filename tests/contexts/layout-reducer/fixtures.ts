import { beforeEach } from 'vitest';
import type { Rectangle, Workspace, WorkspaceId, PaneData } from '../../../src/core/types';
import { DEFAULT_CONFIG } from '../../../src/core/config';
import { resetPaneIdCounter, type LayoutState } from '../../../src/core/operations/layout-actions';

export const defaultViewport: Rectangle = { x: 0, y: 0, width: 120, height: 40 };

export function createInitialState(overrides?: Partial<LayoutState>): LayoutState {
  return {
    workspaces: {},
    activeWorkspaceId: 1,
    viewport: defaultViewport,
    config: DEFAULT_CONFIG,
    layoutVersion: 0,
    ...overrides,
  };
}

export function createWorkspaceWithPanes(
  id: WorkspaceId,
  mainPane: PaneData | null,
  stackPanes: PaneData[] = [],
  options?: Partial<Workspace>
): Workspace {
  return {
    id,
    mainPane,
    stackPanes,
    focusedPaneId: mainPane?.id ?? null,
    activeStackIndex: 0,
    layoutMode: 'vertical',
    zoomed: false,
    ...options,
  };
}

export function setupLayoutReducerTest(): void {
  beforeEach(() => {
    // Reset pane ID counter before each test for determinism
    resetPaneIdCounter();
  });
}
