// Port of CNCMaps.FileFormats.HvaFile
import { VirtualFile, SeekOrigin } from './vfs/VirtualFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';
import { logger } from '../shared/Log.js';

export class HvaSection {
  Name = '';
  Matrices: number[][] = [];
  constructor(numMatrices: number) {
    void numMatrices;
  }
}

// 4x4 column-major matrix (16 floats in a flat array), matching System.Numerics.Matrix4x4.
export class Matrix4x4 {
  m11 = 0; m12 = 0; m13 = 0; m14 = 0;
  m21 = 0; m22 = 0; m23 = 0; m24 = 0;
  m31 = 0; m32 = 0; m33 = 0; m34 = 0;
  m41 = 0; m42 = 0; m43 = 0; m44 = 0;

  static get Identity(): Matrix4x4 {
    return new Matrix4x4(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
  }

  constructor();
  constructor(m11: number, m12: number, m13: number, m14: number,
    m21: number, m22: number, m23: number, m24: number,
    m31: number, m32: number, m33: number, m34: number,
    m41: number, m42: number, m43: number, m44: number);
  constructor(
    m11 = 0, m12 = 0, m13 = 0, m14 = 0,
    m21 = 0, m22 = 0, m23 = 0, m24 = 0,
    m31 = 0, m32 = 0, m33 = 0, m34 = 0,
    m41 = 0, m42 = 0, m43 = 0, m44 = 0,
  ) {
    this.m11 = m11; this.m12 = m12; this.m13 = m13; this.m14 = m14;
    this.m21 = m21; this.m22 = m22; this.m23 = m23; this.m24 = m24;
    this.m31 = m31; this.m32 = m32; this.m33 = m33; this.m34 = m34;
    this.m41 = m41; this.m42 = m42; this.m43 = m43; this.m44 = m44;
  }
}

export class HvaFile extends VirtualFile {
  NumFrames = 0;
  Sections: HvaSection[] = [];
  private initialized = false;

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    fileSize = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, fileSize < 0 ? baseStream.length : fileSize, isBuffered);
  }

  Initialize(): void {
    if (this.initialized) return;
    logger.debug(`Loading HVA file ${this.fileName.split(/[\\/]/).pop()}`);
    this.seek(0, SeekOrigin.Begin);
    this.readCString(16); // filename
    this.NumFrames = this.readInt32();
    const numSections = this.readInt32();
    this.Sections = new Array<HvaSection>(numSections);

    for (let i = 0; i < numSections; i++) {
      const s = new HvaSection(this.NumFrames);
      s.Name = this.readCString(16);
      this.Sections[i] = s;
    }

    for (let frame = 0; frame < this.NumFrames; frame++)
      for (let section = 0; section < this.Sections.length; section++)
        this.Sections[section].Matrices.push(this.readMatrix());

    logger.trace(`Loaded HVA file ${this.fileName.split(/[\\/]/).pop()} with ${this.Sections.length} sections`);
    this.initialized = true;
  }

  private readMatrix(): number[] {
    const ret = new Array<number>(12);
    for (let i = 0; i < 12; i++) ret[i] = this.readFloat();
    return ret;
  }

  loadGLMatrix(section: string | number, frame = 0): Matrix4x4 {
    if (typeof section === 'number') {
      this.Initialize();
      return HvaFile.ToGLMatrix(this.Sections[section].Matrices[frame]);
    }
    const idx = this.Sections.findIndex((s) => s.Name === section);
    return HvaFile.ToGLMatrix(this.Sections[idx].Matrices[frame]);
  }

  // matrix identity, matching System.Numerics.Matrix4x4 semantics.
  static ToGLMatrix(hvaMatrix: number[]): Matrix4x4 {
    return new Matrix4x4(
      hvaMatrix[0], hvaMatrix[4], hvaMatrix[8], 0,
      hvaMatrix[1], hvaMatrix[5], hvaMatrix[9], 0,
      hvaMatrix[2], hvaMatrix[6], hvaMatrix[10], 0,
      hvaMatrix[3], hvaMatrix[7], hvaMatrix[11], 1,
    );
  }
}

registerFormat(FileFormat.Hva, (b, f, o, l, c) => new HvaFile(b, f, o, l, c));