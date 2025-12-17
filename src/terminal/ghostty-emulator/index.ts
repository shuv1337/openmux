/**
 * Ghostty emulator utilities.
 * These are shared utilities used by the Web Worker terminal emulator.
 */

// Codepoint utilities
export {
  isValidCodepoint,
  isCjkIdeograph,
  isSpaceLikeChar,
  isZeroWidthChar,
  codepointToChar,
} from './codepoint-utils';

// Cell conversion utilities
export {
  safeRgb,
  createEmptyCell,
  createFillCell,
  convertCell,
  convertLine,
  createEmptyRow,
} from './cell-converter';
export type { RGB } from './cell-converter';
