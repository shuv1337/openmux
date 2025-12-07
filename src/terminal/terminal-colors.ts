/**
 * Terminal Color Detection Module
 *
 * Detects terminal colors from environment variables.
 * This enables openmux to inherit the user's terminal theme.
 *
 * Note: OSC-based color queries are not used because they would
 * interfere with the TUI's stdin handling. In the future, we could
 * do OSC queries before the TUI starts (e.g., in a pre-init phase).
 */

/**
 * Terminal color information
 */
export interface TerminalColors {
  /** Foreground color in 0xRRGGBB format */
  foreground: number;
  /** Background color in 0xRRGGBB format */
  background: number;
  /** 256-color palette, each in 0xRRGGBB format */
  palette: number[];
  /** True if using fallback defaults */
  isDefault: boolean;
}

let cachedColors: TerminalColors | null = null;

/**
 * Parse OSC color payloads such as:
 * - rgb:xxxx/yyyy/zzzz
 * - #rrggbb
 */
function parseOscColor(payload: string): number | null {
  // rgb:xxxx/yyyy/zzzz
  const rgbMatch = payload.match(/^rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})$/);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1).map((p) => parseInt(p.slice(0, 2), 16));
    return (r << 16) | (g << 8) | b;
  }

  // #rrggbb
  const hexMatch = payload.match(/^#?([0-9a-fA-F]{6})$/);
  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  return null;
}

/**
 * Try to query colors from the host terminal using OSC 10/11.
 * This should be called before the TUI takes over stdin.
 */
async function queryOscColors(timeoutMs: number): Promise<{ foreground?: number; background?: number; paletteOverrides?: Map<number, number> } | null> {
  // Only attempt when we have a controllable TTY with raw mode.
  const stdin = process.stdin as (NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void; isRaw?: boolean });
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return null;
  }

  return await new Promise<{ foreground?: number; background?: number; paletteOverrides?: Map<number, number> } | null>((resolve) => {
    let buffer = '';
    let resolved = false;
    const decoder = new TextDecoder();

    const originalRaw = stdin.isRaw ?? false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      stdin.off('data', onData);
      try {
        stdin.setRawMode?.(originalRaw);
      } catch {
        // ignore
      }
    };

    const finish = (result: { foreground?: number; background?: number; paletteOverrides?: Map<number, number> } | null) => {
      cleanup();
      resolve(result);
    };

    const paletteOverrides = new Map<number, number>();

    const onData = (chunk: Buffer) => {
      buffer += decoder.decode(chunk);

      const fgMatch = buffer.match(/\x1b]10;([^\x07\x1b]+)\x07/);
      const bgMatch = buffer.match(/\x1b]11;([^\x07\x1b]+)\x07/);

      const fg = fgMatch ? parseOscColor(fgMatch[1]) ?? undefined : undefined;
      const bg = bgMatch ? parseOscColor(bgMatch[1]) ?? undefined : undefined;

      // Parse OSC 4 responses; allow BEL or ST terminators
      const paletteRegex = /\x1b]4;(\d+);([^\x07\x1b]+)(?:\x07|\x1b\\)/g;
      let match: RegExpExecArray | null;
      while ((match = paletteRegex.exec(buffer)) !== null) {
        const idx = parseInt(match[1], 10);
        const color = parseOscColor(match[2]);
        if (!Number.isNaN(idx) && idx >= 0 && idx < 256 && color !== null) {
          paletteOverrides.set(idx, color);
        }
      }

      const haveAllPalette = paletteOverrides.size >= 16; // we only ask 0-15

      if (fg !== undefined || bg !== undefined || haveAllPalette) {
        finish({
          foreground: fg,
          background: bg,
          paletteOverrides: paletteOverrides.size ? paletteOverrides : undefined,
        });
      }
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        finish(null);
      }
    }, timeoutMs);

    try {
      stdin.setRawMode?.(true);
    } catch {
      clearTimeout(timer);
      resolve(null);
      return;
    }

    stdin.on('data', onData);

    try {
      // Query default foreground/background (OSC 10/11) and base 0-15 (OSC 4)
      let osc = '\x1b]10;?\x07\x1b]11;?\x07';
      for (let i = 0; i < 16; i++) {
        osc += `\x1b]4;${i};?\x07`;
      }
      process.stdout.write(osc);
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Generate the standard 256-color palette
 * Colors 0-15: ANSI colors (from base16 or defaults)
 * Colors 16-231: 6x6x6 color cube
 * Colors 232-255: Grayscale ramp
 */
function generate256Palette(base16?: number[]): number[] {
  const palette: number[] = [];

  // Colors 0-15: ANSI colors
  const defaultBase16 = [
    0x000000, // 0: black
    0xCD0000, // 1: red
    0x00CD00, // 2: green
    0xCDCD00, // 3: yellow
    0x0000EE, // 4: blue
    0xCD00CD, // 5: magenta
    0x00CDCD, // 6: cyan
    0xE5E5E5, // 7: white
    0x7F7F7F, // 8: bright black
    0xFF0000, // 9: bright red
    0x00FF00, // 10: bright green
    0xFFFF00, // 11: bright yellow
    0x5C5CFF, // 12: bright blue
    0xFF00FF, // 13: bright magenta
    0x00FFFF, // 14: bright cyan
    0xFFFFFF, // 15: bright white
  ];

  for (let i = 0; i < 16; i++) {
    palette.push(base16?.[i] ?? defaultBase16[i]);
  }

  // Colors 16-231: 6x6x6 color cube
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const rv = r ? 55 + r * 40 : 0;
        const gv = g ? 55 + g * 40 : 0;
        const bv = b ? 55 + b * 40 : 0;
        palette.push((rv << 16) | (gv << 8) | bv);
      }
    }
  }

  // Colors 232-255: Grayscale ramp
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push((v << 16) | (v << 8) | v);
  }

  return palette;
}

/**
 * Get default colors (used as fallback)
 */
export function getDefaultColors(): TerminalColors {
  return {
    foreground: 0xFFFFFF,
    // Use a real opaque background; transparency is handled by layout rather than color markers
    background: 0x000000,
    palette: generate256Palette(),
    isDefault: true,
  };
}

/**
 * Query host terminal for its color scheme
 *
 * Currently uses environment-based detection since OSC queries would
 * interfere with the TUI's stdin handling. In the future, we could
 * do OSC queries before the TUI starts.
 *
 * @param _timeoutMs Timeout in milliseconds (unused, for API compatibility)
 * @returns Terminal colors (currently always returns defaults or env-based)
 */
export async function queryHostColors(_timeoutMs: number = 500): Promise<TerminalColors> {
  // Return cached if available
  if (cachedColors) {
    return cachedColors;
  }

  // First, try OSC queries (best-effort, only if TTY + raw mode available)
  try {
    const osc = await queryOscColors(Math.min(200, _timeoutMs));
    if (osc && (osc.foreground !== undefined || osc.background !== undefined || osc.paletteOverrides)) {
      const base16: (number | undefined)[] = new Array(16).fill(undefined);
      if (osc.paletteOverrides) {
        for (const [idx, color] of osc.paletteOverrides.entries()) {
          if (idx >= 0 && idx < 16) {
            base16[idx] = color;
          }
        }
      }
      const palette = generate256Palette(base16 as number[]);
      cachedColors = {
        foreground: osc.foreground ?? 0xFFFFFF,
        background: osc.background ?? 0x000000,
        palette,
        isDefault: false,
      };
      return cachedColors;
    }
  } catch {
    // Fall back to environment detection on any error
  }

  // Fallback to environment-based color detection
  cachedColors = detectColorsFromEnvironment();
  return cachedColors;
}

/**
 * Detect terminal colors from environment variables
 * Uses COLORFGBG if available, otherwise returns defaults
 */
function detectColorsFromEnvironment(): TerminalColors {
  // Check COLORFGBG (format: "fg;bg" e.g., "15;0" for white on black)
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    if (parts.length >= 2) {
      const fgIndex = parseInt(parts[0], 10);
      const bgIndex = parseInt(parts[parts.length - 1], 10);

      // Map ANSI color index to RGB
      const defaultPalette = generate256Palette();
      const fg = (fgIndex >= 0 && fgIndex < 256) ? defaultPalette[fgIndex] : 0xFFFFFF;
      const bg = (bgIndex >= 0 && bgIndex < 256) ? defaultPalette[bgIndex] : 0x000000;

      return {
        foreground: fg,
        background: bg,
        palette: defaultPalette,
        isDefault: false,
      };
    }
  }

  // Check for common dark/light theme indicators
  const colorScheme = process.env.TERM_BACKGROUND || process.env.COLORTHEME;
  if (colorScheme === 'light') {
    return {
      foreground: 0x000000,
      background: 0xFFFFFF,
      palette: generate256Palette(),
      isDefault: false,
    };
  }

  // Default to dark theme
  return getDefaultColors();
}

/**
 * Get cached colors (must call queryHostColors first)
 */
export function getHostColors(): TerminalColors | null {
  return cachedColors;
}

/**
 * Set colors directly (for testing or manual override)
 */
export function setHostColors(colors: TerminalColors): void {
  cachedColors = colors;
}

/**
 * Clear cached colors (mainly for testing)
 */
export function clearColorCache(): void {
  cachedColors = null;
}

/**
 * Extract RGB components from 0xRRGGBB color
 */
export function extractRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xFF,
    g: (color >> 8) & 0xFF,
    b: color & 0xFF,
  };
}
