import { createMemo } from 'solid-js';
import { useTerminal } from '../contexts/TerminalContext';
import { getDefaultColors, getHostColors } from '../terminal/terminal-colors';

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bCh = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bCh;
}

function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function useOverlayColors() {
  const terminal = useTerminal();
  const palette = createMemo(() => {
    void terminal.hostColorsVersion;
    return getHostColors() ?? getDefaultColors();
  });
  const backgroundColor = createMemo(() => palette().background);
  const foregroundColor = createMemo(() => palette().foreground);
  const isLight = createMemo(() => luminance(backgroundColor()) > 0.6);

  const background = createMemo(() => toHex(backgroundColor()));
  const foreground = createMemo(() => toHex(foregroundColor()));
  const muted = createMemo(() =>
    toHex(mixColor(foregroundColor(), backgroundColor(), isLight() ? 0.2 : 0.3))
  );
  const subtle = createMemo(() =>
    toHex(mixColor(foregroundColor(), backgroundColor(), isLight() ? 0.45 : 0.6))
  );
  const separator = createMemo(() =>
    toHex(mixColor(foregroundColor(), backgroundColor(), isLight() ? 0.8 : 0.8))
  );
  const match = createMemo(() => toHex(isLight() ? 0x2e7d32 : 0x88ff88));

  return {
    background,
    foreground,
    muted,
    subtle,
    separator,
    match,
  };
}
