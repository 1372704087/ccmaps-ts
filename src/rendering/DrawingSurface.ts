// Port of CNCMaps.Engine.Rendering.DrawingSurface
//
// The C# original pins a managed byte[] so the renderers can address pixels
// directly through a Scan0/Stride. In TS the array is directly indexable, so we
// keep the same lay-out (BGR byte triplets, stride = width * bytesPerPixel) and
// expose the z/height/shadow auxiliary buffers the renderers use.
import { Rectangle } from '../shared/Geometry.js';
import { logger } from '../shared/Log.js';
import { PngWriter } from './PngWriter.js';

export enum SurfaceFormat {
  Bgr24 = 0,
  Bgra32 = 1,
}

export class DrawingSurface {
  readonly Format: SurfaceFormat;
  readonly Width: number;
  readonly Height: number;
  readonly BytesPerPixel: number;
  readonly Stride: number;

  readonly data: Uint8Array; // BGR triplets
  readonly zBuffer: Int16Array;
  readonly heightBuffer: Int32Array;
  readonly shadowBuffer: Uint8Array; // 0/1

  constructor(width: number, height: number, format: SurfaceFormat = SurfaceFormat.Bgr24) {
    logger.debug(`Initializing DrawingSurface with dimensions (${width},${height}), format ${format}`);
    this.Format = format;
    this.Width = width;
    this.Height = height;
    this.BytesPerPixel = format === SurfaceFormat.Bgr24 ? 3 : 4;
    this.Stride = width * this.BytesPerPixel;

    this.data = new Uint8Array(width * height * this.BytesPerPixel);
    this.zBuffer = new Int16Array(width * height);
    this.heightBuffer = new Int32Array(width * height);
    this.shadowBuffer = new Uint8Array(width * height);
  }

  pixelIndex(x: number, y: number): number {
    return x + y * this.Width;
  }

  isShadow(x: number, y: number): boolean {
    return this.shadowBuffer[this.pixelIndex(x, y)] !== 0;
  }

  setShadow(x: number, y: number): void {
    this.shadowBuffer[this.pixelIndex(x, y)] = 1;
  }

  getShadows(): Uint8Array {
    return this.shadowBuffer;
  }

  getZBuffer(): Int16Array {
    return this.zBuffer;
  }

  getHeightBuffer(): Int32Array {
    return this.heightBuffer;
  }

  // Writes an RGB triplet at a flat byte offset (offset.Y * Stride + offset.X * 3).
  writePixel(wIdx: number, b: number, g: number, r: number): void {
    this.data[wIdx] = b;
    this.data[wIdx + 1] = g;
    this.data[wIdx + 2] = r;
  }

  savePNG(path: string, compressionLevel: number, left: number, top: number, width: number, height: number): void {
    const rect = new Rectangle(left, top, width, height);
    rect.Intersect(new Rectangle(0, 0, this.Width, this.Height));
    logger.info(
      `Saving PNG to ${path}, compression level ${compressionLevel}, clip @(${rect.Left},${rect.Top};${rect.Width}x${rect.Height})`,
    );
    PngWriter.save(path, this.data, this.Width, this.BytesPerPixel, rect, compressionLevel);
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