/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, createMemo, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import { useTerminal } from '../contexts/TerminalContext';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { useTheme } from '../contexts/ThemeContext';
import { getHostBackgroundColor } from '../effect/bridge';
import { createTerminalRenderer } from './terminal-view/terminal-renderer';
import { createTerminalViewState } from './terminal-view/view-state';
import { setupUnifiedSubscription } from './terminal-view/unified-subscription';
import type { TerminalViewProps } from './terminal-view/types';

let nextKittyPaneId = 0;

/**
 * TerminalView component - uses direct buffer rendering for maximum performance
 */
export function TerminalView(props: TerminalViewProps) {
  const renderer = useRenderer();
  const terminal = useTerminal();
  const theme = useTheme();
  const kittyPaneKey = `kitty-pane-${nextKittyPaneId++}`;
  const hostBgColor = createMemo(() => {
    void terminal.hostColorsVersion;
    return getHostBackgroundColor();
  });
  // Get selection state - keep full context to access selectionVersion reactively
  const selection = useSelection();
  const { isCellSelected, getSelection } = selection;
  // Get search state - keep full context to access searchVersion reactively
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch } = search;

  const viewState = createTerminalViewState();
  const recentPrefetchWindow = 32;

  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = createSignal(0);

  setupUnifiedSubscription({
    getPtyId: () => props.ptyId,
    terminal,
    renderer,
    viewState,
    setVersion,
    kittyPaneKey,
    recentPrefetchWindow,
  });

  const renderTerminal = createTerminalRenderer({
    props,
    viewState,
    selection: {
      isCellSelected,
      getSelection,
    },
    search: {
      isSearchMatch,
      isCurrentMatch,
      getSearchState: () => search.searchState,
    },
    theme,
    kittyPaneKey,
  });

  // Request render when selection or search version changes.
  createEffect(
    on(
      [() => selection.selectionVersion, () => search.searchVersion],
      () => renderer.requestRender()
    )
  );

  createEffect(
    on(
      () => terminal.hostColorsVersion,
      () => {
        setVersion((v) => v + 1);
        renderer.requestRender();
      }
    )
  );

  // Resize events don't always trigger a terminal update, so force a render to avoid blank frames.
  createEffect(
    on(
      [() => props.width, () => props.height],
      () => {
        setVersion((v) => v + 1);
        renderer.requestRender();
      }
    )
  );

  return (
    <Show
      when={version() > 0}
      fallback={
        <box
          style={{
            width: props.width,
            height: props.height,
          }}
          backgroundColor={hostBgColor()}
        />
      }
    >
      <box
        style={{
          width: props.width,
          height: props.height,
        }}
        backgroundColor={hostBgColor()}
        renderAfter={renderTerminal}
      />
    </Show>
  );
}

export default TerminalView;
