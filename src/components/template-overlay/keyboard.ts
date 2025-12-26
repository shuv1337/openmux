/**
 * Keyboard handler helpers for template overlay.
 */

import type { Accessor } from 'solid-js';
import { matchKeybinding, type ResolvedKeybindingMap } from '../../core/keybindings';
import type { KeyboardEvent } from '../../effect/bridge';

export type TemplateTabMode = 'apply' | 'save';

type TemplateOverlayKeyHandlerParams = {
  tab: Accessor<TemplateTabMode>;
  setTab: (mode: TemplateTabMode) => void;
  getTemplateCount: () => number;
  setSelectedIndex: (value: (current: number) => number) => void;
  onApply: () => void;
  onDelete: () => void;
  onClose: () => void;
  onSave: () => void;
  setSaveName: (value: (current: string) => string) => void;
  applyBindings: ResolvedKeybindingMap;
  saveBindings: ResolvedKeybindingMap;
};

export function createTemplateOverlayKeyHandler(params: TemplateOverlayKeyHandlerParams) {
  const handleApplyKeys = (event: KeyboardEvent) => {
    const action = matchKeybinding(params.applyBindings, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    });
    const count = params.getTemplateCount();
    switch (action) {
      case 'template.close':
        params.onClose();
        return true;
      case 'template.tab.save':
        params.setTab('save');
        return true;
      case 'template.list.down':
        if (count > 0) {
          params.setSelectedIndex((value) => Math.min(count - 1, value + 1));
        }
        return true;
      case 'template.list.up':
        if (count > 0) {
          params.setSelectedIndex((value) => Math.max(0, value - 1));
        }
        return true;
      case 'template.delete':
        params.onDelete();
        return true;
      case 'template.apply':
        params.onApply();
        return true;
      default:
        return true;
    }
  };

  const handleSaveKeys = (event: KeyboardEvent) => {
    const action = matchKeybinding(params.saveBindings, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    });

    switch (action) {
      case 'template.close':
        params.onClose();
        return true;
      case 'template.tab.apply':
        params.setTab('apply');
        return true;
      case 'template.save.delete':
        params.setSaveName((value) => value.slice(0, -1));
        return true;
      case 'template.save':
        params.onSave();
        return true;
      default:
        break;
    }

    const input = event.sequence ?? (event.key.length === 1 ? event.key : '');
    const charCode = input.charCodeAt(0) ?? 0;
    const isPrintable = input.length === 1 && charCode >= 32 && charCode < 127;
    if (isPrintable && !event.ctrl && !event.alt && !event.meta) {
      params.setSaveName((value) => value + input);
      return true;
    }
    return true;
  };

  return (event: KeyboardEvent) => {
    if (params.tab() === 'apply') {
      return handleApplyKeys(event);
    }
    return handleSaveKeys(event);
  };
}
