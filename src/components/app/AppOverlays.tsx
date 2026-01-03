/**
 * App overlay stack extracted from App.
 */

import type { Accessor } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { useLayout } from '../../contexts';
import { useSelection } from '../../contexts/SelectionContext';
import { useAggregateView } from '../../contexts/AggregateViewContext';
import type { ConfirmationType } from '../../core/types';
import type { VimInputMode } from '../../core/vim-sequences';
import { DEFAULT_COMMAND_PALETTE_COMMANDS, type CommandPaletteCommand } from '../../core/command-palette';
import {
  StatusBar,
  CopyNotification,
  ConfirmationDialog,
} from '../index';
import { SessionPicker } from '../SessionPicker';
import { SearchOverlay } from '../SearchOverlay';
import { AggregateView } from '../AggregateView';
import { CommandPalette, type CommandPaletteState } from '../CommandPalette';
import { TemplateOverlay } from '../TemplateOverlay';
import { calculateLayoutDimensions } from '../aggregate';

interface AppOverlaysProps {
  width: number;
  height: number;
  commandPaletteState: CommandPaletteState;
  setCommandPaletteState: SetStoreFunction<CommandPaletteState>;
  onCommandPaletteExecute: (command: CommandPaletteCommand) => void;
  overlayVimMode: VimInputMode | null;
  onCommandPaletteVimModeChange: (mode: VimInputMode) => void;
  onSessionPickerVimModeChange: (mode: VimInputMode) => void;
  onTemplateOverlayVimModeChange: (mode: VimInputMode) => void;
  onAggregateVimModeChange: (mode: VimInputMode) => void;
  confirmationState: Accessor<{ visible: boolean; type: ConfirmationType }>;
  onConfirm: () => void;
  onCancel: () => void;
  onRequestApplyConfirm: (applyTemplate: () => Promise<void>) => void;
  onRequestOverwriteConfirm: (overwriteTemplate: () => Promise<void>) => void;
  onRequestDeleteConfirm: (deleteTemplate: () => Promise<void>) => void;
  onRequestDeleteSessionConfirm: (deleteSession: () => Promise<void>) => void;
  onRequestQuit: () => void;
  onDetach: () => void;
  onRequestKillPty: (ptyId: string) => void;
}

export function AppOverlays(props: AppOverlaysProps) {
  const selection = useSelection();
  const layout = useLayout();
  const { state: aggregateState } = useAggregateView();

  return (
    <>
      <StatusBar
        width={props.width}
        showCommandPalette={props.commandPaletteState.show}
        overlayVimMode={props.overlayVimMode}
      />

      <SessionPicker
        width={props.width}
        height={props.height}
        onRequestDeleteConfirm={props.onRequestDeleteSessionConfirm}
        onVimModeChange={props.onSessionPickerVimModeChange}
      />

      <TemplateOverlay
        width={props.width}
        height={props.height}
        onRequestApplyConfirm={props.onRequestApplyConfirm}
        onRequestOverwriteConfirm={props.onRequestOverwriteConfirm}
        onRequestDeleteConfirm={props.onRequestDeleteConfirm}
        onVimModeChange={props.onTemplateOverlayVimModeChange}
      />

      <CommandPalette
        width={props.width}
        height={props.height}
        commands={DEFAULT_COMMAND_PALETTE_COMMANDS}
        state={props.commandPaletteState}
        setState={props.setCommandPaletteState}
        onExecute={props.onCommandPaletteExecute}
        onVimModeChange={props.onCommandPaletteVimModeChange}
      />

      <SearchOverlay width={props.width} height={props.height} />

      <AggregateView
        width={props.width}
        height={props.height}
        onRequestQuit={props.onRequestQuit}
        onDetach={props.onDetach}
        onRequestKillPty={props.onRequestKillPty}
        onVimModeChange={props.onAggregateVimModeChange}
      />

      <ConfirmationDialog
        visible={props.confirmationState().visible}
        type={props.confirmationState().type}
        width={props.width}
        height={props.height}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
      />

      <CopyNotification
        visible={selection.copyNotification.visible}
        charCount={selection.copyNotification.charCount}
        paneRect={(() => {
          const ptyId = selection.copyNotification.ptyId;
          if (!ptyId) return null;

          if (aggregateState.showAggregateView && aggregateState.selectedPtyId === ptyId) {
            const aggLayout = calculateLayoutDimensions({ width: props.width, height: props.height });
            return {
              x: aggLayout.listPaneWidth,
              y: 0,
              width: aggLayout.previewPaneWidth,
              height: aggLayout.contentHeight,
            };
          }

          return layout.panes.find((p) => p.ptyId === ptyId)?.rectangle ?? null;
        })()}
      />
    </>
  );
}
