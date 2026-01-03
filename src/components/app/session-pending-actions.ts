/**
 * Pending session delete action helpers.
 */

import { createSignal } from 'solid-js';

type PendingAction = (() => Promise<void>) | null;

type PendingSetters = {
  setPendingDelete: (next: PendingAction | ((prev: PendingAction) => PendingAction)) => void;
};

type PendingHandlers = {
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
};

export function createSessionPendingActions(): PendingSetters & PendingHandlers {
  const [pendingDelete, setPendingDelete] = createSignal<PendingAction>(null);

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
    setPendingDelete,
    confirmDelete,
    cancelDelete,
  };
}
