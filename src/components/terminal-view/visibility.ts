import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import { setPtyUpdateEnabled as setPtyUpdateEnabledBridge } from '../../effect/bridge';

const visiblePtyCounts = new Map<string, number>();

const applyUpdateGate = (ptyId: string, enabled: boolean, emulator?: ITerminalEmulator | null) => {
  void setPtyUpdateEnabledBridge(ptyId, enabled);
  if (emulator && !emulator.isDisposed) {
    emulator.setUpdateEnabled?.(enabled);
  }
};

export const registerVisiblePty = (ptyId: string) => {
  const count = (visiblePtyCounts.get(ptyId) ?? 0) + 1;
  visiblePtyCounts.set(ptyId, count);
  if (count === 1) {
    applyUpdateGate(ptyId, true);
  }
};

export const attachVisibleEmulator = (ptyId: string, emulator: ITerminalEmulator | null) => {
  if (!emulator) return;
  if ((visiblePtyCounts.get(ptyId) ?? 0) > 0) {
    applyUpdateGate(ptyId, true, emulator);
  }
};

export const unregisterVisiblePty = (ptyId: string, emulator: ITerminalEmulator | null) => {
  const count = (visiblePtyCounts.get(ptyId) ?? 0) - 1;
  if (count <= 0) {
    visiblePtyCounts.delete(ptyId);
    applyUpdateGate(ptyId, false, emulator);
    return;
  }
  visiblePtyCounts.set(ptyId, count);
};

export const clearVisiblePty = (ptyId: string) => {
  visiblePtyCounts.delete(ptyId);
};
