/**
 * Search context module exports
 */
export type { SearchMatch, SearchState, SearchContextValue } from './types';
export {
  SEARCH_OVERLAY_HEIGHT,
  extractLineText,
  performSearch,
  isCellInMatch,
  calculateScrollOffset,
  buildMatchLookup,
} from './helpers';
