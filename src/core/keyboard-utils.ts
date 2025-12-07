/**
 * Direction utilities for keyboard navigation
 */

import type { Direction } from './types';

/** Convert hjkl to Direction */
export function keyToDirection(key: string): Direction | null {
  const map: Record<string, Direction> = {
    h: 'west',
    j: 'south',
    k: 'north',
    l: 'east',
  };
  return map[key.toLowerCase()] ?? null;
}
