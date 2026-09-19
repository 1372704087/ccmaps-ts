// Port of CNCMaps.FileFormats.Map.MapObjects + TunnelLine

export class MapObject {
  Tile: IsoTile | null = null;
}

export class NamedMapObject extends MapObject {
  Name = '';
}

export class NumberedMapObject extends MapObject {
  private _number = 0;
  get Number(): number {
    return this._number;
  }
  set Number(value: number) {
    this._number = value;
  }
}

// all the stuff found on maps
export class IsoTile extends NumberedMapObject {
  Dx = 0;
  Dy = 0;
  Rx = 0;
  Ry = 0;
  Z = 0;
  TileNum = 0;
  SubTile = 0;
  IceGrowth = 0;

  constructor(
    p1 = 0,
    p2 = 0,
    rx = 0,
    ry = 0,
    z = 0,
    tilenum = 0,
    subtile = 0,
    icegrowth = 0,
  ) {
    super();
    this.Dx = p1;
    this.Dy = p2;
    this.Rx = rx;
    this.Ry = ry;
    this.Z = z;
    this.TileNum = tilenum;
    this.SubTile = subtile;
    this.IceGrowth = icegrowth;
  }

  toMapPack5Entry(): Uint8Array {
    const ret = new Uint8Array(11);
    const dv = new DataView(ret.buffer);
    dv.setUint16(0, this.Rx, true);
    dv.setUint16(2, this.Ry, true);
    dv.setInt32(4, this.TileNum, true);
    ret[8] = this.SubTile;
    ret[9] = this.Z;
    ret[10] = this.IceGrowth;
    return ret;
  }
}

export class Aircraft extends NamedMapObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  constructor(owner: string, name: string, health: number, direction: number, onBridge: boolean) {
    super();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
    this.OnBridge = onBridge;
  }
}

export class Infantry extends NamedMapObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  constructor(owner: string, name: string, health: number, direction: number, onBridge: boolean) {
    super();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
    this.OnBridge = onBridge;
  }
}

export class Overlay extends NumberedMapObject {
  OverlayID = 0;
  OverlayValue = 0;

  constructor(overlayID: number, overlayValue: number) {
    super();
    this.OverlayID = overlayID;
    this.OverlayValue = overlayValue;
  }

  get Number(): number {
    return this.OverlayID;
  }

  set Number(value: number) {
    this.OverlayID = value;
  }
}

export class Smudge extends NamedMapObject {
  constructor(name: string) {
    super();
    this.Name = name;
  }
}

export class Structure extends NamedMapObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';
  Upgrade1 = '';
  Upgrade2 = '';
  Upgrade3 = '';

  constructor(owner: string, name: string, health: number, direction: number) {
    super();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
  }
}

export class Terrain extends NamedMapObject {
  constructor(name: string) {
    super();
    this.Name = name;
  }
}

export class Unit extends NamedMapObject {
  Health = 0;
  Direction = 0;
  OnBridge = false;
  Owner = '';

  constructor(owner: string, name: string, health: number, direction: number, onBridge: boolean) {
    super();
    this.Owner = owner;
    this.Name = name;
    this.Health = health;
    this.Direction = direction;
    this.OnBridge = onBridge;
  }
}

export class Waypoint extends NumberedMapObject {}

export class TunnelLine {
  StartX = -1;
  StartY = -1;
  Facing = -1;
  EndX = -1;
  EndY = -1;
  Direction: number[] = [];

  constructor(sx = -1, sy = -1, facing = -1, ex = -1, ey = -1, ds?: number[]) {
    this.StartX = sx;
    this.StartY = sy;
    this.Facing = facing;
    this.EndX = ex;
    this.EndY = ey;
    this.Direction = ds ? ds.slice() : [];
  }
}
