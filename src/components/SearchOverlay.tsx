/**
 * SearchOverlay - search input overlay for terminal pane search
 *
 * Displays at the bottom of the screen when search mode is active.
 * Shows search query, match count, and navigation hints.
 */

import { Show, type Accessor } from 'solid-js';
import { useConfig } from '../contexts/ConfigContext';
import { useSearch } from '../contexts/SearchContext';
import { useTheme } from '../contexts/ThemeContext';
import { formatComboSet, type ResolvedKeybindingMap } from '../core/keybindings';
import type { SearchState } from '../contexts/search/types';

interface SearchOverlayProps {
  width: number;
  height: number;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function SearchOverlay(props: SearchOverlayProps) {
  const theme = useTheme();
  const config = useConfig();
  // Keep search context to access searchState reactively (it's a getter)
  const search = useSearch();
  const accentColor = () => theme.searchAccentColor;

  // Calculate overlay dimensions
  const overlayWidth = () => Math.min(props.width - 4, 60);
  const overlayHeight = 3;
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => props.height - overlayHeight - 1;

  // Build match count display
  const matchDisplay = () => {
    const state = search.searchState;
    if (!state) return '';
    const { query, matches, currentMatchIndex } = state;
    if (query === '') {
      return '';
    } else if (matches.length === 0) {
      return '0 matches';
    } else {
      return `${currentMatchIndex + 1}/${matches.length}`;
    }
  };

  const hintText = () => {
    const bindings = config.keybindings().search;
    const nav = formatComboSet([
      ...getCombos(bindings, 'search.next'),
      ...getCombos(bindings, 'search.prev'),
    ]);
    const cancel = formatComboSet(getCombos(bindings, 'search.cancel'));
    return `${nav}:nav ${cancel}:cancel`;
  };

  return (
    <Show when={search.searchState}>
      {(state: Accessor<SearchState>) => (
        <box
          style={{
            position: 'absolute',
            left: overlayX(),
            top: overlayY(),
            width: overlayWidth(),
            height: overlayHeight,
            border: true,
            borderStyle: 'rounded',
            borderColor: accentColor(),
            padding: 0,
            paddingLeft: 1,
            paddingRight: 1,
            zIndex: 150,
          }}
          backgroundColor="#1a1a1a"
          title=" Search "
          titleAlignment="center"
        >
          <box style={{ flexDirection: 'row', height: 1 }}>
            <text fg={accentColor()}>/ </text>
            <text fg="#FFFFFF">{state().query || ' '}</text>
            <text fg={accentColor()}>_</text>
            <text fg="#444444">  </text>
            <text fg={state().matches.length > 0 ? '#88FF88' : '#888888'}>{matchDisplay()}</text>
            <text fg="#444444">  </text>
            <text fg="#666666">{hintText()}</text>
          </box>
        </box>
      )}
    </Show>
  );
}
