// Port of CNCMaps.Engine.Rendering.MatrixMath
//
// Scalar, left-associated evaluation order reproducing OpenTK's math (which the
// C# version kept to stay bit-identical and to use the GL z-extent convention the
// VXL renderer's depth mapping relies on).
import { Matrix4x4 } from '../formats/HvaFile.js';
import { Vector3, Vector4 } from '../shared/Geometry.js';

export function mul4(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
  return new Matrix4x4(
    a.m11 * b.m11 + a.m12 * b.m21 + a.m13 * b.m31 + a.m14 * b.m41,
    a.m11 * b.m12 + a.m12 * b.m22 + a.m13 * b.m32 + a.m14 * b.m42,
    a.m11 * b.m13 + a.m12 * b.m23 + a.m13 * b.m33 + a.m14 * b.m43,
    a.m11 * b.m14 + a.m12 * b.m24 + a.m13 * b.m34 + a.m14 * b.m44,
    a.m21 * b.m11 + a.m22 * b.m21 + a.m23 * b.m31 + a.m24 * b.m41,
    a.m21 * b.m12 + a.m22 * b.m22 + a.m23 * b.m32 + a.m24 * b.m42,
    a.m21 * b.m13 + a.m22 * b.m23 + a.m23 * b.m33 + a.m24 * b.m43,
    a.m21 * b.m14 + a.m22 * b.m24 + a.m23 * b.m34 + a.m24 * b.m44,
    a.m31 * b.m11 + a.m32 * b.m21 + a.m33 * b.m31 + a.m34 * b.m41,
    a.m31 * b.m12 + a.m32 * b.m22 + a.m33 * b.m32 + a.m34 * b.m42,
    a.m31 * b.m13 + a.m32 * b.m23 + a.m33 * b.m33 + a.m34 * b.m43,
    a.m31 * b.m14 + a.m32 * b.m24 + a.m33 * b.m34 + a.m34 * b.m44,
    a.m41 * b.m11 + a.m42 * b.m21 + a.m43 * b.m31 + a.m44 * b.m41,
    a.m41 * b.m12 + a.m42 * b.m22 + a.m43 * b.m32 + a.m44 * b.m42,
    a.m41 * b.m13 + a.m42 * b.m23 + a.m43 * b.m33 + a.m44 * b.m43,
    a.m41 * b.m14 + a.m42 * b.m24 + a.m43 * b.m34 + a.m44 * b.m44,
  );
}

/** Left-to-right product like a chained row-vector matrix stack. */
export function mulChain(a: Matrix4x4, b: Matrix4x4, ...rest: Matrix4x4[]): Matrix4x4 {
  let m = mul4(a, b);
  for (const r of rest) m = mul4(m, r);
  return m;
}

/** Row-vector transform v·M (OpenTK's Vector4.TransformRow). */
export function transformRow(v: Vector4, m: Matrix4x4): Vector4 {
  return new Vector4(
    v.X * m.m11 + v.Y * m.m21 + v.Z * m.m31 + v.W * m.m41,
    v.X * m.m12 + v.Y * m.m22 + v.Z * m.m32 + v.W * m.m42,
    v.X * m.m13 + v.Y * m.m23 + v.Z * m.m33 + v.W * m.m43,
    v.X * m.m14 + v.Y * m.m24 + v.Z * m.m34 + v.W * m.m44,
  );
}

/** Row-vector transform without translation (OpenTK's Vector3.TransformVector). */
export function transformNormal(v: Vector3, m: Matrix4x4): Vector3 {
  return new Vector3(
    v.X * m.m11 + v.Y * m.m21 + v.Z * m.m31,
    v.X * m.m12 + v.Y * m.m22 + v.Z * m.m32,
    v.X * m.m13 + v.Y * m.m23 + v.Z * m.m33,
  );
}

export function createOrthographicGL(width: number, height: number, zNear: number, zFar: number): Matrix4x4 {
  const left = -width / 2, right = width / 2, bottom = -height / 2, top = height / 2;
  const m = Matrix4x4.Identity;
  m.m11 = 2 / (right - left);
  m.m22 = 2 / (top - bottom);
  m.m33 = -2 / (zFar - zNear);
  m.m41 = -(right + left) / (right - left);
  m.m42 = -(top + bottom) / (top - bottom);
  m.m43 = -(zFar + zNear) / (zFar - zNear);
  return m;
}

export function createPerspectiveFieldOfViewGL(fovy: number, aspect: number, zNear: number, zFar: number): Matrix4x4 {
  const top = zNear * Math.tan(0.5 * fovy);
  const bottom = -top;
  const left = bottom * aspect;
  const right = top * aspect;
  return new Matrix4x4(
    2 * zNear / (right - left), 0, 0, 0,
    0, 2 * zNear / (top - bottom), 0, 0,
    (right + left) / (right - left), (top + bottom) / (top - bottom), -(zFar + zNear) / (zFar - zNear), -1,
    0, 0, -(2 * zFar * zNear) / (zFar - zNear), 0,
  );
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function createTranslation(x: number, y: number, z: number): Matrix4x4 {
  const m = Matrix4x4.Identity;
  m.m41 = x;
  m.m42 = y;
  m.m43 = z;
  return m;
}

export function createScale(x: number, y: number, z: number): Matrix4x4 {
  const m = Matrix4x4.Identity;
  m.m11 = x;
  m.m22 = y;
  m.m33 = z;
  return m;
}

export function createRotationX(angle: number): Matrix4x4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = Matrix4x4.Identity;
  m.m22 = c;
  m.m23 = s;
  m.m32 = -s;
  m.m33 = c;
  return m;
}

export function createRotationY(angle: number): Matrix4x4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = Matrix4x4.Identity;
  m.m11 = c;
  m.m13 = -s;
  m.m31 = s;
  m.m33 = c;
  return m;
}

export function createRotationZ(angle: number): Matrix4x4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = Matrix4x4.Identity;
  m.m11 = c;
  m.m12 = s;
  m.m21 = -s;
  m.m22 = c;
  return m;
}

export function createLookAt(cameraPosition: Vector3, cameraTarget: Vector3, cameraUpVector: Vector3): Matrix4x4 {
  const zaxis = Vector3.Normalize(Vector3.Subtract(cameraPosition, cameraTarget));
  const xaxis = Vector3.Normalize(Vector3.Cross(cameraUpVector, zaxis));
  const yaxis = Vector3.Cross(zaxis, xaxis);
  return new Matrix4x4(
    xaxis.X, yaxis.X, zaxis.X, 0,
    xaxis.Y, yaxis.Y, zaxis.Y, 0,
    xaxis.Z, yaxis.Z, zaxis.Z, 0,
    -Vector3.Dot(xaxis, cameraPosition), -Vector3.Dot(yaxis, cameraPosition), -Vector3.Dot(zaxis, cameraPosition), 1,
  );
}

/** 4x4 inverse matching System.Numerics.Matrix4x4.Invert; null when singular. */
export function invert4(m: Matrix4x4): Matrix4x4 | null {
  const b00 = m.m11 * m.m22 - m.m12 * m.m21;
  const b01 = m.m11 * m.m23 - m.m13 * m.m21;
  const b02 = m.m11 * m.m24 - m.m14 * m.m21;
  const b03 = m.m12 * m.m23 - m.m13 * m.m22;
  const b04 = m.m12 * m.m24 - m.m14 * m.m22;
  const b05 = m.m13 * m.m24 - m.m14 * m.m23;
  const b06 = m.m31 * m.m42 - m.m32 * m.m41;
  const b07 = m.m31 * m.m43 - m.m33 * m.m41;
  const b08 = m.m31 * m.m44 - m.m34 * m.m41;
  const b09 = m.m32 * m.m43 - m.m33 * m.m42;
  const b10 = m.m32 * m.m44 - m.m34 * m.m42;
  const b11 = m.m33 * m.m44 - m.m34 * m.m43;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1.175494351e-38) return null; // float.Epsilon
  const invDet = 1.0 / det;
  return new Matrix4x4(
    (m.m22 * b11 - m.m23 * b10 + m.m24 * b09) * invDet,
    (-m.m12 * b11 + m.m13 * b10 - m.m14 * b09) * invDet,
    (m.m32 * b05 - m.m33 * b04 + m.m34 * b03) * invDet,
    (-m.m22 * b05 + m.m23 * b04 - m.m24 * b03) * invDet,
    (-m.m21 * b11 + m.m23 * b08 - m.m24 * b07) * invDet,
    (m.m11 * b11 - m.m13 * b08 + m.m14 * b07) * invDet,
    (-m.m31 * b05 + m.m33 * b02 - m.m34 * b01) * invDet,
    (m.m21 * b05 - m.m23 * b02 + m.m24 * b01) * invDet,
    (m.m21 * b10 - m.m22 * b08 + m.m24 * b06) * invDet,
    (-m.m11 * b10 + m.m12 * b08 - m.m14 * b06) * invDet,
    (m.m31 * b04 - m.m32 * b02 + m.m34 * b00) * invDet,
    (-m.m21 * b04 + m.m22 * b02 - m.m24 * b00) * invDet,
    (-m.m21 * b09 + m.m22 * b07 - m.m23 * b06) * invDet,
    (m.m11 * b09 - m.m12 * b07 + m.m13 * b06) * invDet,
    (-m.m31 * b03 + m.m32 * b01 - m.m33 * b00) * invDet,
    (m.m21 * b03 - m.m22 * b01 + m.m23 * b00) * invDet,
  );
}