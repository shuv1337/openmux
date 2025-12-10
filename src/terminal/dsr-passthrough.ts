/**
 * DSR (Device Status Report) Passthrough
 *
 * Intercepts DSR queries from PTY output and generates appropriate responses
 * that are written back to the PTY, allowing applications inside openmux panes
 * to query cursor position and terminal status.
 *
 * The flow:
 * 1. Application (e.g., codex) writes ESC[6n to query cursor position
 * 2. This goes through the PTY and arrives at pty.onData()
 * 3. We intercept it, get cursor position from ghostty-web emulator
 * 4. We write the response (ESC[row;colR) back to the PTY
 * 5. Application receives the response
 *
 * Supported queries:
 * - DSR 6 (ESC[6n): Cursor Position Report - responds with ESC[row;colR
 * - DSR 5 (ESC[5n): Device Status Report - responds with ESC[0n (OK)
 */

const ESC = '\x1b';

// DSR query patterns
const DSR_CPR_QUERY = `${ESC}[6n`;  // Cursor Position Report query
const DSR_STATUS_QUERY = `${ESC}[5n`;  // Device Status query

export interface DsrQuery {
  type: 'cpr' | 'status';
  startIndex: number;
  endIndex: number;
}

export interface DsrParseResult {
  /** Text to pass through to emulator (without DSR queries) */
  textSegments: string[];
  /** DSR queries that need responses */
  queries: DsrQuery[];
}

/**
 * Quick check if data might contain DSR queries
 */
function mightContainDsr(data: string): boolean {
  return data.includes(`${ESC}[`) && (data.includes('6n') || data.includes('5n'));
}

/**
 * Parse PTY output for DSR queries
 */
export function parseDsrQueries(data: string): DsrParseResult {
  const textSegments: string[] = [];
  const queries: DsrQuery[] = [];

  if (!mightContainDsr(data)) {
    return { textSegments: [data], queries: [] };
  }

  let currentIndex = 0;
  let textStart = 0;

  while (currentIndex < data.length) {
    // Check for CPR query (ESC[6n)
    if (currentIndex + 4 <= data.length && data.startsWith(DSR_CPR_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'cpr',
        startIndex: currentIndex,
        endIndex: currentIndex + 4,
      });
      currentIndex += 4;
      textStart = currentIndex;
      continue;
    }

    // Check for Device Status query (ESC[5n)
    if (currentIndex + 4 <= data.length && data.startsWith(DSR_STATUS_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'status',
        startIndex: currentIndex,
        endIndex: currentIndex + 4,
      });
      currentIndex += 4;
      textStart = currentIndex;
      continue;
    }

    currentIndex++;
  }

  // Add remaining text
  if (textStart < data.length) {
    textSegments.push(data.slice(textStart));
  }

  return { textSegments, queries };
}

/**
 * Generate a CPR (Cursor Position Report) response
 * Format: ESC[row;colR (1-based positions)
 */
export function generateCprResponse(row: number, col: number): string {
  // Convert to 1-based positions for the response
  return `${ESC}[${row + 1};${col + 1}R`;
}

/**
 * Generate a Device Status OK response
 * Format: ESC[0n
 */
export function generateStatusOkResponse(): string {
  return `${ESC}[0n`;
}

/**
 * DSR Passthrough handler for a PTY session
 *
 * Intercepts DSR queries from PTY output, generates responses using
 * cursor position from the emulator, and writes them back to the PTY.
 */
export class DsrPassthrough {
  private ptyWriter: ((data: string) => void) | null = null;
  private cursorGetter: (() => { x: number; y: number }) | null = null;

  constructor() {}

  /**
   * Set the PTY writer function (called to write responses back to PTY)
   */
  setPtyWriter(writer: (data: string) => void): void {
    this.ptyWriter = writer;
  }

  /**
   * Set the cursor getter function (called to get current cursor position)
   */
  setCursorGetter(getter: () => { x: number; y: number }): void {
    this.cursorGetter = getter;
  }

  /**
   * Process PTY data, intercepting DSR queries and generating responses
   * Returns the data to send to the emulator (without DSR queries)
   */
  process(data: string): string {
    const result = parseDsrQueries(data);

    // Handle DSR queries
    if (result.queries.length > 0) {
      for (const query of result.queries) {
        this.handleQuery(query);
      }
    }

    // Return text segments joined (without DSR queries)
    return result.textSegments.join('');
  }

  /**
   * Handle a DSR query by generating and sending the appropriate response
   */
  private handleQuery(query: DsrQuery): void {
    if (!this.ptyWriter) return;

    if (query.type === 'cpr') {
      // Get cursor position from emulator
      const cursor = this.cursorGetter?.() ?? { x: 0, y: 0 };
      const response = generateCprResponse(cursor.y, cursor.x);
      this.ptyWriter(response);
    } else if (query.type === 'status') {
      // Device is OK
      const response = generateStatusOkResponse();
      this.ptyWriter(response);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.ptyWriter = null;
    this.cursorGetter = null;
  }
}
