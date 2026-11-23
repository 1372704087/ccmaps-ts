// Layered PSD export: one layer per render category (terrain, buildings, infantry,
// vehicles, aircraft, naval, terrain objects, overlays, smudges).
//
// The renderer keeps a single composite surface plus one byte per pixel recording which
// category painted the final pixel. Splitting after the fact keeps the composite pixel-
// identical to the PNG output: occlusion, shadows and blended glows all stay baked into
// the layer that owns the pixel.
import * as fs from 'node:fs';
import { writePsdBuffer } from 'ag-psd';
import type { Layer, Psd } from 'ag-psd';
import type { Rectangle } from '../shared/Geometry.js';
import type { DrawingSurface } from './DrawingSurface.js';
import { LayerCategory, LayerCategoryNames, LayerCategoryStack } from './LayerCategory.js';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LayerBuffer {
  box: Box;
  data: Uint8ClampedArray;
}

/** PSD 1.0 dimensions are 30,000 px maximum per side. */
export const PSD_MAX_DIMENSION = 30000;

export class PsdExporter {
  static save(path: string, surface: DrawingSurface, rect: Rectangle): void {
    const categories = surface.getCategories();
    if (categories == null) throw new Error('PSD export requires category tracking');

    const width = rect.Width;
    const height = rect.Height;
    if (width <= 0 || height <= 0) throw new Error(`Cannot export an empty PSD (${width}x${height})`);
    if (width > PSD_MAX_DIMENSION || height > PSD_MAX_DIMENSION) {
      throw new Error(`PSD layers are limited to ${PSD_MAX_DIMENSION}px per side (map is ${width}x${height})`);
    }

    // Pixels no pass claimed (e.g. the empty background) belong to the terrain layer, so
    // the stacked PSD still reproduces the whole image.
    const boxes = new Map<LayerCategory, Box>();
    for (let y = rect.Top; y < rect.Bottom; y++) {
      const row = y * surface.Width;
      for (let x = rect.Left; x < rect.Right; x++) {
        const raw = categories[row + x];
        const category = raw === LayerCategory.None ? LayerCategory.Terrain : (raw as LayerCategory);
        const box = boxes.get(category);
        if (box == null) {
          boxes.set(category, { left: x, top: y, right: x + 1, bottom: y + 1 });
        } else {
          if (x < box.left) box.left = x;
          if (x + 1 > box.right) box.right = x + 1;
          if (y < box.top) box.top = y;
          if (y + 1 > box.bottom) box.bottom = y + 1;
        }
      }
    }

    const buffers = new Map<LayerCategory, LayerBuffer>();
    for (const [category, box] of boxes) {
      const w = box.right - box.left;
      const h = box.bottom - box.top;
      buffers.set(category, { box, data: new Uint8ClampedArray(w * h * 4) });
    }

    const composite = new Uint8ClampedArray(width * height * 4);
    for (let y = rect.Top; y < rect.Bottom; y++) {
      const row = y * surface.Width;
      const localRow = y - rect.Top;
      for (let x = rect.Left; x < rect.Right; x++) {
        const src = row + x;
        const si = src * surface.BytesPerPixel;
        const localX = x - rect.Left;
        const di = (localRow * width + localX) * 4;
        composite[di] = surface.data[si + 2];
        composite[di + 1] = surface.data[si + 1];
        composite[di + 2] = surface.data[si];
        composite[di + 3] = 255;

        const raw = categories[src];
        const category = raw === LayerCategory.None ? LayerCategory.Terrain : (raw as LayerCategory);
        const layer = buffers.get(category);
        if (layer == null) continue;
        const lx = x - layer.box.left;
        const ly = y - layer.box.top;
        const li = (ly * (layer.box.right - layer.box.left) + lx) * 4;
        layer.data[li] = surface.data[si + 2];
        layer.data[li + 1] = surface.data[si + 1];
        layer.data[li + 2] = surface.data[si];
        layer.data[li + 3] = 255;
      }
    }

    // PSD stores layers top-most first; our stack order is bottom-to-top.
    const children: Layer[] = [];
    for (const category of [...LayerCategoryStack].reverse()) {
      const layer = buffers.get(category);
      if (layer == null) continue;
      const { box, data } = layer;
      const w = box.right - box.left;
      const h = box.bottom - box.top;
      children.push({
        name: LayerCategoryNames[category],
        left: box.left - rect.Left,
        top: box.top - rect.Top,
        right: box.left - rect.Left + w,
        bottom: box.top - rect.Top + h,
        imageData: { width: w, height: h, data },
      });
    }

    const psd: Psd = {
      width,
      height,
      channels: 4,
      bitsPerChannel: 8,
      children,
      imageData: { width, height, data: composite },
    };
    const buffer = writePsdBuffer(psd, { noBackground: true, generateThumbnail: false });
    fs.writeFileSync(path, buffer);
  }
}
