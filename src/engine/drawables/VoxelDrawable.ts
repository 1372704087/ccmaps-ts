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
    const vxl_ds = VoxelDrawable.VoxelRenderer.Render(this.Vxl, this.Hva, gobj, this.Props);
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
    const heightBuffer = ds.getHeightBuffer();
    const shadowBufVxl = vxl_ds.getShadows();
    const shadowBuf = ds.getShadows();

    // the drawn sprite's vertical extent, standing in for the SHP path's shp.Height
    let firstDrawnRow = Number.MAX_VALUE;
    let lastDrawnRow = Number.MIN_VALUE;
    for (let y = 0; y < vxl_ds.Height; y++) {
      const srcBase = vxl_ds.Stride * y;
      for (let x = 0; x < vxl_ds.Width; x++) {
        if (vxl_ds.data[srcBase + x * 4 + 3] > 0) {
          if (y < firstDrawnRow) firstDrawnRow = y;
          lastDrawnRow = y;
        }
      }
    }
    const vxlHeight = lastDrawnRow >= firstDrawnRow ? lastDrawnRow - firstDrawnRow + 1 : 0;

    // like the SHP path (ShpRenderer.Draw/DrawShadow): bodies stand vxlHeight
    // above their tile, shadows lie on the ground plane and may not darken
    // anything standing taller than that plane -- most notably this unit's own
    // hull, drawn by an earlier blit of the same UnitDrawable.
    // flying units (props.FlightHeight) draw their body raised while the shadow
    // stays on the ground plane beneath them.
    const flight = props.FlightHeight;
    const hBufVal = Math.trunc(obj.Tile.Z * this._config.TileHeight / 2 + vxlHeight + flight);
    const castHeight = Math.trunc(obj.Tile.Z * this._config.TileHeight / 2);

    // clip to 25-50-75-100
    transLucency = Math.trunc(transLucency / 25) * 25;
    const a = transLucency / 100;
    const b = 1 - a;

    for (let y = 0; y < vxl_ds.Height; y++) {
      // rows inverted! (vxl surface is stored bottom-up)
      const srcRowBase = vxl_ds.Stride * (vxl_ds.Height - y - 1);
      const bodyRowBase = (d.Y + y - flight) * ds.Stride + d.X * 3;
      const shadRowBase = (d.Y + y) * ds.Stride + d.X * 3;
      let zIdx = (d.Y + y - flight) * ds.Width + d.X;
      const bodyRowValid = bodyRowBase >= 0 && bodyRowBase < wHigh;
      const shadRowValid = shadRowBase >= 0 && shadRowBase < wHigh;
      if (!bodyRowValid && !shadRowValid) continue;

      for (let x = 0; x < vxl_ds.Width; x++) {
        const srcBase = srcRowBase + x * 4;
        const bodyPx = vxl_ds.data[srcBase + 3] > 0;
        // only non-transparent pixels
        if (bodyPx && bodyRowValid) {
          const wIdx = bodyRowBase + x * 3;
          const srcB = vxl_ds.data[srcBase];
          const srcG = vxl_ds.data[srcBase + 1];
          const srcR = vxl_ds.data[srcBase + 2];
          if (transLucency !== 0) {
            ds.data[wIdx] = Math.trunc(a * ds.data[wIdx] + b * srcB);
            ds.data[wIdx + 1] = Math.trunc(a * ds.data[wIdx + 1] + b * srcG);
            ds.data[wIdx + 2] = Math.trunc(a * ds.data[wIdx + 2] + b * srcR);
          } else {
            ds.data[wIdx] = srcB;
            ds.data[wIdx + 1] = srcG;
            ds.data[wIdx + 2] = srcR;
          }

          const zBufVal = Math.trunc((obj.Tile.Rx + obj.Tile.Ry + obj.Tile.Z) * this._config.TileHeight / 2);
          if (zBufVal >= zBuffer[zIdx]) zBuffer[zIdx] = zBufVal;
          heightBuffer[zIdx] = hBufVal;
        }
        // shadows fall where the surface has no body pixel; a raised body no
        // longer occludes its own ground shadow
        if ((!bodyPx || flight !== 0) && shadRowValid && shadowBufVxl[x + y * vxl_ds.Width]) {
          const shadIdx = (d.Y + y) * ds.Width + d.X + x;
          if (!shadowBuf[shadIdx] && castHeight >= heightBuffer[shadIdx]) {
            const swIdx = shadRowBase + x * 3;
            ds.data[swIdx] = Math.trunc(ds.data[swIdx] / 2);
            ds.data[swIdx + 1] = Math.trunc(ds.data[swIdx + 1] / 2);
            ds.data[swIdx + 2] = Math.trunc(ds.data[swIdx + 2] / 2);
            shadowBuf[shadIdx] = 1;
          }
        }
        zIdx++;
      }
    }
  }
}