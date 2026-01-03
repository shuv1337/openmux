import { createEffect } from 'solid-js';
import { createVimSequenceHandler, type VimInputMode } from '../../core/vim-sequences';
import type { SearchContextValue } from '../../contexts/search/types';
import type { useConfig } from '../../contexts/ConfigContext';

const SEARCH_VIM_SEQUENCES = [
  { keys: ['n'], action: 'search.next' },
  { keys: ['shift+n'], action: 'search.prev' },
  { keys: ['enter'], action: 'search.confirm' },
  { keys: ['q'], action: 'search.cancel' },
];

export function createSearchVimState(params: {
  config: ReturnType<typeof useConfig>;
  search: SearchContextValue;
}): {
  getSearchVimMode: () => VimInputMode;
  setSearchVimMode: (mode: VimInputMode) => void;
  getSearchVimHandler: () => { handleCombo: (combo: string) => { action: string | null; pending: boolean }; reset: () => void };
} {
  const { config, search } = params;

  let searchVimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: SEARCH_VIM_SEQUENCES,
  });

  createEffect(() => {
    const timeoutMs = config.config().keyboard.vimSequenceTimeoutMs;
    searchVimHandler.reset();
    searchVimHandler = createVimSequenceHandler({
      timeoutMs,
      sequences: SEARCH_VIM_SEQUENCES,
    });
  });

  createEffect(() => {
    if (!search.searchState) return;
    if (config.config().keyboard.vimMode === 'overlays') {
      search.setVimMode('normal');
    }
    searchVimHandler.reset();
  });

  return {
    getSearchVimMode: () => search.vimMode,
    setSearchVimMode: search.setVimMode,
    getSearchVimHandler: () => searchVimHandler,
  };
}
