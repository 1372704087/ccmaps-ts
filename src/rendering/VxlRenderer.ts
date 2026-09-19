// Port of CNCMaps.Engine.Rendering.VxlRenderer
//
// Renders voxel models to an offscreen surface using a small software rasterizer.
// This replaces the former OpenGL implementation with equivalent semantics
// (fixed-function pipeline, flat-shaded quads, depth-test less), so no GPU or
// OpenGL driver is required and output is identical on every machine.
import { Matrix4x4 } from '../formats/HvaFile.js';
import { Vector3, Vector4, Rectangle } from '../shared/Geometry.js';
import { logger } from '../shared/Log.js';
import { VxlFile } from '../formats/VxlFile.js';
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

  private vpl: VplFile | null = null;
  private engine: EngineType = EngineType.YurisRevenge;

  /** Sets the voxels.vpl lookup used for game-accurate lighting; without
   * it a Lambert approximation is used. */
  Configure(vpl: VplFile | null, engine: EngineType): void {
    this.vpl = vpl;
    this.engine = engine;
  }

  private surface: DrawingSurface | null = null;
  private zBuffer: Float32Array | null = null; // window-space depth in [-1,1] (ndc z), depth-test "less"

  Initialize(): void {
    logger.info('Initializing voxel renderer');
    this.isInit = true;
    this.surface = new DrawingSurface(400, 400, SurfaceFormat.Bgra32);
    this.zBuffer = new Float32Array(this.surface.Width * this.surface.Height);
  }

  Render(vxl: VxlFile, hva: HvaFile, obj: GameObjectLike, props: DrawProperties): DrawingSurface {
    if (!this.isInit) this.Initialize();
    const surface = this.surface!;
    const zBuffer = this.zBuffer!;

    logger.debug(`Rendering voxel ${vxl.fileName}`);
    vxl.Initialize();
    hva.Initialize();

    this.clear();

    // RA2 uses dimetric projection with camera elevated 30° off the ground.
    // The game projects orthographically (the world is axonometric); the ortho
    // volume is sized to the scale the historical perspective camera (fov 30°,
    // eye distance 20) had at the model's depth: 2*tan(15°)*20 world units.
    const orthoDiameter = 10.7157;
    const persp = createOrthographicGL(orthoDiameter, orthoDiameter * surface.Height / surface.Width, 1, surface.Height);

    const lookat = createLookAt(new Vector3(0, 0, -10), Vector3.Zero, Vector3.UnitY);
    const trans = createTranslation(0, 0, 10);

    // align and zoom
    let world = createRotationX(degreesToRadians(60));
    world = mul4(createRotationY(degreesToRadians(180)), world);
    world = mul4(createRotationZ(degreesToRadians(-45)), world);
    world = mul4(createScale(0.028, 0.028, 0.028), world);

    // determine tilt vectors
    let tilt = Matrix4x4.Identity;
    let tiltPitch = 0, tiltYaw = 0;
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
    const objectRotation = 90 - direction / 256 * 360 - tiltYaw; // convert game rotation to world degrees
    let object = mul4(createRotationZ(degreesToRadians(objectRotation)), tilt); // object facing
    // art.ini TurretOffset value positions some voxel parts over our x-axis
    object = mul4(createTranslation(0.18 * props.TurretVoxelOffset, 0, 0), object);

    const pitch = degreesToRadians(210);
    const yaw = degreesToRadians(120);
    const shadowTransform = mul4(createRotationZ(pitch), createRotationY(yaw));
    // clear shadowbuf
    const shadBuf = surface.getShadows();
    shadBuf.fill(0);

    for (const section of vxl.Sections) {
      const frameRot = hva.loadGLMatrix(section.Index);
      frameRot.m41 *= section.HVAMultiplier * section.ScaleX;
      frameRot.m42 *= section.HVAMultiplier * section.ScaleY;
      frameRot.m43 *= section.HVAMultiplier * section.ScaleZ;

      const frameTransl = createTranslation(section.MinBounds.X, section.MinBounds.Y, section.MinBounds.Z);
      const frame = mul4(frameTransl, frameRot);

      // full modelview-projection for this section, mirroring the former GL
      // matrix stack (row-vector convention: leftmost matrix applies first)
      const mvp = mulChain(frame, object, world, trans, lookat, persp);

      // shadow: flatten the model onto the ground plane (z=0 in upright world
      // space, i.e. after the model/facing/tilt transforms but before the
      // camera transforms), then project to screen like regular geometry.
      // This projects the actual voxel volume straight down, like the game.
      const flatten = Matrix4x4.Identity;
      flatten.m33 = 0;
      const shadowMvp = mulChain(frame, object, flatten, world, trans, lookat, persp);

      // undo world transformations on light direction
      const v = mulChain(object, world, frame, shadowTransform);

      const vInv = invert4(v);
      let lightDirection = Vector3.Zero;
      if (vInv != null) lightDirection = extractRotationVector(toOpenGL(vInv));

      // game-accurate lighting: precompute which vpl page every normal maps to
      const vplPages = this.vpl != null ? this.preCalculateVplLighting(section.getNormals(), direction) : null;

      for (let x = 0; x !== section.SizeX; x++) {
        for (let y = 0; y !== section.SizeY; y++) {
          for (const vx of section.Spans[x][y].Voxels) {
            if (vx.ColorIndex === 0) continue;
            let cr = 0, cg = 0, cb = 0;
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
              // thanks to pchote for a LOT of help getting it right
              const mult = Math.max(Vector3.Dot(normal, lightDirection), 0);
              const colorMult = Vector3.Add(VxlRenderer.Ambient, Vector3.MultiplyScalar(VxlRenderer.Diffuse, mult));
              cr = Math.trunc(Math.min(255, color.R * colorMult.X));
              cg = Math.trunc(Math.min(255, color.G * colorMult.Y));
              cb = Math.trunc(Math.min(255, color.B * colorMult.Z));
            }

            const vxlPos = Vector3.Multiply(
              new Vector3(x, y, vx.Z),
              section.Scale,
            );
            this.renderVoxel(surface, vxlPos, mvp, cr, cg, cb);
            this.renderVoxelShadow(surface, vxlPos, shadowMvp, shadBuf);
          }
        }
      }
    }

    return surface;
  }

  static GetBounds(obj: GameObjectLike, vxl: VxlFile, hva: HvaFile, props: DrawProperties): Rectangle {
    vxl.Initialize();
    hva.Initialize();

    const direction = 'Direction' in obj ? (obj as unknown as OwnableObjectLike).Direction : 0;
    const objectRotation = 45 - direction / 256 * 360; // convert game rotation to world degrees

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
    const rotationFromFacing = (Math.PI * 2) * direction / 256;
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
    const zBuffer = this.zBuffer!;
    // clear color to transparent black, depth to far plane
    surface.data.fill(0);
    zBuffer.fill(Number.MAX_VALUE);
  }

  // cube corner offsets, index = x + y*2 + z*4 (x: left/right, y: base/top, z: front/back)
  private static readonly cubeFaces = [
    [0, 1, 5, 4], // base   (y = base)
    [4, 5, 7, 6], // back   (z = back)
    [2, 3, 7, 6], // top    (y = top)
    [1, 5, 7, 3], // right  (x = right)
    [0, 1, 3, 2], // front  (z = front)
    [0, 4, 6, 2], // left   (x = left)
  ];

  private corners: ScreenVertex[] = new Array(8).fill(null).map(() => new ScreenVertex(0, 0, 0));

  private renderVoxel(
    surface: DrawingSurface,
    v: Vector3,
    mvp: Matrix4x4,
    r: number,
    g: number,
    b: number,
  ): void {
    const rad = 0.5;
    // transform the 8 cube corners to window coordinates
    let valid = true;
    for (let i = 0; i < 8; i++) {
      const corner = new Vector4(
        v.X + (((i & 1) !== 0) ? rad : -rad),
        v.Y + (((i & 2) !== 0) ? rad : -rad),
        v.Z + (((i & 4) !== 0) ? rad : -rad),
        1,
      );
      const clip = transformRow(corner, mvp);
      if (clip.W <= 1e-6) {
        valid = false; // behind the camera; the fixed camera setup never hits this
        break;
      }
      const invW = 1 / clip.W;
      this.corners[i].X = (clip.X * invW + 1) * surface.Width / 2;
      this.corners[i].Y = (clip.Y * invW + 1) * surface.Height / 2;
      this.corners[i].Z = clip.Z * invW;
    }
    if (!valid) return;

    for (const f of VxlRenderer.cubeFaces) {
      this.rasterizeTriangle(surface, this.corners[f[0]], this.corners[f[1]], this.corners[f[2]], r, g, b);
      this.rasterizeTriangle(surface, this.corners[f[0]], this.corners[f[2]], this.corners[f[3]], r, g, b);
    }
  }

  private shadowCorners: ScreenVertex[] = new Array(8).fill(null).map(() => new ScreenVertex(0, 0, 0));

  private renderVoxelShadow(
    surface: DrawingSurface,
    v: Vector3,
    shadowMvp: Matrix4x4,
    shadBuf: Uint8Array,
  ): void {
    const rad = 0.5;
    for (let i = 0; i < 8; i++) {
      const corner = new Vector4(
        v.X + (((i & 1) !== 0) ? rad : -rad),
        v.Y + (((i & 2) !== 0) ? rad : -rad),
        v.Z + (((i & 4) !== 0) ? rad : -rad),
        1,
      );
      const clip = transformRow(corner, shadowMvp);
      if (clip.W <= 1e-6) return;
      const invW = 1 / clip.W;
      this.shadowCorners[i].X = (clip.X * invW + 1) * surface.Width / 2;
      this.shadowCorners[i].Y = (clip.Y * invW + 1) * surface.Height / 2;
    }

    // the flattened cube's faces together cover its ground silhouette
    for (const f of VxlRenderer.cubeFaces) {
      this.rasterizeShadowTriangle(surface, this.shadowCorners[f[0]], this.shadowCorners[f[1]], this.shadowCorners[f[2]], shadBuf);
      this.rasterizeShadowTriangle(surface, this.shadowCorners[f[0]], this.shadowCorners[f[2]], this.shadowCorners[f[3]], shadBuf);
    }
  }

  private rasterizeShadowTriangle(
    surface: DrawingSurface,
    v0: ScreenVertex,
    v1: ScreenVertex,
    v2: ScreenVertex,
    shadBuf: Uint8Array,
  ): void {
    const minX = Math.max(0, Math.floor(Math.min(v0.X, v1.X, v2.X) - 0.5));
    const maxX = Math.min(surface.Width - 1, Math.ceil(Math.max(v0.X, v1.X, v2.X) - 0.5));
    const minY = Math.max(0, Math.floor(Math.min(v0.Y, v1.Y, v2.Y) - 0.5));
    const maxY = Math.min(surface.Height - 1, Math.ceil(Math.max(v0.Y, v1.Y, v2.Y) - 0.5));
    if (minX > maxX || minY > maxY) return;

    const area = (v1.X - v0.X) * (v2.Y - v0.Y) - (v1.Y - v0.Y) * (v2.X - v0.X);
    if (area === 0) return;
    const invArea = 1 / area;

    const height = surface.Height, width = surface.Width;
    for (let py = minY; py <= maxY; py++) {
      const sy = py + 0.5;
      // the shadow buffer is indexed top-down (see BlitVoxelToSurface)
      const row = (height - 1 - py) * width;
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5;
        const w0 = ((v1.X - v0.X) * (sy - v0.Y) - (v1.Y - v0.Y) * (sx - v0.X)) * invArea;
        const w1 = ((v2.X - v1.X) * (sy - v1.Y) - (v2.Y - v1.Y) * (sx - v1.X)) * invArea;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        shadBuf[row + px] = 1;
      }
    }
  }

  private rasterizeTriangle(
    surface: DrawingSurface,
    v0: ScreenVertex,
    v1: ScreenVertex,
    v2: ScreenVertex,
    r: number,
    g: number,
    b: number,
  ): void {
    // bounding box, clipped to viewport; samples at pixel centers (x+0.5, y+0.5)
    const minX = Math.max(0, Math.floor(Math.min(v0.X, v1.X, v2.X) - 0.5));
    const maxX = Math.min(surface.Width - 1, Math.ceil(Math.max(v0.X, v1.X, v2.X) - 0.5));
    const minY = Math.max(0, Math.floor(Math.min(v0.Y, v1.Y, v2.Y) - 0.5));
    const maxY = Math.min(surface.Height - 1, Math.ceil(Math.max(v0.Y, v1.Y, v2.Y) - 0.5));
    if (minX > maxX || minY > maxY) return;

    const area = (v1.X - v0.X) * (v2.Y - v0.Y) - (v1.Y - v0.Y) * (v2.X - v0.X);
    if (area === 0) return;
    const invArea = 1 / area;

    const stride = surface.Stride;
    const data = surface.data;
    const zBuffer = this.zBuffer!;

    for (let py = minY; py <= maxY; py++) {
      const sy = py + 0.5;
      // store rows bottom-up like GL.ReadPixels used to; BlitVoxelToSurface
      // compensates for that when copying to the map surface
      const row = py * stride;
      const zRow = py * surface.Width;
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5;
        // barycentric coordinates (signed areas); accept both windings since
        // the former GL pipeline did not cull faces
        const w0 = ((v1.X - v0.X) * (sy - v0.Y) - (v1.Y - v0.Y) * (sx - v0.X)) * invArea;
        const w1 = ((v2.X - v1.X) * (sy - v1.Y) - (v2.Y - v1.Y) * (sx - v1.X)) * invArea;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;

        // window-space z interpolates linearly in screen space
        // (w1 weighs v0, w2 weighs v1, w0 weighs v2, from the opposing edges)
        const z = w1 * v0.Z + w2 * v1.Z + w0 * v2.Z;
        const zIdx = zRow + px;
        if (z >= zBuffer[zIdx]) continue; // depth-test "less", like the GL default
        zBuffer[zIdx] = z;

        const pix = row + px * 4;
        data[pix] = b;
        data[pix + 1] = g;
        data[pix + 2] = r;
        data[pix + 3] = 255;
      }
    }
  }
}

class ScreenVertex {
  constructor(public X: number, public Y: number, public Z: number) {}
}

const zeroVector = [0, 0, 0, 1];
const zVector = [0, 0, 1, 1];

function extractRotationVector(mtx: number[]): Vector3 {
  const tVec = matrixVectorMultiply(mtx, zVector);
  const tOrigin = matrixVectorMultiply(mtx, zeroVector);
  tVec[0] -= tOrigin[0] * tVec[3] / tOrigin[3];
  tVec[1] -= tOrigin[1] * tVec[3] / tOrigin[3];
  tVec[2] -= tOrigin[2] * tVec[3] / tOrigin[3];

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