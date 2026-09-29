// Port of CNCMaps.Engine.Rendering.ShpRenderer
import { Point, Rectangle } from '../shared/Geometry.js';
import { EngineType } from '../shared/Enums.js';
import { logger } from '../shared/Log.js';
import { Rand } from '../shared/Util.js';
import { FileFormat } from '../formats/FileFormat.js';
import { ShpFile, ShpImage } from '../formats/ShpFile.js';
import { Palette } from './Palette.js';
import { DrawingSurface } from './DrawingSurface.js';
import { RampHeight } from './RampHeight.js';
import { DrawProperties, DrawFrame } from '../engine/game/DrawProperties.js';
import {
  AircraftObject,
  InfantryObject,
  OverlayObject,
  SmudgeObject,
  StructureObject,
  UnitObject,
} from '../engine/map/GameObjects.js';
import { MapTile } from '../engine/map/MapTile.js';
import {
  DrawableLike,
  GameObjectLike,
  MapTileLike,
  ModConfigLike,
  StructureObjectLike,
  VirtualFileSystemLike,
} from '../engine/Types.js';

function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

// The C# code stores depth in a short[]; Int16Array wraps on assignment, but the comparison
// against the buffer must use the same wrapped value, so wrap explicitly.
function toShort(v: number): number {
  return ((v + 0x8000) & 0xffff) - 0x8000;
}

function isUnitLike(obj: GameObjectLike): boolean {
  return obj instanceof UnitObject || obj instanceof InfantryObject || obj instanceof AircraftObject;
}

function isOwnable(obj: GameObjectLike): obj is GameObjectLike & { OnBridge: boolean } {
  return typeof (obj as { OnBridge?: unknown }).OnBridge === 'boolean';
}

export class ShpRenderer {
  private readonly config: ModConfigLike;
  private readonly vfs: VirtualFileSystemLike;

  // BuildingClass::Draw_It hands Draw_Shape a z-shape reference point, moved by the art
  // ZShapePointMove and back by the foundation far corner, laid on the building draw point. Both
  // are engine literals, not derived from the shape, so a mod's BUILDNGZ of another size keeps
  // them: Tiberian Sun's (144, 172), gamemd's (198, 446).
  private _zShapeRefX = 0;
  private _zShapeRefY = 0;
  // the body stands 2 in front of the ground at its sprite bottom row (Techno_Draw_Object's
  // zadjust - 2) and each shape byte adds its value less a bias. Tiberian Sun takes 39 off every
  // byte when it loads the shape and the blitter reads them signed; captured depth buffers put
  // every building one z behind that, so 40. gamemd's 66 is a constant measured the same way.
  private _zShapeBias = 0;
  private _buildingZShape: Uint8Array | null = null;
  private _zShapeX = 0;
  private _zShapeY = 0;
  private _zShapeWidth = 0;
  private _zShapeHeight = 0;
  private _buildingZShapeTried = false;

  constructor(config: ModConfigLike, vfs: VirtualFileSystemLike) {
    this.config = config;
    this.vfs = vfs;
  }

  /**
   * BUILDNGZ, the per-pixel z pyramid the game blits under a building's own shapes: 288x197
   * BUILDNGZ.SHP in Tiberian Sun's conquer.mix, 396x477 BUILDNGZ.SHA in gamemd's conqmd.mix
   * (Red Alert 2's game.exe reads the same file as BUILDNGZ.SHP from conquer.mix).
   */
  private get BuildingZShape(): Uint8Array | null {
    if (!this._buildingZShapeTried) {
      this._buildingZShapeTried = true;
      if (this.config.Engine >= EngineType.RedAlert2) {
        this._zShapeRefX = 198;
        this._zShapeRefY = 446;
        this._zShapeBias = -66;
      } else {
        this._zShapeRefX = 144;
        this._zShapeRefY = 172;
        this._zShapeBias = -40;
      }
      try {
        let sha = this.vfs.open('buildngz.sha', FileFormat.Shp) as ShpFile | null;
        if (sha == null) sha = this.vfs.open('buildngz.shp', FileFormat.Shp) as ShpFile | null;
        if (sha != null) {
          sha.Initialize();
          const frame = sha.NumImages > 0 ? sha.getImage(0) : null;
          const data = frame != null ? frame.getImageData() : null;
          if (frame != null && data != null && data.length === frame.Width * frame.Height && data.length > 0) {
            this._buildingZShape = data;
            this._zShapeX = frame.X;
            this._zShapeY = frame.Y;
            this._zShapeWidth = frame.Width;
            this._zShapeHeight = frame.Height;
          }
        }
      } catch (e) {
        // a missing or unreadable BUILDNGZ must not abort the render
        logger.debug(`BUILDNGZ unavailable: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (this._buildingZShape == null)
        logger.debug('No usable BUILDNGZ z-shape; buildings fall back to the flat standing z profile');
    }
    return this._buildingZShape;
  }

  private sampleZShape(zShape: Uint8Array, x: number, y: number, originX: number, originY: number): number {
    const col = x - originX - this._zShapeX;
    const row = y - originY - this._zShapeY;
    if (col < 0 || col >= this._zShapeWidth || row < 0 || row >= this._zShapeHeight) return 0;
    return zShape[row * this._zShapeWidth + col];
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
    if (obj.Drawable != null && (obj.Drawable.IsActualWall || obj.Drawable.IsWall))
      frameIndex = (obj as StructureObjectLike).WallBuildingFrame;
    frameIndex = decideFrameIndex(frameIndex, shp.NumImages);
    if (frameIndex < 0 || frameIndex >= shp.Images.length) return;

    const img = shp.getImage(frameIndex);
    const imgData = img.getImageData();
    if (imgData == null || img.Width * img.Height !== imgData.length) return;

    const tileWidth = this.config.TileWidth;
    const tileHeight = this.config.TileHeight;

    const offset = props.GetOffset(obj);
    offset.X += idiv(obj.Tile.Dx * tileWidth, 2) - idiv(shp.Width, 2) + img.X;
    offset.Y += idiv((obj.Tile.Dy - obj.Tile.Z) * tileHeight, 2) - idiv(shp.Height, 2) + img.Y;
    // something standing on a slope stands on its surface, not on the cell's stored corner;
    // an overlay is drawn from its cell's level alone (CellClass::Overlay_Draw_Offset)
    const rampLift = dr.Flat || obj instanceof OverlayObject ? 0 : RampHeight.pixelLiftTile(obj.Tile, this.config);
    offset.Y -= rampLift;
    // a foundation cell's copy of a smudge draws at the entry cell's spot (SmudgeTypeClass::DrawIt)
    if (obj instanceof SmudgeObject) {
      offset.X -= idiv((obj.FoundationCell.X - obj.FoundationCell.Y) * this.config.TileWidth, 2);
      offset.Y -= idiv((obj.FoundationCell.X + obj.FoundationCell.Y) * this.config.TileHeight, 2);
    }
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
    let hBufVal = idiv(obj.Tile.Z * tileHeight, 2);

    // Game z model (gamemd Shape_Draw_Z, CellClass::DrawOverlay): tiles write the ground ramp
    // that reaches zBase at the cell diamond's bottom row. A standing shape anchors at its drawn
    // bottom row, sits a per-class lift in front of the ground there, and recedes 1 z per 3 rows
    // toward its top; a flat shape follows the ground ramp. Lifts: terrain objects 12, wall/rock
    // overlays and all flat overlays 2, other standing overlays 17, units/infantry/aircraft 1.
    // Units and their shadows are only z-tested, never written, so anything drawn later must
    // carry its own closer z or cover them. A smudge is a plain blit (neither z-tested nor
    // written); it is drawn in the tile pass, so the tiles of later cells paint over it.
    const unitLike = isUnitLike(obj);
    const plainBlit = obj instanceof SmudgeObject;
    const isBuilding = obj instanceof StructureObject;
    // AnimClass never carries SHAPE_ZWRITE: an anim paints colour without storing depth. This
    // covers a building's ActiveAnim too. A tile's animation is not an AnimClass, so animated
    // water and its kin keep storing depth. A SHP turret is the building's turret anim.
    const animLike = dr.IsAnim || dr.IsTurret;
    // the veinhole monster draws with SHAPE_ZGRAD and no ZWRITE either
    const isAnim = (animLike || dr.IsVeinHoleMonster) && !(obj instanceof MapTile);
    // the building body takes its z from BUILDNGZ below; Tiberian Sun draws a foundation six or
    // more cells wide on the plain standing profile instead (gamemd keeps the shape on its 6x4s)
    let zShape = isBuilding && !dr.Flat && !animLike ? this.BuildingZShape : null;
    if (zShape != null && this.config.Engine <= EngineType.Firestorm && (obj.Drawable?.Foundation.Width ?? 1) >= 6)
      zShape = null;

    let zLift: number;
    if (obj instanceof OverlayObject)
      // flat overlays sit at ground+1 (the Ground gradient keeps 1 of the game's +2 overlay
      // ZAdjust), standing ones take the full lift
      zLift = dr.Flat ? 1 : dr.IsWall || dr.IsRock ? 2 : 17;
    else if (isBuilding)
      // an attached anim draws at ZAdjust -2 plus its own art value, a turret with TurretAnimZAdjust
      // as that value. A bib or flat anim lies on the Ground gradient one in front of its tile like
      // ore. A body without the shape stands on the plain profile at the same -2
      zLift = dr.Flat ? 1 : animLike || zShape == null ? 2 : 0;
    else if (unitLike) zLift = 1;
    // a smudge or a flat anim lies on the Ground gradient one in front of its tile, like ore
    else zLift = dr.Flat ? 1 : 12;

    // a high bridge piece's BottomTile is two cells down-right for draw order only; its deck sits
    // TileElevation above its own cell, so a piece landing on the abutment must not also take that
    // tile's height
    const bt: MapTileLike = obj instanceof OverlayObject ? obj.Tile : ((obj.BottomTile as MapTileLike | null) ?? obj.Tile);
    const cellBottomY = idiv((bt.Dy - bt.Z) * tileHeight, 2) + tileHeight - 1;
    const spriteBottomY = offset.Y + img.Height - 1;
    // every shape anchors its gradient at its own drawn bottom row. A damage fire is the exception:
    // it borrows the body anchor and burns against the body
    let zAnchorY = spriteBottomY;
    if (isBuilding && animLike && dr.AnchorToBody) {
      const bodyAnchor = (obj as StructureObjectLike).DrawnBodyAnchorY;
      zAnchorY = Math.max(spriteBottomY, bodyAnchor ?? cellBottomY);
    }
    // the game's ZAdjust is -Z_Lepton_To_Pixel(Position.Z), an absolute height that already
    // contains the ramp surface, so the lift moves the sprite on screen without moving it in z;
    // add it back here or a shape on a slope sits a lift behind its own ground
    let zGround =
      idiv((bt.Rx + bt.Ry) * tileHeight, 2) +
      (zAnchorY + rampLift - cellBottomY) +
      idiv(dr.TileElevation * tileHeight, 2);
    // units on a bridge draw raised; their z stays anchored on the deck plane
    if (unitLike && isOwnable(obj) && obj.OnBridge) zGround += idiv(4 * tileHeight, 2);

    if (!dr.Flat) hBufVal += shp.Height;

    // Shape_Draw_Z starts the standing profile at the bottom row's depth plus ZAdjust rounded down
    // to a multiple of 3, plus 1. A z-shape body skips the rounding; units keep the flat +1 until
    // their gradient is measured.
    const lift = zLift - props.ZAdjust;
    const standingLift = unitLike ? lift : lift - 1 + (((2 - zAnchorY - lift) % 3) + 3) % 3;

    // BuildingClass::Draw_It hands the building's own shapes BUILDNGZ as the Draw_Shape z-shape:
    // a pyramid that falls 1 z per 3 rows down and per 3 px sideways from its top centre, cut off
    // below by the lower half of an iso diamond whose tip is the foundation bottom corner.
    let zShapeX = 0;
    let zShapeY = 0;
    if (zShape != null) {
      const fnd = obj.Drawable?.Foundation ?? { Width: 1, Height: 1 };
      const move = props.ZShapePointMove;
      const drawX = offset.X - img.X + idiv(shp.Width, 2);
      const drawY = offset.Y - img.Y + idiv(shp.Height, 2);
      zShapeX = drawX - this._zShapeRefX - move.X + (fnd.Width - fnd.Height) * idiv(tileWidth, 2);
      zShapeY = drawY - this._zShapeRefY - move.Y + (fnd.Width + fnd.Height - 2) * idiv(tileHeight, 2);
    }

    for (let y = 0; y < img.Height; y++) {
      if (offset.Y + y < 0) {
        w += stride;
        rIdx += img.Width;
        zIdx += ds.Width;
        continue; // out of bounds
      }

      for (let x = 0; x < img.Width; x++) {
        const paletteValue = imgData[rIdx];

        if (paletteValue !== 0) {
          // ZAdjust uses the game's sign: positive pushes away from the screen
          let zBufVal: number;
          if (dr.Flat) zBufVal = zGround + zLift + (offset.Y + y) - zAnchorY - props.ZAdjust;
          else if (zShape != null) {
            const sample = this.sampleZShape(zShape, offset.X + x, offset.Y + y, zShapeX, zShapeY);
            zBufVal = zGround + 2 /* BodyLift */ - props.ZAdjust + (sample > 0 ? sample + this._zShapeBias : 0);
          } else zBufVal = zGround + standingLift + idiv(zAnchorY - (offset.Y + y), 3);
          zBufVal = toShort(zBufVal);

          // the RLE blitters draw only a strictly nearer pixel: ties keep the earlier drawing
          if (w >= wLow && w < wHigh && (plainBlit || zBufVal > zBuffer[zIdx])) {
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
            if (!unitLike) {
              if (!isAnim && !plainBlit) zBuffer[zIdx] = zBufVal;
              heightBuffer[zIdx] = hBufVal;
            }
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

  DrawShadow(
    obj: GameObjectLike,
    shp: ShpFile,
    dr: DrawableLike,
    props: DrawProperties,
    ds: DrawingSurface,
  ): void {
    if (obj == null || obj.Tile == null) return;
    shp.Initialize();
    const tileHeight = this.config.TileHeight;
    let frameIndex = props.FrameDecider != null ? props.FrameDecider(obj) : 0;
    if (obj.Drawable != null && (obj.Drawable.IsActualWall || obj.Drawable.IsWall))
      frameIndex = (obj as StructureObjectLike).WallBuildingFrame;
    frameIndex = decideFrameIndex(frameIndex, shp.NumImages);
    if (frameIndex < 0) return;
    frameIndex += idiv(shp.Images.length, 2); // latter half are shadow Images
    if (frameIndex >= shp.Images.length) return;

    const img = shp.getImage(frameIndex);
    const imgData = img.getImageData();
    if (imgData == null || img.Width * img.Height !== imgData.length) return;

    const offset = props.GetShadowOffset(obj);
    offset.X += idiv(obj.Tile.Dx * this.config.TileWidth, 2) - idiv(shp.Width, 2) + img.X;
    offset.Y += idiv((obj.Tile.Dy - obj.Tile.Z) * tileHeight, 2) - idiv(shp.Height, 2) + img.Y;
    const rampLift =
      obj.Drawable != null && !obj.Drawable.Flat && !(obj instanceof OverlayObject)
        ? RampHeight.pixelLiftTile(obj.Tile, this.config)
        : 0;
    offset.Y -= rampLift;
    logger.trace(
      `Drawing SHP shadow ${shp.fileName} (frame ${frameIndex}) at (${offset.X},${offset.Y})`,
    );

    const stride = ds.Stride;
    const zBuffer = ds.getZBuffer();
    const data = ds.data;

    let w = offset.X * 3 + stride * offset.Y;
    let zIdx = offset.X + offset.Y * ds.Width;
    let rIdx = 0;

    // Shadows lie on the caster's ground plane, a per-class lift in front of it: gamemd draws
    // them with the Ground z-gradient and darkens only where that plane is in front of what the
    // pixel holds. A building's shadow keeps the ground gradient and carries no z-shape. gamemd
    // stacks a building shadow on a tree shadow but never two shadows of one class: the strict
    // test on the lifts alone does that, a tie is never darkened twice.
    const animLike = dr.IsAnim || dr.IsTurret;
    const building = obj instanceof StructureObject && !animLike && !dr.Flat;
    const unitLike = isUnitLike(obj);
    const isAnim = animLike && !(obj instanceof MapTile);
    const shadowLift = building || unitLike ? 3 : 2;
    const t = obj.Tile;
    const cellBottomY = idiv((t.Dy - t.Z) * tileHeight, 2) + tileHeight - 1;
    const zBase = idiv((t.Rx + t.Ry) * tileHeight, 2);

    for (let y = 0; y < img.Height; y++) {
      if (offset.Y + y < 0) {
        w += stride;
        rIdx += img.Width;
        zIdx += ds.Width;
        continue; // out of bounds
      }

      // as in Draw: the ramp lift is a screen offset, not a depth one
      const zBufVal = toShort(zBase + (offset.Y + y + rampLift) - cellBottomY + shadowLift);

      for (let x = 0; x < img.Width; x++) {
        if (
          0 <= offset.X + x && offset.X + x < ds.Width && 0 <= y + offset.Y && y + offset.Y < ds.Height &&
          imgData[rIdx] !== 0 &&
          zBufVal > zBuffer[zIdx]
        ) {
          data[w] = Math.trunc(data[w] / 2);
          data[w + 1] = Math.trunc(data[w + 1] / 2);
          data[w + 2] = Math.trunc(data[w + 2] / 2);
          if (!unitLike && !isAnim) zBuffer[zIdx] = zBufVal;
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

  /// <summary>A cliff piece's cast shadow (Tiberian Sun Draw_Shadow_Caster): the frame is centred on the
  /// given point and darkens whatever lies behind the plane the game gives it, the Ground gradient at
  /// ZAdjust -2 - 12*(Height-4), written to z like a building shadow.</summary>
  DrawTileShadow(tile: MapTile, shp: ShpFile, frameIndex: number, centre: Point, ds: DrawingSurface): void {
    shp.Initialize();
    if (frameIndex < 0 || frameIndex >= shp.Images.length) return;
    const img = shp.getImage(frameIndex);
    const imgData = img.getImageData();
    if (imgData == null || img.Width * img.Height !== imgData.length) return;
    const offset = new Point(centre.X - idiv(shp.Width, 2) + img.X, centre.Y - idiv(shp.Height, 2) + img.Y);

    const stride = ds.Stride;
    const zBuffer = ds.getZBuffer();
    const data = ds.data;
    let w = offset.X * 3 + stride * offset.Y;
    let zIdx = offset.X + offset.Y * ds.Width;
    let rIdx = 0;
    const tileHeight = this.config.TileHeight;
    const cellBottomY = idiv((tile.Dy - tile.Z) * tileHeight, 2) + tileHeight - 1;
    const zBase = idiv((tile.Rx + tile.Ry) * tileHeight, 2);
    // ZAdjust -2 - 12*(Height-4) at rows the game draws 12*Height higher: against the anchor above,
    // which already carries the height, the plane lies 12*4 - 2 behind the caster's own tile, less
    // the usual 1 (the building shadow's 3 is -1 - (-4)). That is one z in front of ground four
    // levels lower, so the shadow darkens the low ground beyond the rim and never the plateau
    const lift = -1 - (idiv(4 * tileHeight, 2) - 2);

    for (let y = 0; y < img.Height; y++) {
      const zBufVal = toShort(zBase + (offset.Y + y) - cellBottomY + lift);
      for (let x = 0; x < img.Width; x++) {
        if (
          0 <= offset.X + x && offset.X + x < ds.Width && 0 <= offset.Y + y && offset.Y + y < ds.Height &&
          imgData[rIdx] !== 0 && zBufVal > zBuffer[zIdx]
        ) {
          data[w] = Math.trunc(data[w] / 2);
          data[w + 1] = Math.trunc(data[w + 1] / 2);
          data[w + 2] = Math.trunc(data[w + 2] / 2);
          zBuffer[zIdx] = zBufVal;
        }
        rIdx++;
        zIdx++;
        w += 3;
      }
      w += stride - 3 * img.Width;
      zIdx += ds.Width - img.Width;
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
    offset.X += idiv(obj.Tile.Dx * this.config.TileWidth, 2);
    offset.Y += idiv((obj.Tile.Dy - obj.Tile.Z) * this.config.TileHeight, 2);
    logger.trace(
      `Drawing AlphaImage SHP file ${shp.fileName} (frame ${frameIndex}) at (${offset.X},${offset.Y})`,
    );

    const stride = ds.Stride;
    const data = ds.data;
    const wHigh = stride * ds.Height;

    const dx = offset.X + idiv(this.config.TileWidth, 2) - idiv(shp.Width, 2) + img.X;
    const dy = offset.Y - idiv(shp.Height, 2) + img.Y;
    let w = dx * 3 + stride * dy;
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
}

function limit(mult: number, p: number): number {
  return Math.trunc(Math.min(255, Math.max(0, mult * p)));
}

function decideFrameIndex(frameIndex: number, numImages: number): number {
  const f = frameIndex as DrawFrame;
  if (f === DrawFrame.Random) frameIndex = Rand.nextMax(numImages);
  return frameIndex;
}