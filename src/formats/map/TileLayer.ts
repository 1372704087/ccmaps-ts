// Port of CNCMaps.FileFormats.Map.TileLayer (IsoTile storage layer)
import { Size } from '../../shared/Geometry.js';
import { IsoTile } from './MapObjects.js';
import { Format5 } from '../encodings/Format5.js';
import { IniSection } from '../IniFile.js';

export class TileLayer {
  private isoTiles: (IsoTile | null)[][];
  private fullSize: Size;

  constructor(w: number, h: number);
  constructor(fullSize: Size);
  constructor(wOrSize: number | Size, h?: number) {
    if (typeof wOrSize === 'number') this.fullSize = new Size(wOrSize, h!);
    else this.fullSize = wOrSize;
    this.isoTiles = new Array(this.fullSize.Width * 2 - 1);
    for (let i = 0; i < this.isoTiles.length; i++)
      this.isoTiles[i] = new Array<IsoTile | null>(this.fullSize.Height).fill(null);
  }

  get Width(): number {
    return this.fullSize.Width;
  }

  get Height(): number {
    return this.fullSize.Height;
  }

  get(x: number, y: number): IsoTile | null {
    if (0 <= x && x < this.isoTiles.length && 0 <= y && y < this.isoTiles[0].length)
      return this.isoTiles[x][y];
    return null;
  }

  set(x: number, y: number, value: IsoTile | null): void {
    this.isoTiles[x][y] = value;
  }

  /// <summary>Gets a tile at display coordinates.</summary>
  getTile(dx: number, dy: number): IsoTile | null {
    if (0 <= dx && dx < this.isoTiles.length && 0 <= dy && dy < this.isoTiles[0].length)
      return this.isoTiles[dx][dy];
    return null;
  }

  /// <summary>Gets a tile at map coordinates.</summary>
  getTileR(rx: number, ry: number): IsoTile | null {
    const dx = rx - ry + this.fullSize.Width - 1;
    const dy = rx + ry - this.fullSize.Width - 1;

    if (dx < 0 || dy < 0 || dx >= this.isoTiles.length || Math.trunc(dy / 2) >= this.isoTiles[0].length)
      return null;
    return this.getTile(dx, Math.trunc(dy / 2));
  }

  *[Symbol.iterator](): IterableIterator<IsoTile> {
    for (let y = 0; y < this.isoTiles[0].length; y++)
      for (let x = 0; x < this.isoTiles.length; x++) {
        const t = this.isoTiles[x][y];
        if (t != null) yield t;
      }
  }

  serializeIsoMapPack5(isoMapPack5: IniSection, compress = false): void {
    const tileSet: IsoTile[] = [];
    for (let y = 0; y < this.isoTiles[0].length; y++)
      for (let x = 0; x < this.isoTiles.length; x++) {
        const iso = this.isoTiles[x][y];
        if (iso != null) tileSet.push(iso);
      }

    let encoded: Uint8Array;

    // Compressing involves removing level 0 clear tiles and then sort the tiles before encoding
    if (compress) {
      const tileSetStage: IsoTile[] = [];

      for (const t of tileSet) {
        if (t.TileNum > 0 || t.Z > 0 || t.SubTile > 0 || t.IceGrowth > 0) tileSetStage.push(t);
      }
      if (tileSetStage.length === 0) {
        tileSetStage.push(tileSet[0]);
        encoded = TileLayer.getEncoded(tileSetStage);
      } else {
        const sortedTiles: Uint8Array[] = [];
        const sorters: Array<(a: IsoTile, b: IsoTile) => number> = [
          (a, b) => a.Rx - b.Rx || a.SubTile - b.SubTile || a.TileNum - b.TileNum || a.Z - b.Z,
          (a, b) => a.Rx - b.Rx || a.TileNum - b.TileNum || a.SubTile - b.SubTile || a.Z - b.Z,
          (a, b) => a.SubTile - b.SubTile || a.TileNum - b.TileNum || a.Rx - b.Rx || a.Z - b.Z,
          (a, b) => a.SubTile - b.SubTile || a.TileNum - b.TileNum || a.Z - b.Z || a.Rx - b.Rx,
          (a, b) => a.SubTile - b.SubTile || a.TileNum - b.TileNum || a.Z - b.Z || a.Ry - b.Ry,
          (a, b) => a.SubTile - b.SubTile || a.Z - b.Z || a.TileNum - b.TileNum || a.Rx - b.Rx,
          (a, b) => a.SubTile - b.SubTile || a.Z - b.Z || a.TileNum - b.TileNum || a.Ry - b.Ry,
          (a, b) => a.TileNum - b.TileNum || a.Rx - b.Rx || a.SubTile - b.SubTile || a.Z - b.Z,
          (a, b) => a.TileNum - b.TileNum || a.SubTile - b.SubTile || a.Ry - b.Ry || a.Z - b.Z,
          (a, b) => a.TileNum - b.TileNum || a.SubTile - b.SubTile || a.Z - b.Z || a.Rx - b.Rx,
          (a, b) => a.TileNum - b.TileNum || a.SubTile - b.SubTile || a.Z - b.Z || a.Ry - b.Ry,
          (a, b) => a.TileNum - b.TileNum || a.Z - b.Z || a.SubTile - b.SubTile || a.Rx - b.Rx,
          (a, b) => a.TileNum - b.TileNum || a.Z - b.Z || a.SubTile - b.SubTile || a.Ry - b.Ry,
          (a, b) => a.Z - b.Z || a.SubTile - b.SubTile || a.TileNum - b.TileNum || a.Rx - b.Rx,
          (a, b) => a.Z - b.Z || a.SubTile - b.SubTile || a.TileNum - b.TileNum || a.Ry - b.Ry,
          (a, b) => a.Z - b.Z || a.TileNum - b.TileNum || a.Rx - b.Rx || a.SubTile - b.SubTile,
          (a, b) => a.Z - b.Z || a.TileNum - b.TileNum || a.Ry - b.Ry || a.SubTile - b.SubTile,
          (a, b) => a.Z - b.Z || a.TileNum - b.TileNum || a.SubTile - b.SubTile || a.Rx - b.Rx,
          (a, b) => a.Z - b.Z || a.TileNum - b.TileNum || a.SubTile - b.SubTile || a.Ry - b.Ry,
        ];
        for (const sorter of sorters) {
          const copy = tileSetStage.slice().sort(sorter);
          sortedTiles.push(TileLayer.getEncoded(copy));
        }
        let smallest = sortedTiles[0].length;
        let smallestIndex = 0;
        for (let index = 0; index < sortedTiles.length; index++) {
          if (sortedTiles[index].length < smallest) {
            smallest = sortedTiles[index].length;
            smallestIndex = index;
          }
        }
        encoded = sortedTiles[smallestIndex];
      }
    } else {
      encoded = TileLayer.getEncoded(tileSet);
    }

    // base64 without line breaks
    let base64 = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < encoded.length; i += CHUNK) {
      base64 += Buffer.from(encoded.subarray(i, i + CHUNK)).toString('base64');
    }

    isoMapPack5.clear();
    let i = 1;
    let idx = 0;
    while (idx < base64.length) {
      const adv = Math.min(74, base64.length - idx);
      const key = i.toString();
      i++;
      isoMapPack5.setValue(key, base64.substring(idx, idx + adv));
      idx += adv;
    }
  }

  private static getEncoded(tileSetParam: IsoTile[]): Uint8Array {
    // A tile is of 11 bytes. Last 4 bytes of padding is used for termination
    const isoMapPack = new Uint8Array(tileSetParam.length * 11 + 4);

    let di = 0;
    for (const tile of tileSetParam) {
      const bs = tile.toMapPack5Entry();
      isoMapPack.set(bs, di);
      di += 11;
    }

    return Format5.Encode(isoMapPack, 5);
  }
}
