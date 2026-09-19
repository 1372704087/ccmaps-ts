// Port of CNCMaps.Engine.Drawables.TerrainDrawable
import { Rectangle } from '../../shared/Geometry.js';
import type { IniSection } from '../../formats/IniFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import type { GameObjectLike } from '../Types.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { ShpRenderer } from '../../rendering/ShpRenderer.js';
import { Drawable } from './Drawable.js';
import { ShpDrawable } from './ShpDrawable.js';
import { AlphaDrawable } from './AlphaDrawable.js';

export class TerrainDrawable extends Drawable {
  private terrainShp: ShpDrawable | null = null;

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection, art: IniSection) {
    super(config, vfs, rules, art);
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadows = true): void {
    this.terrainShp = new ShpDrawable(this._config, this._vfs, this.Rules, this.Art);
    this.terrainShp.OwnerCollection = this.OwnerCollection;
    this.terrainShp.LoadFromArtEssential();
    this.terrainShp.Props = this.Props;
    this.terrainShp.Shp = this._vfs.open(this.terrainShp.GetFilename(), FileFormat.Shp) as ShpFile | null;

    for (const sub of this.SubDrawables) {
      if (sub instanceof AlphaDrawable) sub.Draw(obj, ds, false);
    }

    if (shadows) this.terrainShp.DrawShadow(obj, ds);
    this.terrainShp.Draw(obj, ds, false);
  }

  override GetBounds(obj: GameObject): Rectangle {
    if (this.InvisibleInGame || this.terrainShp == null || this.terrainShp.Shp == null) return Rectangle.Empty;
    const renderer = new ShpRenderer(this._config, this._vfs);
    const gobj = obj as unknown as GameObjectLike;
    const bounds = renderer.GetBounds(gobj, this.terrainShp.Shp, this.Props);
    bounds.Offset((obj.Tile!.Dx * this._config.TileWidth) / 2, ((obj.Tile!.Dy - obj.Tile!.Z) * this._config.TileHeight) / 2);
    bounds.Offset(this.Props.GetOffset(gobj));
    return bounds;
  }
}