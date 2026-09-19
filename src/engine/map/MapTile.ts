// Port of CNCMaps.Engine.Map.MapTile
import { logger } from '../../shared/Log.js';
import type { TmpFile } from '../../formats/TmpFile.js';
import { NumberedObject, GameObject } from './GameObjects.js';
import type { TileLayer } from './TileLayer.js';
import type { TileDrawable } from '../drawables/TileDrawable.js';

export class MapTile extends NumberedObject {
  Dx = 0;
  Dy = 0;
  Rx = 0;
  Ry = 0;
  Z = 0;

  private _tileNum = 0;
  get TileNum(): number {
    return this._tileNum;
  }
  set TileNum(value: number) {
    this._tileNum = value;
  }

  get Number(): number {
    return this.TileNum;
  }
  protected set Number(value: number) {
    this.TileNum = value;
  }

  IceGrowth = 0;
  SetNum = 0;
  SubTile = 0;

  private _layer: TileLayer | null = null;
  get Layer(): TileLayer | null {
    return this._layer;
  }
  set Layer(value: TileLayer | null) {
    this._layer = value;
  }

  ExtraDataAffected = false;

  get AllObjects(): GameObject[] {
    return this._allObjects;
  }
  private readonly _allObjects: GameObject[] = [];

  constructor(
    dx = 0,
    dy = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    tilenum = 0,
    subtile = 0,
    icegrowth = 0,
    layer: TileLayer | null = null,
    setnum = 0,
  ) {
    super();
    this.Dx = dx;
    this.Dy = dy;
    this.Rx = rx;
    this.Ry = ry;
    this.Z = rz;
    this.TileNum = tilenum;
    this.SetNum = setnum;
    this.SubTile = subtile;
    this.IceGrowth = icegrowth;
    this.Layer = layer;
  }

  AddObject(obj: GameObject): void {
    this._allObjects.push(obj);
    obj.Tile = this;
  }

  RemoveObject(obj: GameObject, silent = false): void {
    if (!silent) logger.warn(`Removing unknown object ${obj} from tile ${this}`);
    const removed = this._allObjects.indexOf(obj) !== -1;
    if (removed) this._allObjects.splice(this._allObjects.indexOf(obj), 1);
    else logger.warn(`Failed to remove objects ${obj} from tile ${this}`);
  }

  toString(): string {
    return `d(${this.Dx},${this.Dy}),r(${this.Rx},${this.Ry},${this.Z})`;
  }

  get Tile(): MapTile {
    return this;
  }
  set Tile(_value: MapTile | null) {
    throw new Error('lol wat u tryin bra');
  }

  GetTileFile(): TmpFile | null {
    const dr = this.Drawable as TileDrawable | null;
    return dr != null ? dr.GetTileFile(this) : null;
  }

  GetTileImage(): TmpFile['Images'][number] | null {
    const dr = this.Drawable as TileDrawable | null;
    return dr != null ? dr.GetTileImage(this) : null;
  }
}
