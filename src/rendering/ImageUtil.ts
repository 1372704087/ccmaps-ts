// Simple image resampling for preview generation.
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

// The cubic convolution kernel with a = -0.5, the one behind ImageSharp's
// KnownResamplers.Bicubic that the original renderer's preview injection uses.
function bicubicKernel(x: number): number {
  x = Math.abs(x);
  const x2 = x * x;
  const x3 = x2 * x;
  if (x < 1) return 1.5 * x3 - 2.5 * x2 + 1;
  if (x < 2) return -0.5 * x3 + 2.5 * x2 - 4 * x + 2;
  return 0;
}

// Source indices and normalized weights each destination row/column samples. When
// downscaling the window widens by the ratio, so every destination pixel averages the
// whole source span that maps onto it (ImageSharp's ResizeKernelMap behaviour).
function buildResampleTaps(srcSize: number, destSize: number): { idx: Int32Array[]; wts: Float64Array[] } {
  const ratio = srcSize / destSize;
  const scale = Math.max(1, ratio);
  const radius = Math.ceil(2 * scale);
  const idx: Int32Array[] = [];
  const wts: Float64Array[] = [];
  for (let d = 0; d < destSize; d++) {
    const center = (d + 0.5) * ratio - 0.5;
    const start = Math.floor(center) - radius + 1;
    const ii = new Int32Array(2 * radius);
    const ww = new Float64Array(2 * radius);
    let sum = 0;
    for (let k = 0; k < 2 * radius; k++) {
      const s = Math.min(srcSize - 1, Math.max(0, start + k));
      const w = bicubicKernel((center - s) / scale);
      ii[k] = s;
      ww[k] = w;
      sum += w;
    }
    if (sum !== 0) for (let k = 0; k < ww.length; k++) ww[k] /= sum;
    idx.push(ii);
    wts.push(ww);
  }
  return { idx, wts };
}

export function resizeBicubic(src: DrawingSurface, newWidth: number, newHeight: number): DrawingSurface {
  // two separable passes keep the widened downscale windows linear in the pixel count
  const mid = new DrawingSurface(newWidth, src.Height, SurfaceFormat.Bgr24);
  const xt = buildResampleTaps(src.Width, newWidth);
  for (let y = 0; y < src.Height; y++) {
    const rowBase = y * src.Width;
    for (let x = 0; x < newWidth; x++) {
      const ii = xt.idx[x];
      const ww = xt.wts[x];
      const di = (y * newWidth + x) * 3;
      let b = 0;
      let g = 0;
      let r = 0;
      for (let k = 0; k < ii.length; k++) {
        const si = (rowBase + ii[k]) * 3;
        const w = ww[k];
        b += src.data[si] * w;
        g += src.data[si + 1] * w;
        r += src.data[si + 2] * w;
      }
      mid.data[di] = Math.min(255, Math.max(0, Math.round(b)));
      mid.data[di + 1] = Math.min(255, Math.max(0, Math.round(g)));
      mid.data[di + 2] = Math.min(255, Math.max(0, Math.round(r)));
    }
  }

  const yt = buildResampleTaps(src.Height, newHeight);
  const dst = new DrawingSurface(newWidth, newHeight, SurfaceFormat.Bgr24);
  for (let y = 0; y < newHeight; y++) {
    const ii = yt.idx[y];
    const ww = yt.wts[y];
    for (let x = 0; x < newWidth; x++) {
      let b = 0;
      let g = 0;
      let r = 0;
      for (let k = 0; k < ii.length; k++) {
        const si = (ii[k] * newWidth + x) * 3;
        const w = ww[k];
        b += mid.data[si] * w;
        g += mid.data[si + 1] * w;
        r += mid.data[si + 2] * w;
      }
      const di = (y * newWidth + x) * 3;
      dst.data[di] = Math.min(255, Math.max(0, Math.round(b)));
      dst.data[di + 1] = Math.min(255, Math.max(0, Math.round(g)));
      dst.data[di + 2] = Math.min(255, Math.max(0, Math.round(r)));
    }
  }
  return dst;
}
