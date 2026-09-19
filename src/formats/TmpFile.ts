// Port of CNCMaps.FileFormats.TmpFile
import { VirtualFile, SeekOrigin } from './vfs/VirtualFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';
import { logger } from '../shared/Log.js';

enum DataPrecencyFlags {
  ExtraData = 0x01,
  ZData = 0x02,
  DamagedData = 0x04,
}

export class TmpImage {
  X = 0;
  Y = 0;
  private extraDataOffset = 0;
  private zDataOffset = 0;
  private extraZDataOffset = 0;
  ExtraX = 0;
  ExtraY = 0;
  ExtraWidth = 0;
  ExtraHeight = 0;
  Height = 0;
  TerrainType = 0;
  RampType = 0;
  RadarRedLeft = 0;
  RadarGreenLeft = 0;
  RadarBlueLeft = 0;
  RadarRedRight = 0;
  RadarGreenRight = 0;
  RadarBlueRight = 0;
  private dataPrecencyFlags = 0;

  TileData: Uint8Array = new Uint8Array(0);
  ExtraData: Uint8Array | null = null;
  ZData: Uint8Array | null = null;
  ExtraZData: Uint8Array | null = null;

  read(f: TmpFile): void {
    this.X = f.readInt32(); this.Y = f.readInt32();
    this.extraDataOffset = f.readInt32();
    this.zDataOffset = f.readInt32();
    this.extraZDataOffset = f.readInt32();
    this.ExtraX = f.readInt32();
    this.ExtraY = f.readInt32();
    this.ExtraWidth = f.readInt32();
    this.ExtraHeight = f.readInt32();
    this.dataPrecencyFlags = f.readUInt32();
    this.Height = f.readByte();
    this.TerrainType = f.readByte();
    this.RampType = f.readByte();
    this.RadarRedLeft = f.readSByte();
    this.RadarGreenLeft = f.readSByte();
    this.RadarBlueLeft = f.readSByte();
    this.RadarRedRight = f.readSByte();
    this.RadarGreenRight = f.readSByte();
    this.RadarBlueRight = f.readSByte();
    f.read(3); // discard padding

    this.TileData = f.read((f.BlockWidth * f.BlockHeight) / 2);
    if (this.hasZData) this.ZData = f.read((f.BlockWidth * f.BlockHeight) / 2);
    if (this.hasExtraData) this.ExtraData = f.read(Math.abs(this.ExtraWidth * this.ExtraHeight));
    if (this.hasZData && this.hasExtraData && 0 < this.extraZDataOffset && this.extraZDataOffset < f.length)
      this.ExtraZData = f.read(Math.abs(this.ExtraWidth * this.ExtraHeight));
  }

  get hasExtraData(): boolean {
    return (this.dataPrecencyFlags & DataPrecencyFlags.ExtraData) === DataPrecencyFlags.ExtraData;
  }
  get hasZData(): boolean {
    return (this.dataPrecencyFlags & DataPrecencyFlags.ZData) === DataPrecencyFlags.ZData;
  }
  get hasDamagedData(): boolean {
    return (this.dataPrecencyFlags & DataPrecencyFlags.DamagedData) === DataPrecencyFlags.DamagedData;
  }
}

export class TmpFile extends VirtualFile {
  Width = 0;
  Height = 0;
  BlockWidth = 0;
  BlockHeight = 0;
  Images: TmpImage[] = [];
  private isInitialized = false;

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
    if (this.isInitialized) return;
    logger.trace(`Initializing TMP data for file ${this.fileName.split(/[\\/]/).pop()}`);
    this.isInitialized = true;
    this.position = 0;

    this.Width = this.readInt32();
    this.Height = this.readInt32();
    this.BlockWidth = this.readInt32();
    this.BlockHeight = this.readInt32();

    const index = this.read(this.Width * this.Height * 4);
    this.Images = new Array<TmpImage>(this.Width * this.Height);
    for (let x = 0; x < this.Width * this.Height; x++) {
      const imageData = leInt32(index, x * 4);
      this.seek(imageData, SeekOrigin.Begin);
      const img = new TmpImage();
      img.read(this);
      this.Images[x] = img;
    }
  }
}

function leInt32(arr: Uint8Array, offset: number): number {
  return (arr[offset] | (arr[offset + 1] << 8) | (arr[offset + 2] << 16) | (arr[offset + 3] << 24)) | 0;
}

registerFormat(FileFormat.Tmp, (b, f, o, l, c) => new TmpFile(b, f, o, l, c));