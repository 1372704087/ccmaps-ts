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

const LampNames = [
  'REDLAMP', 'BLUELAMP', 'GRENLAMP', 'YELWLAMP', 'PURPLAMP', 'INORANLAMP', 'INGRNLMP', 'INREDLMP', 'INBLULMP',
  'INGALITE', 'GALITE', 'TSTLAMP',
  'INYELWLAMP', 'INPURPLAMP', 'NEGLAMP', 'NERGRED', 'TEMMORLAMP', 'TEMPDAYLAMP', 'TEMDAYLAMP', 'TEMDUSLAMP',
  'TEMNITLAMP', 'SNOMORLAMP',
  'SNODAYLAMP', 'SNODUSLAMP', 'SNONITLAMP',
];

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
    this.InvisibleInGame = this.Rules!.readBool('InvisibleInGame') || LampNames.includes(this.Name.toUpperCase());
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
  }

  private LoadExtraImage(extraImage: string, inheritProps: DrawProperties): AnimDrawable | null {
    const animSection = this.Art!.readString(extraImage);
    if (animSection === '') return null;

    const extraRules = this.OwnerCollection!.Rules.getOrCreateSection(animSection);
    const extraArt = this.OwnerCollection!.Art.getOrCreateSection(animSection);
    const anim = new AnimDrawable(this._config, this._vfs, extraRules, extraArt);
    anim.OwnerCollection = this.OwnerCollection;
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
    let f = 0;
    while (true) {
      // enumerate as many fires as are existing
      const dfo = this.Art!.readString('DamageFireOffset' + f++);
      if (dfo === '') break;

      const coords = dfo.split(/[,.]/).filter((s) => s !== '');
      const fireAnim = this.OwnerCollection!.FireNames[Rand.nextMax(this.OwnerCollection!.FireNames.length)]!;
      const fireArt = this.OwnerCollection!.Art.getOrCreateSection(fireAnim);

      const fire = new AnimDrawable(
        this._config,
        this._vfs,
        this.Rules,
        this.Art,
        this._vfs.open(fireAnim + '.shp', FileFormat.Shp) as ShpFile | null,
      );
      fire.Props.PaletteOverride = this.GetFireAnimPalette(fireArt);
      fire.Props.Offset = new Point(parseInt(coords[0], 10) + this._config.TileWidth / 2, parseInt(coords[1], 10));
      fire.Props.FrameDecider = FrameDeciders.RandomFrameDecider;
      this._fires.push(fire);
    }
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
    if (this.InvisibleInGame) return;

    // RA2/YR building rubble
    if (obj instanceof StructureObject && (obj as StructureObject).Health === 0 && this._config.Engine >= EngineType.RedAlert2 && this._baseShp != null && this._baseShp.Shp != null) {
      const rubble = this._baseShp.Clone() as ShpDrawable;
      rubble.Props = this._baseShp.Props.Clone();
      rubble.Shp!.Initialize();
      if (rubble.Shp!.NumImages >= 8) {
        rubble.Props.PaletteOverride = this.OwnerCollection!.Palettes.IsoPalette;
        rubble.Props.FrameDecider =
          FrameDeciders.BuildingRubbleFrameDecider(rubble.Shp!.NumImages) as unknown as (obj: GameObjectLike) => number;
        if (shadows) rubble.DrawShadow(obj, ds);
        rubble.Draw(obj, ds, false);
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
      if (shadows) d.DrawShadow(obj, ds);
      d.Draw(obj, ds, false);
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