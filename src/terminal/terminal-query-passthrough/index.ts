/**
 * Terminal Query Passthrough Module
 *
 * Intercepts terminal queries from PTY output and generates appropriate responses.
 */

// Main class
export { TerminalQueryPassthrough } from './passthrough';

// Types
export type { TerminalQuery, QueryParseResult, QueryType } from './types';

// Parser (for testing or direct use)
export { parseTerminalQueries, mightContainQueries } from './parser';

// Response generators (for testing or direct use)
export * from './responses';

// Constants (for testing or extensions)
export * from './constants';
