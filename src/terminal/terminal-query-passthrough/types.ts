/**
 * Type definitions for terminal query passthrough
 */

export type QueryType =
  | 'cpr'           // Cursor Position Report (ESC[6n)
  | 'decxcpr'       // Extended Cursor Position Report (ESC[?6n)
  | 'status'        // Device Status Report (ESC[5n)
  | 'da1'           // Primary Device Attributes (ESC[c)
  | 'da2'           // Secondary Device Attributes (ESC[>c)
  | 'da3'           // Tertiary Device Attributes (ESC[=c)
  | 'xtversion'     // Terminal Version (ESC[>q)
  | 'decrqm'        // DEC Request Mode (ESC[?Ps$p)
  | 'decrqss'       // Request Status String (DCS$q...ST)
  | 'xtgettcap'     // Termcap Query (DCS+q...ST)
  | 'xtsmgraphics'  // Graphics Attributes (ESC[?Pi;Pa;PvS)
  | 'kitty-keyboard' // Kitty Keyboard Protocol (ESC[?u)
  | 'xtwinops'      // Window Operations (ESC[14t, 16t, 18t)
  | 'osc-palette'   // OSC 4 Palette Query
  | 'osc-fg'        // OSC 10 Foreground Query
  | 'osc-bg'        // OSC 11 Background Query
  | 'osc-cursor'    // OSC 12 Cursor Color Query
  | 'osc-clipboard'; // OSC 52 Clipboard Query

export interface TerminalQuery {
  type: QueryType;
  startIndex: number;
  endIndex: number;
  /** Mode number for DECRQM queries */
  mode?: number;
  /** Capability names for XTGETTCAP queries (hex-encoded) */
  capabilities?: string[];
  /** Window operation type for XTWINOPS (14, 16, 18) */
  winop?: number;
  /** Color index for OSC 4 palette queries */
  colorIndex?: number;
  /** Status string type for DECRQSS queries (e.g., 'm' for SGR, 'q' for DECSCUSR) */
  statusType?: string;
  /** Graphics attribute item for XTSMGRAPHICS (1=colors, 2=sixel geometry, 3=regis geometry) */
  graphicsItem?: number;
  /** Graphics action for XTSMGRAPHICS (1=read, 2=reset, 3=set, 4=read max) */
  graphicsAction?: number;
  /** Clipboard selection for OSC 52 (c=clipboard, p=primary, etc.) */
  clipboardSelection?: string;
}

export interface QueryParseResult {
  /** Text to pass through to emulator (without queries) */
  textSegments: string[];
  /** Queries that need responses */
  queries: TerminalQuery[];
}
