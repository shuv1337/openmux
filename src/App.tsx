/**
 * Main App component for openmux
 */

import { useTerminalDimensions, useRenderer } from '@opentui/solid';
import {
  useConfig,
  useLayout,
  useKeyboardHandler,
  useKeyboardState,
  useTerminal,
} from './contexts';
import { useSelection } from './contexts/SelectionContext';
import { useSearch } from './contexts/SearchContext';
import { useSession } from './contexts/SessionContext';
import { useAggregateView } from './contexts/AggregateViewContext';
import { useTitle } from './contexts/TitleContext';
import { PaneContainer } from './components';
import { getFocusedPane, getFocusedPtyId } from './core/workspace-utils';
import { type CommandPaletteCommand } from './core/command-palette';
import { setKeyboardVimMode, type KeyboardVimMode } from './core/user-config';
import { onShimDetached, shutdownShim } from './effect/bridge';
import { disposeRuntime } from './effect/runtime';
import {
  createPaneResizeHandlers,
  createPasteHandler,
} from './components/app';
import { setClipboardPasteHandler } from './terminal/focused-pty-registry';
import { readFromClipboard } from './effect/bridge';
import { handleNormalModeAction } from './contexts/keyboard/handlers';
import { setupKeyboardRouting } from './components/app/keyboard-routing';
import { usePtyCreation } from './components/app/pty-creation';
import { AppOverlays } from './components/app/AppOverlays';
import { createKittyGraphicsBridge } from './components/app/kitty-graphics-bridge';
import { createCellMetricsGetter, createPixelResizeTracker } from './components/app/pixel-metrics';
import { createExitHandlers } from './components/app/exit-handlers';
import { createSearchVimState } from './components/app/search-vim';
import { createOverlayVimMode } from './components/app/overlay-vim-mode';
import { setupAppLayoutEffects } from './components/app/layout-effects';
import { createOverlayState } from './components/app/overlay-state';
import { createConfirmationWorkflows } from './components/app/confirmation-workflows';
import { setupAppEffects } from './components/app/app-effects';
import { AppProviders } from './components/app/AppProviders';
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

  const overlayState = createOverlayState();
  const {
    commandPaletteState,
    setCommandPaletteState,
    toggleCommandPalette,
    paneRenameState,
    setPaneRenameState,
    workspaceLabelState,
    setWorkspaceLabelState,
    commandPaletteVimMode,
    setCommandPaletteVimMode,
    paneRenameVimMode,
    setPaneRenameVimMode,
    workspaceLabelVimMode,
    setWorkspaceLabelVimMode,
    sessionPickerVimMode,
    setSessionPickerVimMode,
    templateOverlayVimMode,
    setTemplateOverlayVimMode,
    aggregateVimMode,
    setAggregateVimMode,
    updateLabel,
    setUpdateLabel,
  } = overlayState;

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
  const confirmationWorkflows = createConfirmationWorkflows({
    closePane,
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    destroyPTY,
    enterConfirmMode,
    exitConfirmMode,
    onQuit: handleQuit,
  });
  const {
    confirmationState,
    confirmationHandlers,
    requestTemplateApplyConfirm,
    requestTemplateOverwriteConfirm,
    requestTemplateDeleteConfirm,
    requestSessionDeleteConfirm,
  } = confirmationWorkflows;

  // Create paste handler for bracketed paste from host terminal
  const pasteHandler = createPasteHandler({
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    writeToPTY,
  });
  setupAppEffects({
    getWidth: width,
    getHeight: height,
    sessionState,
    session,
    layout,
    search,
    selection,
    aggregateState,
    commandPaletteState,
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
    renderer,
    pasteHandler,
    setUpdateLabel,
    setClipboardPasteHandler,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached: exitHandlers.handleShimDetached,
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    isPtyActive,
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
        onToggleSessionPicker: togglePicker,
        onToggleTemplateOverlay: toggleTemplateOverlay,
        onEnterSearch: handleEnterSearch,
        onToggleConsole: handleToggleConsole,
        onToggleAggregateView: openAggregateView,
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

  const keyboardHandler = useKeyboardHandler({
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onSplitPane: handleSplitPane,
    onQuit: handleQuit,
    onDetach: handleDetach,
    onRequestQuit: confirmationHandlers.handleRequestQuit,
    onRequestClosePane: confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: togglePicker,
    onToggleTemplateOverlay: toggleTemplateOverlay,
    onEnterSearch: handleEnterSearch,
    onToggleConsole: handleToggleConsole,
    onToggleAggregateView: openAggregateView,
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
        onCommandPaletteVimModeChange={setCommandPaletteVimMode}
        onPaneRenameVimModeChange={setPaneRenameVimMode}
        onWorkspaceLabelVimModeChange={setWorkspaceLabelVimMode}
        onSessionPickerVimModeChange={setSessionPickerVimMode}
        onTemplateOverlayVimModeChange={setTemplateOverlayVimMode}
        onAggregateVimModeChange={setAggregateVimMode}
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

export function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
