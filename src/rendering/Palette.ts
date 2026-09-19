// Port of CNCMaps.Engine.Rendering.Palette
import { Color } from '../shared/Geometry.js';
import { PalFile } from '../formats/PalFile.js';
import { Lighting } from '../formats/map/Lighting.js';

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

  private loadOriginalColors(): void {
    if (!this.originalColorsLoaded && this.originalPalette != null) {
      this.origColors = this.originalPalette.getOriginalColors();
      this.originalColorsLoaded = true;
    }
  }

  recalculate(): void {
    if (!this.originalColorsLoaded) this.loadOriginalColors();
    if (!this.originalColorsLoaded) return;

    const clipMult = Number.MAX_VALUE;
    this.ambientMult = Math.min(Math.max(this.ambientMult, 0), clipMult);
    this.redMult = Math.min(Math.max(this.redMult, 0), clipMult);
    this.greenMult = Math.min(Math.max(this.greenMult, 0), clipMult);
    this.blueMult = Math.min(Math.max(this.blueMult, 0), clipMult);

    const orig = this.origColors!;
    for (let i = 0; i < 256; i++) {
      let rmult = this.ambientMult * this.redMult;
      let gmult = this.ambientMult * this.greenMult;
      let bmult = this.ambientMult * this.blueMult;
      if (i >= 240 && i <= 254 && this.isObjectPalette) {
        rmult = gmult = bmult = 1.0;
      }
      const r = Math.min(255, (orig[i * 3 + 0] * rmult) / 63.0 * 255.0);
      const g = Math.min(255, (orig[i * 3 + 1] * gmult) / 63.0 * 255.0);
      const b = Math.min(255, (orig[i * 3 + 2] * bmult) / 63.0 * 255.0);
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

  remap(color: Color): void {
    if (!this.originalColorsLoaded) this.loadOriginalColors();
    const mults = [
      0xfc >> 2, 0xec >> 2, 0xdc >> 2, 0xd0 >> 2,
      0xc0 >> 2, 0xb0 >> 2, 0xa4 >> 2, 0x94 >> 2,
      0x84 >> 2, 0x78 >> 2, 0x68 >> 2, 0x58 >> 2,
      0x4c >> 2, 0x3c >> 2, 0x2c >> 2, 0x20 >> 2,
    ];
    const orig = this.origColors!;
    for (let i = 16; i < 32; i++) {
      orig[i * 3 + 0] = Math.trunc((color.R / 255.0) * mults[i - 16]);
      orig[i * 3 + 1] = Math.trunc((color.G / 255.0) * mults[i - 16]);
      orig[i * 3 + 2] = Math.trunc((color.B / 255.0) * mults[i - 16]);
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