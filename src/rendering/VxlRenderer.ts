// Port of CNCMaps.Engine.Rendering.VxlRenderer
//
// Renders voxel models to an offscreen surface one pixel per voxel, the way gamemd's voxel
// library does: the projection is orthographic (one voxel unit is one screen pixel) and every
// voxel is placed by stepping 8.8 fixed-point screen deltas from the projected bounding-box
// corner farthest from the viewer. No GPU or OpenGL driver is required.
import { Matrix4x4 } from '../formats/HvaFile.js';
import { Vector3, Vector4, Rectangle } from '../shared/Geometry.js';
import { logger } from '../shared/Log.js';
import { VxlFile, VxlSection } from '../formats/VxlFile.js';
import { HvaFile } from '../formats/HvaFile.js';
import { VplFile } from '../formats/VplFile.js';
import { EngineType } from '../shared/Enums.js';
import { DrawingSurface, SurfaceFormat } from './DrawingSurface.js';
import { DrawProperties } from '../engine/game/DrawProperties.js';
import {
  GameObjectLike,
  OwnableObjectLike,
  TileDrawableLike,
} from '../engine/Types.js';
import {
  mul4,
  mulChain,
  transformRow,
  transformNormal,
  createOrthographicGL,
  createPerspectiveFieldOfViewGL,
  degreesToRadians,
  createTranslation,
  createScale,
  createRotationX,
  createRotationY,
  createRotationZ,
  createLookAt,
  invert4,
} from './MatrixMath.js';

/** Casts a number the way C#'s `(short)double` does: truncate toward zero, keep the low 16
 * bits, sign-extend. Voxel positions live in unsigned 16-bit 8.8 fixed-point registers, so the
 * step values are 16-bit signed and the running sums wrap at 16 bits. */
function toShort(v: number): number {
  const x = Math.trunc(v) | 0;
  return ((x & 0xffff) ^ 0x8000) - 0x8000;
}

export class VxlRenderer {
  private isInit = false;

  // color contributors for the fallback lighting used when no voxels.vpl is available;
  // the standard voxels.vpl already adds a lot of ambient, that's why these seem high
  private static readonly Diffuse = Vector3.FromScalar(1.3);
  private static readonly Ambient = Vector3.FromScalar(0.8);

  // game light directions for the vpl page selection (from WorldAlteringEditor)
  private static readonly TSLight = new Vector3(-1, 0, 0);
  private static readonly YRLight = transformNormal(
    new Vector3(-1, 0, 0),
    createRotationZ(degreesToRadians(45)),
  );

  /// <summary>Screen shift of a voxel shadow, gamemd Set_Voxel_Light_Angle: -6 * light.X with the
  /// light (-sqrt(1/2), -sqrt(1/2), 0) turned 45 degrees about Y.</summary>
  private static readonly ShadowShiftX = 3;

  // bounding box corners in the order gamemd's Prep_For_Object scans them; bit 0 = max x,
  // bit 1 = max y, bit 2 = max z
  private static readonly CornerScanOrder = [3, 1, 0, 2, 7, 5, 4, 6];

  private vpl: VplFile | null = null;
  private engine: EngineType = EngineType.YurisRevenge;

  /// <summary>Screen row of the bottom of the model's projected volume, in the draw buffer's
  /// top-down rows. The voxel blitter anchors its standing z-gradient there.</summary>
  VolumeBottomRow = 0;

  /** Sets the voxels.vpl lookup used for game-accurate lighting; without
   * it a Lambert approximation is used. */
  Configure(vpl: VplFile | null, engine: EngineType): void {
    this.vpl = vpl;
    this.engine = engine;
  }

  private surface: DrawingSurface | null = null;

  Initialize(): void {
    logger.info('Initializing voxel renderer');
    this.isInit = true;
    this.surface = new DrawingSurface(400, 400, SurfaceFormat.Bgra32);
  }

  Render(vxl: VxlFile, hva: HvaFile, obj: GameObjectLike, props: DrawProperties, shadowSection = 0): DrawingSurface {
    if (!this.isInit) this.Initialize();
    const surface = this.surface!;

    logger.debug(`Rendering voxel ${vxl.fileName}`);
    vxl.Initialize();
    hva.Initialize();

    this.clear();

    // RA2 projects orthographically with the camera elevated 30 degrees off the ground
    // (gamemd IsometricViewMatrix = RotX(-60) * RotZ(-45), no scaling): one voxel unit
    // is one screen pixel.
    const persp = createOrthographicGL(surface.Width, surface.Height, 1, surface.Height);

    const lookat = createLookAt(new Vector3(0, 0, -10), Vector3.Zero, Vector3.UnitY);
    const trans = createTranslation(0, 0, 10);

    let world = createRotationX(degreesToRadians(60));
    world = mul4(createRotationY(degreesToRadians(180)), world);
    world = mul4(createRotationZ(degreesToRadians(-45)), world);

    // determine tilt vectors
    let tilt = Matrix4x4.Identity;
    let tiltPitch = 0;
    let tiltYaw = 0;
    if (obj.Tile.Drawable != null) {
      const t = obj.Tile.Drawable as TileDrawableLike;
      const img = t.GetTileImage(obj.Tile);
      const ramp = img != null ? img.RampType : 0;
      if (ramp === 0 || ramp >= 17) {
        tiltPitch = tiltYaw = 0;
      } else if (ramp <= 4) {
        // screen-diagonal facings (perpendicular to axes)
        tiltPitch = 25;
        tiltYaw = -90 * ramp;
      } else {
        // world-diagonal facings (perpendicular to screen)
        tiltPitch = 25;
        tiltYaw = 225 - 90 * ((ramp - 1) % 4);
      }
      tilt = mul4(tilt, createRotationX(degreesToRadians(tiltPitch)));
      tilt = mul4(tilt, createRotationZ(degreesToRadians(tiltYaw)));
    }

    // object rotation around Z
    const direction = 'Direction' in obj ? (obj as unknown as OwnableObjectLike).Direction : 0;
    const objectRotation = 90 - (direction / 256) * 360 - tiltYaw; // convert game rotation to world degrees
    let object = mul4(createRotationZ(degreesToRadians(objectRotation)), tilt); // object facing
    // art.ini TurretOffset value positions some voxel parts over our x-axis
    object = mul4(createTranslation(0.18 * props.TurretVoxelOffset, 0, 0), object);

    const pitch = degreesToRadians(210);
    const yaw = degreesToRadians(120);
    const shadowTransform = mul4(createRotationZ(pitch), createRotationY(yaw));
    let volumeMinY = Number.MAX_VALUE;

    // project every section's bounding box first: gamemd centres the whole model in its
    // draw buffer on the union of the boxes, and that centre decides the pixel rounding
    const sectionCount = vxl.Sections.length;
    const lightDirs: Vector3[] = new Array(sectionCount);
    const corners: Vector3[][] = new Array(sectionCount);
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = -Number.MAX_VALUE;
    let maxY = -Number.MAX_VALUE;
    for (let s = 0; s < sectionCount; s++) {
      const section = vxl.Sections[s];
      const frameRot = hva.loadGLMatrix(section.Index);
      frameRot.m41 *= section.HVAMultiplier * section.ScaleX;
      frameRot.m42 *= section.HVAMultiplier * section.ScaleY;
      frameRot.m43 *= section.HVAMultiplier * section.ScaleZ;

      const frameTransl = createTranslation(section.MinBounds.X, section.MinBounds.Y, section.MinBounds.Z);
      const frame = mul4(frameTransl, frameRot);

      // full modelview-projection for this section, mirroring the former GL
      // matrix stack (row-vector convention: leftmost matrix applies first)
      const mvp = mulChain(frame, object, world, trans, lookat, persp);
      for (let i = 0; i < 8; i++) {
        const corner = new Vector4(
          (((i & 1) !== 0) ? section.SizeX - 0.5 : -0.5) * section.ScaleX,
          (((i & 2) !== 0) ? section.SizeY - 0.5 : -0.5) * section.ScaleY,
          (((i & 4) !== 0) ? section.SizeZ - 0.5 : -0.5) * section.ScaleZ,
          1,
        );
        const clip = transformRow(corner, mvp);
        if (clip.W > 1e-6) volumeMinY = Math.min(volumeMinY, ((clip.Y / clip.W + 1) * surface.Height) / 2);
      }

      corners[s] = new Array(8);
      for (let i = 0; i < 8; i++) {
        const corner = new Vector4(
          ((i & 1) !== 0) ? section.SpanX : 0,
          ((i & 2) !== 0) ? section.SpanY : 0,
          ((i & 4) !== 0) ? section.SpanZ : 0,
          1,
        );
        const p = this.project(corner, mvp, surface);
        corners[s][i] = p;
        minX = Math.min(minX, p.X);
        maxX = Math.max(maxX, p.X);
        minY = Math.min(minY, p.Y);
        maxY = Math.max(maxY, p.Y);
      }

      // undo world transformations on light direction
      const v = mulChain(object, world, frame, shadowTransform);
      const vInv = invert4(v);
      lightDirs[s] = vInv != null ? extractRotationVector(toOpenGL(vInv)) : Vector3.Zero;
    }
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;

    for (let s = 0; s < sectionCount; s++)
      this.drawSection(surface, vxl.Sections[s], corners[s], centerX, centerY, obj, direction, lightDirs[s]);

    if (sectionCount > 0) {
      const shadow = Math.min(shadowSection, sectionCount - 1);
      this.drawShadow(surface, vxl.Sections[shadow], corners[shadow]);
    }

    this.VolumeBottomRow = surface.Height - 1 - Math.min(Math.max(Math.floor(volumeMinY), 0), surface.Height - 1);
    return surface;
  }

  /// <summary>Window position of a model point relative to the draw point: x right, y down,
  /// z growing away from the viewer.</summary>
  private project(p: Vector4, mvp: Matrix4x4, surface: DrawingSurface): Vector3 {
    const clip = transformRow(p, mvp);
    const invW = 1 / clip.W;
    return new Vector3((clip.X * invW * surface.Width) / 2, (-clip.Y * invW * surface.Height) / 2, clip.Z * invW);
  }

  /// <summary>
  /// Walks the section's voxels like gamemd's Draw_Voxel_Regular_Lighting_Normals_ASM: every
  /// voxel is one pixel, placed by stepping 8.8 fixed-point screen deltas from the projected
  /// bounding box corner farthest from the viewer, and later voxels overwrite earlier ones
  /// (painter's order, no depth test).
  /// </summary>
  private drawSection(
    surface: DrawingSurface,
    section: VxlSection,
    corners: Vector3[],
    centerX: number,
    centerY: number,
    obj: GameObjectLike,
    direction: number,
    lightDirection: Vector3,
  ): void {
    let anchor = VxlRenderer.CornerScanOrder[0];
    for (const c of VxlRenderer.CornerScanOrder) if (corners[c].Z > corners[anchor].Z) anchor = c;
    const maxX = (anchor & 1) !== 0;
    const maxY = (anchor & 2) !== 0;
    const maxZ = (anchor & 4) !== 0;
    const c0 = corners[anchor];
    const cx = corners[anchor ^ 1];
    const cy = corners[anchor ^ 2];
    const cz = corners[anchor ^ 4];

    // VoxelLibrary::Render_Object: the anchor lands at buffer (128,128) minus the model
    // centre, deltas are truncated to 1/256 px per voxel; positions live in unsigned
    // 16-bit 8.8 registers, hence the masks
    const baseX = Math.trunc(Math.fround(Math.fround(c0.X + 128 - centerX) * 256)) & 0xffff;
    const baseY = Math.trunc(Math.fround(Math.fround(c0.Y + 128 - centerY) * 256)) & 0xffff;
    const stepXx = toShort(((cx.X - c0.X) / section.SizeX) * 256);
    const stepXy = toShort(((cx.Y - c0.Y) / section.SizeX) * 256);
    const stepYx = toShort(((cy.X - c0.X) / section.SizeY) * 256);
    const stepYy = toShort(((cy.Y - c0.Y) / section.SizeY) * 256);
    const stepZx = toShort(((cz.X - c0.X) / section.SizeZ) * 256);
    const stepZy = toShort(((cz.Y - c0.Y) / section.SizeZ) * 256);
    const originX = Math.trunc(surface.Width / 2) - 128 + Math.trunc(centerX);
    const originY = Math.trunc(surface.Height / 2) - 128 + Math.trunc(centerY);

    // game-accurate lighting: precompute which vpl page every normal maps to
    const vplPages = this.vpl != null ? this.preCalculateVplLighting(section.getNormals(), direction) : null;

    for (let wy = 0; wy < section.SizeY; wy++) {
      const dy = maxY ? section.SizeY - 1 - wy : wy;
      for (let wx = 0; wx < section.SizeX; wx++) {
        const dx = maxX ? section.SizeX - 1 - wx : wx;
        const voxels = section.Spans[dx][dy].Voxels;
        if (voxels.length === 0) continue;
        const colX = baseX + wx * stepXx + wy * stepYx;
        const colY = baseY + wx * stepXy + wy * stepYy;
        for (let i = 0; i < voxels.length; i++) {
          const vx = voxels[maxZ ? voxels.length - 1 - i : i];
          if (vx.ColorIndex === 0) continue;
          const wz = maxZ ? section.SizeZ - 1 - vx.Z : vx.Z;
          const px = ((colX + wz * stepZx) & 0xffff) >> 8;
          const py = ((colY + wz * stepZy) & 0xffff) >> 8;
          const sx = px + originX;
          const sy = py + originY;
          if (sx < 0 || sx >= surface.Width || sy < 0 || sy >= surface.Height) continue;

          let cr = 0;
          let cg = 0;
          let cb = 0;
          if (vplPages != null) {
            // like the game: remap the palette index through voxels.vpl
            // for the lighting page this voxel's normal maps to
            const remapped = this.vpl!.getPaletteIndex(vplPages[vx.NormalIndex], vx.ColorIndex);
            const color = obj.Palette.Colors[remapped];
            cr = color.R;
            cg = color.G;
            cb = color.B;
          } else {
            const color = obj.Palette.Colors[vx.ColorIndex];
            const normal = section.getNormal(vx.NormalIndex);
            // shader function taken from https://github.com/OpenRA/OpenRA/blob/bleed/cg/vxl.fx
            const mult = Math.max(Vector3.Dot(normal, lightDirection), 0);
            const colorMult = Vector3.Add(VxlRenderer.Ambient, Vector3.MultiplyScalar(VxlRenderer.Diffuse, mult));
            cr = Math.trunc(Math.min(255, color.R * colorMult.X));
            cg = Math.trunc(Math.min(255, color.G * colorMult.Y));
            cb = Math.trunc(Math.min(255, color.B * colorMult.Z));
          }
          this.setPixel(surface, sx, sy, cr, cg, cb);
        }
      }
    }
  }

  /// <summary>
  /// VoxelLibrary::Render_Shadow: every column holding a voxel stamps a 2 px wide dot on the
  /// section's bottom bounding-box face, which the same view projects to the screen; the
  /// silhouette is shifted by the light vector and centred on that face's own box.
  /// </summary>
  private drawShadow(surface: DrawingSurface, section: VxlSection, corners: Vector3[]): void {
    const shift = VxlRenderer.ShadowShiftX;
    const c0 = corners[0];
    const cx = corners[1];
    const cy = corners[2];
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = -Number.MAX_VALUE;
    let maxY = -Number.MAX_VALUE;
    for (let i = 0; i < 4; i++) {
      minX = Math.min(minX, corners[i].X + shift);
      maxX = Math.max(maxX, corners[i].X + shift);
      minY = Math.min(minY, corners[i].Y);
      maxY = Math.max(maxY, corners[i].Y);
    }
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const baseX = Math.trunc(Math.fround(Math.fround(c0.X + shift + 128 - centerX) * 256)) & 0xffff;
    const baseY = Math.trunc(Math.fround(Math.fround(c0.Y + 128 - centerY) * 256)) & 0xffff;
    const stepXx = toShort(((cx.X - c0.X) / section.SizeX) * 256);
    const stepXy = toShort(((cx.Y - c0.Y) / section.SizeX) * 256);
    const stepYx = toShort(((cy.X - c0.X) / section.SizeY) * 256);
    const stepYy = toShort(((cy.Y - c0.Y) / section.SizeY) * 256);
    const originX = Math.trunc(surface.Width / 2) - 128 + Math.trunc(centerX);
    const originY = Math.trunc(surface.Height / 2) - 128 + Math.trunc(centerY);

    const shadBuf = surface.getShadows();
    for (let y = 0; y < section.SizeY; y++) {
      for (let x = 0; x < section.SizeX; x++) {
        if (section.Spans[x][y].Voxels.length === 0) continue;
        const px = (((baseX + x * stepXx + y * stepYx) & 0xffff) >> 8) + originX;
        const py = (((baseY + x * stepXy + y * stepYy) & 0xffff) >> 8) + originY;
        if (py < 0 || py >= surface.Height) continue;
        if (px >= 0 && px < surface.Width) shadBuf[py * surface.Width + px] = 1;
        if (px + 1 >= 0 && px + 1 < surface.Width) shadBuf[py * surface.Width + px + 1] = 1;
      }
    }
  }

  private setPixel(surface: DrawingSurface, x: number, y: number, r: number, g: number, b: number): void {
    const pix = (y * surface.Width + x) * 4;
    surface.data[pix] = b;
    surface.data[pix + 1] = g;
    surface.data[pix + 2] = r;
    surface.data[pix + 3] = 255;
  }

  static GetBounds(obj: GameObjectLike, vxl: VxlFile, hva: HvaFile, props: DrawProperties): Rectangle {
    vxl.Initialize();
    hva.Initialize();

    const direction = 'Direction' in obj ? (obj as unknown as OwnableObjectLike).Direction : 0;
    const objectRotation = 45 - (direction / 256) * 360; // convert game rotation to world degrees

    let world = createRotationX(degreesToRadians(60));
    world = mul4(createRotationZ(degreesToRadians(objectRotation)), world); // object facing
    world = mul4(createScale(0.25, 0.25, 0.25), world);

    // art.ini TurretOffset value positions some voxel parts over our x-axis
    world = mul4(createTranslation(0.18 * props.TurretVoxelOffset, 0, 0), world);
    const camera = createPerspectiveFieldOfViewGL(degreesToRadians(30), 1, 1, 100);
    world = mul4(world, camera);

    let ret = Rectangle.Empty;
    for (const section of vxl.Sections) {
      const frameRot = hva.loadGLMatrix(section.Index);
      frameRot.m41 *= section.HVAMultiplier * section.ScaleX;
      frameRot.m42 *= section.HVAMultiplier * section.ScaleY;
      frameRot.m43 *= section.HVAMultiplier * section.ScaleZ;

      const minbounds = new Vector3(section.MinBounds.X, section.MinBounds.Y, section.MinBounds.Z);
      if (props.HasShadow) minbounds.Z = -100;

      const frameTransl = createTranslation(minbounds.X, minbounds.Y, minbounds.Z);
      const frame = mulChain(frameTransl, frameRot, world);

      // floor rect of the bounding box
      let floorTopLeft = new Vector3(0, 0, 0);
      let floorTopRight = new Vector3(section.SpanX, 0, 0);
      let floorBottomRight = new Vector3(section.SpanX, section.SpanY, 0);
      let floorBottomLeft = new Vector3(0, section.SpanY, 0);

      // ceil rect of the bounding box
      let ceilTopLeft = new Vector3(0, 0, section.SpanZ);
      let ceilTopRight = new Vector3(section.SpanX, 0, section.SpanZ);
      let ceilBottomRight = new Vector3(section.SpanX, section.SpanY, section.SpanZ);
      let ceilBottomLeft = new Vector3(0, section.SpanY, section.SpanZ);

      // apply transformations
      floorTopLeft = transformNormal(floorTopLeft, frame);
      floorTopRight = transformNormal(floorTopRight, frame);
      floorBottomRight = transformNormal(floorBottomRight, frame);
      floorBottomLeft = transformNormal(floorBottomLeft, frame);

      ceilTopLeft = transformNormal(ceilTopLeft, frame);
      ceilTopRight = transformNormal(ceilTopRight, frame);
      ceilBottomRight = transformNormal(ceilBottomRight, frame);
      ceilBottomLeft = transformNormal(ceilBottomLeft, frame);

      const FminX = Math.floor(Math.min(floorTopLeft.X, floorTopRight.X, floorBottomRight.X, floorBottomLeft.X));
      const FmaxX = Math.ceil(Math.max(floorTopLeft.X, floorTopRight.X, floorBottomRight.X, floorBottomLeft.X));
      const FminY = Math.floor(Math.min(floorTopLeft.Y, floorTopRight.Y, floorBottomRight.Y, floorBottomLeft.Y));
      const FmaxY = Math.ceil(Math.max(floorTopLeft.Y, floorTopRight.Y, floorBottomRight.Y, floorBottomLeft.Y));

      const TminX = Math.floor(Math.min(ceilTopLeft.X, ceilTopRight.X, ceilBottomRight.X, ceilBottomLeft.X));
      const TmaxX = Math.ceil(Math.max(ceilTopLeft.X, ceilTopRight.X, ceilBottomRight.X, ceilBottomLeft.X));
      const TminY = Math.floor(Math.min(ceilTopLeft.Y, ceilTopRight.Y, ceilBottomRight.Y, ceilBottomLeft.Y));
      const TmaxY = Math.ceil(Math.max(ceilTopLeft.Y, ceilTopRight.Y, ceilBottomRight.Y, ceilBottomLeft.Y));

      const minX = Math.min(FminX, TminX);
      const maxX = Math.max(FmaxX, TmaxX);
      const minY = Math.min(FminY, TminY);
      const maxY = Math.max(FmaxY, TmaxY);

      ret = Rectangle.Union(ret, Rectangle.FromLTRB(minX, minY, maxX, maxY));
    }

    return ret;
  }

  /** Maps every voxel normal to the voxels.vpl lighting page the game would use,
   * for a given object facing. Blinn-Phong reflection model as reverse-engineered
   * by the WorldAlteringEditor project. */
  private preCalculateVplLighting(normalsTable: Vector3[], direction: number): Uint8Array {
    const rotationFromFacing = (Math.PI * 2 * direction) / 256;
    const baseLight = this.engine >= EngineType.RedAlert2 ? VxlRenderer.YRLight : VxlRenderer.TSLight;
    const light = transformNormal(baseLight, createRotationZ(rotationFromFacing - degreesToRadians(45)));

    // halfway vector between light direction and view direction (Blinn-Phong)
    const viewer = Vector3.UnitZ;
    const halfway = Vector3.Normalize(Vector3.Add(light, viewer));

    const specularStrength = 3.0; // constant used in YR

    const pages = new Uint8Array(256);
    for (let i = 0; i < normalsTable.length; i++) {
      const diffuse = Math.max(Vector3.Dot(normalsTable[i], light), 0);
      const halfwayDot = Vector3.Dot(normalsTable[i], halfway);
      let specular = halfwayDot / (specularStrength - halfwayDot * specularStrength + halfwayDot);
      specular = Math.max(specular, 0);

      pages[i] = Math.trunc(Math.min(255, Math.max(0, (diffuse + specular) * 16.0)));
    }

    // special normal indices are neutrally lit
    pages[253] = 16;
    pages[254] = 16;
    pages[255] = 16;

    return pages;
  }

  private clear(): void {
    const surface = this.surface!;
    // clear color to transparent black
    surface.data.fill(0);
    const shadBuf = surface.getShadows();
    shadBuf.fill(0);
  }
}

const zeroVector = [0, 0, 0, 1];
const zVector = [0, 0, 1, 1];

function extractRotationVector(mtx: number[]): Vector3 {
  const tVec = matrixVectorMultiply(mtx, zVector);
  const tOrigin = matrixVectorMultiply(mtx, zeroVector);
  tVec[0] -= (tOrigin[0] * tVec[3]) / tOrigin[3];
  tVec[1] -= (tOrigin[1] * tVec[3]) / tOrigin[3];
  tVec[2] -= (tOrigin[2] * tVec[3]) / tOrigin[3];

  // Renormalize
  const w = Math.sqrt(tVec[0] * tVec[0] + tVec[1] * tVec[1] + tVec[2] * tVec[2]);
  tVec[0] /= w;
  tVec[1] /= w;
  tVec[2] /= w;
  tVec[3] = 1;

  return new Vector3(tVec[0], tVec[1], tVec[2]);
}

function toOpenGL(source: Matrix4x4): number[] {
  return [
    source.m11, source.m12, source.m13, source.m14,
    source.m21, source.m22, source.m23, source.m24,
    source.m31, source.m32, source.m33, source.m34,
    source.m41, source.m42, source.m43, source.m44,
  ];
}

function matrixVectorMultiply(mtx: number[], vec: number[]): number[] {
  const ret = new Array<number>(4);
  for (let j = 0; j < 4; j++) {
    ret[j] = 0;
    for (let k = 0; k < 4; k++) ret[j] += mtx[4 * k + j] * vec[k];
  }
  return ret;
}