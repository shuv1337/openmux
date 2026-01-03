/**
 * Keyboard handlers for AggregateView
 * Handles keyboard input for list mode, preview mode, and search mode
 */

import { writeToPty } from '../../effect/bridge';
import type { KeyboardEvent } from '../../effect/bridge';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import { encodeKeyForEmulator } from '../../terminal/key-encoder';
import { eventToCombo, matchKeybinding, type ResolvedKeybindings } from '../../core/keybindings';
import type { VimInputMode } from '../../core/vim-sequences';

type VimSequenceHandler = {
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

/**
 * Creates keyboard handler for AggregateView
 */
export function createAggregateKeyboardHandler(deps: AggregateKeyboardDeps) {
  const {
    getPreviewMode,
    getSelectedPtyId,
    getFilterQuery,
    getSearchState,
    getInSearchMode,
    getPrefixActive,
    getKeybindings,
    getMatchedCount,
    getVimEnabled,
    getVimMode,
    setVimMode,
    getVimHandlers,
    getEmulatorSync,
    setFilterQuery,
    toggleShowInactive,
    setInSearchMode,
    setPrefixActive,
    setSelectedIndex,
    closeAggregateView,
    navigateUp,
    navigateDown,
    enterPreviewMode,
    exitPreviewMode,
    exitAggregateMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    handleEnterSearch,
    handleJumpToPty,
    onRequestQuit,
    onDetach,
    onRequestKillPty,
    clearPrefixTimeout,
    startPrefixTimeout,
  } = deps;

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleSearchAction = (action: string | null): boolean => {
    if (!action) return false;

    if (action === 'aggregate.search.cancel') {
      exitSearchMode(true);
      setInSearchMode(false);
      return true;
    }

    if (action === 'aggregate.search.confirm') {
      exitSearchMode(false);
      setInSearchMode(false);
      return true;
    }

    const currentSearchState = getSearchState();
    if (!currentSearchState) {
      return true;
    }

    if (action === 'aggregate.search.next') {
      nextMatch();
      return true;
    }

    if (action === 'aggregate.search.prev') {
      prevMatch();
      return true;
    }

    if (action === 'aggregate.search.delete') {
      setSearchQuery(currentSearchState.query.slice(0, -1));
      return true;
    }

    return false;
  };

  const handleSearchInput = (event: KeyboardEvent): boolean => {
    const currentSearchState = getSearchState();
    if (!currentSearchState) {
      return true;
    }

    const searchCharCode = event.sequence?.charCodeAt(0) ?? 0;
    const isPrintable = event.sequence?.length === 1 && searchCharCode >= 32 && searchCharCode < 127;
    if (isPrintable && !event.ctrl && !event.alt && !event.meta) {
      setSearchQuery(currentSearchState.query + event.sequence);
      return true;
    }

    return true;
  };

  /**
   * Handle search mode keyboard input
   * Returns true if key was handled
   */
  const handleSearchModeKeys = (event: KeyboardEvent): boolean => {
    if (event.eventType === 'release') {
      return true;
    }

    const keybindings = getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!getVimEnabled()) {
      const action = matchKeybinding(keybindings.aggregate.search, keyEvent);
      if (handleSearchAction(action)) return true;
      return handleSearchInput(event);
    }

    if (getVimMode() === 'insert') {
      if (isBareEscape(event)) {
        setVimMode('normal');
        getVimHandlers().search.reset();
        return true;
      }
      const action = matchKeybinding(keybindings.aggregate.search, keyEvent);
      if (handleSearchAction(action)) return true;
      return handleSearchInput(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      setVimMode('insert');
      getVimHandlers().search.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = getVimHandlers().search.handleCombo(combo);
    if (result.pending) return true;
    if (handleSearchAction(result.action)) return true;

    const isBackspace = event.key === 'backspace';
    const shouldMatchBindings = !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
    if (shouldMatchBindings && !isBareEscape(event)) {
      const fallbackAction = matchKeybinding(keybindings.aggregate.search, keyEvent);
      if (handleSearchAction(fallbackAction)) return true;
    }

    return true;
  };

  const forwardToPreviewPty = (event: KeyboardEvent): boolean => {
    const selectedPtyId = getSelectedPtyId();
    if (selectedPtyId) {
      const emulator = getEmulatorSync(selectedPtyId);
      const inputStr = encodeKeyForEmulator(
        {
          key: event.key,
          ctrl: event.ctrl,
          alt: event.alt,
          shift: event.shift,
          sequence: event.sequence,
          baseCode: event.baseCode,
          eventType: event.eventType,
          repeated: event.repeated,
        },
        emulator
      );
      if (inputStr) {
        writeToPty(selectedPtyId, inputStr);
      }
    }
    return true;
  };

  const handlePreviewAction = (action: string | null): boolean => {
    if (!action) return false;

    if (action === 'aggregate.preview.search') {
      handleEnterSearch();
      return true;
    }

    if (action === 'aggregate.preview.exit') {
      exitPreviewMode();
      return true;
    }

    if (action === 'aggregate.kill') {
      const selectedPtyId = getSelectedPtyId();
      if (selectedPtyId && onRequestKillPty) {
        onRequestKillPty(selectedPtyId);
      }
      return true;
    }

    return false;
  };

  /**
   * Handle preview mode keyboard input
   * Returns true if key was handled
   */
  const handlePreviewModeKeys = (event: KeyboardEvent): boolean => {
    if (event.eventType === 'release') {
      if (!getVimEnabled() || getVimMode() === 'insert') {
        return forwardToPreviewPty(event);
      }
      return true;
    }

    const keybindings = getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!getVimEnabled()) {
      const action = matchKeybinding(keybindings.aggregate.preview, keyEvent);
      if (handlePreviewAction(action)) return true;
      return forwardToPreviewPty(event);
    }

    if (getVimMode() === 'insert') {
      if (isBareEscape(event)) {
        const selectedPtyId = getSelectedPtyId();
        const emulator = selectedPtyId ? getEmulatorSync(selectedPtyId) : null;
        const alternateScreen = emulator?.getTerminalState()?.alternateScreen ?? false;
        if (!alternateScreen) {
          setVimMode('normal');
          getVimHandlers().preview.reset();
          return true;
        }
      }
      const action = matchKeybinding(keybindings.aggregate.preview, keyEvent);
      if (handlePreviewAction(action)) return true;
      return forwardToPreviewPty(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      setVimMode('insert');
      getVimHandlers().preview.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = getVimHandlers().preview.handleCombo(combo);
    if (result.pending) return true;
    if (handlePreviewAction(result.action)) return true;

    const shouldMatchBindings = event.ctrl || event.alt || event.meta || event.key.length > 1;
    if (shouldMatchBindings && !isBareEscape(event)) {
      const fallbackAction = matchKeybinding(keybindings.aggregate.preview, keyEvent);
      if (handlePreviewAction(fallbackAction)) return true;
    }

    return true;
  };

  /**
   * Handle list mode keyboard input
   * Returns true if key was handled
   */
  const handleListAction = (action: string | null): boolean => {
    switch (action) {
      case 'aggregate.list.down':
        navigateDown();
        return true;
      case 'aggregate.list.up':
        navigateUp();
        return true;
      case 'aggregate.list.top':
        setSelectedIndex(0);
        return true;
      case 'aggregate.list.bottom': {
        const count = getMatchedCount();
        if (count > 0) {
          setSelectedIndex(count - 1);
        }
        return true;
      }
      case 'aggregate.list.preview':
        if (getSelectedPtyId()) {
          enterPreviewMode();
        }
        return true;
      case 'aggregate.list.jump':
        handleJumpToPty();
        return true;
      case 'aggregate.list.toggle.scope':
        toggleShowInactive();
        return true;
      case 'aggregate.list.delete':
        setFilterQuery(getFilterQuery().slice(0, -1));
        return true;
      case 'aggregate.list.close':
        closeAggregateView();
        exitAggregateMode();
        return true;
      case 'aggregate.kill': {
        const selectedPtyId = getSelectedPtyId();
        if (selectedPtyId && onRequestKillPty) {
          onRequestKillPty(selectedPtyId);
        }
        return true;
      }
      default:
        return false;
    }
  };

  const handleListInput = (event: KeyboardEvent): boolean => {
    const { key } = event;
    if (key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      setFilterQuery(getFilterQuery() + key);
      return true;
    }
    return true;
  };

  const handleListModeKeys = (event: KeyboardEvent): boolean => {
    const keybindings = getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };
    const action = matchKeybinding(keybindings.aggregate.list, keyEvent);

    if (!getVimEnabled()) {
      if (handleListAction(action)) return true;
      return handleListInput(event);
    }

    if (getVimMode() === 'insert') {
      if (isBareEscape(event)) {
        setVimMode('normal');
        getVimHandlers().list.reset();
        return true;
      }
      if (handleListAction(action)) return true;
      return handleListInput(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      setVimMode('insert');
      getVimHandlers().list.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = getVimHandlers().list.handleCombo(combo);
    if (result.pending) return true;
    if (handleListAction(result.action)) return true;

    const isBackspace = event.key === 'backspace';
    const shouldMatchBindings = !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
    if (shouldMatchBindings && !isBareEscape(event)) {
      const fallbackAction = matchKeybinding(keybindings.aggregate.list, keyEvent);
      if (handleListAction(fallbackAction)) return true;
    }

    return true;
  };

  /**
   * Main keyboard handler for AggregateView
   */
  const handleKeyDown = (event: KeyboardEvent): boolean => {
    const keybindings = getKeybindings();
    const combo = eventToCombo({
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    });

    // Handle search mode first (when active in preview)
    if (getInSearchMode() && getPreviewMode()) {
      return handleSearchModeKeys(event);
    }

    if (event.eventType === 'release') {
      if (getPreviewMode()) {
        return handlePreviewModeKeys(event);
      }
      return true;
    }

    // Global prefix key handling (works in both list and preview mode)
    if (combo === keybindings.prefixKey) {
      setPrefixActive(true);
      clearPrefixTimeout();
      startPrefixTimeout();
      return true;
    }

    // Prefix commands (work in both list and preview mode)
    if (getPrefixActive()) {
      const prefixAction = matchKeybinding(keybindings.aggregate.prefix, {
        key: event.key,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
        meta: event.meta,
      });

      if (prefixAction) {
        setPrefixActive(false);
        clearPrefixTimeout();
      }

      switch (prefixAction) {
        case 'aggregate.prefix.quit':
          onRequestQuit?.();
          return true;
        case 'aggregate.prefix.detach':
          onDetach?.();
          return true;
        case 'aggregate.prefix.exit':
          if (getPreviewMode()) {
            exitPreviewMode();
          } else {
            closeAggregateView();
            exitAggregateMode();
          }
          return true;
        case 'aggregate.prefix.search':
          if (getPreviewMode()) {
            handleEnterSearch();
          }
          return true;
        default:
          if (prefixAction) {
            return true;
          }
          setPrefixActive(false);
          clearPrefixTimeout();
      }
    }

    // In preview mode, most keys go to the PTY
    if (getPreviewMode()) {
      return handlePreviewModeKeys(event);
    }

    // List mode keyboard handling
    return handleListModeKeys(event);
  };

  return {
    handleKeyDown,
    handleSearchModeKeys,
    handlePreviewModeKeys,
    handleListModeKeys,
  };
}
