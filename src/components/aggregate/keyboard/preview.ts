import { writeToPty } from '../../../effect/bridge';
import type { KeyboardEvent } from '../../../effect/bridge';
import { encodeKeyForEmulator } from '../../../terminal/key-encoder';
import { eventToCombo, matchKeybinding } from '../../../core/keybindings';
import type { AggregateKeyboardDeps } from './types';
import { isBareEscape } from './helpers';

export function createAggregatePreviewHandler(deps: AggregateKeyboardDeps) {
  const forwardToPreviewPty = (event: KeyboardEvent): boolean => {
    const selectedPtyId = deps.getSelectedPtyId();
    if (selectedPtyId) {
      const emulator = deps.getEmulatorSync(selectedPtyId);
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
      deps.handleEnterSearch();
      return true;
    }

    if (action === 'aggregate.preview.exit') {
      deps.exitPreviewMode();
      return true;
    }

    if (action === 'aggregate.kill') {
      const selectedPtyId = deps.getSelectedPtyId();
      if (selectedPtyId && deps.onRequestKillPty) {
        deps.onRequestKillPty(selectedPtyId);
      }
      return true;
    }

    return false;
  };

  const handlePreviewModeKeys = (event: KeyboardEvent): boolean => {
    if (event.eventType === 'release') {
      if (!deps.getVimEnabled() || deps.getVimMode() === 'insert') {
        return forwardToPreviewPty(event);
      }
      return true;
    }

    const keybindings = deps.getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!deps.getVimEnabled()) {
      const action = matchKeybinding(keybindings.aggregate.preview, keyEvent);
      if (handlePreviewAction(action)) return true;
      return forwardToPreviewPty(event);
    }

    if (deps.getVimMode() === 'insert') {
      if (isBareEscape(event)) {
        const selectedPtyId = deps.getSelectedPtyId();
        const emulator = selectedPtyId ? deps.getEmulatorSync(selectedPtyId) : null;
        const alternateScreen = emulator?.getTerminalState()?.alternateScreen ?? false;
        if (!alternateScreen) {
          deps.setVimMode('normal');
          deps.getVimHandlers().preview.reset();
          return true;
        }
      }
      const action = matchKeybinding(keybindings.aggregate.preview, keyEvent);
      if (handlePreviewAction(action)) return true;
      return forwardToPreviewPty(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      deps.setVimMode('insert');
      deps.getVimHandlers().preview.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = deps.getVimHandlers().preview.handleCombo(combo);
    if (result.pending) return true;
    if (handlePreviewAction(result.action)) return true;

    const shouldMatchBindings = event.ctrl || event.alt || event.meta || event.key.length > 1;
    if (shouldMatchBindings && !isBareEscape(event)) {
      const fallbackAction = matchKeybinding(keybindings.aggregate.preview, keyEvent);
      if (handlePreviewAction(fallbackAction)) return true;
    }

    return true;
  };

  return { handlePreviewModeKeys };
}
