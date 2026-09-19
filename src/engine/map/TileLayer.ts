// Port of CNCMaps.Engine.Map.TileLayer (engine tile storage with neighbour queries)
import { Point, Size } from '../../shared/Geometry.js';
import { logger } from '../../shared/Log.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { IsoTile } from '../../formats/map/MapObjects.js';
import { MapTile } from './MapTile.js';

export enum TileDirection {
  Top,
  TopLeft,
  TopRight,
  Left,
  Right,
  BottomLeft,
  Bottom,
  BottomRight,
}

export enum TouchType {
  Untouched = 0,
  ByNormalData = 1,
  ByExtraData = 2,
}

export class TileLayer {
  GridTouched: TouchType[][];
  GridTouchedBy: (MapTile | null)[][];
  private tiles: (MapTile | null)[][];
  private readonly fullSize: Size;
  private readonly config: ModConfig;

  constructor(w: number, h: number, config: ModConfig);
  constructor(fullSize: Size, config: ModConfig);
  constructor(wOrSize: number | Size, hOrConfig: number | ModConfig, config?: ModConfig) {
    if (typeof wOrSize === 'number') {
      this.fullSize = new Size(wOrSize, hOrConfig as number);
      this.config = config!;
    } else {
      this.fullSize = wOrSize;
      this.config = hOrConfig as ModConfig;
    }
    this.tiles = new Array(this.fullSize.Width * 2 - 1);
    this.GridTouched = new Array(this.fullSize.Width * 2 - 1);
    this.GridTouchedBy = new Array(this.fullSize.Width * 2 - 1);
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i] = new Array<MapTile | null>(this.fullSize.Height).fill(null);
      this.GridTouched[i] = new Array<TouchType>(this.fullSize.Height).fill(TouchType.Untouched);
      this.GridTouchedBy[i] = new Array<MapTile | null>(this.fullSize.Height).fill(null);
    }
  }

  get Width(): number {
    return this.fullSize.Width;
  }

  get Height(): number {
    return this.fullSize.Height;
  }

  get(x: number, y: number): MapTile | null {
    if (0 <= x && x < this.tiles.length && 0 <= y && y < this.tiles[0].length)
      return this.tiles[x][y];
    return null;
  }

  set(x: number, y: number, value: MapTile | null): void {
    this.tiles[x][y] = value;
  }

  /** Gets a tile at display coordinates. */
  GetTile(dx: number, dy: number): MapTile | null {
    if (0 <= dx && dx < this.tiles.length && 0 <= dy && dy < this.tiles[0].length)
      return this.tiles[dx][dy];
    return null;
  }

  /** Gets a tile at map coordinates. */
  GetTileR(rx: number, ry: number): MapTile | null {
    const dx = rx - ry + this.fullSize.Width - 1;
    const dy = rx + ry - this.fullSize.Width - 1;

    if (dx < 0 || dy < 0 || dx >= this.tiles.length || Math.trunc(dy / 2) >= this.tiles[0].length) {
      logger.trace(`Referencing empty tile at (rx,ry)=(${rx},${ry}); (dx,dy)=(${dx},${dy})`);
      return null;
    }
    return this.GetTile(dx, Math.trunc(dy / 2));
  }

  GetTilePixelCenter(t: IsoTile): Point {
    const ret = new Point((t.Dx * this.config.TileWidth) / 2, (t.Dy - t.Z) * this.config.TileHeight);
    ret.Offset(this.config.TileWidth / 2, this.config.TileHeight / 2);
    return ret;
  }

  GetTileScreen(p: Point, fixOOB = true, omitHeight = false): MapTile | null {
    // use inverse matrix of world projection for screen to world
    const w = this.config.TileWidth / 2;
    const h = this.config.TileHeight / 2;
    const fx = w * this.Width;
    const fy = h * (-1 - this.Width);
    const rx = (p.X * h + p.Y * w - fx * h - fy * w) / (2 * w * h);
    const ry = (p.X * -h + p.Y * w + fx * h - fy * w) / (2 * w * h);

    let dx = rx - ry + this.Width - 1;
    let dy = rx + ry - this.Width - 1;
    if (fixOOB) {
      dx = Math.min(this.Width * 2 - 2, Math.max(0, dx));
      dy = Math.min(this.Height * 2 - 2, Math.max(0, dy));
    }
    const tileNoHeight = this.get(Math.trunc(dx), Math.trunc(dy / 2));
    if (omitHeight) return tileNoHeight;

    let dyFinal = dy;
    if (tileNoHeight != null) dyFinal += tileNoHeight.Z;
    if (fixOOB) dyFinal = Math.min(this.Height * 2 - 2, Math.max(0, dyFinal));
    return this.get(Math.trunc(dx), Math.trunc(dyFinal / 2));
  }

  GetNeighbourTile(t: MapTile, tileDirection: TileDirection): MapTile | null {
    // find index for t
    const x = t.Dx;
    // C# uses int division here (truncating); float division would leave a
    // fractional row index that never hits a stored tile.
    const y = Math.trunc((t.Dy + ((t.Dx + 1) % 2)) / 2);
    return this.GetNeighbourTileInner(x, y, tileDirection);
  }

  private GetNeighbourTileInner(x: number, y: number, direction: TileDirection): MapTile | null {
    switch (direction) {
      // in non-diagonal direction we don't need to check odd/evenness of x
      case TileDirection.Bottom:
        if (y >= this.tiles[0].length) return null;
        return this.get(x, y + 1);

      case TileDirection.Top:
        if (y < 2) return null;
        return this.get(x, y - 1);

      case TileDirection.Left:
        if (x < 2) return null;
        return this.get(x - 2, y);

      case TileDirection.Right:
        if (x >= this.tiles.length - 1) return null;
        return this.get(x + 2, y);
    }

    // the horizontally neighbouring tiles have dy' = dy + 1 if x is odd,
    // and the horizontally neighbouring tiles have dy' = dy - 1 if x is even,
    const yAdjust = y + (x % 2);
    switch (direction) {
      case TileDirection.BottomLeft:
        if (x < 1 || yAdjust >= this.tiles[0].length) return null;
        return this.get(x - 1, yAdjust);

      case TileDirection.BottomRight:
        if (x >= this.tiles.length || yAdjust >= this.tiles[0].length) return null;
        return this.get(x + 1, yAdjust);

      case TileDirection.TopLeft:
        if (x < 1 || yAdjust < 1) return null;
        return this.get(x - 1, yAdjust - 1);

      case TileDirection.TopRight:
        if (yAdjust < 1 || x >= this.tiles.length - 1) return null;
        return this.get(x + 1, yAdjust - 1);
    }
    throw new Error('Invalid tile direction');
  }

  getTile(isoTile: IsoTile): MapTile | null {
    return this.get(isoTile.Dx, Math.trunc(isoTile.Dy / 2));
  }

  *[Symbol.iterator](): IterableIterator<MapTile> {
    for (let y = 0; y < this.tiles[0].length; y++)
      for (let x = 0; x < this.tiles.length; x++) {
        const t = this.tiles[x][y];
        if (t != null) yield t;
      }
  }
}