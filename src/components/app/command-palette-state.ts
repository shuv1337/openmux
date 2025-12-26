/**
 * Command palette state helpers for App.
 */

import { createStore, type SetStoreFunction } from 'solid-js/store';
import type { CommandPaletteState } from '../CommandPalette';

export function createCommandPaletteState(): {
  commandPaletteState: CommandPaletteState;
  setCommandPaletteState: SetStoreFunction<CommandPaletteState>;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
} {
  const [commandPaletteState, setCommandPaletteState] = createStore<CommandPaletteState>({
    show: false,
    query: '',
    selectedIndex: 0,
  });

  const openCommandPalette = () => {
    setCommandPaletteState({ show: true, query: '', selectedIndex: 0 });
  };

  const closeCommandPalette = () => {
    setCommandPaletteState({ show: false, query: '', selectedIndex: 0 });
  };

  const toggleCommandPalette = () => {
    if (commandPaletteState.show) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
  };

  return {
    commandPaletteState,
    setCommandPaletteState,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
  };
}
