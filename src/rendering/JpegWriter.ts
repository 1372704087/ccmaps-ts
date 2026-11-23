// JPEG writer for the CLI/server path (the browser worker encodes with
// OffscreenCanvas instead). jpeg-js wants RGBA, so a full RGBA copy of the
// saved region is unavoidable; PNG streams row chunks and stays cheaper for
// very large maps.
import * as fs from 'node:fs';
import { encode } from 'jpeg-js';
import { logger } from '../shared/Log.js';
import { Rectangle } from '../shared/Geometry.js';
import type { DrawingSurface } from './DrawingSurface.js';

export class JpegWriter {
  static save(
    surface: DrawingSurface,
    path: string,
    left: number,
    top: number,
    width: number,
    height: number,
    quality: number,
  ): void {
    const rect = new Rectangle(left, top, width, height);
    rect.Intersect(new Rectangle(0, 0, surface.Width, surface.Height));
    if (rect.Width <= 0 || rect.Height <= 0) throw new Error('Cannot write an empty JPEG');

    const q = Number.isFinite(quality) ? Math.min(100, Math.max(1, Math.trunc(quality))) : 92;
    const rgba = new Uint8Array(rect.Width * rect.Height * 4);
    const bpp = surface.BytesPerPixel;
    let dst = 0;
    for (let y = 0; y < rect.Height; y++) {
      let src = ((rect.Top + y) * surface.Width + rect.Left) * bpp;
      for (let x = 0; x < rect.Width; x++) {
        rgba[dst++] = surface.data[src + 2];
        rgba[dst++] = surface.data[src + 1];
        rgba[dst++] = surface.data[src];
        rgba[dst++] = bpp >= 4 ? surface.data[src + 3] : 255;
        src += bpp;
      }
    }

    const out = encode({ data: rgba, width: rect.Width, height: rect.Height }, q);
    fs.writeFileSync(path, out.data);
    logger.info(`Saving JPEG to ${path}, quality ${q}, clip @(${rect.Left},${rect.Top};${rect.Width}x${rect.Height})`);
  }
}
