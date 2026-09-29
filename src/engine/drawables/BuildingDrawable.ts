// Port of CNCMaps.Engine.Drawables.BuildingDrawable
import { Size, Point, Rectangle } from '../../shared/Geometry.js';
import { EngineType } from '../../shared/Enums.js';
import type { IniSection } from '../../formats/IniFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import type { VxlFile } from '../../formats/VxlFile.js';
import type { HvaFile } from '../../formats/HvaFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import type { GameObjectLike } from '../Types.js';
import { StructureObject } from '../map/GameObjects.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import type { Palette } from '../../rendering/Palette.js';
import { ShpRenderer } from '../../rendering/ShpRenderer.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import { Rand } from '../../shared/Util.js';
import type { DrawProperties } from '../game/DrawProperties.js';
import { Drawable } from './Drawable.js';
import { ShpDrawable } from './ShpDrawable.js';
import { VoxelDrawable } from './VoxelDrawable.js';
import { AnimDrawable } from './AnimDrawable.js';
import { AlphaDrawable } from './AlphaDrawable.js';

const AnimImages = [
  // "ProductionAnim",  // you don't want ProductionAnims on map renders, but IdleAnim instead
  'IdleAnim',
  'SuperAnim',
  // "Turret",
  //"SpecialAnimFour",
  //"SpecialAnimThree",
  //"SpecialAnimTwo",
  //"SpecialAnim",
  'ActiveAnimFour',
  'ActiveAnimThree',
  'ActiveAnimTwo',
  'ActiveAnim',
];

export class BuildingDrawable extends Drawable {
  private _baseShp: ShpDrawable | null = null;
  private readonly _powerupSlots: PowerupSlot[] = [];
  private readonly _anims: AnimDrawable[] = [];
  private readonly _animsDamaged: AnimDrawable[] = [];
  private readonly _fires: AnimDrawable[] = [];
  private _canBeOccupied = false;
  private _techLevel = 0;
  private _conditionYellowHealth = 0;
  private _conditionRedHealth = 0;

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection, art: IniSection) {
    super(config, vfs, rules, art);
  }

  override LoadFromRules(): void {
    super.LoadFromRules();

    this.IsBuildingPart = true;
    // Both games have two kinds of lamp: the IN* and theater-named ones declare InvisibleInGame
    // and only light their surroundings; REDLAMP, GALITE, TSTLAMP and friends are real light
    // posts drawn from GALITE art.
    this.InvisibleInGame = this.Rules!.readBool('InvisibleInGame');
    let foundation = this.Art!.readString('Foundation', '1x1');
    if (foundation.toLowerCase() !== 'custom') {
      const fx = foundation.charCodeAt(0) - '0'.charCodeAt(0);
      const fy = foundation.charCodeAt(2) - '0'.charCodeAt(0);
      this.Foundation = new Size(fx, fy);
    } else {
      const fx = this.Art!.readInt('Foundation.X', 1);
      const fy = this.Art!.readInt('Foundation.Y', 1);
      this.Foundation = new Size(fx, fy);
    }
    this.Props.SortIndex = this.Art!.readInt('NormalYSort') - this.Art!.readInt('NormalZAdjust'); // "main" building image before anims
    this.Props.ZShapePointMove = this.Art!.readPoint('ZShapePointMove');

    this._canBeOccupied = this.Rules!.readBool('CanBeOccupied');
    this._techLevel = this.Rules!.readInt('TechLevel');
    this._conditionYellowHealth = 128;
    this._conditionRedHealth = 64;
    const audioVisual = this.OwnerCollection!.Rules.getOrCreateSection('AudioVisual');
    if (audioVisual != null) {
      if (audioVisual.hasKey('ConditionYellow')) {
        const conditionYellow = audioVisual.readPercent('ConditionYellow');
        this._conditionYellowHealth = Math.trunc((256 * conditionYellow) / 100);
      }
      if (audioVisual.hasKey('ConditionRed')) {
        const conditionRed = audioVisual.readPercent('ConditionRed');
        this._conditionRedHealth = Math.trunc((256 * conditionRed) / 100);
      }
    }

    this._baseShp = new ShpDrawable(this._config, this._vfs, this.Rules, this.Art);
    this._baseShp.OwnerCollection = this.OwnerCollection;
    this._baseShp.LoadFromArtEssential();
    this._baseShp.Props = this.Props;
    this._baseShp.Shp = this._vfs.open(this._baseShp.GetFilename(), FileFormat.Shp) as ShpFile | null;

    const extraProps = this.Props.Clone();
    extraProps.SortIndex = 0;
    for (const extraImage of AnimImages) {
      const extra = this.LoadExtraImage(extraImage, extraProps);
      if (extra != null && extra.Shp != null) {
        this._anims.push(extra);

        const extraDmg = this.LoadExtraImage(extraImage + 'Damaged', extra.Props);
        if (extraDmg != null && extraDmg.Shp != null) this._animsDamaged.push(extraDmg);
        // no damaged anim --> use normal anim also in damaged state
        else this._animsDamaged.push(extra);
      }
    }

    // RA2 and later support adding fire animations to buildings, supports custom-paletted animations.
    if (this._config.Engine >= EngineType.RedAlert2) this.LoadFireAnimations();

    // Add turrets
    if (this.Rules!.readBool('Turret') && this.Rules!.hasKey('TurretAnim')) {
      let turretName = this.Rules!.readString('TurretAnim');
      const turretArt = this.OwnerCollection!.Art.getOrCreateSection(turretName);
      if (turretArt.hasKey('Image')) turretName = turretArt.readString('Image');
      // NewTheater/generic image fallback support for turrets.
      const turretNameShp = this.NewTheater
        ? this.OwnerCollection!.ApplyNewTheaterIfNeeded(turretName, turretName + '.shp')
        : turretName + '.shp';
      let turret: Drawable = this.Rules!.readBool('TurretAnimIsVoxel')
        ? new VoxelDrawable(
            this._config,
            this._vfs.open(turretName + '.vxl') as VxlFile,
            this._vfs.open(turretName + '.hva') as HvaFile,
          )
        : new ShpDrawable(new ShpRenderer(this._config, this._vfs), this._vfs.open(turretNameShp, FileFormat.Shp) as ShpFile | null);
      turret.Props.Offset = Point.Add(this.Props.Offset, new Size(this.Rules!.readInt('TurretAnimX'), this.Rules!.readInt('TurretAnimY')));
      turret.Props.HasShadow = this.Rules!.readBool('UseTurretShadow');
      turret.Props.FrameDecider =
        FrameDeciders.TurretFrameDecider as unknown as (obj: GameObjectLike) => number;
      turret.Props.ZAdjust = this.Rules!.readInt('TurretAnimZAdjust');
      turret.Props.Cloakable = this.Props.Cloakable;
      turret.IsTurret = true;
      this.SubDrawables.push(turret);

      if (turret instanceof VoxelDrawable && turretName.toUpperCase().includes('TUR')) {
        const barrelName = turretName.replace('TUR', 'BARL');
        if (this._vfs.fileExists(barrelName + '.vxl')) {
          const barrel = new VoxelDrawable(
            this._config,
            this._vfs.open(barrelName + '.vxl') as VxlFile,
            this._vfs.open(barrelName + '.hva') as HvaFile,
          );
          this.SubDrawables.push(barrel);
          barrel.Props = turret.Props;
        }
      }
    }

    // Bib
    if (this.Art!.hasKey('BibShape')) {
      let bibImg = this.Art!.readString('BibShape') + '.shp';
      if (this.NewTheater) bibImg = this.OwnerCollection!.ApplyNewTheaterIfNeeded(bibImg, bibImg);
      const bibShp = this._vfs.open(bibImg, FileFormat.Shp) as ShpFile | null;
      if (bibShp != null) {
        const bib = new ShpDrawable(new ShpRenderer(this._config, this._vfs), bibShp);
        bib.Props = this.Props.Clone();
        bib.Flat = true;
        this.SubDrawables.push(bib);
      }
    }

    // Powerup slots, at most 3
    for (let i = 1; i <= 3; i++) {
      const slot = new PowerupSlot();
      slot.X = this.Art!.readInt('PowerUp' + i + 'LocXX', 0);
      slot.Y = this.Art!.readInt('PowerUp' + i + 'LocYY', 0);
      slot.Z = this.Art!.readInt('PowerUp' + i + 'LocZZ', 0);
      slot.YSort = this.Art!.readInt('PowerUp' + i + 'LocYSort', 0);
      this._powerupSlots.push(slot);
    }

    if (this.IsWall && this._baseShp.Shp != null) {
      this._baseShp.Shp.Initialize();
      if (this._baseShp.Shp.NumImages >= 32) this.IsActualWall = true;
    }

    // the body's own z offset (BuildingClass::Draw_It zadjust = NormalZAdjust); the anims, bib and
    // turret above cloned Props before this and carry their own keys
    this.Props.ZAdjust = this.Art!.readInt('NormalZAdjust');
  }

  private LoadExtraImage(extraImage: string, inheritProps: DrawProperties): AnimDrawable | null {
    const animSection = this.Art!.readString(extraImage);
    if (animSection === '') return null;

    const extraRules = this.OwnerCollection!.Rules.getOrCreateSection(animSection);
    const extraArt = this.OwnerCollection!.Art.getOrCreateSection(animSection);
    const anim = new AnimDrawable(this._config, this._vfs, extraRules, extraArt);
    anim.OwnerCollection = this.OwnerCollection;
    // gamemd pauses power-gated anims (<slot>Powered, default yes) on buildings that are not
    // operating: capture-to-operate ones (NeedsEngineer: BuildingClass::Read_INI powers them off
    // whoever owns them, and a change-house trigger turns them back on like a capture) and
    // power-dependent ones (Powered=true; preplaced owners have no power at the frames
    // --anim-frame simulates, so the owner's actual power balance is not modelled)
    const slot = extraImage.endsWith('Damaged') ? extraImage.substring(0, extraImage.length - 7) : extraImage;
    const powerGated = this.Art!.readBool(slot + 'Powered', true);
    anim.HoldAtStart = powerGated && this.Rules!.readBool('Powered');
    anim.HoldUntilCaptured = powerGated && this.Rules!.readBool('NeedsEngineer');
    anim.LoadFromRules();

    anim.NewTheater = this.NewTheater;

    if (
      extraArt.hasKey('YSortAdjust') ||
      this.Art!.hasKey(extraImage + 'YSort') ||
      extraArt.hasKey('ZAdjust') ||
      this.Art!.hasKey(extraImage + 'ZAdjust')
    )
      anim.Props.SortIndex =
        extraArt.readInt('YSortAdjust', this.Art!.readInt(extraImage + 'YSort')) -
        extraArt.readInt('ZAdjust', this.Art!.readInt(extraImage + 'ZAdjust'));
    else anim.Props.SortIndex = inheritProps.SortIndex;
    if (this.Art!.hasKey(extraImage + 'X') || this.Art!.hasKey(extraImage + 'Y'))
      anim.Props.Offset = new Point(
        this.Props.Offset.X + this.Art!.readInt(extraImage + 'X'),
        this.Props.Offset.Y + this.Art!.readInt(extraImage + 'Y'),
      );
    else anim.Props.Offset = inheritProps.Offset.Clone();
    anim.Props.ZAdjust = this.Art!.readInt(extraImage + 'ZAdjust');
    anim.IsBuildingPart = true;

    anim.Shp = this._vfs.open(anim.GetFilename(), FileFormat.Shp) as ShpFile | null;
    return anim;
  }

  private LoadUpgrade(structObj: StructureObject, upgradeSlot: number, inheritProps: DrawProperties): AnimDrawable {
    let upgradeName = '';
    if (upgradeSlot === 0) upgradeName = structObj.Upgrade1;
    else if (upgradeSlot === 1) upgradeName = structObj.Upgrade2;
    else if (upgradeSlot === 2) upgradeName = structObj.Upgrade3;

    const upgradeRules = this.OwnerCollection!.Rules.getOrCreateSection(upgradeName);
    if (upgradeRules != null && upgradeRules.hasKey('Image')) upgradeName = upgradeRules.readString('Image');
    const upgradeArt = this.OwnerCollection!.Art.getOrCreateSection(upgradeName);
    if (upgradeArt != null && upgradeArt.hasKey('Image')) upgradeName = upgradeArt.readString('Image');

    const upgRules = this.OwnerCollection!.Rules.getOrCreateSection(upgradeName);
    const upgArt = this.OwnerCollection!.Art.getOrCreateSection(upgradeName);
    const upgrade = new AnimDrawable(this._config, this._vfs, upgRules, upgArt);
    upgrade.OwnerCollection = this.OwnerCollection;
    upgrade.Props = inheritProps;
    upgrade.Props.ZAdjust = 0; // the body's NormalZAdjust is not the upgrade's
    upgrade.LoadFromRules();
    upgrade.NewTheater = this.NewTheater;
    upgrade.IsBuildingPart = true;
    const shpfilename = this.NewTheater
      ? this.OwnerCollection!.ApplyNewTheaterIfNeeded(upgradeName, upgradeName + '.shp')
      : upgradeName + '.shp';
    upgrade.Shp = this._vfs.open(shpfilename, FileFormat.Shp) as ShpFile | null;
    const powerupOffset = new Point(this._powerupSlots[upgradeSlot].X, this._powerupSlots[upgradeSlot].Y);
    upgrade.Props.Offset.Offset(powerupOffset.X, powerupOffset.Y);
    return upgrade;
  }

  // Adds fire animations to a building. Supports custom-paletted animations.
  private LoadFireAnimations(): void {
    // http://modenc.renegadeprojects.com/DamageFireTypes
    // BuildingClass::Start_Damage_Fires rolls one DamageFireTypes index for the whole
    // building and then walks the list round-robin over its remaining offsets
    const fireType = Rand.nextMax(this.OwnerCollection!.FireNames.length);
    let f = 0;
    while (true) {
      // enumerate as many fires as are existing
      const dfo = this.Art!.readString('DamageFireOffset' + f++);
      if (dfo === '') break;

      const coords = dfo.split(/[,.]/).filter((s) => s !== '');
      const fireAnim = this.OwnerCollection!.FireNames[(fireType + f - 1) % this.OwnerCollection!.FireNames.length]!;
      const fireRules = this.OwnerCollection!.Rules.getOrCreateSection(fireAnim);
      const fireArt = this.OwnerCollection!.Art.getOrCreateSection(fireAnim);

      // built on the fire's own sections instead of the building's, so it animates off FIRE0x's own
      // Rate/LoopEnd like every other anim
      const fire = new AnimDrawable(
        this._config,
        this._vfs,
        fireRules,
        fireArt,
        this._vfs.open(fireAnim + '.shp', FileFormat.Shp) as ShpFile | null,
      );
      fire.OwnerCollection = this.OwnerCollection;
      fire.LoadFromRules();
      fire.AnchorToBody = true;
      // Start_Damage_Fires (0x43C25B) gives the anim ZAdjust min(0, ((dfoY - 15*(W+H)) * 3 >> 1) - 10),
      // which keeps the flame in front of its building whatever depth the body has; without it a
      // flame on a flat-profile body ties that profile and the strict test drops it
      const fireY = parseInt(coords[1], 10);
      const halfH = this._config.TileHeight / 2;
      fire.Props.ZAdjust = Math.min(0, (((fireY - (this.Foundation.Width + this.Foundation.Height) * halfH) * 3) >> 1) - 10);
      fire.Props.PaletteOverride = this.GetFireAnimPalette(fireArt);
      const dfoX = parseInt(coords[0], 10);
      const dfoY = parseInt(coords[1], 10);
      // AnimClass::Draw_It adds the art's YDrawOffset to the draw point (nothing for X)
      fire.Props.Offset = new Point(this._config.TileWidth / 2, fireArt.readInt('YDrawOffset'));
      fire.Props.OffsetHack = (obj) => this.DamageFireOffset(obj, dfoX, dfoY);
      this._fires.push(fire);
    }
  }

  // Start_Damage_Fires (0x43C0D0) does not place a fire at the pixel pair the art declares: it
  // pushes the offset through the tactical pixel-to-lepton matrix (TacticalClass+0xDE4, the
  // float literals 4.2667 / 8.5334 rather than 128/30 and 128/15) and truncates each lepton
  // with _ftol, adds that to the building's coordinate minus half a cell (BuildingClass
  // GetCoords 0x459EF0; the building sits at its entry cell's centre), and the anim's draw
  // point is CoordsToClient (0x6D1F10, truncating integer division) of the sum. Both
  // truncations move the flame up to a pixel. Returned relative to the cell's top corner;
  // Props.Offset carries the TileWidth/2 from there to the point ShpRenderer centres on.
  private static readonly TacticalInvX = Math.fround(4.2667);
  private static readonly TacticalInvY = Math.fround(8.5334);

  private DamageFireOffset(obj: GameObjectLike, dfoX: number, dfoY: number): Point {
    const cx = obj.Tile.Rx;
    const cy = obj.Tile.Ry;
    const halfW = this._config.TileWidth / 2;
    const halfH = this._config.TileHeight / 2;
    // Matrix3D * Vector3 in x87 extended precision, stored to float, then _ftol truncates
    const dx = Math.trunc(Math.fround(BuildingDrawable.TacticalInvX * dfoX + BuildingDrawable.TacticalInvY * dfoY));
    const dy = Math.trunc(Math.fround(-BuildingDrawable.TacticalInvX * dfoX + BuildingDrawable.TacticalInvY * dfoY));
    const fx = cx * 256 + dx;
    const fy = cy * 256 + dy;
    const px = Math.trunc((halfW * (fx - fy)) / 256);
    const py = Math.trunc((halfH * (fx + fy)) / 256);
    return new Point(px - halfW * (cx - cy), py - halfH * (cx + cy));
  }

  /* Finds out the correct name for an animation palette to use with fire animations.
   * Reason why this is so complicated is because with NPatch & Ares, the YR logic extensions that support custom animation palettes
   * use different name for the flag declaring the palette. (NPatch uses 'Palette' whilst Ares uses 'CustomPalette' to make it distinct
   * from the custom object palettes).
   */
  private GetFireAnimPalette(animation: IniSection): Palette {
    let pal: Palette | null = null;
    if (animation.readString('Palette') !== '') {
      pal = this.OwnerCollection!.Palettes.GetCustomPalette(animation.readString('Palette'));
      if (pal == null) pal = this.OwnerCollection!.Palettes.AnimPalette;
    } else if (animation.readString('CustomPalette') !== '') {
      pal = this.OwnerCollection!.Palettes.GetCustomPalette(animation.readString('CustomPalette'));
      if (pal == null) pal = this.OwnerCollection!.Palettes.AnimPalette;
    } else if (animation.readString('AltPalette') !== '') pal = this.OwnerCollection!.Palettes.UnitPalette;
    else pal = this.OwnerCollection!.Palettes.AnimPalette;
    return (pal ?? this.OwnerCollection!.Palettes.AnimPalette)!;
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadows = true): void {
    if (this.InvisibleInGame) {
      // invisible lamp buildings still project their AlphaImage glow in game
      for (const sub of this.SubDrawables) if (sub instanceof AlphaDrawable) sub.Draw(obj, ds, false);
      return;
    }

    // RA2/YR building rubble
    if (obj instanceof StructureObject && (obj as StructureObject).Health === 0 && this._config.Engine >= EngineType.RedAlert2 && this._baseShp != null && this._baseShp.Shp != null) {
      const rubble = this._baseShp.Clone() as ShpDrawable;
      rubble.Props = this._baseShp.Props.Clone();
      rubble.Shp!.Initialize();
      if (rubble.Shp!.NumImages >= 8) {
        rubble.Props.PaletteOverride = this.OwnerCollection!.Palettes.IsoPalette;
        rubble.Props.FrameDecider =
          FrameDeciders.BuildingRubbleFrameDecider(rubble.Shp!.NumImages) as unknown as (obj: GameObjectLike) => number;
        obj.DrawnBodyAnchorY = rubble.GetDrawnBottomY(obj);
        rubble.Draw(obj, ds, false);
        if (shadows) rubble.DrawShadow(obj, ds);
        return;
      }
    }

    let isDamaged = false;
    let isOnFire = false;
    if (obj instanceof StructureObject) {
      const health = (obj as StructureObject).Health;
      if (health <= this._conditionYellowHealth) {
        isDamaged = true;
        if (health > this._conditionRedHealth && this._canBeOccupied && this._techLevel < 1) isDamaged = false;
      }
      this._baseShp!.Props.FrameDecider =
        FrameDeciders.BaseBuildingFrameDecider(isDamaged) as unknown as (obj: GameObjectLike) => number;

      if (this._config.Engine >= EngineType.RedAlert2) {
        if (isDamaged) isOnFire = true;
        if (health > this._conditionRedHealth && this._canBeOccupied) isOnFire = false;
      }
    }

    // the body's drawn bottom row is the z anchor the game uses for the whole
    // building; parts above it (anims, turrets) share it via StructureObject
    if (obj instanceof StructureObject) obj.DrawnBodyAnchorY = this._baseShp!.GetDrawnBottomY(obj);

    let drawList: Drawable[] = [];
    drawList.push(this._baseShp!);

    if (obj instanceof StructureObject && isDamaged) {
      drawList.push(...this._animsDamaged);
      if (isOnFire) drawList.push(...this._fires);
    } else drawList.push(...this._anims);

    drawList.push(...this.SubDrawables); // bib
    /* order:
    ActiveAnims+Flat=yes
    BibShape
    ActiveAnims (+ZAdjust=0)
    Building
    ActiveAnims+ZAdjust=-32 */
    drawList = drawList
      .map((d, i) => ({ d, i }))
      .sort((a, b) => {
        const ca = a.d.Flat ? -1 : 1;
        const cb = b.d.Flat ? -1 : 1;
        if (ca !== cb) return ca - cb;
        const sa = a.d.Props.SortIndex;
        const sb = b.d.Props.SortIndex;
        if (sa !== sb) return sa - sb;
        return a.i - b.i;
      })
      .map((x) => x.d);

    for (const d of drawList) {
      // an attached anim is drawn with every other anim after the object pass, never here
      if (d instanceof AnimDrawable) {
        // AnimDrawable.Draw's third parameter is omitShadow: it draws its own shadow,
        // so an explicit DrawShadow here would darken the same pixels twice
        ds.deferAnim(() => d.Draw(obj, ds, !shadows));
        continue;
      }
      // the engine emits body then shadow for a building, which is what lets a shadow
      // darken the body it belongs to
      d.Draw(obj, ds, false);
      if (shadows) d.DrawShadow(obj, ds);
    }

    const strObj = obj as StructureObject;

    if (strObj.Upgrade1.toLowerCase() !== 'none') {
      const up1 = this.LoadUpgrade(strObj, 0, this.Props.Clone());
      up1.Draw(obj, ds, false);
    }

    if (strObj.Upgrade2.toLowerCase() !== 'none') {
      const up2 = this.LoadUpgrade(strObj, 1, this.Props.Clone());
      up2.Draw(obj, ds, false);
    }

    if (strObj.Upgrade3.toLowerCase() !== 'none') {
      const up3 = this.LoadUpgrade(strObj, 2, this.Props.Clone());
      up3.Draw(obj, ds, false);
    }
  }

  override GetBounds(obj: GameObject): Rectangle {
    let bounds = Rectangle.Empty;
    if (this.InvisibleInGame) return bounds;

    const parts: Drawable[] = [this._baseShp!];
    // C# also comments out _anims and SubDrawables for bounds

    for (const d of parts) {
      if (d.InvisibleInGame) continue;
      const db = d.GetBounds(obj);
      if (db.IsEmpty) continue;
      if (bounds.IsEmpty) bounds = db;
      else bounds = Rectangle.Union(bounds, db);
    }
    return bounds;
  }
}

export class PowerupSlot {
  X = 0;
  Y = 0;
  Z = 0;
  YSort = 0;
}