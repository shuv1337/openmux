/**
 * Session picker action helpers.
 */

import type { SessionId } from '../core/types';
import type { SessionAction } from '../core/operations/session-actions';

export function createSessionPickerActions(dispatch: (action: SessionAction) => void) {
  const togglePicker = () => {
    dispatch({ type: 'TOGGLE_SESSION_PICKER' });
  };

  const closePicker = () => {
    dispatch({ type: 'CLOSE_SESSION_PICKER' });
  };

  const setSearchQuery = (query: string) => {
    dispatch({ type: 'SET_SEARCH_QUERY', query });
  };

  const startRename = (id: SessionId, currentName: string) => {
    dispatch({ type: 'START_RENAME', sessionId: id, currentName });
  };

  const cancelRename = () => {
    dispatch({ type: 'CANCEL_RENAME' });
  };

  const updateRenameValue = (value: string) => {
    dispatch({ type: 'UPDATE_RENAME_VALUE', value });
  };

  const navigateUp = () => {
    dispatch({ type: 'NAVIGATE_UP' });
  };

  const navigateDown = () => {
    dispatch({ type: 'NAVIGATE_DOWN' });
  };

  return {
    togglePicker,
    closePicker,
    setSearchQuery,
    startRename,
    cancelRename,
    updateRenameValue,
    navigateUp,
    navigateDown,
  };
}
