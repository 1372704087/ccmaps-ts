// Converts a rendered BGR/BGRA surface region to RGBA bytes for ImageData.
import type { Rectangle } from '../shared/Geometry.js';

export interface BgrSurfaceLike {
  data: Uint8Array;
  Width: number;
  BytesPerPixel: number;
}

export function bgrToRgba(surface: BgrSurfaceLike, rect: Rectangle): Uint8ClampedArray<ArrayBuffer> {
  const width = Math.max(0, rect.Width);
  const height = Math.max(0, rect.Height);
  const out = new Uint8ClampedArray(width * height * 4);
  const bpp = surface.BytesPerPixel;
  let dst = 0;
  for (let y = 0; y < height; y++) {
    let src = ((rect.Top + y) * surface.Width + rect.Left) * bpp;
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
