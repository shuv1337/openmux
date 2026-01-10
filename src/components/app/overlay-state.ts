/**
 * Overlay state container for App.
 */

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { VimInputMode } from '../../core/vim-sequences';
import { createCommandPaletteState } from './command-palette-state';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';

export function createOverlayState() {
  const commandPalette = createCommandPaletteState();
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

  return {
    ...commandPalette,
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
  };
}
