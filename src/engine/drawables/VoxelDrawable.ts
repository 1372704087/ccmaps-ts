// Port of CNCMaps.Engine.Drawables.VoxelDrawable
//
// A software-rendered voxel drawable. The heavy lifting (model transform,
// rasterization, shadow projection, vpl lighting) lives in VxlRenderer; this
// drawable is responsible for the per-object responsibilities: holding the
// Vxl/Hva files, selecting the correct transformation/voxel props, running the
// renderer and blitting its offscreen surface into the map surface (handling
// flight height, z-buffer/height-buffer bookkeeping and shadow falloff).
import { Drawable } from './Drawable.js';
import { VxlRenderer } from '../../rendering/VxlRenderer.js';
import { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { Rectangle } from '../../shared/Geometry.js';
import { ModConfig } from '../../shared/ModConfig.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { IniSection } from '../../formats/IniFile.js';
import { VxlFile } from '../../formats/VxlFile.js';
import { HvaFile } from '../../formats/HvaFile.js';
import { DrawProperties } from '../game/DrawProperties.js';
import type { GameObjectLike } from '../Types.js';
import type { GameObject } from '../map/GameObjects.js';

export class VoxelDrawable extends Drawable {
  /// <summary>Shared, engine-wide voxel renderer (configured once via the theater).</summary>
  static readonly VoxelRenderer = new VxlRenderer();

  Vxl: VxlFile | null = null;
  Hva: HvaFile | null = null;

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection | null, art: IniSection | null);
  constructor(config: ModConfig, vxl: VxlFile, hva: HvaFile);
  constructor(
    config: ModConfig,
    vfsOrVxl: VirtualFileSystem | VxlFile,
    rulesOrHva: IniSection | null | HvaFile,
    art?: IniSection | null,
  ) {
    if (vfsOrVxl instanceof VxlFile && rulesOrHva instanceof HvaFile) {
      super(config, null as unknown as VirtualFileSystem, null, null);
      this.Vxl = vfsOrVxl;
      this.Hva = rulesOrHva;
    } else {
      super(config, vfsOrVxl as VirtualFileSystem, rulesOrHva as IniSection | null, art ?? null);
    }
  }

  Draw(obj: GameObject, ds: DrawingSurface, _shadow = true): void {
    if (this.Vxl == null || this.Hva == null) return;
    const gobj = obj as unknown as GameObjectLike;
    const shadowSection = this.Art != null ? this.Art.readInt('ShadowIndex', 0) : 0;
    const vxl_ds = VoxelDrawable.VoxelRenderer.Render(this.Vxl, this.Hva, gobj, this.Props, shadowSection);
    if (vxl_ds != null)
      this.BlitVoxelToSurface(ds, vxl_ds, gobj, this.Props, this.Props.Cloakable ? 50 : 0);
  }

  GetBounds(obj: GameObject): Rectangle {
    if (this.Vxl == null || this.Hva == null) return Rectangle.Empty;
    const gobj = obj as unknown as GameObjectLike;
    let bounds = VxlRenderer.GetBounds(gobj, this.Vxl, this.Hva, this.Props);
    bounds.Offset(
      Math.trunc(gobj.Tile.Dx * this._config.TileWidth / 2),
      Math.trunc((gobj.Tile.Dy - gobj.Tile.Z) * this._config.TileHeight / 2),
    );
    bounds.Offset(this.Props.GetOffset(gobj));
    if (this.Props.FlightHeight > 0) {
      // raised body plus grounded shadow
      bounds = Rectangle.Union(bounds, new Rectangle(bounds.X, bounds.Y - this.Props.FlightHeight, bounds.Width, bounds.Height));
    }
    return bounds;
  }

  private BlitVoxelToSurface(
    ds: DrawingSurface,
    vxl_ds: DrawingSurface,
    obj: GameObjectLike,
    props: DrawProperties,
    transLucency = 0,
  ): void {
    const dX = Math.trunc(obj.Tile.Dx * this._config.TileWidth / 2);
    const dY = Math.trunc((obj.Tile.Dy - obj.Tile.Z) * this._config.TileHeight / 2);
    const d = props.GetOffset(obj);
    d.X += dX;
    d.Y += dY;
    d.X -= Math.trunc(vxl_ds.Width / 2);
    d.Y -= Math.trunc(vxl_ds.Height / 2);

    const wHigh = ds.Stride * ds.Height;
    const zBuffer = ds.getZBuffer();
    const shadowBufVxl = vxl_ds.getShadows();
    const voxelMask = ds.getVoxelMask();
    const categories = ds.getCategories();
    const layer = ds.getCategoryLayer(ds.CurrentCategory);
    const category = ds.CurrentCategory;

    let firstDrawnRow = Number.MAX_VALUE;
    for (let y = 0; y < vxl_ds.Height; y++) {
      const srcBase = vxl_ds.Stride * y;
      for (let x = 0; x < vxl_ds.Width; x++) {
        if (vxl_ds.data[srcBase + x * 4 + 3] > 0) {
          firstDrawnRow = y;
          break;
        }
      }
      if (firstDrawnRow !== Number.MAX_VALUE) break;
    }
    if (firstDrawnRow === Number.MAX_VALUE) return;

    // gamemd blits the cached voxel through the same Shape_Draw_Z path as SHP objects, with the
    // Deg90 standing gradient anchored at the bottom row of the region the model's volume projects
    // to, and BlitterFlags Alpha|Flat: the pixels are z-tested against the buffer but never written
    // back. Anchoring at the last drawn pixel instead puts a turret whose box reaches under its
    // geometry behind its own post. Flying bodies draw raised while their z stays anchored at the
    // ground-projected row.
    const flight = props.FlightHeight;
    const t = obj.Tile;
    const cellBottomY = Math.trunc((t.Dy - t.Z) * this._config.TileHeight / 2) + this._config.TileHeight - 1;
    const anchorY = d.Y + VoxelDrawable.VoxelRenderer.VolumeBottomRow;
    // ZAdjust uses the game's sign, as in ShpRenderer: positive pushes away from the screen.
    const zBase0 = Math.trunc((t.Rx + t.Ry) * this._config.TileHeight / 2) + (anchorY - cellBottomY) + 1 - props.ZAdjust;
    const zShadowBase = Math.trunc((t.Rx + t.Ry) * this._config.TileHeight / 2) + 2;
    // units on a bridge draw raised; their z stays anchored on the deck plane
    const onBridge = (obj as unknown as { OnBridge?: boolean }).OnBridge;
    const zBase = onBridge === true ? zBase0 + Math.trunc((4 * this._config.TileHeight) / 2) : zBase0;

    // clip to 25-50-75-100
    transLucency = Math.trunc(transLucency / 25) * 25;
    const a = transLucency / 100;
    const b = 1 - a;

    const shadowPart = ds.beginPart(d.X - ds.OriginX, d.Y - ds.OriginY, vxl_ds.Width, vxl_ds.Height);
    const elementPart = ds.beginPart(
      d.X - ds.OriginX,
      d.Y - ds.OriginY - flight,
      vxl_ds.Width,
      vxl_ds.Height,
    );

    const dsWidth = ds.Width;
    const dsHeight = ds.Height;
    const dsStride = ds.Stride;
    const dstData = ds.data;
    const srcData = vxl_ds.data;
    const srcWidth = vxl_ds.Width;
    const srcStride = vxl_ds.Stride;
    const originX = d.X - ds.OriginX;
    const originY = d.Y - ds.OriginY;

    for (let y = 0; y < vxl_ds.Height; y++) {
      const srcRowBase = srcStride * y;
      // banded surfaces hold one strip of the map: z stays in map coordinates, the write cursor
      // moves into the surface's own space
      const bodyRow = originY + y - flight;
      const bodyRowBase = bodyRow * dsStride + originX * 3;
      const shadRowBase = (originY + y) * dsStride + originX * 3;
      let zIdx = bodyRow * dsWidth + originX;
      const bodyRowValid = bodyRow >= 0 && bodyRow < dsHeight;
      const shadRowValid = originY + y >= 0 && originY + y < dsHeight;
      if (!bodyRowValid && !shadRowValid) continue;

      const zBufVal = zBase + Math.trunc((anchorY - (d.Y + y - flight)) / 3);
      const zShadowVal = zShadowBase + (d.Y + y) - cellBottomY;
      const shadowIdxOffset = flight * dsWidth;

      for (let x = 0; x < vxl_ds.Width; x++) {
        const srcBase = srcRowBase + x * 4;
        const bodyPx = srcData[srcBase + 3] > 0;
        // only non-transparent pixels in front of what the buffer holds
        if (bodyPx && bodyRowValid) {
          const wIdx = bodyRowBase + x * 3;
          const srcB = srcData[srcBase];
          const srcG = srcData[srcBase + 1];
          const srcR = srcData[srcBase + 2];
          if (zBufVal > zBuffer[zIdx]) {
            if (transLucency !== 0) {
              dstData[wIdx] = Math.trunc(a * dstData[wIdx] + b * srcB);
              dstData[wIdx + 1] = Math.trunc(a * dstData[wIdx + 1] + b * srcG);
              dstData[wIdx + 2] = Math.trunc(a * dstData[wIdx + 2] + b * srcR);
            } else {
              dstData[wIdx] = srcB;
              dstData[wIdx + 1] = srcG;
              dstData[wIdx + 2] = srcR;
            }
            if (categories != null) categories[zIdx] = category;
            if (voxelMask != null) voxelMask[zIdx] = 1;
            // Only pixels the game actually wrote go into the layer; kept z-rejected pixels
            // would stack a hidden body above the sprite the game shows.
            const sx = originX + x;
            if (layer != null && sx >= 0 && sx < dsWidth) {
              const li = zIdx * 4;
              layer[li] = srcR;
              layer[li + 1] = srcG;
              layer[li + 2] = srcB;
              layer[li + 3] = 255;
            }
            if (elementPart != null) {
              const pi = (y * srcWidth + x) * 4;
              elementPart.data[pi] = srcR;
              elementPart.data[pi + 1] = srcG;
              elementPart.data[pi + 2] = srcB;
              elementPart.data[pi + 3] = 255;
            }
          }
        }
        // shadows lie on the caster's ground plane and darken only where that
        // plane is in front of the buffer; the body pixels drawn by this same
        // blit keep covering their own shadow
        if ((!bodyPx || flight !== 0) && shadRowValid && shadowBufVxl[x + y * srcWidth]) {
          const shadIdx = zIdx + shadowIdxOffset;
          if (zShadowVal > zBuffer[shadIdx]) {
            const swIdx = shadRowBase + x * 3;
            dstData[swIdx] = Math.trunc(dstData[swIdx] / 2);
            dstData[swIdx + 1] = Math.trunc(dstData[swIdx + 1] / 2);
            dstData[swIdx + 2] = Math.trunc(dstData[swIdx + 2] / 2);
            // Keep only the shadow the game actually drew with the unit in the PSD.
            if (shadowPart != null) {
              const pi = (y * srcWidth + x) * 4;
              shadowPart.data[pi] = 0;
              shadowPart.data[pi + 1] = 0;
              shadowPart.data[pi + 2] = 0;
              shadowPart.data[pi + 3] = 128;
            }
          }
        }
        zIdx++;
      }
    }
  }
}