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
  private terrainShpLoaded = false;
  private readonly _shpRenderer: ShpRenderer;

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection, art: IniSection) {
    super(config, vfs, rules, art);
    this._shpRenderer = new ShpRenderer(this._config, this._vfs);
  }

  /** The game's TerrainClass keeps one SHP per terrain type; the previous port rebuilt it, its art
   * lookup and its SHP decode on every tree/rock draw. */
  private EnsureTerrainShp(): ShpDrawable | null {
    if (this.terrainShpLoaded) return this.terrainShp;
    this.terrainShpLoaded = true;
    const shp = new ShpDrawable(this._config, this._vfs, this.Rules, this.Art);
    shp.OwnerCollection = this.OwnerCollection;
    shp.LoadFromArtEssential();
    shp.Props = this.Props;
    shp.Shp = this._vfs.open(shp.GetFilename(), FileFormat.Shp) as ShpFile | null;
    this.terrainShp = shp;
    return shp;
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadows = true): void {
    const terrainShp = this.EnsureTerrainShp();
    if (terrainShp == null) return;

    for (const sub of this.SubDrawables) {
      if (sub instanceof AlphaDrawable) sub.Draw(obj, ds, false);
    }

    // the engine emits body then shadow (0x71c304 / 0x71c34e)
    terrainShp.Draw(obj, ds, false);
    if (shadows) terrainShp.DrawShadow(obj, ds);
  }

  override GetBounds(obj: GameObject): Rectangle {
    const terrainShp = this.EnsureTerrainShp();
    if (this.InvisibleInGame || terrainShp == null || terrainShp.Shp == null) return Rectangle.Empty;
    const gobj = obj as unknown as GameObjectLike;
    const bounds = this._shpRenderer.GetBounds(gobj, terrainShp.Shp, this.Props);
    bounds.Offset((obj.Tile!.Dx * this._config.TileWidth) / 2, ((obj.Tile!.Dy - obj.Tile!.Z) * this._config.TileHeight) / 2);
    bounds.Offset(this.Props.GetOffset(gobj));
    return bounds;
  }
}
