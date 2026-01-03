import type { KeyboardEvent } from '../../../effect/bridge';

export const isBareEscape = (event: KeyboardEvent) =>
  event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;
