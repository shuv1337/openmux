import { KittyGraphicsFormat, type KittyGraphicsImageInfo } from '../emulator-interface';

export function prepareImageData(
  info: KittyGraphicsImageInfo,
  data: Uint8Array
): { format: number; payload: Uint8Array } | null {
  switch (info.format) {
    case KittyGraphicsFormat.RGB:
      return { format: 24, payload: data };
    case KittyGraphicsFormat.RGBA:
      return { format: 32, payload: data };
    case KittyGraphicsFormat.PNG: {
      const expected = info.width * info.height * 4;
      if (data.byteLength !== expected) {
        return { format: 100, payload: data };
      }
      return { format: 32, payload: data };
    }
    case KittyGraphicsFormat.GRAY:
      return { format: 32, payload: expandGray(data) };
    case KittyGraphicsFormat.GRAY_ALPHA:
      return { format: 32, payload: expandGrayAlpha(data) };
    default:
      return null;
  }
}

function expandGray(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.byteLength * 4);
  let outIdx = 0;
  for (let i = 0; i < data.byteLength; i++) {
    const v = data[i] ?? 0;
    out[outIdx++] = v;
    out[outIdx++] = v;
    out[outIdx++] = v;
    out[outIdx++] = 255;
  }
  return out;
}

function expandGrayAlpha(data: Uint8Array): Uint8Array {
  const pixels = Math.floor(data.byteLength / 2);
  const out = new Uint8Array(pixels * 4);
  let outIdx = 0;
  for (let i = 0; i < pixels; i++) {
    const gray = data[i * 2] ?? 0;
    const alpha = data[i * 2 + 1] ?? 255;
    out[outIdx++] = gray;
    out[outIdx++] = gray;
    out[outIdx++] = gray;
    out[outIdx++] = alpha;
  }
  return out;
}
