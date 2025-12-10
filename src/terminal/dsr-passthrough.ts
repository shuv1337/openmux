/**
 * DSR (Device Status Report), DA (Device Attributes), and OSC Query Passthrough
 *
 * Intercepts DSR, DA, and OSC queries from PTY output and generates appropriate responses
 * that are written back to the PTY, allowing applications inside openmux panes
 * to query cursor position, terminal status, capabilities, and colors.
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
 * - DA1 (ESC[c or ESC[0c): Primary Device Attributes - responds with VT220 capabilities
 * - DA2 (ESC[>c or ESC[>0c): Secondary Device Attributes - responds with VT500 type
 * - OSC 10 (ESC]10;?): Foreground color query - responds with ESC]10;rgb:rr/gg/bb
 * - OSC 11 (ESC]11;?): Background color query - responds with ESC]11;rgb:rr/gg/bb
 */

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;

// DSR query patterns
const DSR_CPR_QUERY = `${ESC}[6n`;  // Cursor Position Report query
const DSR_STATUS_QUERY = `${ESC}[5n`;  // Device Status query

// Device Attributes query patterns
const DA1_QUERY = `${ESC}[c`;  // Primary Device Attributes (short form)
const DA1_QUERY_FULL = `${ESC}[0c`;  // Primary Device Attributes (explicit)
const DA2_QUERY = `${ESC}[>c`;  // Secondary Device Attributes (short form)
const DA2_QUERY_FULL = `${ESC}[>0c`;  // Secondary Device Attributes (explicit)

// OSC color query patterns - can end with BEL or ST
// OSC 10;? = query foreground, OSC 11;? = query background
const OSC_FG_QUERY_BEL = `${ESC}]10;?${BEL}`;
const OSC_FG_QUERY_ST = `${ESC}]10;?${ST}`;
const OSC_BG_QUERY_BEL = `${ESC}]11;?${BEL}`;
const OSC_BG_QUERY_ST = `${ESC}]11;?${ST}`;

export interface DsrQuery {
  type: 'cpr' | 'status' | 'da1' | 'da2' | 'osc-fg' | 'osc-bg';
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
 * Quick check if data might contain DSR, DA, or OSC queries
 */
function mightContainQueries(data: string): boolean {
  // Check for DSR queries (ESC[5n, ESC[6n) and DA queries (ESC[c, ESC[>c)
  if (data.includes(`${ESC}[`)) {
    if (data.includes('6n') || data.includes('5n') || data.includes('c')) {
      return true;
    }
  }
  // Check for OSC color queries (ESC]10;? or ESC]11;?)
  if (data.includes(`${ESC}]`) && data.includes(';?')) {
    return true;
  }
  return false;
}

/**
 * Parse PTY output for DSR and OSC queries
 */
export function parseDsrQueries(data: string): DsrParseResult {
  const textSegments: string[] = [];
  const queries: DsrQuery[] = [];

  if (!mightContainQueries(data)) {
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

    // Check for DA2 (Secondary Device Attributes) - must check before DA1
    // DA2: ESC[>c or ESC[>0c
    if (data.startsWith(DA2_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da2',
        startIndex: currentIndex,
        endIndex: currentIndex + DA2_QUERY_FULL.length,
      });
      currentIndex += DA2_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA2_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da2',
        startIndex: currentIndex,
        endIndex: currentIndex + DA2_QUERY.length,
      });
      currentIndex += DA2_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DA1 (Primary Device Attributes)
    // DA1: ESC[c or ESC[0c
    if (data.startsWith(DA1_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da1',
        startIndex: currentIndex,
        endIndex: currentIndex + DA1_QUERY_FULL.length,
      });
      currentIndex += DA1_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA1_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da1',
        startIndex: currentIndex,
        endIndex: currentIndex + DA1_QUERY.length,
      });
      currentIndex += DA1_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for OSC foreground color query (ESC]10;? with BEL or ST terminator)
    if (data.startsWith(OSC_FG_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-fg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_FG_QUERY_BEL.length,
      });
      currentIndex += OSC_FG_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_FG_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-fg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_FG_QUERY_ST.length,
      });
      currentIndex += OSC_FG_QUERY_ST.length;
      textStart = currentIndex;
      continue;
    }

    // Check for OSC background color query (ESC]11;? with BEL or ST terminator)
    if (data.startsWith(OSC_BG_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-bg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_BG_QUERY_BEL.length,
      });
      currentIndex += OSC_BG_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_BG_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-bg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_BG_QUERY_ST.length,
      });
      currentIndex += OSC_BG_QUERY_ST.length;
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
 * Generate an OSC foreground color response
 * Format: ESC]10;rgb:rrrr/gggg/bbbb ESC\
 * Note: Uses 16-bit color values (multiply 8-bit by 257 to get rrrr format)
 */
export function generateOscFgResponse(r: number, g: number, b: number): string {
  const r16 = (r * 257).toString(16).padStart(4, '0');
  const g16 = (g * 257).toString(16).padStart(4, '0');
  const b16 = (b * 257).toString(16).padStart(4, '0');
  return `${ESC}]10;rgb:${r16}/${g16}/${b16}${ST}`;
}

/**
 * Generate an OSC background color response
 * Format: ESC]11;rgb:rrrr/gggg/bbbb ESC\
 */
export function generateOscBgResponse(r: number, g: number, b: number): string {
  const r16 = (r * 257).toString(16).padStart(4, '0');
  const g16 = (g * 257).toString(16).padStart(4, '0');
  const b16 = (b * 257).toString(16).padStart(4, '0');
  return `${ESC}]11;rgb:${r16}/${g16}/${b16}${ST}`;
}

/**
 * Generate a Primary Device Attributes (DA1) response
 * Format: ESC[?62;1;4;22c - Reports VT220 with capabilities:
 * - 62: VT220
 * - 1: 132 columns
 * - 4: Sixel graphics
 * - 22: ANSI color
 */
export function generateDa1Response(): string {
  return `${ESC}[?62;1;4;22c`;
}

/**
 * Generate a Secondary Device Attributes (DA2) response
 * Format: ESC[>Pp;Pv;Pc c
 * - Pp = Terminal type (65 = VT500)
 * - Pv = Firmware version (100)
 * - Pc = ROM cartridge registration (0 = none)
 */
export function generateDa2Response(): string {
  return `${ESC}[>65;100;0c`;
}

/**
 * DSR, DA, and OSC Passthrough handler for a PTY session
 *
 * Intercepts DSR and OSC queries from PTY output, generates responses using
 * cursor position and colors from the emulator, and writes them back to the PTY.
 */
export class DsrPassthrough {
  private ptyWriter: ((data: string) => void) | null = null;
  private cursorGetter: (() => { x: number; y: number }) | null = null;
  private colorsGetter: (() => { foreground: number; background: number }) | null = null;

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
   * Set the colors getter function (called to get terminal colors for OSC queries)
   * Colors should be in 0xRRGGBB format
   */
  setColorsGetter(getter: () => { foreground: number; background: number }): void {
    this.colorsGetter = getter;
  }

  /**
   * Process PTY data, intercepting DSR and OSC queries and generating responses
   * Returns the data to send to the emulator (without queries)
   */
  process(data: string): string {
    const result = parseDsrQueries(data);

    // Handle queries
    if (result.queries.length > 0) {
      for (const query of result.queries) {
        this.handleQuery(query);
      }
    }

    // Return text segments joined (without queries)
    return result.textSegments.join('');
  }

  /**
   * Handle a query by generating and sending the appropriate response
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
    } else if (query.type === 'osc-fg') {
      // Get foreground color
      const colors = this.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
      const r = (colors.foreground >> 16) & 0xFF;
      const g = (colors.foreground >> 8) & 0xFF;
      const b = colors.foreground & 0xFF;
      const response = generateOscFgResponse(r, g, b);
      this.ptyWriter(response);
    } else if (query.type === 'da1') {
      // Primary Device Attributes - report VT220 capabilities
      const response = generateDa1Response();
      this.ptyWriter(response);
    } else if (query.type === 'da2') {
      // Secondary Device Attributes - report VT500 type
      const response = generateDa2Response();
      this.ptyWriter(response);
    } else if (query.type === 'osc-bg') {
      // Get background color
      const colors = this.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
      const r = (colors.background >> 16) & 0xFF;
      const g = (colors.background >> 8) & 0xFF;
      const b = colors.background & 0xFF;
      const response = generateOscBgResponse(r, g, b);
      this.ptyWriter(response);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.ptyWriter = null;
    this.cursorGetter = null;
    this.colorsGetter = null;
  }
}
