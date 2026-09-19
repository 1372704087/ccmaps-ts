// Software 2D drawing helpers that replicate the ImageSharp vector operations
// used by Map.cs (Fill/EllipsePolygon/FillPolygon/DrawLine/PatternPen/DrawImage).
// All functions write directly into a DrawingSurface's BGR buffer with alpha
// blending, matching ImageSharp's default behavior of drawing over existing
// content.
import type { DrawingSurface } from './DrawingSurface.js';
import type { Point } from '../shared/Geometry.js';

function blendPixel(ds: DrawingSurface, x: number, y: number, r: number, g: number, b: number, alpha: number): void {
  if (x < 0 || y < 0 || x >= ds.Width || y >= ds.Height) return;
  const a = alpha / 255.0;
  const inv = 1.0 - a;
  const idx = (x + y * ds.Width) * 3;
  ds.data[idx] = Math.trunc(b * a + ds.data[idx] * inv);
  ds.data[idx + 1] = Math.trunc(g * a + ds.data[idx + 1] * inv);
  ds.data[idx + 2] = Math.trunc(r * a + ds.data[idx + 2] * inv);
}

export function fillRect(
  ds: DrawingSurface,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const x0 = Math.max(0, Math.trunc(x));
  const y0 = Math.max(0, Math.trunc(y));
  const x1 = Math.min(ds.Width, Math.trunc(x + w));
  const y1 = Math.min(ds.Height, Math.trunc(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) blendPixel(ds, px, py, r, g, b, a);
  }
}

export function fillEllipse(
  ds: DrawingSurface,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const x0 = Math.max(0, Math.trunc(cx - rx));
  const y0 = Math.max(0, Math.trunc(cy - ry));
  const x1 = Math.min(ds.Width, Math.ceil(cx + rx));
  const y1 = Math.min(ds.Height, Math.ceil(cy + ry));
  const rxsq = rx * rx;
  const rysq = ry * ry;
  for (let py = y0; py < y1; py++) {
    const dy = py + 0.5 - cy;
    for (let px = x0; px < x1; px++) {
      const dx = px + 0.5 - cx;
      if ((dx * dx) / rxsq + (dy * dy) / rysq <= 1.0) blendPixel(ds, px, py, r, g, b, a);
    }
  }
}

// even-odd rule point-in-polygon test
function pointInPolygon(px: number, py: number, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].X;
    const yi = pts[i].Y;
    const xj = pts[j].X;
    const yj = pts[j].Y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function fillPolygon(
  ds: DrawingSurface,
  pts: Point[],
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (pts.length < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.X < minX) minX = p.X;
    if (p.Y < minY) minY = p.Y;
    if (p.X > maxX) maxX = p.X;
    if (p.Y > maxY) maxY = p.Y;
  }
  const x0 = Math.max(0, Math.trunc(minX));
  const y0 = Math.max(0, Math.trunc(minY));
  const x1 = Math.min(ds.Width, Math.ceil(maxX));
  const y1 = Math.min(ds.Height, Math.ceil(maxY));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (pointInPolygon(px + 0.5, py + 0.5, pts)) blendPixel(ds, px, py, r, g, b, a);
    }
  }
}

function distanceToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - x0;
    const ey = py - y0;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - x0) * dx + (py - y0) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const ex = px - (x0 + t * dx);
  const ey = py - (y0 + t * dy);
  return Math.sqrt(ex * ex + ey * ey);
}

export function drawLine(
  ds: DrawingSurface,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const radius = width / 2;
  const minX = Math.max(0, Math.trunc(Math.min(x0, x1) - radius));
  const minY = Math.max(0, Math.trunc(Math.min(y0, y1) - radius));
  const maxX = Math.min(ds.Width, Math.ceil(Math.max(x0, x1) + radius));
  const maxY = Math.min(ds.Height, Math.ceil(Math.max(y0, y1) + radius));
  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      if (distanceToSegment(px + 0.5, py + 0.5, x0, y0, x1, y1) <= radius)
        blendPixel(ds, px, py, r, g, b, a);
    }
  }
}

export function drawDashedLine(
  ds: DrawingSurface,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  r: number,
  g: number,
  b: number,
  a: number,
  dashValues: number[],
): void {
  const radius = width / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const minX = Math.max(0, Math.trunc(Math.min(x0, x1) - radius));
  const minY = Math.max(0, Math.trunc(Math.min(y0, y1) - radius));
  const maxX = Math.min(ds.Width, Math.ceil(Math.max(x0, x1) + radius));
  const maxY = Math.min(ds.Height, Math.ceil(Math.max(y0, y1) + radius));
  const period = dashValues.reduce((s, v) => s + v, 0);
  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      const pxx = px + 0.5;
      const pyy = py + 0.5;
      const dist = distanceToSegment(pxx, pyy, x0, y0, x1, y1);
      if (dist > radius) continue;
      // project pixel onto the segment to find the dash phase
      const t = ((pxx - x0) * ux + (pyy - y0) * uy) / len;
      const along = t * len;
      // accumulate dash pattern
      let phase = along % period;
      if (phase < 0) phase += period;
      let acc = 0;
      let on = true;
      for (const dv of dashValues) {
        acc += dv;
        if (phase < acc) break;
        on = !on;
      }
      if (on) blendPixel(ds, px, py, r, g, b, a);
    }
  }
}

export interface RgbaImage {
  Width: number;
  Height: number;
  Data: Uint8Array; // RGBA quadruplets
}

export function drawImage(ds: DrawingSurface, img: RgbaImage, x: number, y: number, opacity = 1.0): void {
  const x0 = Math.trunc(x);
  const y0 = Math.trunc(y);
  for (let iy = 0; iy < img.Height; iy++) {
    const sy = y0 + iy;
    if (sy < 0 || sy >= ds.Height) continue;
    for (let ix = 0; ix < img.Width; ix++) {
      const sx = x0 + ix;
      if (sx < 0 || sx >= ds.Width) continue;
      const idx = (ix + iy * img.Width) * 4;
      const srcA = (img.Data[idx + 3] / 255.0) * opacity;
      if (srcA <= 0) continue;
      const inv = 1.0 - srcA;
      const di = (sx + sy * ds.Width) * 3;
      ds.data[di] = Math.trunc(img.Data[idx + 2] * srcA + ds.data[di] * inv);
      ds.data[di + 1] = Math.trunc(img.Data[idx + 1] * srcA + ds.data[di + 1] * inv);
      ds.data[di + 2] = Math.trunc(img.Data[idx] * srcA + ds.data[di + 2] * inv);
    }
  }
}
