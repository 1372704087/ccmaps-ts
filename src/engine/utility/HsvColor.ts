// Port of CNCMaps.Engine.Utility.HsvColor
// My HSV considers Hue Sat and Val as values from 0 - 255.
import { Color } from '../../shared/Geometry.js';

export class HsvColor {
  Hue = 0;
  Saturation = 0;
  Value = 0;

  constructor(h?: number, s?: number, v?: number);
  constructor(color?: Color);
  constructor(hOrColor?: number | Color, s?: number, v?: number) {
    if (hOrColor instanceof Color) this.fromRGB(hOrColor);
    else if (hOrColor !== undefined) {
      this.Hue = hOrColor;
      this.Saturation = s!;
      this.Value = v!;
    }
  }

  get Color(): Color {
    return this.toRGB();
  }

  set Color(value: Color) {
    this.fromRGB(value);
  }

  private fromRGB(color: Color): void {
    let min: number, max: number, delta: number;
    const r = color.R / 255;
    const g = color.G / 255;
    const b = color.B / 255;
    let h: number, s: number, v: number;

    min = Math.min(Math.min(r, g), b);
    max = Math.max(Math.max(r, g), b);
    v = max;
    delta = max - min;
    if (max === 0 || delta === 0) {
      s = 0;
      h = 0;
    } else {
      s = delta / max;
      if (r === max) {
        h = (60 * ((g - b) / delta)) % 360;
      } else if (g === max) {
        h = 60 * ((b - r) / delta) + 120;
      } else {
        h = 60 * ((r - g) / delta) + 240;
      }
    }
    if (h < 0) {
      h += 360;
    }

    this.Hue = Math.trunc((h / 360) * 255);
    this.Saturation = Math.trunc(s * 255);
    this.Value = Math.trunc(v * 255);
  }

  toRGB(): Color {
    let h: number, s: number, v: number;
    let r = 0, g = 0, b = 0;

    h = ((this.Hue / 255) * 360) % 360;
    s = this.Saturation / 255;
    v = this.Value / 255;

    if (s === 0) {
      r = v;
      g = v;
      b = v;
    } else {
      let p: number, q: number, t: number;

      let fractionalSector: number;
      let sectorNumber: number;

      const sectorPos = h / 60;
      sectorNumber = Math.floor(sectorPos);

      fractionalSector = sectorPos - sectorNumber;

      p = v * (1 - s);
      q = v * (1 - s * fractionalSector);
      t = v * (1 - s * (1 - fractionalSector));

      switch (sectorNumber) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
      }
    }
    return Color.FromArgb(255, Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255));
  }
}
