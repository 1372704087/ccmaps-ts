// Port of CNCMaps.Engine.Rendering.DrawingSurface
//
// The C# original pins a managed byte[] so the renderers can address pixels
// directly through a Scan0/Stride. In TS the array is directly indexable, so we
// keep the same lay-out (BGR byte triplets, stride = width * bytesPerPixel) and
// expose the z/height/shadow auxiliary buffers the renderers use.
import { Rectangle } from '../shared/Geometry.js';
import { logger } from '../shared/Log.js';
import { PngWriter } from './PngWriter.js';
import { JpegWriter } from './JpegWriter.js';
import { LayerCategory } from './LayerCategory.js';

export enum SurfaceFormat {
  Bgr24 = 0,
  Bgra32 = 1,
}

/** One blit of an element (object) into its own RGBA patch, positioned in render space. */
export interface ElementPart {
  left: number;
  top: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Art painted by one map object, so a PSD group can hold one layer per object. */
export interface SurfaceElement {
  name: string;
  category: LayerCategory;
  parts: ElementPart[];
}

export class DrawingSurface {
  readonly Format: SurfaceFormat;
  readonly Width: number;
  readonly Height: number;
  readonly BytesPerPixel: number;
  readonly Stride: number;

  /// <summary>Top-left corner of this surface in the map's own render coordinates. Banded
  /// rendering draws one horizontal strip at a time so a 4.4e8-pixel map never needs its full
  /// canvas in memory; every blitter subtracts this from the coordinates it derives from the
  /// map, so the drawing code keeps working in render space and only the write index moves.</summary>
  readonly OriginX: number;
  readonly OriginY: number;

  readonly data: Uint8Array; // BGR triplets
  readonly zBuffer: Int16Array;
  /** Allocated only for maps that actually draw voxel shadows. */
  private _shadowBuffer: Uint8Array | null = null;

  /// <summary>Set before drawing to have the voxel blit record which pixels it wrote. Off by
  /// default: the buffer costs a byte per pixel and only A/B diagnostics read it.</summary>
  TrackVoxelMask = false;
  private _voxelMask: Uint8Array | null = null;

  /// <summary>When set, blitters only record the tiles their art touches (the map's cutoff row is
  /// derived from that) and skip their pixels. A 1x1 surface plus this flag measures the map's
  /// real bounds without allocating a canvas.</summary>
  MeasureOnly = false;

  /// <summary>Set for PSD export: allocates one byte per pixel recording which category painted
  /// the final pixel, and keeps the pixels each object painted so non-terrain categories can be
  /// split into one layer per element. Categories are only written by passes that paint new art;
  /// shadow/alpha passes leave the underlying category intact.</summary>
  TrackCategories = false;
  CurrentCategory: LayerCategory = LayerCategory.None;
  /** When set, writes do not change the pixel's category (shadows, glows, highlights). */
  PreserveCategory = false;
  private _categories: Uint8Array | null = null;
  private _layerPixels: Array<Uint8ClampedArray | null> = [];
  private _element: SurfaceElement | null = null;
  private _elements: SurfaceElement[] = [];
  private _elementIndex = new Map<string, SurfaceElement>();

  // Attached animations are drawn once every object has been drawn. gamemd orders a scene
  // terrain -> buildings -> anims and puts anims last whatever their position, so an anim's
  // art is never darkened by a shadow: nothing is drawn after it.
  private readonly _deferredAnims: (() => void)[] = [];
  // AlphaImage glows are applied once everything else is drawn. The game keeps its alpha
  // lighting in a buffer that every blitter reads, so the glow lights whatever ends up
  // visible under it; drawing it in place would only light what came before.
  private readonly _deferredAlpha: (() => void)[] = [];

  /// <summary>Queue an attached animation to be drawn once every object has been drawn.</summary>
  deferAnim(draw: () => void): void {
    const category = this.CurrentCategory;
    const element = this._element;
    this._deferredAnims.push(() => {
      const previous = this.CurrentCategory;
      const previousElement = this._element;
      this.CurrentCategory = category;
      this._element = element;
      draw();
      this.CurrentCategory = previous;
      this._element = previousElement;
    });
  }

  drawDeferredAnims(): void {
    for (const draw of this._deferredAnims) draw();
    this._deferredAnims.length = 0;
  }

  /// <summary>Queue an AlphaImage glow to be applied once everything else is drawn.</summary>
  deferAlpha(draw: () => void): void {
    const category = this.CurrentCategory;
    const element = this._element;
    this._deferredAlpha.push(() => {
      const previous = this.CurrentCategory;
      const previousElement = this._element;
      this.CurrentCategory = category;
      this._element = element;
      draw();
      this.CurrentCategory = previous;
      this._element = previousElement;
    });
  }

  drawDeferredAlpha(): void {
    for (const draw of this._deferredAlpha) draw();
    this._deferredAlpha.length = 0;
  }

  constructor(
    width: number,
    height: number,
    format: SurfaceFormat = SurfaceFormat.Bgr24,
    originX = 0,
    originY = 0,
  ) {
    logger.debug(`Initializing DrawingSurface with dimensions (${width},${height}), format ${format}`);
    this.Format = format;
    this.OriginX = originX;
    this.OriginY = originY;
    this.Width = width;
    this.Height = height;
    this.BytesPerPixel = format === SurfaceFormat.Bgr24 ? 3 : 4;
    this.Stride = width * this.BytesPerPixel;

    this.data = new Uint8Array(width * height * this.BytesPerPixel);
    this.zBuffer = new Int16Array(width * height);
  }

  pixelIndex(x: number, y: number): number {
    return x + y * this.Width;
  }

  isShadow(x: number, y: number): boolean {
    return (this._shadowBuffer?.[this.pixelIndex(x, y)] ?? 0) !== 0;
  }

  setShadow(x: number, y: number): void {
    (this._shadowBuffer ??= new Uint8Array(this.Width * this.Height))[this.pixelIndex(x, y)] = 1;
  }

  getShadows(): Uint8Array {
    return (this._shadowBuffer ??= new Uint8Array(this.Width * this.Height));
  }

  getZBuffer(): Int16Array {
    return this.zBuffer;
  }

  /// <summary>Pixels drawn by the voxel rasteriser, or null when tracking is off. The game shades
  /// voxels differently (a known divergence), so a comparison against an engine capture masks
  /// these out instead of counting them as defects.</summary>
  getVoxelMask(): Uint8Array | null {
    if (!this.TrackVoxelMask) return null;
    return (this._voxelMask ??= new Uint8Array(this.Width * this.Height));
  }

  /// <summary>Per-pixel category map for PSD export, or null when tracking is off.</summary>
  getCategories(): Uint8Array | null {
    if (!this.TrackCategories) return null;
    return (this._categories ??= new Uint8Array(this.Width * this.Height));
  }

  /// <summary>Full-surface RGBA buffer that accumulates every pixel this category paints, so
  /// art hidden by a later category stays in its own layer instead of becoming a cutout. Only
  /// terrain uses one now: other categories are split into one layer per element.</summary>
  getCategoryLayer(category: LayerCategory): Uint8ClampedArray | null {
    if (!this.TrackCategories || category !== LayerCategory.Terrain) return null;
    return (this._layerPixels[category] ??= new Uint8ClampedArray(this.Width * this.Height * 4));
  }

  /// <summary>Hands the accumulated layer buffer to the exporter and drops the reference so the
  /// pixels can be collected while the next layer is cropped.</summary>
  takeCategoryLayer(category: LayerCategory): Uint8ClampedArray | null {
    const pixels = this._layerPixels[category] ?? null;
    this._layerPixels[category] = null;
    return pixels;
  }

  /// <summary>The element (map object) currently being drawn, or null.</summary>
  get CurrentElement(): SurfaceElement | null {
    return this._element;
  }

  /// <summary>Starts collecting the art of one object. Elements are keyed by name, so a
  /// later redraw of the same object (ore highlighting) updates its existing layer.</summary>
  beginElement(name: string, category: LayerCategory): void {
    if (!this.TrackCategories || category === LayerCategory.None) return;
    const key = category + '\u0000' + name;
    let element = this._elementIndex.get(key);
    if (element == null) {
      element = { name, category, parts: [] };
      this._elementIndex.set(key, element);
      this._elements.push(element);
    }
    this._element = element;
  }

  endElement(): void {
    this._element = null;
  }

  /// <summary>Allocates an RGBA patch for one blit of the current element. The patch is kept in
  /// sprite space, so pixels hidden by other art still make it into the object's own layer.</summary>
  beginPart(left: number, top: number, width: number, height: number): ElementPart | null {
    if (!this.TrackCategories || this._element == null) return null;
    const w = Math.round(width);
    const h = Math.round(height);
    if (w <= 0 || h <= 0) return null;
    const part: ElementPart = {
      left: Math.round(left),
      top: Math.round(top),
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    };
    this._element.parts.push(part);
    return part;
  }

  /// <summary>Hands the collected elements to the exporter and clears them.</summary>
  takeElements(): SurfaceElement[] {
    const elements = this._elements;
    this._elements = [];
    this._elementIndex.clear();
    this._element = null;
    return elements;
  }

  setCategory(category: LayerCategory): void {
    this.CurrentCategory = category;
  }

  /** Records the category on a pixel index (x + y * Width) after a blitter painted it. */
  markCategory(pixelIndex: number): void {
    if (this._categories == null || this.PreserveCategory) return;
    if (this.CurrentCategory === LayerCategory.None) return;
    this._categories[pixelIndex] = this.CurrentCategory;
    const layer = this.getCategoryLayer(this.CurrentCategory);
    if (layer == null) return;
    const si = pixelIndex * this.BytesPerPixel;
    const li = pixelIndex * 4;
    layer[li] = this.data[si + 2];
    layer[li + 1] = this.data[si + 1];
    layer[li + 2] = this.data[si];
    layer[li + 3] = 255;
  }

  // Writes an RGB triplet at a flat byte offset (offset.Y * Stride + offset.X * 3).
  writePixel(wIdx: number, b: number, g: number, r: number): void {
    this.data[wIdx] = b;
    this.data[wIdx + 1] = g;
    this.data[wIdx + 2] = r;
    this.markCategory(Math.trunc(wIdx / this.BytesPerPixel));
  }

  savePNG(path: string, compressionLevel: number, left: number, top: number, width: number, height: number): void {
    const rect = new Rectangle(left, top, width, height);
    rect.Intersect(new Rectangle(0, 0, this.Width, this.Height));
    if (rect.Width <= 0 || rect.Height <= 0) throw new Error('Cannot write an empty PNG');
    logger.info(
      `Saving PNG to ${path}, compression level ${compressionLevel}, clip @(${rect.Left},${rect.Top};${rect.Width}x${rect.Height})`,
    );
    PngWriter.save(path, this.data, this.Width, this.BytesPerPixel, rect, compressionLevel);
  }

  saveJPEG(path: string, quality: number, left: number, top: number, width: number, height: number): void {
    JpegWriter.save(this, path, left, top, width, height, quality);
  }

  // The surface is always directly addressable now; kept for call-site compatibility.
  lock(): void {}
  unlock(): void {}

  /// <summary>Copies a region of the surface into a standalone Bgr24 surface.</summary>
  copyRegion(rect: Rectangle): DrawingSurface {
    const region = new DrawingSurface(rect.Width, rect.Height, SurfaceFormat.Bgr24);
    const bpp = this.BytesPerPixel;
    for (let y = 0; y < rect.Height; y++) {
      const srcRowStart = ((rect.Top + y) * this.Width + rect.Left) * bpp;
      const dstRowStart = y * region.Width * 3;
      const src = this.data.subarray(srcRowStart, srcRowStart + rect.Width * bpp);
      if (bpp === 3) {
        region.data.set(src, dstRowStart);
      } else {
        for (let x = 0; x < rect.Width; x++) {
          region.data[dstRowStart + x * 3] = src[x * 4];
          region.data[dstRowStart + x * 3 + 1] = src[x * 4 + 1];
          region.data[dstRowStart + x * 3 + 2] = src[x * 4 + 2];
        }
      }
    }
    return region;
  }
}