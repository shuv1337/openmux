import type { Accessor } from 'solid-js';
import type { CommandPaletteState } from '../CommandPalette';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { VimInputMode } from '../../core/vim-sequences';
import type { SearchContextValue } from '../../contexts/search/types';
import type { SessionState } from '../../core/operations/session-actions';
import type { useConfig } from '../../contexts/ConfigContext';
import type { useKeyboardState } from '../../contexts';
import type { useSession } from '../../contexts/SessionContext';

export function createOverlayVimMode(params: {
  config: ReturnType<typeof useConfig>;
  confirmationVisible: Accessor<boolean>;
  commandPaletteState: CommandPaletteState;
  paneRenameState: PaneRenameState;
  session: ReturnType<typeof useSession>;
  sessionState: SessionState;
  aggregateState: { showAggregateView: boolean };
  keyboardState: ReturnType<typeof useKeyboardState>;
  search: SearchContextValue;
  commandPaletteVimMode: Accessor<VimInputMode>;
  paneRenameVimMode: Accessor<VimInputMode>;
  sessionPickerVimMode: Accessor<VimInputMode>;
  templateOverlayVimMode: Accessor<VimInputMode>;
  aggregateVimMode: Accessor<VimInputMode>;
}): Accessor<VimInputMode | null> {
  const {
    config,
    confirmationVisible,
    commandPaletteState,
    paneRenameState,
    session,
    sessionState,
    aggregateState,
    keyboardState,
    search,
    commandPaletteVimMode,
    paneRenameVimMode,
    sessionPickerVimMode,
    templateOverlayVimMode,
    aggregateVimMode,
  } = params;

  return () => {
    if (config.config().keyboard.vimMode !== 'overlays') return null;
    if (confirmationVisible()) return null;
    if (commandPaletteState.show) return commandPaletteVimMode();
    if (paneRenameState.show) return paneRenameVimMode();
    if (session.showTemplateOverlay) return templateOverlayVimMode();
    if (sessionState.showSessionPicker) return sessionPickerVimMode();
    if (aggregateState.showAggregateView) return aggregateVimMode();
    if (keyboardState.state.mode === 'search' && search.searchState) {
      return search.vimMode;
    }
    return null;
  };
}
