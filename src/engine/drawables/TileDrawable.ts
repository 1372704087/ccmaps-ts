// Port of CNCMaps.Engine.Drawables.TileDrawable
import { Rectangle } from '../../shared/Geometry.js';
import type { IniSection } from '../../formats/IniFile.js';
import type { TmpFile, TmpImage } from '../../formats/TmpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import type { MapTile } from '../map/MapTile.js';
import type { MapTileLike } from '../Types.js';
import type { TileSet } from '../game/TileCollection.js';
import { TmpRenderer } from '../../rendering/TmpRenderer.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { Drawable } from './Drawable.js';

// Structural contract for a tile-set entry. The concrete implementation lives in
// TileCollection.TileSetEntry (which `implements` this interface); drawables only
// rely on this shape to read tiles and their attached animations.
export interface TileSetEntry {
  TmpFiles: TmpFile[];
  AnimationDrawable: Drawable | null;
  AnimationSubtile: number;
  MemberOfSet: TileSet;
  Index: number;
  AddTile(tmpFile: TmpFile): void;
  AddAnimation(subtile: number, drawable: Drawable): void;
  GetTmpFile(t: MapTile, damaged?: boolean): TmpFile | null;
  toString(): string;
}

export class TileDrawable extends Drawable {
  TsEntry: TileSetEntry | null;

  constructor(
    config: ModConfig,
    vfs: VirtualFileSystem,
    rules: IniSection | null,
    art: IniSection | null,
    entry: TileSetEntry | null,
  ) {
    super(config, vfs, rules, art);
    this.TsEntry = entry;
    if (entry != null)
      this.Name = entry.toString();
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadows = true): void {
    if (obj == null || this.TsEntry == null) return;

    const tile = obj as MapTile;
    const tmpFile = this.TsEntry.GetTmpFile(tile);
    if (tmpFile != null) {
      const renderer = new TmpRenderer(this._config);
      renderer.Draw(tile as unknown as MapTileLike, tmpFile, ds);

      if (this.TsEntry.AnimationDrawable != null && this.TsEntry.AnimationSubtile === tile.SubTile) {
        this.TsEntry.AnimationDrawable.Draw(obj, ds, false);
      }
    }

    // todo: tile shadows (TS)
  }

  override GetBounds(obj: GameObject): Rectangle {
    const tile = obj as MapTile;
    return TmpRenderer.GetBounds(tile as unknown as MapTileLike, this.TsEntry != null ? this.TsEntry.GetTmpFile(tile) : null);
  }

  GetTileSetEntry(): TileSetEntry | null {
    return this.TsEntry;
  }

  GetTileFile(t: MapTile): TmpFile | null {
    return this.TsEntry != null ? this.TsEntry.GetTmpFile(t) : null;
  }

  GetTileImage(t: MapTile): TmpImage | null {
    const tmp = this.TsEntry != null ? this.TsEntry.GetTmpFile(t) : null;
    if (tmp == null || tmp.Images.length === 0) return null;
    if (tmp.Images.length > t.SubTile) return tmp.Images[t.SubTile];
    else return tmp.Images[0];
  }

  DoesSubTileExist(t: MapTile): boolean {
    let exist = true;
    const tmp = this.TsEntry != null ? this.TsEntry.GetTmpFile(t) : null;
    if (tmp != null)
      if (t.SubTile > 0 && t.SubTile > tmp.Images.length - 1)
        exist = false;
    return exist;
  }
}