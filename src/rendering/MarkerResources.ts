// Port of CNCMaps.Engine.Rendering.MarkerResources.
// The C# original loads the start-position marker PNGs from embedded resources
// ("bittah_marker_1..8", "aro_marker_1..8"). Here the same marker shapes are
// generated procedurally into RGBA buffers, keyed by the same names.
import type { RgbaImage } from './MapDrawing.js';

const cache = new Map<string, RgbaImage | null>();

function makeMarker(kind: 'bittah' | 'aro', num: number): RgbaImage {
  const W = 36;
  const H = 28;
  const data = new Uint8Array(W * H * 4);
  const cx = W / 2;
  const cy = H / 2;

  const colors = [
    [255, 0, 0],
    [255, 128, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 200, 255],
    [0, 0, 255],
    [160, 0, 255],
    [255, 0, 200],
  ];
  const [cr, cg, cb] = colors[(num - 1) % colors.length];

  const set = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    const idx = (Math.trunc(x) + Math.trunc(y) * W) * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  };

  // draw a filled diamond / rounded marker body
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let inside = false;
      if (kind === 'bittah') {
        // diamond
        const nx = Math.abs(x + 0.5 - cx) / (W / 2);
        const ny = Math.abs(y + 0.5 - cy) / (H / 2);
        inside = nx + ny <= 1.0;
        if (inside) set(x, y, cr, cg, cb, 255);
      } else {
        // downward-pointing triangle (arrow)
        const t = (y + 0.5 - 2) / (H - 4);
        if (t >= 0 && t <= 1) {
          const half = ((W - 8) / 2) * (1 - t) + 3;
          if (Math.abs(x + 0.5 - cx) <= half) inside = true;
        }
        if (inside) set(x, y, cr, cg, cb, 255);
      }
    }
  }

  // white border
  const border = (x: number, y: number): boolean => {
    if (kind === 'bittah') {
      const nx = Math.abs(x + 0.5 - cx) / (W / 2);
      const ny = Math.abs(y + 0.5 - cy) / (H / 2);
      const d = Math.abs(nx + ny - 1.0);
      return d <= 0.08;
    }
    const t = (y + 0.5 - 2) / (H - 4);
    if (t < 0 || t > 1) return false;
    const half = ((W - 8) / 2) * (1 - t) + 3;
    return Math.abs(Math.abs(x + 0.5 - cx) - half) <= 0.8;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (border(x, y)) set(x, y, 255, 255, 255, 255);
    }
  }

  return { Width: W, Height: H, Data: data };
}

export class MarkerResources {
  static Get(name: string): RgbaImage | null {
    if (cache.has(name)) return cache.get(name) ?? null;
    const m = /^(bittah|aro)_marker_([1-8])$/.exec(name);
    let img: RgbaImage | null = null;
    if (m != null) img = makeMarker(m[1] as 'bittah' | 'aro', parseInt(m[2], 10));
    cache.set(name, img);
    return img;
  }
}
