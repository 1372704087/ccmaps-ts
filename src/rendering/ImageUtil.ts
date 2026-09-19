// Simple image resampling for preview generation (replaces ImageSharp's
// Bicubic resampler with a bilinear one - visually close enough for previews).
import { DrawingSurface, SurfaceFormat } from './DrawingSurface.js';

export function resizeBilinear(src: DrawingSurface, newWidth: number, newHeight: number): DrawingSurface {
  const dst = new DrawingSurface(newWidth, newHeight, SurfaceFormat.Bgr24);
  const xRatio = src.Width / newWidth;
  const yRatio = src.Height / newHeight;
  const sx3 = src.Width * 3;
  for (let y = 0; y < newHeight; y++) {
    const srcY = y * yRatio;
    const y0 = Math.trunc(srcY);
    const y1 = Math.min(src.Height - 1, y0 + 1);
    const fy = srcY - y0;
    for (let x = 0; x < newWidth; x++) {
      const srcX = x * xRatio;
      const x0 = Math.trunc(srcX);
      const x1 = Math.min(src.Width - 1, x0 + 1);
      const fx = srcX - x0;

      const i00 = (y0 * src.Width + x0) * 3;
      const i10 = (y0 * src.Width + x1) * 3;
      const i01 = (y1 * src.Width + x0) * 3;
      const i11 = (y1 * src.Width + x1) * 3;

      const di = (y * newWidth + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = src.data[i00 + c] * (1 - fx) + src.data[i10 + c] * fx;
        const bottom = src.data[i01 + c] * (1 - fx) + src.data[i11 + c] * fx;
        dst.data[di + c] = Math.trunc(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return dst;
}
