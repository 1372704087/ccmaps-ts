// Port of CNCMaps.Engine.Rendering.TmpRenderer
import { Point, Rectangle } from '../shared/Geometry.js';
import { logger } from '../shared/Log.js';
import { TmpFile } from '../formats/TmpFile.js';
import { DrawingSurface } from './DrawingSurface.js';
import { ModConfigLike, MapTileLike, TouchType } from '../engine/Types.js';

export class TmpRenderer {
  private readonly config: ModConfigLike;

  constructor(config: ModConfigLike) {
    this.config = config;
  }

  static GetBounds(tile: MapTileLike, tmp: TmpFile | null): Rectangle {
    if (tmp == null) return Rectangle.Empty;
    tmp.Initialize();

    if (tile.SubTile >= tmp.Images.length) return Rectangle.Empty;
    const img = tmp.Images[tile.SubTile];

    let left = Math.trunc(tile.Dx * tmp.BlockWidth / 2);
    let top = Math.trunc((tile.Dy - tile.Z) * tmp.BlockHeight / 2);
    let width = tmp.BlockWidth;
    let height = tmp.BlockHeight;
    if (img.hasExtraData) {
      if (img.ExtraX < 0) { left += img.ExtraX; width -= img.ExtraX; }
      if (img.ExtraY < 0) { top += img.ExtraY; height -= img.ExtraY; }
      width = Math.max(width, img.ExtraWidth);
      height = Math.max(height, img.ExtraHeight);
    }

    return new Rectangle(left, top, width, height);
  }

  Draw(tile: MapTileLike, tmp: TmpFile, ds: DrawingSurface): void {
    tmp.Initialize();

    if (tile.SubTile >= tmp.Images.length) return;
    const img = tmp.Images[tile.SubTile];
    const zBuffer = ds.getZBuffer();
    const heightBuffer = ds.getHeightBuffer();
    const p = tile.Palette;
    const bgr = p.getBgrBytes();
    const zData = img.ZData;
    const zBase = Math.trunc((tile.Rx + tile.Ry) * tmp.BlockHeight / 2);
    const hBufVal = Math.trunc(tile.Z * this.config.TileHeight / 2);

    // calculate tile index -> pixel index
    const offset = new Point(
      Math.trunc(tile.Dx * tmp.BlockWidth / 2),
      Math.trunc((tile.Dy - tile.Z) * tmp.BlockHeight / 2),
    );

    // make touched tiles (used for determining image cutoff)
    const center = new Point(offset.X + Math.trunc(tmp.BlockWidth / 2), offset.Y + Math.trunc(tmp.BlockHeight / 2));
    const centerGridTile = tile.Layer.GetTileScreen(center, true, true);
    if (centerGridTile != null) {
      tile.Layer.GridTouched[centerGridTile.Dx][Math.trunc(centerGridTile.Dy / 2)] |= TouchType.ByNormalData;
      tile.Layer.GridTouchedBy[centerGridTile.Dx][Math.trunc(centerGridTile.Dy / 2)] = tile;
    }

    logger.trace(
      `Drawing TMP file ${tmp.fileName} (subtile ${tile.SubTile}) at (${offset.X},${offset.Y})`,
    );

    const stride = ds.Stride;
    const data = ds.data;

    const halfCx = Math.trunc(tmp.BlockWidth / 2);
    const halfCy = Math.trunc(tmp.BlockHeight / 2);

    // writing bounds
    const wHigh = stride * ds.Height;
    let w = stride * offset.Y + (offset.X + halfCx - 2) * 3;

    let rIdx = 0, x = 0, y = 0;
    let zIdx = offset.Y * ds.Width + offset.X + halfCx - 2;
    let cx = 0; // Amount of pixel to copy

    for (; y < halfCy; y++) {
      cx += 4;
      for (let c = 0; c < cx; c++) {
        const paletteValue = img.TileData[rIdx];
        const zBufVal = zBase - (zData != null ? zData[rIdx] : 0);
        if (paletteValue !== 0 && w >= 0 && w < wHigh && zBufVal >= zBuffer[zIdx]) {
          const ci = paletteValue * 3;
          data[w] = bgr[ci];
          data[w + 1] = bgr[ci + 1];
          data[w + 2] = bgr[ci + 2];
          zBuffer[zIdx] = zBufVal;
          heightBuffer[zIdx] = hBufVal;
        }
        w += 3;
        zIdx++;
        rIdx++;
      }
      w += stride - 3 * (cx + 2);
      zIdx += ds.Width - (cx + 2);
    }

    w += 12;
    zIdx += 4;
    for (; y < tmp.BlockHeight; y++) {
      cx -= 4;
      for (let c = 0; c < cx; c++) {
        const paletteValue = img.TileData[rIdx];
        const zBufVal = zBase - (zData != null ? zData[rIdx] : 0);
        if (paletteValue !== 0 && w >= 0 && w < wHigh && zBufVal >= zBuffer[zIdx]) {
          const ci = paletteValue * 3;
          data[w] = bgr[ci];
          data[w + 1] = bgr[ci + 1];
          data[w + 2] = bgr[ci + 2];
          zBuffer[zIdx] = zBufVal;
          heightBuffer[zIdx] = hBufVal;
        }
        w += 3;
        zIdx++;
        rIdx++;
      }
      w += stride - 3 * (cx - 2);
      zIdx += ds.Width - (cx - 2);
    }

    if (!img.hasExtraData) return; // we're done now
    const xzData = img.ExtraZData;

    offset.X += img.ExtraX - img.X;
    offset.Y += img.ExtraY - img.Y;
    w = stride * offset.Y + 3 * offset.X;
    zIdx = offset.X + offset.Y * ds.Width;
    rIdx = 0;

    // identify extra-data affected tiles for cutoff
    const extraScreenBounds = Rectangle.FromLTRB(
      Math.max(0, offset.X), Math.max(0, offset.Y),
      Math.min(offset.X + img.ExtraWidth, ds.Width), Math.min(offset.Y + img.ExtraHeight, ds.Height),
    );

    for (let by = extraScreenBounds.Top; by < extraScreenBounds.Bottom; by += Math.trunc(tmp.BlockHeight / 2)) {
      for (let bx = extraScreenBounds.Left; bx < extraScreenBounds.Right; bx += Math.trunc(tmp.BlockWidth / 2)) {
        const gridTileNoZ = tile.Layer.GetTileScreen(new Point(bx, by), true, true);
        if (gridTileNoZ != null) {
          logger.trace(
            `Tile at (${tile.Dx},${tile.Dy}) has extradata affecting (${gridTileNoZ.Dx},${gridTileNoZ.Dy})`,
          );
          tile.Layer.GridTouched[gridTileNoZ.Dx][Math.trunc(gridTileNoZ.Dy / 2)] |= TouchType.ByExtraData;
          tile.Layer.GridTouchedBy[gridTileNoZ.Dx][Math.trunc(gridTileNoZ.Dy / 2)] = tile;
        }
      }
    }

    // Extra graphics are just a square
    for (y = 0; y < img.ExtraHeight; y++) {
      for (x = 0; x < img.ExtraWidth; x++) {
        // Checking per line is required because v needs to be checked every time
        const paletteValue = img.ExtraData != null ? img.ExtraData[rIdx] : 0;
        const zBufVal = zBase - (xzData != null ? xzData[rIdx] : 0);

        if (paletteValue !== 0 && w >= 0 && w < wHigh && zBufVal >= zBuffer[zIdx]) {
          const ci = paletteValue * 3;
          data[w] = bgr[ci];
          data[w + 1] = bgr[ci + 1];
          data[w + 2] = bgr[ci + 2];
          zBuffer[zIdx] = zBufVal;
          heightBuffer[zIdx] = img.ExtraHeight - y + hBufVal;
          w += 3;
        } else {
          w += 3;
        }
        zIdx++;
        rIdx++;
      }
      w += stride - img.ExtraWidth * 3;
      zIdx += ds.Width - img.ExtraWidth;
    }
  }
}