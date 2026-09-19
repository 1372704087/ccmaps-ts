// Port of CNCMaps.Engine.Map.GameObjects
import { Rectangle } from '../../shared/Geometry.js';
import { Palette } from '../../rendering/Palette.js';
import { IniSection } from '../../formats/IniFile.js';
import { Lighting } from '../../formats/map/Lighting.js';
import { logger } from '../../shared/Log.js';
import type { Drawable } from '../drawables/Drawable.js';
import type { GameCollection } from '../game/GameCollection.js';
import type { MapTile } from './MapTile.js';

export interface OwnableObject {
  Owner: string;
  Health: number;
  Direction: number;
  OnBridge: boolean;
}

let globalIdCounter = 0;

export class GameObject {
  private _tile: MapTile | null = null;
  get Tile(): MapTile | null {
    return this._tile;
  }
  set Tile(value: MapTile | null) {
    this._tile = value;
  }
  Collection: GameCollection | null = null;

  private _drawable: Drawable | null = null;
  get Drawable(): Drawable | null {
    if (this._drawable == null) this._drawable = this.Collection != null ? this.Collection.GetDrawable(this) : null;
    return this._drawable;
  }
  set Drawable(value: Drawable | null) {
    this._drawable = value;
  }

  Palette: Palette | null = null;

  // C# base GameObject: virtual BottomTile/TopTile default to Tile.
  // Subclasses that override them (overlay/smudge/structure/unit/aircraft/infantry)
  // start as null until Map.SetBaseTiles assigns foundation tiles.
  private _bottomTile: MapTile | null = null;
  private _topTile: MapTile | null = null;
  private _usesOwnBaseTiles = false;

  /** Enable independent BottomTile/TopTile (C# property override). */
  protected useOwnBaseTiles(): void {
    this._usesOwnBaseTiles = true;
  }

  get BottomTile(): MapTile | null {
    return this._usesOwnBaseTiles ? this._bottomTile : this._tile;
  }
  set BottomTile(value: MapTile | null) {
    this._bottomTile = value;
    this._usesOwnBaseTiles = true;
  }
  get TopTile(): MapTile | null {
    return this._usesOwnBaseTiles ? this._topTile : this._tile;
  }
  set TopTile(value: MapTile | null) {
    this._topTile = value;
    this._usesOwnBaseTiles = true;
  }

  toString(): string {
    if (this instanceof NamedObject) return (this as NamedObject).Name;
    else if (this instanceof NumberedObject) return (this as NumberedObject).Number.toString();
    return this.constructor.name;
  }

  get Lighting() {
    return this.Drawable != null ? this.Drawable.Props.LightingType : 4 /* LightingType.Full */;
  }

  Id = 0;
  DrawOrderIndex = -1;
  RequiresBoundsInvalidation = true;
  RequiresFrameInvalidation = true;
  private cachedBounds = Rectangle.Empty;

  constructor() {
    this.Id = globalIdCounter++;
  }

  GetBounds(): Rectangle {
    if (this.RequiresBoundsInvalidation && this.Drawable != null) {
      this.cachedBounds = this.Drawable.GetBounds(this);
      this.RequiresBoundsInvalidation = false;
    }
    return this.cachedBounds;
  }
}

export class NumberedObject extends GameObject {
  private _number = 0;
  get Number(): number {
    return this._number;
  }
  protected set Number(value: number) {
    this._number = value;
  }
}

export class NamedObject extends GameObject {
  Name = '';
}

export class AircraftObject extends NamedObject implements OwnableObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  constructor(owner: string, name: string, health: number, direction: number, onBridge: boolean) {
    super();
    this.useOwnBaseTiles();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
    this.OnBridge = onBridge;
  }
}

export class InfantryObject extends NamedObject implements OwnableObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  constructor(owner: string, name: string, health: number, direction: number, onBridge: boolean) {
    super();
    this.useOwnBaseTiles();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
    this.OnBridge = onBridge;
  }
}

export class StructureObject extends NamedObject implements OwnableObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  Upgrade1 = '';
  Upgrade2 = '';
  Upgrade3 = '';
  WallBuildingFrame = 0;

  constructor(owner: string, name: string, health: number, direction: number) {
    super();
    this.useOwnBaseTiles();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
  }
}

export class LightSource extends StructureObject {
  LightVisibility = 0;
  LightIntensity = 0;
  LightRedTint = 0;
  LightGreenTint = 0;
  LightBlueTint = 0;
  private scenario: Lighting | null = null;

  constructor();
  constructor(lamp: IniSection, scenario: Lighting);
  constructor(lamp?: IniSection, scenario?: Lighting) {
    super('nobody', '', 0, 0);
    if (lamp != null && scenario != null) {
      this.Name = lamp.Name;
      this.Initialize(lamp, scenario);
    }
  }

  private Initialize(lamp: IniSection, scenario: Lighting): void {
    logger.trace(`Loading LightSource ${lamp.Name} at (${this.Tile})`);

    // Read and assume default values
    this.LightVisibility = lamp.readDouble('LightVisibility', 5000.0);
    this.LightIntensity = lamp.readDouble('LightIntensity', 0.0);
    this.LightRedTint = lamp.readDouble('LightRedTint', 1.0);
    this.LightGreenTint = lamp.readDouble('LightGreenTint', 1.0);
    this.LightBlueTint = lamp.readDouble('LightBlueTint', 1.0);
    this.scenario = scenario;
  }

  /** Applies a lamp to this object's palette if it's in range */
  ApplyLamp(obj: GameObject, ambientOnly = false): boolean {
    const lamp = this;
    const TOLERANCE = 0.001;
    if (Math.abs(lamp.LightIntensity) < TOLERANCE) return false;

    const drawLocation = obj.Tile;
    if (drawLocation == null || lamp.Tile == null) return false;
    const sqX = (lamp.Tile.Rx - drawLocation.Rx) * (lamp.Tile.Rx - drawLocation.Rx);
    const sqY = (lamp.Tile.Ry - drawLocation.Ry) * (lamp.Tile.Ry - drawLocation.Ry);

    const distance = Math.sqrt(sqX + sqY);

    // checks whether we're in range
    if (0 < lamp.LightVisibility && distance < lamp.LightVisibility / 256) {
      const lsEffect = (lamp.LightVisibility - 256 * distance) / lamp.LightVisibility;

      // we don't want to apply lamps to shared palettes, so clone first
      if (obj.Palette != null && obj.Palette.IsShared) obj.Palette = obj.Palette.clone();

      if (obj.Palette != null) obj.Palette.applyLamp(lamp, lsEffect, ambientOnly);
      return true;
    }
    return false;
  }
}

export class OverlayObject extends NumberedObject {
  get OverlayID(): number {
    return this.Number;
  }
  set OverlayID(value: number) {
    this.Number = value;
  }

  OverlayValue = 0;

  constructor(overlayID: number, overlayValue: number) {
    super();
    this.useOwnBaseTiles();
    this.OverlayID = overlayID;
    this.OverlayValue = overlayValue;
  }

  IsGeneratedVeins = false;

  toString(): string {
    return `${this.Drawable != null ? this.Drawable.Name : this.OverlayID.toString()} (${this.OverlayValue})`;
  }
}

export class SmudgeObject extends NamedObject {
  constructor(name: string) {
    super();
    this.useOwnBaseTiles();
    this.Name = name;
  }
}

export class TerrainObject extends NamedObject {
  constructor(name: string) {
    super();
    this.Name = name;
  }
}

export class UnitObject extends NamedObject implements OwnableObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  constructor(owner: string, name: string, health: number, direction: number, onBridge: boolean) {
    super();
    this.useOwnBaseTiles();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
    this.OnBridge = onBridge;
  }
}

export class AnimationObject extends NamedObject {
  constructor(name: string, drawable: Drawable | null) {
    super();
    this.Name = name;
    this.Drawable = drawable;
  }
}
