// Converts a rendered BGR/BGRA surface region to RGBA bytes for ImageData.
import type { Rectangle } from '../shared/Geometry.js';

export interface BgrSurfaceLike {
  data: Uint8Array;
  Width: number;
  BytesPerPixel: number;
}

/** Converts `rect` (or `rowCount` rows starting at `rowOffset`) to RGBA. Encoding in horizontal
 * strips keeps the largest allocation ~width*512*4 instead of the whole 4-byte RGBA copy. */
export function bgrToRgba(
  surface: BgrSurfaceLike,
  rect: Rectangle,
  rowOffset = 0,
  rowCount = -1,
): Uint8ClampedArray<ArrayBuffer> {
  const width = Math.max(0, rect.Width);
  const height = Math.max(0, rect.Height);
  const rows = Math.max(0, Math.min(rowCount < 0 ? height : rowCount, height - rowOffset));
  const out = new Uint8ClampedArray(width * rows * 4);
  const bpp = surface.BytesPerPixel;
  let dst = 0;
  for (let y = 0; y < rows; y++) {
    let src = ((rect.Top + rowOffset + y) * surface.Width + rect.Left) * bpp;
    for (let x = 0; x < width; x++) {
      out[dst++] = surface.data[src + 2];
      out[dst++] = surface.data[src + 1];
      out[dst++] = surface.data[src];
      out[dst++] = bpp >= 4 ? surface.data[src + 3] : 255;
      src += bpp;
    }
  }
  return out;
}
