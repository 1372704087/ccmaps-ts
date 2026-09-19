// Port of CNCMaps.Engine.Game.PaletteCollection
import { Palette } from '../../rendering/Palette.js';
import { PalFile } from '../../formats/PalFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import { VirtualFileSystem } from '../../formats/vfs/VirtualFileSystem.js';
import { PaletteType } from '../../shared/Enums.js';
import { ModConfig } from '../../shared/ModConfig.js';

export class PaletteCollection {
  CustomPalettes: Palette[] = [];
  IsoPalette: Palette | null = null;
  OvlPalette: Palette | null = null;
  UnitPalette: Palette | null = null;
  AnimPalette: Palette | null = null;

  private readonly _vfs: VirtualFileSystem;

  constructor(vfs: VirtualFileSystem) {
    this._vfs = vfs;
  }

  GetPalette(paletteType: PaletteType): Palette {
    switch (paletteType) {
      case PaletteType.Anim:
        return this.AnimPalette as Palette;
      case PaletteType.Overlay:
        return this.OvlPalette as Palette;
      case PaletteType.Unit:
        return this.UnitPalette as Palette;
      case PaletteType.Custom:
        throw new Error('GetPalette only works on built-in default palettes');
      case PaletteType.Iso:
      default:
        return this.IsoPalette as Palette;
    }
  }

  /** Enumerates the built-in palettes followed by all custom palettes (IEnumerable<Palette> equivalent). */
  GetPalettes(): Palette[] {
    const p: Palette[] = [
      this.IsoPalette as Palette,
      this.OvlPalette as Palette,
      this.UnitPalette as Palette,
      this.AnimPalette as Palette,
    ];
    p.push(...this.CustomPalettes);
    return p;
  }

  [Symbol.iterator](): Iterator<Palette> {
    return this.GetPalettes()[Symbol.iterator]();
  }

  /**
   * Gets a custom palette from the collection. If the custom palette is not found,
   * creates one, adds it to the collection and returns it.
   * Search is done by comparing names of the palettes.
   * @param paletteName Name of the palette to find, without theater or .pal extension.
   * @returns The correct custom palette, or null if the underlying file does not exist.
   */
  GetCustomPalette(paletteName: string): Palette | null {
    let fileName: string;
    // Necessary to distinguish between object and theater/animation palettes when recalculating values.
    let objectPalette = false;
    if (paletteName.toLowerCase().endsWith('.pal')) {
      // full name already given
      fileName = paletteName;
    } else {
      // filename = <paletteName><theaterExtension>.pal (e.g. lib<tem/sno/urb>.pal)
      fileName = paletteName + (ModConfig.ActiveTheater?.Extension ?? '').substring(1) + '.pal';
      objectPalette = true;
    }

    let pal = this.CustomPalettes.find((p) => p.Name === paletteName) ?? null;
    if (pal == null) {
      // palette hasn't been loaded yet
      // If the original does not exist, it means the file it should use does not exist. In that case
      // null is returned, which is handled appropriately wherever this method is called to fall back
      // to the default palette for that type of object.
      const orig = this._vfs.open(fileName, FileFormat.Pal) as PalFile | null;
      if (orig == null) return null;
      pal = new Palette(orig, paletteName, objectPalette);
      this.CustomPalettes.push(pal);
    }
    return pal;
  }
}