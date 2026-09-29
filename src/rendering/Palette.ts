// Port of CNCMaps.Engine.Rendering.Palette
import { Color } from '../shared/Geometry.js';
import { PalFile } from '../formats/PalFile.js';
import { Lighting } from '../formats/map/Lighting.js';
import { HsvColor } from '../engine/utility/HsvColor.js';

// Structural type for the light-source used in ApplyLamp; the concrete
// LightSource class lives in the GameObjects module. Kept as an interface to
// avoid a circular import.
export interface LightSourceLike {
  LightIntensity: number;
  LightRedTint: number;
  LightGreenTint: number;
  LightBlueTint: number;
}

export class Palette {
  /** Quantize lighting to the 63 intensity steps the engine draws through. Always on for a
   * render; kept as a switch so a render can be compared against the continuous maths. */
  static QuantizeIntensity = false;

  Name = '';
  Colors: Color[] = new Array(256).fill(null).map(() => new Color(0, 0, 0, 0));
  IsShared = false;

  private originalPalette: PalFile | null = null;
  private isObjectPalette = false;
  private originalColorsLoaded = false;
  private origColors: Uint8Array | null = null;
  private bgr: Uint8Array | null = null;

  private redMult = 1.0;
  private greenMult = 1.0;
  private blueMult = 1.0;
  private ambientMult = 1.0;

  constructor(originalPalette?: PalFile | null, name = '', objectPalette = false, colors?: Uint8Array) {
    if (colors != null) {
      this.origColors = colors;
      this.Name = name;
      return;
    }
    this.originalPalette = originalPalette ?? null;
    this.isObjectPalette = objectPalette;
    if (name !== '') this.Name = name;
    else if (this.originalPalette != null)
      this.Name = (this.originalPalette.fileName.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '');
  }

  clone(): Palette {
    const p = new Palette();
    p.Name = this.Name;
    p.Colors = new Array(256).fill(null).map((_, i) => this.Colors[i].Clone());
    p.IsShared = false;
    p.originalPalette = this.originalPalette;
    p.isObjectPalette = this.isObjectPalette;
    p.originalColorsLoaded = this.originalColorsLoaded;
    p.origColors = this.origColors ? this.origColors.slice() : null;
    p.redMult = this.redMult;
    p.greenMult = this.greenMult;
    p.blueMult = this.blueMult;
    p.ambientMult = this.ambientMult;
    return p;
  }

  /** Colors as B,G,R triplets, rebuilt after every Recalculate. */
  getBgrBytes(): Uint8Array {
    if (this.bgr == null) {
      this.bgr = new Uint8Array(768);
      for (let i = 0; i < 256; i++) {
        this.bgr[i * 3 + 0] = this.Colors[i].B;
        this.bgr[i * 3 + 1] = this.Colors[i].G;
        this.bgr[i * 3 + 2] = this.Colors[i].R;
      }
    }
    return this.bgr;
  }

  applyLighting(l: Lighting, level = 0, applyTints = true): void {
    this.ambientMult = l.Ambient - l.Ground + l.Level * level;
    if (applyTints) {
      this.redMult = l.Red;
      this.greenMult = l.Green;
      this.blueMult = l.Blue;
    }
  }

  applyLamp(lamp: LightSourceLike, lsEffect: number, ambientOnly = false): void {
    this.ambientMult += lsEffect * lamp.LightIntensity;
    if (!ambientOnly) {
      this.redMult += lsEffect * lamp.LightRedTint;
      this.greenMult += lsEffect * lamp.LightGreenTint;
      this.blueMult += lsEffect * lamp.LightBlueTint;
    }
  }

  /** Adds a flat intensity, in the game's per-mille units divided by 1000. */
  addLight(intensity: number): void {
    this.ambientMult += intensity;
  }

  private loadOriginalColors(): void {
    if (!this.originalColorsLoaded && this.originalPalette != null) {
      this.origColors = this.originalPalette.getOriginalColors();
      this.originalColorsLoaded = true;
    }
  }

  // The engine does not scale colors by the light level. It draws every shape through a
  // LightConvertClass whose table holds 63 intensity steps from black to double brightness, and
  // the cell's brightness picks one of them, so a cell's lighting always lands on a multiple of
  // 1/31. The chain below is the game's own: Draw_Tile hands the brightness to
  // AlphaLightingRemapClass::Get_Table, whose row index is (261*brightness)>>11, and the table
  // entry is (alpha * shade * 62) / 32258 with alpha at its neutral 127. RA2 and YR use the same
  // machinery.
  private static quantizeTsIntensity(intensity: number): number {
    let brightness = Math.trunc(intensity * 1000);
    if (brightness < 0) brightness = 0;
    if (brightness > 2000) brightness = 2000;
    const shade = Math.min(254, (261 * brightness) >> 11);
    const level = Math.min(62, Math.trunc((127 * shade * 62) / 32258));
    return level / 31.0;
  }

  recalculate(): void {
    if (!this.originalColorsLoaded) this.loadOriginalColors();
    if (!this.originalColorsLoaded) return;

    // gamemd (CellClass::ComputeLighting 0x484180, normalize 0x5558E0): the ambient sum and each
    // tint sum clamp to [0,2]; the tint triple is normalized so its max channel becomes 1, the max
    // goes into the intensity, and that clamps to [0,2] again. Without a binding clamp this is the
    // plain per-channel product; the clamps cap the dominant channel's gain at 2x, which keeps
    // stacked or negative lamps from discoloring.
    const amb = Math.min(Math.max(this.ambientMult, 0), 2.0);
    const tr = Math.min(Math.max(this.redMult, 0), 2.0);
    const tg = Math.min(Math.max(this.greenMult, 0), 2.0);
    const tb = Math.min(Math.max(this.blueMult, 0), 2.0);
    const m = Math.max(tr, Math.max(tg, tb));
    let rmult: number;
    let gmult: number;
    let bmult: number;
    if (m < 0.001) {
      rmult = gmult = bmult = 0;
    } else {
      let intensity = Math.min(amb * m, 2.0);
      if (Palette.QuantizeIntensity) intensity = Palette.quantizeTsIntensity(intensity);
      rmult = intensity * (tr / m);
      gmult = intensity * (tg / m);
      bmult = intensity * (tb / m);
    }

    const orig = this.origColors!;
    for (let i = 0; i < 256; i++) {
      let rm = rmult;
      let gm = gmult;
      let bm = bmult;
      if (i >= 240 && i <= 254 && this.isObjectPalette) {
        rm = gm = bm = 1.0;
      }
      const r = Math.min(255, (orig[i * 3 + 0] * rm) / 63.0 * 255.0);
      const g = Math.min(255, (orig[i * 3 + 1] * gm) / 63.0 * 255.0);
      const b = Math.min(255, (orig[i * 3 + 2] * bm) / 63.0 * 255.0);
      this.Colors[i] = new Color(r, g, b);
    }
    this.bgr = null;
  }

  static makePalette(c: Color): Palette {
    const p = new Palette();
    for (let i = 0; i < 256; i++) p.Colors[i] = c;
    p.originalColorsLoaded = true;
    return p;
  }

  static merge(A: Palette, B: Palette, opacity: number): Palette {
    const p = new Palette();
    for (let i = 0; i < 256; i++) {
      p.Colors[i] = new Color(
        Math.trunc(A.Colors[i].R * opacity + B.Colors[i].R * (1.0 - opacity)),
        Math.trunc(A.Colors[i].G * opacity + B.Colors[i].G * (1.0 - opacity)),
        Math.trunc(A.Colors[i].B * opacity + B.Colors[i].B * (1.0 - opacity)),
        A.Colors[i].A,
      );
    }
    return p;
  }

  // The 16 remap shades a house colour gets, in palette indices 16-31. gamemd builds them at
  // 0x0068C3B0: the colour's hue is kept, its saturation swept up a sine and its value swept
  // down a cosine, so a shade grows more saturated as it darkens. Both sweeps end at pi/2, so
  // shade 15 is black. The angles are the binary's own doubles; in degrees they run 20 + 14i/3
  // for the value, overridden to 11.25 at i=0, and 50 + 8i/3 for the saturation.
  remap(color: HsvColor): void {
    if (!this.originalColorsLoaded) this.loadOriginalColors();

    const orig = this.origColors!;
    for (let i = 0; i < 16; i++) {
      const value = i === 0 ? 0.19634954084936207 : i * 0.08144869842640204 + 0.3490658503988659;
      const saturation = i * 0.046542113386515455 + 0.8726646259971648;
      const shade = Palette.engineHsvToRgb(
        color.Hue,
        Math.trunc(Math.sin(saturation) * color.Saturation),
        Math.trunc(Math.cos(value) * color.Value),
      );
      // The palette is six bit; the engine's conversion hands back eight.
      orig[(16 + i) * 3 + 0] = Math.trunc((shade.R * 63) / 255);
      orig[(16 + i) * 3 + 1] = Math.trunc((shade.G * 63) / 255);
      orig[(16 + i) * 3 + 2] = Math.trunc((shade.B * 63) / 255);
    }
  }

  // The engine's own HSV conversion (0x00517440), not the floating point one on HsvColor: it
  // splits the hue on 255 rather than 256 or 360 and truncates every intermediate, which moves
  // a shade a unit or two against a textbook conversion.
  private static engineHsvToRgb(h: number, s: number, v: number): Color {
    const sector = Math.trunc((h * 6) / 255);
    const frac = (h * 6) % 255;
    const p = Math.trunc(((255 - s) * v) / 255);
    const q = Math.trunc(((255 - Math.trunc((frac * s) / 255)) * v) / 255);
    const t = Math.trunc(((255 - Math.trunc(((255 - frac) * s) / 255)) * v) / 255);
    switch (sector) {
      case 1: return Color.FromRgb(q, v, p);
      case 2: return Color.FromRgb(p, v, t);
      case 3: return Color.FromRgb(p, q, v);
      case 4: return Color.FromRgb(t, p, v);
      case 5: return Color.FromRgb(v, p, q);
      default: return Color.FromRgb(v, t, p); // 0, and 6 when the hue is 255
    }
  }

  getLighting(ambientOnly = false): Lighting {
    if (!ambientOnly) {
      return {
        Ambient: this.ambientMult,
        Red: this.redMult,
        Green: this.greenMult,
        Blue: this.blueMult,
        Ground: 0,
        Level: 0,
      } as unknown as Lighting;
    }
    return {
      Ambient: this.ambientMult,
      Red: 1.0,
      Green: 1.0,
      Blue: 1.0,
      Ground: 0,
      Level: 0,
    } as unknown as Lighting;
  }
}