// Layered PSD export: one group per render category, and one layer per map object inside
// every non-terrain group (terrain stays a single merged layer).
//
// Terrain keeps one RGBA buffer for the whole map, while every other object collects its own
// pixel patches while it is drawn. That keeps the complete art of each element even where a
// later object paints over it. The PSD's flattened image is the untouched composite.
import * as fs from 'node:fs';
import { writePsdBuffer } from 'ag-psd';
import type { Layer, Psd } from 'ag-psd';
import type { Rectangle } from '../shared/Geometry.js';
import type { DrawingSurface, SurfaceElement } from './DrawingSurface.js';
import { LayerCategory, LayerCategoryNames, LayerCategoryStack } from './LayerCategory.js';

/** PSD 1.0 dimensions are 30,000 px maximum per side. */
export const PSD_MAX_DIMENSION = 30000;

export class PsdExporter {
  static save(path: string, surface: DrawingSurface, rect: Rectangle): void {
    const categories = surface.getCategories();
    if (categories == null) throw new Error('PSD export requires category tracking');
    // The depth/aux buffers are drawing-only; free them before the layer copies are built.
    surface.releaseAuxBuffers();

    const width = rect.Width;
    const height = rect.Height;
    if (width <= 0 || height <= 0) throw new Error(`Cannot export an empty PSD (${width}x${height})`);
    if (width > PSD_MAX_DIMENSION || height > PSD_MAX_DIMENSION) {
      throw new Error(`PSD layers are limited to ${PSD_MAX_DIMENSION}px per side (map is ${width}x${height})`);
    }

    // Terrain stays one merged layer: the category buffer already holds every tile pixel,
    // and effects that paint without claiming a category (start markers, shadows) fall back
    // to the pixel's final owner.
    let terrainPixels = surface.takeCategoryLayer(LayerCategory.Terrain);
    let terrainLeft = Number.POSITIVE_INFINITY;
    let terrainTop = Number.POSITIVE_INFINITY;
    let terrainRight = -1;
    let terrainBottom = -1;
    const expandTerrain = (x: number, y: number): void => {
      if (x < terrainLeft) terrainLeft = x;
      if (x + 1 > terrainRight) terrainRight = x + 1;
      if (y < terrainTop) terrainTop = y;
      if (y + 1 > terrainBottom) terrainBottom = y + 1;
    };

    const composite = new Uint8ClampedArray(width * height * 4);
    for (let y = rect.Top; y < rect.Bottom; y++) {
      const row = y * surface.Width;
      const localRow = y - rect.Top;
      for (let x = rect.Left; x < rect.Right; x++) {
        const src = row + x;
        const si = src * surface.BytesPerPixel;
        const di = (localRow * width + (x - rect.Left)) * 4;
        composite[di] = surface.data[si + 2];
        composite[di + 1] = surface.data[si + 1];
        composite[di + 2] = surface.data[si];
        composite[di + 3] = 255;

        const raw = categories[src];
        if (raw === LayerCategory.None || raw === LayerCategory.Terrain) expandTerrain(x, y);
      }
    }
    if (terrainPixels != null) {
      for (let y = rect.Top; y < rect.Bottom; y++) {
        const rowBase = y * surface.Width;
        for (let x = rect.Left; x < rect.Right; x++) {
          if (terrainPixels[(rowBase + x) * 4 + 3] !== 0) expandTerrain(x, y);
        }
      }
    }

    // Every non-terrain category is a group of one layer per element (object).
    const elements = surface.takeElements();
    const elementsByCategory = new Map<LayerCategory, SurfaceElement[]>();
    for (const element of elements) {
      if (element.category === LayerCategory.Terrain || element.parts.length === 0) continue;
      const list = elementsByCategory.get(element.category);
      if (list == null) elementsByCategory.set(element.category, [element]);
      else list.push(element);
    }

    const buildElementLayer = (element: SurfaceElement): Layer | null => {
      // The part is usually a sprite-sized buffer, so trim the layer to the pixels that
      // were actually painted instead of its allocated rectangle.
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = -1;
      let bottom = -1;
      for (const part of element.parts) {
        const l = Math.max(rect.Left, part.left);
        const t = Math.max(rect.Top, part.top);
        const r = Math.min(rect.Right, part.left + part.width);
        const b = Math.min(rect.Bottom, part.top + part.height);
        for (let y = t; y < b; y++) {
          const srcRow = (y - part.top) * part.width;
          for (let x = l; x < r; x++) {
            if (part.data[(srcRow + (x - part.left)) * 4 + 3] === 0) continue;
            if (x < left) left = x;
            if (x + 1 > right) right = x + 1;
            if (y < top) top = y;
            if (y + 1 > bottom) bottom = y + 1;
          }
        }
      }
      if (right <= left || bottom <= top) return null;

      const w = right - left;
      const h = bottom - top;
      const data = new Uint8ClampedArray(w * h * 4);
      // Parts are appended in draw order, so later blits of the same object overwrite earlier ones.
      for (const part of element.parts) {
        const l = Math.max(rect.Left, part.left);
        const t = Math.max(rect.Top, part.top);
        const r = Math.min(rect.Right, part.left + part.width);
        const b = Math.min(rect.Bottom, part.top + part.height);
        for (let y = t; y < b; y++) {
          const srcRow = (y - part.top) * part.width;
          const dstRow = (y - top) * w;
          for (let x = l; x < r; x++) {
            const si = (srcRow + (x - part.left)) * 4;
            const alpha = part.data[si + 3];
            if (alpha === 0) continue;
            const di = (dstRow + (x - left)) * 4;
            data[di] = part.data[si];
            data[di + 1] = part.data[si + 1];
            data[di + 2] = part.data[si + 2];
            data[di + 3] = alpha;
          }
        }
      }
      return {
        name: element.name,
        left: left - rect.Left,
        top: top - rect.Top,
        right: left - rect.Left + w,
        bottom: top - rect.Top + h,
        imageData: { width: w, height: h, data },
      };
    };

    // PSD layer records are stored bottom-to-top, which is also our stack order. Each
    // category is a group: terrain holds its merged layer, the others hold one layer per
    // element (earlier-drawn objects sit lower inside their group).
    const children: Layer[] = [];
    for (const category of LayerCategoryStack) {
      const name = LayerCategoryNames[category];
      if (category === LayerCategory.Terrain) {
        if (terrainRight <= terrainLeft || terrainBottom <= terrainTop) continue;
        const w = terrainRight - terrainLeft;
        const h = terrainBottom - terrainTop;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = terrainTop; y < terrainBottom; y++) {
          const row = y * surface.Width;
          const dstRow = (y - terrainTop) * w;
          for (let x = terrainLeft; x < terrainRight; x++) {
            const src = row + x;
            const li = (dstRow + (x - terrainLeft)) * 4;
            // Terrain drawn before the objects, including the part later covered by them,
            // and annotations (start markers, tunnel lines) marked while they were painted.
            // Object shadows are not here: they travel with their own layer.
            if (terrainPixels != null) {
              const pi = src * 4;
              if (terrainPixels[pi + 3] !== 0) {
                data[li] = terrainPixels[pi];
                data[li + 1] = terrainPixels[pi + 1];
                data[li + 2] = terrainPixels[pi + 2];
                data[li + 3] = 255;
                continue;
              }
            }
            const raw = categories[src];
            if (raw !== LayerCategory.None && raw !== LayerCategory.Terrain) continue;
            const si = src * surface.BytesPerPixel;
            data[li] = surface.data[si + 2];
            data[li + 1] = surface.data[si + 1];
            data[li + 2] = surface.data[si];
            data[li + 3] = 255;
          }
        }
        children.push({
          name,
          opened: false,
          children: [{
            name: `${name}·合并`,
            left: terrainLeft - rect.Left,
            top: terrainTop - rect.Top,
            right: terrainLeft - rect.Left + w,
            bottom: terrainTop - rect.Top + h,
            imageData: { width: w, height: h, data },
          }],
        });
        // the merged layer owns its own copy now
        terrainPixels = null;
        surface.releaseCategoryMap();
        continue;
      }

      const list = elementsByCategory.get(category);
      if (list == null) continue;
      const layers: Layer[] = [];
      for (const element of list) {
        const layer = buildElementLayer(element);
        // the layer holds its own cropped copy; release the collected sprite patches
        element.parts.length = 0;
        if (layer != null) layers.push(layer);
      }
      if (!layers.length) continue;
      children.push({ name, opened: false, children: layers });
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
