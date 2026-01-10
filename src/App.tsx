/**
 * Main App component for openmux
 */

import { createSignal, createEffect, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useTerminalDimensions, useRenderer } from '@opentui/solid';
import {
  ConfigProvider,
  useConfig,
  ThemeProvider,
  LayoutProvider,
  KeyboardProvider,
  TerminalProvider,
  useLayout,
  useKeyboardHandler,
  useKeyboardState,
  useTerminal,
} from './contexts';
import { SelectionProvider, useSelection } from './contexts/SelectionContext';
import { SearchProvider, useSearch } from './contexts/SearchContext';
import { useSession } from './contexts/SessionContext';
import { AggregateViewProvider, useAggregateView } from './contexts/AggregateViewContext';
import { TitleProvider, useTitle } from './contexts/TitleContext';
import { PaneContainer } from './components';
import type { ConfirmationType } from './core/types';
import { SessionBridge } from './components/SessionBridge';
import { getFocusedPane, getFocusedPtyId } from './core/workspace-utils';
import { DEFAULT_COMMAND_PALETTE_COMMANDS, type CommandPaletteCommand } from './core/command-palette';
import { setKeyboardVimMode, type KeyboardVimMode } from './core/user-config';
import { type VimInputMode } from './core/vim-sequences';
import { onShimDetached, shutdownShim } from './effect/bridge';
import { disposeRuntime } from './effect/runtime';
import {
  createConfirmationHandlers,
  createPaneResizeHandlers,
  createPasteHandler,
} from './components/app';
import { setClipboardPasteHandler } from './terminal/focused-pty-registry';
import { readFromClipboard } from './effect/bridge';
import { handleNormalModeAction } from './contexts/keyboard/handlers';
import { createCommandPaletteState } from './components/app/command-palette-state';
import { setupKeyboardRouting } from './components/app/keyboard-routing';
import { usePtyCreation } from './components/app/pty-creation';
import { AppOverlays } from './components/app/AppOverlays';
import type { PaneRenameState } from './components/PaneRenameOverlay';
import type { WorkspaceLabelState } from './components/WorkspaceLabelOverlay';
import { createTemplatePendingActions } from './components/app/template-pending-actions';
import { createSessionPendingActions } from './components/app/session-pending-actions';
import { createKittyGraphicsBridge } from './components/app/kitty-graphics-bridge';
import { createCellMetricsGetter, createPixelResizeTracker } from './components/app/pixel-metrics';
import { createExitHandlers } from './components/app/exit-handlers';
import { setupClipboardAndShimBridge } from './components/app/clipboard-bridge';
import { setupFocusedPtyRegistry, setupHostFocusTracking } from './components/app/focus-tracking';
import { setupOverlayClipRects } from './components/app/overlay-clips';
import { createSearchVimState } from './components/app/search-vim';
import { createOverlayVimMode } from './components/app/overlay-vim-mode';
import { setupAppLayoutEffects } from './components/app/layout-effects';
import { checkForUpdateLabel } from './core/update-checker';
import {
  getCommandPaletteRect,
  getPaneRenameRect,
  getWorkspaceLabelRect,
  getConfirmationRect,
  getCopyNotificationRect,
  getSearchOverlayRect,
  getSessionPickerRect,
  getTemplateOverlayRect,
} from './components/app/overlay-rects';

function AppContent() {
  const config = useConfig();
  const dimensions = useTerminalDimensions();
  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const layout = useLayout();
  const { setViewport, newPane, closePane } = layout;
  // Don't destructure isInitialized - it's a reactive getter that loses reactivity when destructured
  const terminal = useTerminal();
  const {
    destroyPTY,
    resizePTY,
    writeToFocused,
    writeToPTY,
    pasteToFocused,
    getFocusedEmulator,
    isPtyActive,
  } = terminal;
  const session = useSession();
  const { togglePicker, toggleTemplateOverlay, state: sessionState, saveSession, suspendPersistence } = session;
  const titleContext = useTitle();
  // Keep selection/search contexts to access reactive getters
  const selection = useSelection();
  const { clearAllSelections } = selection;
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const { state: aggregateState, openAggregateView } = useAggregateView();
  const keyboardState = useKeyboardState();
  const { enterConfirmMode, exitConfirmMode, exitSearchMode: keyboardExitSearchMode } = keyboardState;
  const renderer = useRenderer();

  const { commandPaletteState, setCommandPaletteState, toggleCommandPalette } = createCommandPaletteState();
  const [paneRenameState, setPaneRenameState] = createStore<PaneRenameState>({
    show: false,
    paneId: null,
    value: '',
  });
  const [workspaceLabelState, setWorkspaceLabelState] = createStore<WorkspaceLabelState>({
    show: false,
    workspaceId: null,
    value: '',
  });
  const [commandPaletteVimMode, setCommandPaletteVimMode] = createSignal<VimInputMode>('normal');
  const [paneRenameVimMode, setPaneRenameVimMode] = createSignal<VimInputMode>('normal');
  const [workspaceLabelVimMode, setWorkspaceLabelVimMode] = createSignal<VimInputMode>('normal');
  const [sessionPickerVimMode, setSessionPickerVimMode] = createSignal<VimInputMode>('normal');
  const [templateOverlayVimMode, setTemplateOverlayVimMode] = createSignal<VimInputMode>('normal');
  const [aggregateVimMode, setAggregateVimMode] = createSignal<VimInputMode>('normal');
  const [updateLabel, setUpdateLabel] = createSignal<string | null>(null);

  const getCellMetrics = createCellMetricsGetter(renderer as any, width, height);

  const paneResizeHandlers = createPaneResizeHandlers({
    getPanes: () => layout.panes,
    resizePTY,
    getCellMetrics,
  });

  const { ensurePixelResize, stopPixelResizePoll } = createPixelResizeTracker({
    getCellMetrics,
    isTerminalInitialized: () => terminal.isInitialized,
    getPaneCount: () => layout.panes.length,
    scheduleResizeAllPanes: paneResizeHandlers.scheduleResizeAllPanes,
  });

  const kittyRenderer = createKittyGraphicsBridge({
    renderer,
    ensurePixelResize,
    stopPixelResizePoll,
  });

  const exitHandlers = createExitHandlers({
    saveSession,
    suspendSessionPersistence: suspendPersistence,
    shutdownShim,
    disposeRuntime,
    renderer,
  });
  const handleQuit = exitHandlers.handleQuit;
  const handleDetach = exitHandlers.handleDetach;


  // Confirmation dialog state
  const [confirmationState, setConfirmationState] = createSignal<{
    visible: boolean;
    type: ConfirmationType;
  }>({ visible: false, type: 'close_pane' });

  // Track pending kill PTY ID for aggregate view kill confirmation
  const [pendingKillPtyId, setPendingKillPtyId] = createSignal<string | null>(null);

  setupOverlayClipRects({
    getWidth: width,
    getHeight: height,
    sessionState,
    session,
    layout,
    search,
    selection,
    aggregateState,
    commandPaletteState,
    commandPaletteCommands: DEFAULT_COMMAND_PALETTE_COMMANDS,
    paneRenameState,
    workspaceLabelState,
    confirmationVisible: () => confirmationState().visible,
    kittyRenderer,
    getSessionPickerRect,
    getTemplateOverlayRect,
    getCommandPaletteRect,
    getPaneRenameRect,
    getWorkspaceLabelRect,
    getSearchOverlayRect,
    getConfirmationRect,
    getCopyNotificationRect,
  });

  const templatePending = createTemplatePendingActions();
  const sessionPending = createSessionPendingActions();

  const handleConfirmTemplateApply = templatePending.confirmApply;
  const handleCancelTemplateApply = templatePending.cancelApply;
  const handleConfirmTemplateOverwrite = templatePending.confirmOverwrite;
  const handleCancelTemplateOverwrite = templatePending.cancelOverwrite;
  const handleConfirmTemplateDelete = templatePending.confirmDelete;
  const handleCancelTemplateDelete = templatePending.cancelDelete;
  const handleConfirmSessionDelete = sessionPending.confirmDelete;
  const handleCancelSessionDelete = sessionPending.cancelDelete;

  // Create confirmation handlers
  const confirmationHandlers = createConfirmationHandlers({
    confirmationState,
    setConfirmationState,
    pendingKillPtyId,
    setPendingKillPtyId,
    closePane,
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    destroyPTY,
    enterConfirmMode,
    exitConfirmMode,
    onQuit: handleQuit,
    onConfirmApplyTemplate: handleConfirmTemplateApply,
    onCancelApplyTemplate: handleCancelTemplateApply,
    onConfirmOverwriteTemplate: handleConfirmTemplateOverwrite,
    onCancelOverwriteTemplate: handleCancelTemplateOverwrite,
    onConfirmDeleteTemplate: handleConfirmTemplateDelete,
    onCancelDeleteTemplate: handleCancelTemplateDelete,
    onConfirmDeleteSession: handleConfirmSessionDelete,
    onCancelDeleteSession: handleCancelSessionDelete,
  });

  // Create paste handler for bracketed paste from host terminal
  const pasteHandler = createPasteHandler({
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    writeToPTY,
  });

  // Connect focused PTY registry for clipboard passthrough
  // This bridges the stdin-level paste trigger with the SolidJS context
  // Key insight: We read from clipboard (always complete) instead of unreliable stdin data
  setupClipboardAndShimBridge({
    setClipboardPasteHandler,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached: exitHandlers.handleShimDetached,
  });

  setupFocusedPtyRegistry(() => getFocusedPtyId(layout.activeWorkspace));
  setupHostFocusTracking({
    renderer,
    isPtyActive,
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
  });

  const { handleNewPane, handleSplitPane } = usePtyCreation({
    layout: {
      get panes() { return layout.panes; },
      getFocusedPaneId: () => layout.activeWorkspace.focusedPaneId,
    },
    terminal,
    sessionState,
    newPane,
    splitPane: layout.splitPane,
  });

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = () => {
    pasteToFocused();
  };

  // Session picker toggle handler
  const handleToggleSessionPicker = () => {
    togglePicker();
  };

  const handleToggleTemplateOverlay = () => {
    toggleTemplateOverlay();
  };

  const handleCommandPaletteVimModeChange = (mode: VimInputMode) => {
    setCommandPaletteVimMode(mode);
  };

  const handlePaneRenameVimModeChange = (mode: VimInputMode) => {
    setPaneRenameVimMode(mode);
  };

  const handleWorkspaceLabelVimModeChange = (mode: VimInputMode) => {
    setWorkspaceLabelVimMode(mode);
  };

  const handleSessionPickerVimModeChange = (mode: VimInputMode) => {
    setSessionPickerVimMode(mode);
  };

  const handleTemplateOverlayVimModeChange = (mode: VimInputMode) => {
    setTemplateOverlayVimMode(mode);
  };

  const handleAggregateVimModeChange = (mode: VimInputMode) => {
    setAggregateVimMode(mode);
  };

  const handlePaneRenameOpen = () => {
    const focusedPane = getFocusedPane(layout.activeWorkspace);
    if (!focusedPane) return;
    const currentTitle =
      titleContext.getTitle(focusedPane.id) ?? focusedPane.title ?? 'shell';
    setPaneRenameState({ show: true, paneId: focusedPane.id, value: currentTitle });
  };

  const handleWorkspaceLabelOpen = () => {
    const workspace = layout.activeWorkspace;
    const currentLabel = workspace.label ?? '';
    setWorkspaceLabelState({
      show: true,
      workspaceId: workspace.id,
      value: currentLabel,
    });
  };

  const hasAnyPanes = () =>
    Object.values(layout.state.workspaces).some(
      (workspace) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0)
    );

  const requestTemplateApplyConfirm = (applyTemplate: () => Promise<void>) => {
    templatePending.setPendingApply(() => applyTemplate);
    confirmationHandlers.handleRequestApplyTemplate();
  };

  const requestTemplateOverwriteConfirm = (overwriteTemplate: () => Promise<void>) => {
    templatePending.setPendingOverwrite(() => overwriteTemplate);
    confirmationHandlers.handleRequestOverwriteTemplate();
  };

  const requestTemplateDeleteConfirm = (deleteTemplate: () => Promise<void>) => {
    templatePending.setPendingDelete(() => deleteTemplate);
    confirmationHandlers.handleRequestDeleteTemplate();
  };

  const requestSessionDeleteConfirm = (deleteSession: () => Promise<void>) => {
    sessionPending.setPendingDelete(() => deleteSession);
    confirmationHandlers.handleRequestDeleteSession();
  };

  // Toggle debug console
  const handleToggleConsole = () => {
    renderer.console.toggle();
  };

  const handleToggleVimMode = () => {
    const current = config.config().keyboard.vimMode;
    const next: KeyboardVimMode = current === 'overlays' ? 'off' : 'overlays';
    setKeyboardVimMode(next);
    config.reloadConfig();
  };

  const searchVimState = createSearchVimState({ config, search });

  // Search mode enter handler
  const handleEnterSearch = async () => {
    // Clear any existing selection so it doesn't hide search highlights
    clearAllSelections();

    // Get the focused pane's PTY ID using centralized utility
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    if (focusedPtyId) {
      await enterSearchMode(focusedPtyId);
    }
  };

  // Aggregate view toggle handler
  const handleToggleAggregateView = () => {
    openAggregateView();
  };

  const executeCommandAction = (action: string) => {
    handleNormalModeAction(
      action,
      keyboardState,
      layout,
      layout.activeWorkspace.layoutMode,
      {
        onPaste: handlePaste,
        onNewPane: handleNewPane,
        onSplitPane: handleSplitPane,
        onQuit: handleQuit,
        onDetach: handleDetach,
        onRequestQuit: confirmationHandlers.handleRequestQuit,
        onRequestClosePane: confirmationHandlers.handleRequestClosePane,
        onToggleSessionPicker: handleToggleSessionPicker,
        onToggleTemplateOverlay: handleToggleTemplateOverlay,
        onEnterSearch: handleEnterSearch,
        onToggleConsole: handleToggleConsole,
        onToggleAggregateView: handleToggleAggregateView,
        onToggleCommandPalette: toggleCommandPalette,
        onToggleVimMode: handleToggleVimMode,
        onRenamePane: handlePaneRenameOpen,
        onLabelWorkspace: handleWorkspaceLabelOpen,
      }
    );
  };

  const handleCommandPaletteExecute = (command: CommandPaletteCommand) => {
    executeCommandAction(command.action);
  };

  const overlayVimMode = createOverlayVimMode({
    config,
    confirmationVisible: () => confirmationState().visible,
    commandPaletteState,
    paneRenameState,
    workspaceLabelState,
    session,
    sessionState,
    aggregateState,
    keyboardState,
    search,
    commandPaletteVimMode,
    paneRenameVimMode,
    workspaceLabelVimMode,
    sessionPickerVimMode,
    templateOverlayVimMode,
    aggregateVimMode,
  });

  createEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const label = await checkForUpdateLabel(controller.signal);
      if (label) setUpdateLabel(label);
    })();

    onCleanup(() => {
      controller.abort();
    });
  });

  // Handle bracketed paste from host terminal (Cmd+V sends this)
  createEffect(() => {
    renderer.keyInput.on('paste', pasteHandler.handleBracketedPaste);

    onCleanup(() => {
      renderer.keyInput.off('paste', pasteHandler.handleBracketedPaste);
    });
  });

  const keyboardHandler = useKeyboardHandler({
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onSplitPane: handleSplitPane,
    onQuit: handleQuit,
    onDetach: handleDetach,
    onRequestQuit: confirmationHandlers.handleRequestQuit,
    onRequestClosePane: confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: handleToggleSessionPicker,
    onToggleTemplateOverlay: handleToggleTemplateOverlay,
    onEnterSearch: handleEnterSearch,
    onToggleConsole: handleToggleConsole,
    onToggleAggregateView: handleToggleAggregateView,
    onToggleCommandPalette: toggleCommandPalette,
    onToggleVimMode: handleToggleVimMode,
    onRenamePane: handlePaneRenameOpen,
    onLabelWorkspace: handleWorkspaceLabelOpen,
  });

  setupAppLayoutEffects({
    width,
    height,
    setViewport,
    sessionState,
    hasAnyPanes,
    newPane,
    ensurePixelResize,
    layout,
    terminal,
    paneResizeHandlers,
    aggregateState,
  });

  setupKeyboardRouting({
    config,
    keyboardHandler,
    keyboardExitSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    getSearchState: () => search.searchState,
    getVimEnabled: () => config.config().keyboard.vimMode === 'overlays',
    getSearchVimMode: searchVimState.getSearchVimMode,
    setSearchVimMode: searchVimState.setSearchVimMode,
    getSearchVimHandler: searchVimState.getSearchVimHandler,
    clearAllSelections,
    getFocusedEmulator,
    writeToFocused,
    isOverlayActive: () => sessionState.showSessionPicker || session.showTemplateOverlay,
  });

  return (
    <box
      style={{
        width: width(),
        height: height(),
        flexDirection: 'column',
      }}
    >
      {/* Main pane area */}
      <PaneContainer />

      <AppOverlays
        width={width()}
        height={height()}
        commandPaletteState={commandPaletteState}
        setCommandPaletteState={setCommandPaletteState}
        onCommandPaletteExecute={handleCommandPaletteExecute}
        paneRenameState={paneRenameState}
        setPaneRenameState={setPaneRenameState}
        workspaceLabelState={workspaceLabelState}
        setWorkspaceLabelState={setWorkspaceLabelState}
        overlayVimMode={overlayVimMode()}
        updateLabel={updateLabel()}
        onCommandPaletteVimModeChange={handleCommandPaletteVimModeChange}
        onPaneRenameVimModeChange={handlePaneRenameVimModeChange}
        onWorkspaceLabelVimModeChange={handleWorkspaceLabelVimModeChange}
        onSessionPickerVimModeChange={handleSessionPickerVimModeChange}
        onTemplateOverlayVimModeChange={handleTemplateOverlayVimModeChange}
        onAggregateVimModeChange={handleAggregateVimModeChange}
        confirmationState={confirmationState}
        onConfirm={confirmationHandlers.handleConfirmAction}
        onCancel={confirmationHandlers.handleCancelConfirmation}
        onRequestApplyConfirm={requestTemplateApplyConfirm}
        onRequestOverwriteConfirm={requestTemplateOverwriteConfirm}
        onRequestDeleteConfirm={requestTemplateDeleteConfirm}
        onRequestDeleteSessionConfirm={requestSessionDeleteConfirm}
        onRequestQuit={confirmationHandlers.handleRequestQuit}
        onDetach={handleDetach}
        onRequestKillPty={confirmationHandlers.handleRequestKillPty}
      />
    </box>
  );
}

function AppWithTerminal() {
  return (
    <TitleProvider>
      <TerminalProvider>
        <SelectionProvider>
          <SearchProvider>
            <SessionBridge>
              <AggregateViewProvider>
                <AppContent />
              </AggregateViewProvider>
            </SessionBridge>
          </SearchProvider>
        </SelectionProvider>
      </TerminalProvider>
    </TitleProvider>
  );
}

export function App() {
  return (
    <ConfigProvider>
      <ConfiguredApp />
    </ConfigProvider>
  );
}

function ConfiguredApp() {
  const config = useConfig();
  const currentConfig = () => config.config();

  return (
    <ThemeProvider theme={currentConfig().theme}>
      <LayoutProvider config={currentConfig().layout}>
        <KeyboardProvider>
          <AppWithTerminal />
        </KeyboardProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
