import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { ResolvedKeybindings } from '../../../core/keybindings';
import type { VimInputMode } from '../../../core/vim-sequences';

export type VimSequenceHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export interface AggregateKeyboardDeps {
  // State getters
  getPreviewMode: () => boolean;
  getSelectedPtyId: () => string | null;
  getFilterQuery: () => string;
  getSearchState: () => { query: string } | null;
  getInSearchMode: () => boolean;
  getPrefixActive: () => boolean;
  getKeybindings: () => ResolvedKeybindings;
  getMatchedCount: () => number;
  getVimEnabled: () => boolean;
  getVimMode: () => VimInputMode;
  setVimMode: (mode: VimInputMode) => void;
  getVimHandlers: () => {
    list: VimSequenceHandler;
    preview: VimSequenceHandler;
    search: VimSequenceHandler;
  };
  getEmulatorSync: (ptyId: string) => ITerminalEmulator | null;

  // State setters
  setFilterQuery: (query: string) => void;
  toggleShowInactive: () => void;
  setInSearchMode: (value: boolean) => void;
  setPrefixActive: (value: boolean) => void;
  setSelectedIndex: (index: number) => void;

  // Aggregate view actions
  closeAggregateView: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  enterPreviewMode: () => void;
  exitPreviewMode: () => void;

  // Keyboard context actions
  exitAggregateMode: () => void;

  // Search actions
  exitSearchMode: (cancel: boolean) => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  handleEnterSearch: () => Promise<void>;

  // Navigation
  handleJumpToPty: () => Promise<boolean>;

  // External actions
  onRequestQuit?: () => void;
  onDetach?: () => void;
  onRequestKillPty?: (ptyId: string) => void;

  // Prefix timeout management
  clearPrefixTimeout: () => void;
  startPrefixTimeout: () => void;
}
