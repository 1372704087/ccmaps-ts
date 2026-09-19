// Port of CNCMaps.Engine.Drawables.UnitDrawable
import { Size, Point, Rectangle } from '../../shared/Geometry.js';
import type { IniSection } from '../../formats/IniFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import type { VxlFile } from '../../formats/VxlFile.js';
import type { HvaFile } from '../../formats/HvaFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject, OwnableObject } from '../map/GameObjects.js';
import type { GameObjectLike } from '../Types.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import { Drawable } from './Drawable.js';
import { ShpDrawable } from './ShpDrawable.js';
import { VoxelDrawable } from './VoxelDrawable.js';

export class UnitDrawable extends Drawable {
  // the jumpjet locomotor's CLSID in the game rules
  private static readonly JumpjetLocomotor = '{92612C46-F71F-11d1-AC9F-006008055BB5}';

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection, art: IniSection) {
    super(config, vfs, rules, art);
  }

  override LoadFromRules(): void {
    super.LoadFromArtEssential();

    // jumpjet units that can never land (BalloonHover, e.g. the Kirov airship)
    // hover at their cruise height even when preplaced on a map; one height
    // level is 104 leptons and projects to half a tile
    if (
      this.Rules!.readBool('BalloonHover') &&
      this.Rules!.readString('Locomotor').toUpperCase() === UnitDrawable.JumpjetLocomotor.toUpperCase()
    ) {
      const cruiseDefault = this.OwnerCollection!.Rules.getOrCreateSection('JumpjetControls').readInt('CruiseHeight', 500);
      const leptons = this.Rules!.readInt('JumpjetHeight', cruiseDefault);
      this.Props.FlightHeight = Math.trunc((leptons * (this._config.TileHeight / 2)) / 104);
    }

    let shp: ShpDrawable | null = null;
    let vxl: VoxelDrawable | null = null;

    if (this.IsVoxel) {
      vxl = new VoxelDrawable(this._config, this._vfs, this.Rules, this.Art);
      vxl.OwnerCollection = this.OwnerCollection;
      vxl.Props = this.Props;
      vxl.LoadFromRules();
      vxl.Vxl = this._vfs.open(vxl.Image + '.vxl') as VxlFile | null;
      vxl.Hva = this._vfs.open(vxl.Image + '.hva') as HvaFile | null;
      this.SubDrawables.push(vxl);
    } else {
      shp = new ShpDrawable(this._config, this._vfs, this.Rules, this.Art);
      shp.Props = this.Props;
      shp.OwnerCollection = this.OwnerCollection;
      shp.LoadFromRules();
      shp.Shp = this._vfs.open(shp.GetFilename(), FileFormat.Shp) as ShpFile | null;
      shp.Props.FrameDecider = FrameDeciders.SHPVehicleFrameDecider(
        shp.StartStandFrame,
        shp.StandingFrames,
        shp.StartWalkFrame,
        shp.WalkFrames,
        shp.Facings,
        this._config.Engine,
      ) as unknown as (obj: GameObjectLike) => number;
      this.SubDrawables.push(shp);
    }

    if (shp != null || vxl != null) {
      if (this.Rules!.readBool('Turret')) {
        let vxlturret: VoxelDrawable | null = null;
        let shpturret: ShpDrawable | null = null;
        const turretVxl = this._vfs.open(this.Image + 'TUR.vxl') as VxlFile | null;
        const turretHva = this._vfs.open(this.Image + 'TUR.hva') as HvaFile | null;

        if (turretVxl != null && turretHva != null) {
          vxlturret = new VoxelDrawable(this._config, turretVxl, turretHva);
          vxlturret.Props.Offset = this.Props.Offset.Clone();
          vxlturret.Props.Offset.Offset(this.Rules!.readInt('TurretAnimX'), this.Rules!.readInt('TurretAnimY'));
          vxlturret.Props.TurretVoxelOffset = this.Art!.readFloat('TurretOffset');
          vxlturret.Props.Cloakable = this.Props.Cloakable;
          vxlturret.Props.FlightHeight = this.Props.FlightHeight;
          this.SubDrawables.push(vxlturret);
        }

        if (vxlturret == null && shp != null) {
          shpturret = new ShpDrawable(this._config, this._vfs, this.Rules, this.Art);
          shpturret.Props = shp.Props.Clone();
          shpturret.OwnerCollection = this.OwnerCollection;
          shpturret.LoadFromRules();
          shpturret.Shp = this._vfs.open(shpturret.GetFilename(), FileFormat.Shp) as ShpFile | null;
          shpturret.Props.FrameDecider = FrameDeciders.SHPVehicleSHPTurretFrameDecider(
            shpturret.StartWalkFrame,
            shpturret.WalkFrames,
            shpturret.Facings,
          ) as unknown as (obj: GameObjectLike) => number;
          shpturret.Props.Cloakable = this.Props.Cloakable;
          this.SubDrawables.push(shpturret);
        }

        const barrelVxl = this._vfs.open(this.Image + 'BARL.vxl') as VxlFile | null;
        const barrelHva = this._vfs.open(this.Image + 'BARL.hva') as HvaFile | null;
        if (barrelVxl != null && barrelHva != null) {
          const barrel = new VoxelDrawable(this._config, barrelVxl, barrelHva);
          if (vxlturret != null) barrel.Props = vxlturret.Props;
          else if (shp != null) {
            barrel.Props.Offset = this.Props.Offset.Clone();
            barrel.Props.Offset.Offset(this.Rules!.readInt('TurretAnimX'), this.Rules!.readInt('TurretAnimY'));
            barrel.Props.TurretVoxelOffset = this.Art!.readFloat('TurretOffset');
            barrel.Props.FlightHeight = this.Props.FlightHeight;
          }
          barrel.Props.Cloakable = this.Props.Cloakable;
          this.SubDrawables.push(barrel);
        }
      }
    }
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadows = true): void {
    let onBridgeOffset = Size.Empty;
    if (isOwnableObject(obj) && (obj as OwnableObject).OnBridge)
      onBridgeOffset = new Size(0, (-4 * this._config.TileHeight) / 2);

    for (const drawable of this.SubDrawables) {
      drawable.Props.Offset.Offset(onBridgeOffset.Width, onBridgeOffset.Height);
      drawable.Draw(obj, ds, shadows);
      drawable.Props.Offset.Offset(-onBridgeOffset.Width, -onBridgeOffset.Height);
    }
  }

  override GetBounds(obj: GameObject): Rectangle {
    let bounds = Rectangle.Empty;
    for (const d of this.SubDrawables) {
      const db = d.GetBounds(obj);
      if (db.IsEmpty) continue;
      if (bounds.IsEmpty) bounds = db;
      else bounds = Rectangle.Union(bounds, db);
    }

    let onBridgeOffset = Point.Empty;
    if (isOwnableObject(obj) && (obj as OwnableObject).OnBridge)
      onBridgeOffset = new Point(0, (-4 * this._config.TileHeight) / 2);
    bounds.Offset(onBridgeOffset);

    return bounds;
  }
}

function isOwnableObject(o: GameObject): o is GameObject & OwnableObject {
  return 'Direction' in o && 'OnBridge' in o;
}