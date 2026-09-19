// Port of CNCMaps.Engine.Rendering.ShpRenderer
import { Point, Rectangle } from '../shared/Geometry.js';
import { EngineType } from '../shared/Enums.js';
import { logger } from '../shared/Log.js';
import { Rand } from '../shared/Util.js';
import { FileFormat } from '../formats/FileFormat.js';
import { ShpFile, ShpImage } from '../formats/ShpFile.js';
import { Palette } from './Palette.js';
import { DrawingSurface } from './DrawingSurface.js';
import { DrawProperties, DrawFrame } from '../engine/game/DrawProperties.js';
import {
  DrawableLike,
  GameObjectLike,
  ModConfigLike,
  StructureObjectLike,
  VirtualFileSystemLike,
} from '../engine/Types.js';

export class ShpRenderer {
  private noBuildingZAvailable = false;
  private readonly config: ModConfigLike;
  private readonly vfs: VirtualFileSystemLike;
  private BuildingZ: ShpFile | null = null;

  constructor(config: ModConfigLike, vfs: VirtualFileSystemLike) {
    this.config = config;
    this.vfs = vfs;
  }

  GetBounds(obj: GameObjectLike, shp: ShpFile, props: DrawProperties): Rectangle {
    shp.Initialize();
    const frameIndex = decideFrameIndex(props.FrameDecider != null ? props.FrameDecider(obj) : 0, shp.NumImages);
    const offset = new Point(-Math.trunc(shp.Width / 2), -Math.trunc(shp.Height / 2));
    const size = { Width: 0, Height: 0 };
    const img = shp.getImage(frameIndex);
    if (img != null) {
      offset.Offset(img.X, img.Y);
      size.Width = img.Width;
      size.Height = img.Height;
    }
    return new Rectangle(offset.X, offset.Y, size.Width, size.Height);
  }

  Draw(
    shp: ShpFile,
    obj: GameObjectLike,
    dr: DrawableLike,
    props: DrawProperties,
    ds: DrawingSurface,
    transLucency = 0,
  ): void {
    if (obj == null || obj.Tile == null) return;
    shp.Initialize();
    const p: Palette | null = props.PaletteOverride ?? obj.Palette;
    const bgr = p != null ? p.getBgrBytes() : null;
    if (bgr == null) return; // no palette to look up pixel colors with
    let frameIndex = props.FrameDecider != null ? props.FrameDecider(obj) : 0;
    if (obj.Drawable != null && obj.Drawable.IsActualWall)
      frameIndex = (obj as StructureObjectLike).WallBuildingFrame;
    frameIndex = decideFrameIndex(frameIndex, shp.NumImages);
    if (frameIndex >= shp.Images.length) return;

    const img = shp.getImage(frameIndex);
    const imgData = img.getImageData();
    if (imgData == null || img.Width * img.Height !== imgData.length) return;

    const offset = props.GetOffset(obj);
    offset.X += Math.trunc(obj.Tile.Dx * this.config.TileWidth / 2) - Math.trunc(shp.Width / 2) + img.X;
    offset.Y += Math.trunc((obj.Tile.Dy - obj.Tile.Z) * this.config.TileHeight / 2) - Math.trunc(shp.Height / 2) + img.Y;
    logger.trace(
      `Drawing SHP file ${shp.fileName} (Frame ${frameIndex}) at (${offset.X},${offset.Y})`,
    );

    const stride = ds.Stride;
    const heightBuffer = ds.getHeightBuffer();
    const zBuffer = ds.getZBuffer();

    const data = ds.data;
    const wLow = 0;
    const wHigh = stride * ds.Height;
    let w = offset.X * 3 + stride * offset.Y;

    // clip to 25-50-75-100
    transLucency = Math.trunc(transLucency / 25) * 25;
    const a = transLucency / 100;
    const blendB = 1 - a;

    let rIdx = 0; // image pixel index
    let zIdx = offset.X + offset.Y * ds.Width; // z-buffer pixel index
    const bottom = obj.BottomTile ?? obj.Tile;
    let hBufVal = Math.trunc(obj.Tile.Z * this.config.TileHeight / 2);
    let zOffset = Math.trunc((bottom.Rx + bottom.Ry) * this.config.TileHeight / 2 + props.ZAdjust);

    if (!dr.Flat) hBufVal += shp.Height;

    for (let y = 0; y < img.Height; y++) {
      if (offset.Y + y < 0) {
        w += stride;
        rIdx += img.Width;
        zIdx += ds.Width;
        continue; // out of bounds
      }

      for (let x = 0; x < img.Width; x++) {
        const paletteValue = imgData[rIdx];

        const zshapeOffset =
          (obj as StructureObjectLike).WallBuildingFrame !== undefined ? this.GetBuildingZ(x, y, shp, img, obj) : 0;

        if (paletteValue !== 0) {
          let zBufVal = zOffset;
          if (dr.Flat) zBufVal += y - img.Height;
          else if (dr.IsBuildingPart) zBufVal += zshapeOffset;
          else zBufVal += img.Height;

          if (w >= wLow && w < wHigh) {
            const ci = paletteValue * 3;
            if (transLucency !== 0) {
              data[w] = Math.trunc(a * data[w] + blendB * bgr[ci]);
              data[w + 1] = Math.trunc(a * data[w + 1] + blendB * bgr[ci + 1]);
              data[w + 2] = Math.trunc(a * data[w + 2] + blendB * bgr[ci + 2]);
            } else {
              data[w] = bgr[ci];
              data[w + 1] = bgr[ci + 1];
              data[w + 2] = bgr[ci + 2];
            }
            zBuffer[zIdx] = zBufVal;
            heightBuffer[zIdx] = hBufVal;
          }
        }

        // Up to the next pixel
        rIdx++;
        zIdx++;
        w += 3;
      }
      w += stride - 3 * img.Width;
      zIdx += ds.Width - img.Width;
    }
  }

  // An object with a body of its own may only darken what stands below its top: a tie means a
  // neighbouring copy of the same object, and those must not shade each other. Flat casters
  // carry no height, and high bridges rely on the tie to reach the ground from their deck.
  private static castsOver(dr: DrawableLike, castHeight: number, surfaceHeight: number): boolean {
    return dr.Flat ? castHeight >= surfaceHeight : castHeight > surfaceHeight;
  }

  DrawShadow(obj: GameObjectLike, shp: ShpFile, props: DrawProperties, ds: DrawingSurface): void {
    shp.Initialize();
    let frameIndex = props.FrameDecider != null ? props.FrameDecider(obj) : 0;
    if (obj.Drawable != null && obj.Drawable.IsActualWall)
      frameIndex = (obj as StructureObjectLike).WallBuildingFrame;
    frameIndex = decideFrameIndex(frameIndex, shp.NumImages);
    frameIndex += Math.trunc(shp.Images.length / 2); // latter half are shadow Images
    if (frameIndex >= shp.Images.length) return;

    const img = shp.getImage(frameIndex);
    const imgData = img.getImageData();
    if (imgData == null || img.Width * img.Height !== imgData.length) return;

    const offset = props.GetShadowOffset(obj);
    offset.X += Math.trunc(obj.Tile.Dx * this.config.TileWidth / 2) - Math.trunc(shp.Width / 2) + img.X;
    offset.Y += Math.trunc((obj.Tile.Dy - obj.Tile.Z) * this.config.TileHeight / 2) - Math.trunc(shp.Height / 2) + img.Y;
    logger.trace(
      `Drawing SHP shadow ${shp.fileName} (frame ${frameIndex}) at (${offset.X},${offset.Y})`,
    );

    const stride = ds.Stride;
    const shadows = ds.getShadows();
    const zBuffer = ds.getZBuffer();
    const heightBuffer = ds.getHeightBuffer();

    const data = ds.data;
    const wHigh = stride * ds.Height;

    let w = offset.X * 3 + stride * offset.Y;
    let zIdx = offset.X + offset.Y * ds.Width;
    let rIdx = 0;
    let zOffset = Math.trunc((obj.Tile.Rx + obj.Tile.Ry) * this.config.TileHeight / 2) - Math.trunc(shp.Height / 2) + img.Y;
    let castHeight = Math.trunc(obj.Tile.Z * this.config.TileHeight / 2);
    if (obj.Drawable != null && !obj.Drawable.Flat) {
      castHeight += shp.Height;
      castHeight += Math.trunc(obj.Drawable.TileElevation * this.config.TileHeight / 2);
    }

    for (let y = 0; y < img.Height; y++) {
      if (offset.Y + y < 0) {
        w += stride;
        rIdx += img.Width;
        zIdx += ds.Width;
        continue; // out of bounds
      }

      let zBufVal = zOffset;
      if (obj.Drawable != null && obj.Drawable.Flat) zBufVal += y;
      else zBufVal += img.Height;

      for (let x = 0; x < img.Width; x++) {
        if (
          0 <= offset.X + x && offset.X + x < ds.Width && 0 <= y + offset.Y && y + offset.Y < ds.Height &&
          imgData[rIdx] !== 0 && !shadows[zIdx] &&
          // zBufVal >= zBuffer[zIdx] &&
          obj.Drawable != null && ShpRenderer.castsOver(obj.Drawable, castHeight, heightBuffer[zIdx])
        ) {
          data[w] = Math.trunc(data[w] / 2);
          data[w + 1] = Math.trunc(data[w + 1] / 2);
          data[w + 2] = Math.trunc(data[w + 2] / 2);
          shadows[zIdx] = 1;
        }
        // Up to the next pixel
        rIdx++;
        zIdx++;
        w += 3;
      }
      w += stride - 3 * img.Width; // ... and if we're no more on the same row,
      zIdx += ds.Width - img.Width; // adjust the writing pointer accordingly
    }
  }

  DrawAlpha(obj: GameObjectLike, shp: ShpFile, props: DrawProperties, ds: DrawingSurface): void {
    shp.Initialize();

    // Ares supports multiframe AlphaImages, based on frame count and the direction the unit it facing.
    const frameIndex = props.FrameDecider != null ? props.FrameDecider(obj) : 0;

    const img = shp.getImage(frameIndex);
    const imgData = img.getImageData();
    const c_px = img.Width * img.Height;
    if (c_px <= 0 || img.Width < 0 || img.Height < 0 || frameIndex > shp.NumImages || imgData == null) return;

    const offset = props.GetOffset(obj);
    offset.X += Math.trunc(obj.Tile.Dx * this.config.TileWidth / 2);
    offset.Y += Math.trunc((obj.Tile.Dy - obj.Tile.Z) * this.config.TileHeight / 2);
    logger.trace(
      `Drawing AlphaImage SHP file ${shp.fileName} (frame ${frameIndex}) at (${offset.X},${offset.Y})`,
    );

    const stride = ds.Stride;
    const data = ds.data;
    const wHigh = stride * ds.Height;

    const dx = offset.X + Math.trunc(this.config.TileWidth / 2) - Math.trunc(shp.Width / 2) + img.X;
    const dy = offset.Y - Math.trunc(shp.Height / 2) + img.Y;
    let w = dx * 3 + stride * dy;
    // zOffset is computed in the original but unused by the loop
    let rIdx = 0;

    for (let y = 0; y < img.Height; y++) {
      for (let x = 0; x < img.Width; x++) {
        if (imgData[rIdx] !== 0 && w >= 0 && w < wHigh) {
          const mult = imgData[rIdx] / 127.0;
          data[w] = limit(mult, data[w]);
          data[w + 1] = limit(mult, data[w + 1]);
          data[w + 2] = limit(mult, data[w + 2]);
        }
        // Up to the next pixel
        rIdx++;
        w += 3;
      }
      w += stride - 3 * img.Width; // ... and if we're no more on the same row,
      // adjust the writing pointer accordingly
    }
  }

  private GetBuildingZ(x: number, y: number, shp: ShpFile, img: ShpImage, obj: GameObjectLike): number {
    if (this.noBuildingZAvailable) return 0;

    if (this.BuildingZ == null) {
      if (this.config.Engine < EngineType.YurisRevenge) this.BuildingZ = this.vfs.open('buildngz.shp', FileFormat.Shp) as ShpFile | null;
      else this.BuildingZ = this.vfs.open('buildngz.sha', FileFormat.Shp) as ShpFile | null; // Yuri's Revenge uses .sha
      if (this.BuildingZ != null) this.BuildingZ.Initialize();
      else this.noBuildingZAvailable = true;
    }
    if (this.BuildingZ == null) return 0;

    const zImg = this.BuildingZ.getImage(0);
    const zData = zImg.getImageData();
    if (zData == null) return 0;

    // center x
    x += Math.trunc(zImg.Width / 2) - Math.trunc(shp.Width / 2) + img.X;

    // correct for foundation
    if (obj.Drawable != null)
      x -= (obj.Drawable.Foundation.Width - obj.Drawable.Foundation.Height) * 30;

    // add zshapepointmove
    if (obj.Drawable != null) x += obj.Drawable.Props.ZShapePointMove.X;

    // align y on bottom
    y += zImg.Height - shp.Height;

    // add zshapepointmove
    if (obj.Drawable != null) y -= obj.Drawable.Props.ZShapePointMove.Y;

    x = Math.min(zImg.Width - 1, Math.max(0, x));
    y = Math.min(zImg.Height - 1, Math.max(0, y));

    return -64 + zData[y * zImg.Width + x];
  }
}

function limit(mult: number, p: number): number {
  return Math.trunc(Math.min(255, Math.max(0, mult * p)));
}

function decideFrameIndex(frameIndex: number, numImages: number): number {
  const f = frameIndex as DrawFrame;
  if (f === DrawFrame.Random) frameIndex = Rand.nextMax(numImages);
  return frameIndex;
}
