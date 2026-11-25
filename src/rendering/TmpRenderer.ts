// Port of CNCMaps.Engine.Rendering.TmpRenderer
import { Point, Rectangle } from '../shared/Geometry.js';
import { logger, LogLevel } from '../shared/Log.js';
import { TmpFile } from '../formats/TmpFile.js';
import { DrawingSurface } from './DrawingSurface.js';
import { ModConfigLike, MapTileLike, TouchType } from '../engine/Types.js';

export class TmpRenderer {
  private readonly config: ModConfigLike;
  // Scratch points: the renderer is used serially, and at 1M tiles two Point
  // allocations per draw are pure GC pressure.
  private readonly offset = new Point(0, 0);
  private readonly center = new Point(0, 0);

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
    const p = tile.Palette;
    let bgr = p.getBgrBytes();
    const tileData = img.TileData;
    const zData = img.ZData;
    const zBase = Math.trunc((tile.Rx + tile.Ry) * tmp.BlockHeight / 2);
    const hBufVal = Math.trunc(tile.Z * this.config.TileHeight / 2);

    // calculate tile index -> pixel index
    const offset = this.offset;
    offset.X = Math.trunc(tile.Dx * tmp.BlockWidth / 2);
    offset.Y = Math.trunc((tile.Dy - tile.Z) * tmp.BlockHeight / 2);

    // make touched tiles (used for determining image cutoff)
    const center = this.center;
    center.X = offset.X + Math.trunc(tmp.BlockWidth / 2);
    center.Y = offset.Y + Math.trunc(tmp.BlockHeight / 2);
    const centerGridTile = tile.Layer.GetTileScreen(center, true, true);
    if (centerGridTile != null) {
      tile.Layer.GridTouched[centerGridTile.Dx][Math.trunc(centerGridTile.Dy / 2)] |= TouchType.ByNormalData;
      tile.Layer.GridTouchedBy[centerGridTile.Dx][Math.trunc(centerGridTile.Dy / 2)] = tile;
    }

    if (logger.isEnabled(LogLevel.Trace)) {
      logger.trace(`Drawing TMP file ${tmp.fileName} (subtile ${tile.SubTile}) at (${offset.X},${offset.Y})`);
    }

    const stride = ds.Stride;
    const data = ds.data;
    const categories = ds.getCategories();
    const layer = ds.getCategoryLayer(ds.CurrentCategory);
    const category = ds.CurrentCategory;

    const halfCx = Math.trunc(tmp.BlockWidth / 2);
    const halfCy = Math.trunc(tmp.BlockHeight / 2);

    // writing bounds
    const wHigh = stride * ds.Height;
    // banded surfaces hold a strip of the map: the tile keeps its map coordinates, the cursor
    // moves into surface space
    const oy = offset.Y - ds.OriginY;
    const ox = offset.X - ds.OriginX;
    const elementPart = ds.beginPart(
      ox,
      oy,
      Math.max(tmp.BlockWidth, img.hasExtraData ? tmp.BlockWidth + img.ExtraWidth : tmp.BlockWidth),
      tmp.BlockHeight + (img.hasExtraData ? img.ExtraHeight : 0),
    );
    let w = stride * oy + (ox + halfCx - 2) * 3;

    let rIdx = 0, x = 0, y = 0;
    let zIdx = oy * ds.Width + ox + halfCx - 2;
    let cx = 0; // Amount of pixel to copy

    // like the game (Blit_Iso_Tile): a tile without a z-data section draws without
    // touching the z-buffer, so its pixels stay "far" and never occlude anything
    const useZ = zData != null;
    // Pixels are written as one linear index run per tile row, so the per-pixel
    // bounds test can collapse to one check per row when the whole row is inside.
    const pixelHigh = ds.Width * ds.Height;
    const plain = categories == null && layer == null && elementPart == null;

    // A measuring pass only needs the touched-tile state recorded above; skipping the pixel
    // loops makes the pre-render band survey much cheaper.
    if (!ds.MeasureOnly) {
    for (; y < halfCy; y++) {
      cx += 4;
      const rowStart = zIdx;
      if (plain && rowStart >= 0 && rowStart + cx <= pixelHigh) {
        if (useZ) {
          for (let c = 0; c < cx; c++) {
            const paletteValue = tileData[rIdx];
            if (paletteValue !== 0) {
              const zv = zBase - zData![rIdx];
              const zi = rowStart + c;
              if (zv >= zBuffer[zi]) {
                const ci = paletteValue * 3;
                data[w] = bgr[ci];
                data[w + 1] = bgr[ci + 1];
                data[w + 2] = bgr[ci + 2];
                zBuffer[zi] = zv;
              }
            }
            w += 3;
            rIdx++;
          }
        } else {
          for (let c = 0; c < cx; c++) {
            const paletteValue = tileData[rIdx];
            if (paletteValue !== 0) {
              const ci = paletteValue * 3;
              data[w] = bgr[ci];
              data[w + 1] = bgr[ci + 1];
              data[w + 2] = bgr[ci + 2];
            }
            w += 3;
            rIdx++;
          }
        }
        zIdx = rowStart + cx;
      } else {
        for (let c = 0; c < cx; c++) {
          const paletteValue = tileData[rIdx];
          const zBufVal = zBase - (useZ ? zData![rIdx] : 0);
          if (paletteValue !== 0 && zIdx >= 0 && zIdx < pixelHigh && (!useZ || zBufVal >= zBuffer[zIdx])) {
            const ci = paletteValue * 3;
            data[w] = bgr[ci];
            data[w + 1] = bgr[ci + 1];
            data[w + 2] = bgr[ci + 2];
            if (useZ) zBuffer[zIdx] = zBufVal;
            if (categories != null) categories[zIdx] = category;
            if (layer != null) {
              const li = zIdx * 4;
              layer[li] = bgr[ci + 2];
              layer[li + 1] = bgr[ci + 1];
              layer[li + 2] = bgr[ci];
              layer[li + 3] = 255;
            }
            if (elementPart != null) {
              const px = (zIdx % ds.Width) - ox;
              const py = ((zIdx / ds.Width) | 0) - oy;
              if (px >= 0 && px < elementPart.width && py >= 0 && py < elementPart.height) {
                const pi = (py * elementPart.width + px) * 4;
                elementPart.data[pi] = bgr[ci + 2];
                elementPart.data[pi + 1] = bgr[ci + 1];
                elementPart.data[pi + 2] = bgr[ci];
                elementPart.data[pi + 3] = 255;
              }
            }
          }
          w += 3;
          zIdx++;
          rIdx++;
        }
      }
      w += stride - 3 * (cx + 2);
      zIdx += ds.Width - (cx + 2);
    }

    w += 12;
    zIdx += 4;
    for (; y < tmp.BlockHeight; y++) {
      cx -= 4;
      const rowStart = zIdx;
      if (plain && rowStart >= 0 && rowStart + cx <= pixelHigh) {
        if (useZ) {
          for (let c = 0; c < cx; c++) {
            const paletteValue = tileData[rIdx];
            if (paletteValue !== 0) {
              const zv = zBase - zData![rIdx];
              const zi = rowStart + c;
              if (zv >= zBuffer[zi]) {
                const ci = paletteValue * 3;
                data[w] = bgr[ci];
                data[w + 1] = bgr[ci + 1];
                data[w + 2] = bgr[ci + 2];
                zBuffer[zi] = zv;
              }
            }
            w += 3;
            rIdx++;
          }
        } else {
          for (let c = 0; c < cx; c++) {
            const paletteValue = tileData[rIdx];
            if (paletteValue !== 0) {
              const ci = paletteValue * 3;
              data[w] = bgr[ci];
              data[w + 1] = bgr[ci + 1];
              data[w + 2] = bgr[ci + 2];
            }
            w += 3;
            rIdx++;
          }
        }
        zIdx = rowStart + cx;
      } else {
        for (let c = 0; c < cx; c++) {
          const paletteValue = tileData[rIdx];
          const zBufVal = zBase - (useZ ? zData![rIdx] : 0);
          if (paletteValue !== 0 && zIdx >= 0 && zIdx < pixelHigh && (!useZ || zBufVal >= zBuffer[zIdx])) {
            const ci = paletteValue * 3;
            data[w] = bgr[ci];
            data[w + 1] = bgr[ci + 1];
            data[w + 2] = bgr[ci + 2];
            if (useZ) zBuffer[zIdx] = zBufVal;
            if (categories != null) categories[zIdx] = category;
            if (layer != null) {
              const li = zIdx * 4;
              layer[li] = bgr[ci + 2];
              layer[li + 1] = bgr[ci + 1];
              layer[li + 2] = bgr[ci];
              layer[li + 3] = 255;
            }
            if (elementPart != null) {
              const px = (zIdx % ds.Width) - ox;
              const py = ((zIdx / ds.Width) | 0) - oy;
              if (px >= 0 && px < elementPart.width && py >= 0 && py < elementPart.height) {
                const pi = (py * elementPart.width + px) * 4;
                elementPart.data[pi] = bgr[ci + 2];
                elementPart.data[pi + 1] = bgr[ci + 1];
                elementPart.data[pi + 2] = bgr[ci];
                elementPart.data[pi + 3] = 255;
              }
            }
          }
          w += 3;
          zIdx++;
          rIdx++;
        }
      }
      w += stride - 3 * (cx - 2);
      zIdx += ds.Width - (cx - 2);
    }
    }

    if (!img.hasExtraData) return; // we're done now
    const xzData = img.ExtraZData;
    // the game lights a tunnel roof as the plateau it belongs to, not the tunnel floor
    if (tile.ExtraPalette != null) bgr = tile.ExtraPalette.getBgrBytes();

    offset.X += img.ExtraX - img.X;
    offset.Y += img.ExtraY - img.Y;
    w = stride * (offset.Y - ds.OriginY) + 3 * (offset.X - ds.OriginX);
    zIdx = offset.X - ds.OriginX + (offset.Y - ds.OriginY) * ds.Width;
    rIdx = 0;

    // identify extra-data affected tiles for cutoff
    const extraScreenBounds = Rectangle.FromLTRB(
      Math.max(ds.OriginX, offset.X), Math.max(ds.OriginY, offset.Y),
      Math.min(offset.X + img.ExtraWidth, ds.OriginX + ds.Width),
      Math.min(offset.Y + img.ExtraHeight, ds.OriginY + ds.Height),
    );

    for (let by = extraScreenBounds.Top; by < extraScreenBounds.Bottom; by += Math.trunc(tmp.BlockHeight / 2)) {
      for (let bx = extraScreenBounds.Left; bx < extraScreenBounds.Right; bx += Math.trunc(tmp.BlockWidth / 2)) {
        const gridTileNoZ = tile.Layer.GetTileScreen(new Point(bx, by), true, true);
        if (gridTileNoZ != null) {
          if (logger.isEnabled(LogLevel.Trace)) {
            logger.trace(`Tile at (${tile.Dx},${tile.Dy}) has extradata affecting (${gridTileNoZ.Dx},${gridTileNoZ.Dy})`);
          }
          tile.Layer.GridTouched[gridTileNoZ.Dx][Math.trunc(gridTileNoZ.Dy / 2)] |= TouchType.ByExtraData;
          tile.Layer.GridTouchedBy[gridTileNoZ.Dx][Math.trunc(gridTileNoZ.Dy / 2)] = tile;
        }
      }
    }

    // Extra graphics are just a square
    // a measuring pass only needs the touched-tile state, which both parts above and below record
    if (ds.MeasureOnly) return;
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
          if (categories != null) categories[zIdx] = category;
          if (layer != null) {
            const li = zIdx * 4;
            layer[li] = bgr[ci + 2];
            layer[li + 1] = bgr[ci + 1];
            layer[li + 2] = bgr[ci];
            layer[li + 3] = 255;
          }
          if (elementPart != null) {
            const px = (zIdx % ds.Width) - ox;
            const py = ((zIdx / ds.Width) | 0) - oy;
            if (px >= 0 && px < elementPart.width && py >= 0 && py < elementPart.height) {
              const pi = (py * elementPart.width + px) * 4;
              elementPart.data[pi] = bgr[ci + 2];
              elementPart.data[pi + 1] = bgr[ci + 1];
              elementPart.data[pi + 2] = bgr[ci];
              elementPart.data[pi + 3] = 255;
            }
          }
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