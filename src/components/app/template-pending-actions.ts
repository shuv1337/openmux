/**
 * Pending template apply/overwrite/delete action helpers.
 */

import { createSignal } from 'solid-js';

type PendingAction = (() => Promise<void>) | null;

type PendingSetters = {
  setPendingApply: (next: PendingAction | ((prev: PendingAction) => PendingAction)) => void;
  setPendingOverwrite: (next: PendingAction | ((prev: PendingAction) => PendingAction)) => void;
  setPendingDelete: (next: PendingAction | ((prev: PendingAction) => PendingAction)) => void;
};

type PendingHandlers = {
  confirmApply: () => Promise<void>;
  cancelApply: () => void;
  confirmOverwrite: () => Promise<void>;
  cancelOverwrite: () => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
};

export function createTemplatePendingActions(): PendingSetters & PendingHandlers {
  const [pendingApply, setPendingApply] = createSignal<PendingAction>(null);
  const [pendingOverwrite, setPendingOverwrite] = createSignal<PendingAction>(null);
  const [pendingDelete, setPendingDelete] = createSignal<PendingAction>(null);

  const confirmApply = async () => {
    const pending = pendingApply();
    if (pending) {
      await pending();
    }
    setPendingApply(null);
  };

  const cancelApply = () => {
    setPendingApply(null);
  };

  const confirmOverwrite = async () => {
    const pending = pendingOverwrite();
    if (pending) {
      await pending();
    }
    setPendingOverwrite(null);
  };

  const cancelOverwrite = () => {
    setPendingOverwrite(null);
  };

  const confirmDelete = async () => {
    const pending = pendingDelete();
    if (pending) {
      await pending();
    }
    setPendingDelete(null);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
  };

  return {
    setPendingApply,
    setPendingOverwrite,
    setPendingDelete,
    confirmApply,
    cancelApply,
    confirmOverwrite,
    cancelOverwrite,
    confirmDelete,
    cancelDelete,
  };
}
