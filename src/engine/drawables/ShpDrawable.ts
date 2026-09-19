// Port of CNCMaps.Engine.Drawables.ShpDrawable
import { Size, Rectangle } from '../../shared/Geometry.js';
import { CollectionType } from '../../shared/Enums.js';
import { Rand } from '../../shared/Util.js';
import type { IniSection } from '../../formats/IniFile.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject, OwnableObject } from '../map/GameObjects.js';
import { OverlayObject } from '../map/GameObjects.js';
import { TileDirection } from '../map/TileLayer.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { ShpRenderer } from '../../rendering/ShpRenderer.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import type { GameObjectLike } from '../Types.js';
import { Drawable } from './Drawable.js';

// Minimal structural view of the owner collection needed by this drawable.
// The full ObjectCollection is ported separately (used by these drawables next).
interface OwnedCollectionRef {
  Type: CollectionType;
  Art: IniSection | null;
  ApplyNewTheaterIfNeeded(artName: string, imageFileName: string): string;
}

export class ShpDrawable extends Drawable {
  Shp: ShpFile | null = null;
  protected readonly _renderer: ShpRenderer;

  constructor(
    config: ModConfig,
    vfs: VirtualFileSystem,
    rules: IniSection | null,
    art: IniSection | null,
    shpFile?: ShpFile | null,
  );
  constructor(renderer: ShpRenderer, shpFile: ShpFile | null);
  constructor(
    configOrRenderer: ModConfig | ShpRenderer,
    vfsOrShp: VirtualFileSystem | ShpFile | null,
    rules?: IniSection | null,
    art?: IniSection | null,
    shpFile?: ShpFile | null,
  ) {
    if (configOrRenderer instanceof ShpRenderer) {
      super();
      this._renderer = configOrRenderer;
      this.Shp = vfsOrShp as ShpFile | null;
    } else {
      super(configOrRenderer as ModConfig, vfsOrShp as VirtualFileSystem, rules ?? null, art ?? null);
      this._renderer = new ShpRenderer(configOrRenderer as ModConfig, vfsOrShp as VirtualFileSystem);
      this.Shp = shpFile ?? null;
    }
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadow = true): void {
    if (this.InvisibleInGame || this.Shp == null) return;
    const onBridgeOffset = new Size(0, 0);
    if (this.OwnerCollection != null && (this.OwnerCollection as unknown as OwnedCollectionRef).Type === CollectionType.Infantry) {
      let randomDir = -1;
      if (this._config.ExtraOptions[0] != null && this._config.ExtraOptions[0].EnableRandomInfantryFacing)
        randomDir = Rand.nextMax(256);
      this.Props.FrameDecider = FrameDeciders.InfantryFrameDecider(
        this.Ready_Start,
        this.Ready_Count,
        this.Ready_CountNext,
        randomDir,
      ) as unknown as ((obj: GameObjectLike) => number);
      if (isOwnable(obj) && obj.OnBridge)
        onBridgeOffset.Height = (-4 * this._config.TileHeight) / 2;
    }

    this.Props.Offset.Offset(onBridgeOffset.Width, onBridgeOffset.Height);
    if (this.Props.HasShadow && shadow && !this.Props.Cloakable)
      this._renderer.DrawShadow(obj as unknown as GameObjectLike, this.Shp, this.Props, ds);
    this._renderer.Draw(this.Shp, obj as unknown as GameObjectLike, this, this.Props, ds, this.Props.Cloakable ? 50 : 0);
    this.Props.Offset.Offset(-onBridgeOffset.Width, -onBridgeOffset.Height);

    if (this.IsVeinHoleMonster)
      this.DrawSurroundingVeins(obj, ds);
  }

  // The veinhole monster's image spans its 3x3 foundation of VEINHOLEDUMMY cells, and the
  // game draws those cells' fully grown veins on top of its dull background so the monster
  // connects to the surrounding vein field. Half of those cells are drawn before this
  // object, so repeat their veins here to guarantee they end up on top.
  private DrawSurroundingVeins(obj: GameObject, ds: DrawingSurface): void {
    const tile = obj.Tile;
    if (tile == null || tile.Layer == null) return;
    for (let dir = TileDirection.Top; dir <= TileDirection.BottomRight; dir++) {
      const neighbour = tile.Layer.GetNeighbourTile(tile, dir);
      if (neighbour == null) continue;
      for (const ovl of neighbour.AllObjects) {
        if (ovl instanceof OverlayObject &&
          ovl.Drawable != null && ovl.Drawable.IsVeins && !ovl.Drawable.IsVeinHoleMonster)
          ovl.Drawable.Draw(ovl, ds, false);
      }
    }
  }

  override DrawShadow(obj: GameObject, ds: DrawingSurface): void {
    if (this.InvisibleInGame || this.Shp == null) return;
    if (this.Props.HasShadow && !this.Props.Cloakable)
      this._renderer.DrawShadow(obj as unknown as GameObjectLike, this.Shp, this.Props, ds);
  }

  override GetBounds(obj: GameObject): Rectangle {
    if (this.InvisibleInGame || this.Shp == null) return Rectangle.Empty;

    const bounds = this._renderer.GetBounds(obj as unknown as GameObjectLike, this.Shp, this.Props);
    bounds.Offset((obj.Tile!.Dx * this._config.TileWidth) / 2, ((obj.Tile!.Dy - obj.Tile!.Z) * this._config.TileHeight) / 2);
    bounds.Offset(this.Props.GetOffset(obj as unknown as GameObjectLike));
    return bounds;
  }

  GetFilename(): string {
    let fn = this.Image;
    if (this.TheaterExtension)
      fn += ModConfig.ActiveTheater != null ? ModConfig.ActiveTheater.Extension : '';
    else
      fn += '.shp';
    if (this.NewTheater && this.OwnerCollection != null)
      fn = (this.OwnerCollection as unknown as OwnedCollectionRef)
        .ApplyNewTheaterIfNeeded(this.Art != null ? this.Art.Name : this.Name, fn);
    return fn;
  }
}

function isOwnable(o: GameObject): o is GameObject & OwnableObject {
  return 'OnBridge' in o;
}