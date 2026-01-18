import { RGBA } from '@opentui/core';

export function mixColor(a: number, b: number, t: number): number {
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

export function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function toRgba(color: number, alpha: number = 255): RGBA {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return RGBA.fromInts(r, g, b, alpha);
}
