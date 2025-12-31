/**
 * Terminal Query Passthrough
 *
 * Intercepts terminal queries from PTY output and generates appropriate responses
 * that are written back to the PTY, allowing applications inside openmux panes
 * to query cursor position, terminal status, capabilities, modes, and colors.
 *
 * The flow:
 * 1. Application (e.g., codex) writes ESC[6n to query cursor position
 * 2. This goes through the PTY and arrives at pty.onData()
 * 3. We intercept it, get cursor position from the emulator
 * 4. We write the response (ESC[row;colR) back to the PTY
 * 5. Application receives the response
 *
 * Supported queries:
 * - DSR 5 (ESC[5n): Device Status Report - responds with ESC[0n (OK)
 * - DSR 6 (ESC[6n): Cursor Position Report - responds with ESC[row;colR
 * - DA1 (ESC[c or ESC[0c): Primary Device Attributes - responds with VT220 capabilities
 * - DA2 (ESC[>c or ESC[>0c): Secondary Device Attributes - responds with VT500 type
 * - DA3 (ESC[=c or ESC[=0c): Tertiary Device Attributes - responds with unit ID
 * - XTVERSION (ESC[>q or ESC[>0q): Terminal version - responds with DCS>|openmux(version)ST
 * - DECRQM (ESC[?Ps$p): Request DEC private mode - responds with mode status
 * - XTGETTCAP (DCS+q...ST): Termcap/terminfo query - responds with capability values
 * - Kitty Keyboard Query (ESC[?u): Query keyboard protocol flags
 * - XTWINOPS (ESC[14t, 16t, 18t): Window size queries
 * - DECXCPR (ESC[?6n): Extended cursor position report
 * - OSC 4 (ESC]4;index;?): Palette color query
 * - OSC 10 (ESC]10;?): Foreground color query - responds with ESC]10;rgb:rr/gg/bb
 * - OSC 11 (ESC]11;?): Background color query - responds with ESC]11;rgb:rr/gg/bb
 * - OSC 12 (ESC]12;?): Cursor color query - responds with ESC]12;rgb:rr/gg/bb
 * - OSC 52 (ESC]52;sel;?): Clipboard query - responds with empty (security)
 * - DECRQSS (DCS$q...ST): Request status string - responds with current state
 */

import type { TerminalQuery } from './types';
import { parseTerminalQueries } from './parser';
import { tracePtyEvent } from '../pty-trace';
import { KNOWN_CAPABILITIES, KNOWN_MODES, DEFAULT_PALETTE } from './constants';
import {
  hexToString,
  generateCprResponse,
  generateDecxcprResponse,
  generateStatusOkResponse,
  generateDa1Response,
  generateDa2Response,
  generateDa3Response,
  generateOscFgResponse,
  generateOscBgResponse,
  generateOscCursorResponse,
  generateOscPaletteResponse,
  generateDecrpmResponse,
  generateXtgettcapResponse,
  generateXtwinopsResponse,
  generateXtversionResponse,
  generateKittyKeyboardResponse,
  generateDecrqssValidResponse,
  generateDecrqssInvalidResponse,
  generateOscClipboardEmptyResponse,
} from './responses';

export class TerminalQueryPassthrough {
  private ptyWriter: ((data: string) => void) | null = null;
  private cursorGetter: (() => { x: number; y: number }) | null = null;
  private colorsGetter: (() => { foreground: number; background: number }) | null = null;
  private modeGetter: ((mode: number) => boolean | null) | null = null;
  private paletteGetter: ((index: number) => number | null) | null = null;
  private sizeGetter: (() => {
    cols: number;
    rows: number;
    pixelWidth: number;
    pixelHeight: number;
    cellWidth: number;
    cellHeight: number;
  }) | null = null;
  private kittyKeyboardFlags: number = 0;
  private kittyKeyboardFlagsGetter: (() => number) | null = null;
  private terminalVersion: string = '0.1.0';
  private cursorColor: number = 0xFFFFFF;
  private pendingInput: string = '';
  private readonly pendingLimit = 8192;

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
   * Set the mode getter function (called to get DEC private mode state)
   * Returns true if set, false if reset, null if unknown
   */
  setModeGetter(getter: (mode: number) => boolean | null): void {
    this.modeGetter = getter;
  }

  /**
   * Set the Kitty keyboard protocol flags
   */
  setKittyKeyboardFlags(flags: number): void {
    this.kittyKeyboardFlags = flags;
  }

  /**
   * Set a getter for Kitty keyboard protocol flags.
   * This allows dynamic querying of the current flags.
   */
  setKittyKeyboardFlagsGetter(getter: () => number): void {
    this.kittyKeyboardFlagsGetter = getter;
  }

  /**
   * Set the terminal version string for XTVERSION responses
   */
  setTerminalVersion(version: string): void {
    this.terminalVersion = version;
  }

  /**
   * Set the palette getter function (called to get palette colors for OSC 4 queries)
   * Returns color in 0xRRGGBB format, or null to use default palette
   */
  setPaletteGetter(getter: (index: number) => number | null): void {
    this.paletteGetter = getter;
  }

  /**
   * Set the size getter function (called to get terminal dimensions for XTWINOPS)
   */
  setSizeGetter(getter: () => {
    cols: number;
    rows: number;
    pixelWidth: number;
    pixelHeight: number;
    cellWidth: number;
    cellHeight: number;
  }): void {
    this.sizeGetter = getter;
  }

  /**
   * Set the cursor color for OSC 12 queries (0xRRGGBB format)
   */
  setCursorColor(color: number): void {
    this.cursorColor = color;
  }

  /**
   * Process PTY data, intercepting terminal queries and generating responses
   * Returns the data to send to the emulator (without queries)
   */
  process(data: string): string {
    tracePtyEvent('query-process-start', { len: data.length });
    let input = this.pendingInput + data;
    this.pendingInput = '';

    const pendingStart = this.findIncompleteSequenceStart(input);
    if (pendingStart !== null) {
      this.pendingInput = input.slice(pendingStart);
      input = input.slice(0, pendingStart);
      if (this.pendingInput.length > this.pendingLimit) {
        input += this.pendingInput;
        this.pendingInput = '';
      }
    }

    if (input.length === 0) {
      return '';
    }

    const result = parseTerminalQueries(input);
    tracePtyEvent('query-process-parsed', {
      queryCount: result.queries.length,
      queryTypes: result.queries.map((query) => query.type),
      textCount: result.textSegments.length,
    });

    // Handle queries
    if (result.queries.length > 0) {
      for (const query of result.queries) {
        this.handleQuery(query);
      }
    }

    // Return text segments joined (without queries)
    const text = result.textSegments.join('');
    return this.stripKittyResponses(text);
  }

  /**
   * Process PTY data while capturing responses instead of writing to the PTY.
   * Useful when responses must be ordered after other terminal output.
   */
  processWithResponses(data: string): { text: string; responses: string[] } {
    const responses: string[] = [];
    const originalWriter = this.ptyWriter;
    this.ptyWriter = (response: string) => {
      responses.push(response);
    };
    try {
      const text = this.process(data);
      return { text, responses };
    } finally {
      this.ptyWriter = originalWriter;
    }
  }

  private findIncompleteSequenceStart(data: string): number | null {
    const ESC = '\x1b';
    const BEL = '\x07';
    const CSI_C1 = '\x9b';
    const DCS_C1 = '\x90';
    const OSC_C1 = '\x9d';
    const ST_C1 = '\x9c';
    const APC_C1 = '\x9f';
    type State = 'text' | 'esc' | 'csi' | 'osc' | 'dcs' | 'apc' | 'osc-esc' | 'dcs-esc' | 'apc-esc';
    let state: State = 'text';
    let seqStart = -1;

    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      switch (state) {
        case 'text':
          if (ch === ESC) {
            state = 'esc';
            seqStart = i;
          } else if (ch === CSI_C1) {
            state = 'csi';
            seqStart = i;
          } else if (ch === OSC_C1) {
            state = 'osc';
            seqStart = i;
          } else if (ch === DCS_C1) {
            state = 'dcs';
            seqStart = i;
          } else if (ch === APC_C1) {
            state = 'apc';
            seqStart = i;
          }
          break;
        case 'esc':
          if (ch === '[') {
            state = 'csi';
          } else if (ch === ']') {
            state = 'osc';
          } else if (ch === 'P') {
            state = 'dcs';
          } else if (ch === '_') {
            state = 'apc';
          } else if (ch === ESC) {
            state = 'esc';
            seqStart = i;
          } else {
            state = 'text';
            seqStart = -1;
          }
          break;
        case 'csi': {
          const code = ch.charCodeAt(0);
          if (code >= 0x40 && code <= 0x7e) {
            state = 'text';
            seqStart = -1;
          }
          break;
        }
        case 'osc':
          if (ch === BEL || ch === ST_C1) {
            state = 'text';
            seqStart = -1;
          } else if (ch === ESC) {
            state = 'osc-esc';
          }
          break;
        case 'osc-esc':
          if (ch === '\\') {
            state = 'text';
            seqStart = -1;
          } else if (ch === ESC) {
            state = 'osc-esc';
          } else {
            state = 'osc';
          }
          break;
        case 'dcs':
          if (ch === ST_C1) {
            state = 'text';
            seqStart = -1;
          } else if (ch === ESC) {
            state = 'dcs-esc';
          }
          break;
        case 'dcs-esc':
          if (ch === '\\') {
            state = 'text';
            seqStart = -1;
          } else if (ch === ESC) {
            state = 'dcs-esc';
          } else {
            state = 'dcs';
          }
          break;
        case 'apc':
          if (ch === ST_C1) {
            state = 'text';
            seqStart = -1;
          } else if (ch === ESC) {
            state = 'apc-esc';
          }
          break;
        case 'apc-esc':
          if (ch === '\\') {
            state = 'text';
            seqStart = -1;
          } else if (ch === ESC) {
            state = 'apc-esc';
          } else {
            state = 'apc';
          }
          break;
      }
    }

    if (state === 'text') {
      return null;
    }
    return seqStart >= 0 ? seqStart : null;
  }

  private stripKittyResponses(data: string): string {
    const ESC = '\x1b';
    const ST_C1 = '\x9c';
    let result = '';
    let i = 0;

    while (i < data.length) {
      const ch = data[i];
      const isEscApc = ch === ESC && i + 2 < data.length && data[i + 1] === '_' && data[i + 2] === 'G';
      const isC1Apc = ch === '\x9f' && i + 1 < data.length && data[i + 1] === 'G';

      if (!isEscApc && !isC1Apc) {
        result += ch;
        i += 1;
        continue;
      }

      const start = i;
      let pos = i + (isEscApc ? 3 : 2);
      let end = -1;
      let terminatorLength = 0;
      while (pos < data.length) {
        if (data[pos] === ST_C1) {
          end = pos + 1;
          terminatorLength = 1;
          break;
        }
        if (data[pos] === ESC && pos + 1 < data.length && data[pos + 1] === '\\') {
          end = pos + 2;
          terminatorLength = 2;
          break;
        }
        pos += 1;
      }

      if (end < 0) {
        result += data.slice(start);
        break;
      }

      const body = data.slice(isEscApc ? start + 3 : start + 2, end - terminatorLength);
      const sep = body.indexOf(';');
      if (sep === -1) {
        result += data.slice(start, end);
        i = end;
        continue;
      }

      const control = body.slice(0, sep);
      const payload = body.slice(sep + 1);
      const hasAction = control.includes('a=');
      const isOk = payload === 'OK';
      const hasNonBase64 = /[^A-Za-z0-9+/=]/.test(payload);

      if (!hasAction && (isOk || hasNonBase64)) {
        i = end;
        continue;
      }

      result += data.slice(start, end);
      i = end;
    }

    return result;
  }

  /**
   * Handle a query by generating and sending the appropriate response
   */
  private handleQuery(query: TerminalQuery): void {
    if (!this.ptyWriter) return;

    tracePtyEvent('query-handle', {
      queryType: query.type,
      mode: query.type === 'decrqm' ? query.mode : undefined,
      winop: query.type === 'xtwinops' ? query.winop : undefined,
    });

    if (query.type === 'cpr') {
      // Get cursor position from emulator
      const cursor = this.cursorGetter?.() ?? { x: 0, y: 0 };
      const response = generateCprResponse(cursor.y, cursor.x);
      this.ptyWriter(response);
    } else if (query.type === 'decxcpr') {
      // Extended cursor position report
      const cursor = this.cursorGetter?.() ?? { x: 0, y: 0 };
      const response = generateDecxcprResponse(cursor.y, cursor.x);
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
    } else if (query.type === 'da3') {
      // Tertiary Device Attributes - report unit ID
      const response = generateDa3Response();
      this.ptyWriter(response);
    } else if (query.type === 'xtversion') {
      // Terminal version query
      const response = generateXtversionResponse('openmux', this.terminalVersion);
      this.ptyWriter(response);
    } else if (query.type === 'decrqm') {
      // Request DEC private mode
      const mode = query.mode ?? 0;
      let value: 0 | 1 | 2 | 3 | 4 = 0; // Default to "not recognized"

      // First check if we have a mode getter that can provide live state
      if (this.modeGetter) {
        const state = this.modeGetter(mode);
        if (state !== null) {
          value = state ? 1 : 2; // 1 = set, 2 = reset
        } else if (mode in KNOWN_MODES) {
          value = KNOWN_MODES[mode];
        }
      } else if (mode in KNOWN_MODES) {
        value = KNOWN_MODES[mode];
      }

      const response = generateDecrpmResponse(mode, value);
      this.ptyWriter(response);
    } else if (query.type === 'xtgettcap') {
      // Termcap/terminfo query
      const caps = new Map<string, string | null>();
      for (const hexName of query.capabilities ?? []) {
        const name = hexToString(hexName);
        if (name in KNOWN_CAPABILITIES) {
          caps.set(name, KNOWN_CAPABILITIES[name]);
        } else {
          caps.set(name, null); // Unknown capability
        }
      }
      const response = generateXtgettcapResponse(caps);
      this.ptyWriter(response);
    } else if (query.type === 'kitty-keyboard') {
      // Kitty keyboard protocol query
      const flags = this.kittyKeyboardFlagsGetter
        ? this.kittyKeyboardFlagsGetter()
        : this.kittyKeyboardFlags;
      const response = generateKittyKeyboardResponse(flags);
      this.ptyWriter(response);
    } else if (query.type === 'osc-bg') {
      // Get background color
      const colors = this.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
      const r = (colors.background >> 16) & 0xFF;
      const g = (colors.background >> 8) & 0xFF;
      const b = colors.background & 0xFF;
      const response = generateOscBgResponse(r, g, b);
      this.ptyWriter(response);
    } else if (query.type === 'osc-cursor') {
      // Get cursor color
      const r = (this.cursorColor >> 16) & 0xFF;
      const g = (this.cursorColor >> 8) & 0xFF;
      const b = this.cursorColor & 0xFF;
      const response = generateOscCursorResponse(r, g, b);
      this.ptyWriter(response);
    } else if (query.type === 'osc-palette') {
      // Get palette color by index
      const index = query.colorIndex ?? 0;
      let color: number;
      if (this.paletteGetter) {
        const customColor = this.paletteGetter(index);
        color = customColor ?? (DEFAULT_PALETTE[index] ?? 0);
      } else {
        color = DEFAULT_PALETTE[index] ?? 0;
      }
      const r = (color >> 16) & 0xFF;
      const g = (color >> 8) & 0xFF;
      const b = color & 0xFF;
      const response = generateOscPaletteResponse(index, r, g, b);
      this.ptyWriter(response);
    } else if (query.type === 'xtwinops') {
      // Window size queries
      const winop = query.winop ?? 18;
      tracePtyEvent('xtwinops-start', { winop });
      try {
        if (this.sizeGetter) {
          const size = this.sizeGetter();
          tracePtyEvent('xtwinops-size', {
            winop,
            cols: size.cols,
            rows: size.rows,
            pixelWidth: size.pixelWidth,
            pixelHeight: size.pixelHeight,
            cellWidth: size.cellWidth,
            cellHeight: size.cellHeight,
          });
          let height: number, width: number;
          switch (winop) {
            case 14: // Window size in pixels
              height = size.pixelHeight;
              width = size.pixelWidth;
              break;
            case 16: // Cell size in pixels
              height = size.cellHeight;
              width = size.cellWidth;
              break;
            case 18: // Text area in characters
            default:
              height = size.rows;
              width = size.cols;
              break;
          }
          const response = generateXtwinopsResponse(winop, height, width);
          tracePtyEvent('xtwinops-response', { winop, height, width, len: response.length });
          this.ptyWriter(response);
          tracePtyEvent('xtwinops-response-written', { winop, len: response.length });
        } else {
          // Fallback to default sizes
          const response = generateXtwinopsResponse(winop, 24, 80);
          tracePtyEvent('xtwinops-response', { winop, height: 24, width: 80, len: response.length });
          this.ptyWriter(response);
          tracePtyEvent('xtwinops-response-written', { winop, len: response.length });
        }
      } catch (err) {
        tracePtyEvent('xtwinops-error', { winop, error: err });
      }
    } else if (query.type === 'osc-clipboard') {
      // Clipboard query - respond with empty for security
      // Apps should not be able to read clipboard through terminal queries
      const selection = query.clipboardSelection ?? 'c';
      const response = generateOscClipboardEmptyResponse(selection);
      this.ptyWriter(response);
    } else if (query.type === 'decrqss') {
      // Request status string - respond based on status type
      const statusType = query.statusType ?? '';
      let response: string;

      switch (statusType) {
        case 'm':
          // SGR (Select Graphic Rendition) - return reset state
          response = generateDecrqssValidResponse('0m');
          break;
        case ' q':
          // DECSCUSR (Cursor Style) - return blinking block (default)
          response = generateDecrqssValidResponse('1 q');
          break;
        case '"q':
          // DECSCA (Select Character Attribute) - return not protected
          response = generateDecrqssValidResponse('0"q');
          break;
        case 'r':
          // DECSTBM (Top and Bottom Margins) - return full screen
          if (this.sizeGetter) {
            const size = this.sizeGetter();
            response = generateDecrqssValidResponse(`1;${size.rows}r`);
          } else {
            response = generateDecrqssValidResponse('1;24r');
          }
          break;
        case '"p':
          // DECSCL (Conformance Level) - return VT220
          response = generateDecrqssValidResponse('62;1"p');
          break;
        default:
          // Unknown status type
          response = generateDecrqssInvalidResponse();
          break;
      }
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
    this.modeGetter = null;
    this.paletteGetter = null;
    this.sizeGetter = null;
    this.pendingInput = '';
  }
}
