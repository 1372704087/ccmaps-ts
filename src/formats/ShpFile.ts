// Port of CNCMaps.FileFormats.ShpFile
import { VirtualFile, SeekOrigin } from './vfs/VirtualFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';
import { Format3 } from './encodings/Format3.js';
import { logger } from '../shared/Log.js';

export class ShpImage {
  private f: ShpFile | null = null;
  private frameIndex = 0;

  X = 0;
  Y = 0;
  Width = 0;
  Height = 0;
  CompressionType = 0;
  Unknown1 = 0;
  Unknown2 = 0;
  Unknown3 = 0;
  ImgDataOffset = 0;
  private decompressedImage: Uint8Array | null = null;

  read(f: ShpFile, frameIndex: number): void {
    this.f = f;
    this.frameIndex = frameIndex;
    this.X = f.readInt16();
    this.Y = f.readInt16();
    this.Width = f.readInt16();
    this.Height = f.readInt16();
    this.CompressionType = f.readByte();
    this.Unknown1 = f.readByte();
    this.Unknown2 = f.readByte();
    this.Unknown3 = f.readByte();
    f.readInt32(); // Unknown4
    f.readInt32(); // Zero
    this.ImgDataOffset = f.readInt32();
  }

  getImageData(): Uint8Array | null {
    if (this.decompressedImage == null) {
      if (this.f == null) return null;
      this.f.seek(this.ImgDataOffset, SeekOrigin.Begin);
      const c_px = this.Width * this.Height;

      if (this.CompressionType <= 1) {
        this.decompressedImage = this.f.read(c_px);
      } else if (this.CompressionType === 2) {
        this.decompressedImage = new Uint8Array(c_px);
        let lineOffset = 0;
        for (let y = 0; y < this.Height; y++) {
          const scanlineLength = this.f.readUInt16() - 2;
          const data = this.f.read(scanlineLength);
          this.decompressedImage.set(data, lineOffset);
          lineOffset += scanlineLength;
        }
      } else if (this.CompressionType === 3) {
        this.decompressedImage = new Uint8Array(c_px);
        let compressedEnd = this.f.length;
        if (this.frameIndex < this.f.Images.length - 1)
          compressedEnd = this.f.Images[this.frameIndex + 1].ImgDataOffset;
        if (compressedEnd < this.ImgDataOffset) compressedEnd = this.f.length;
        Format3.DecodeInto(this.f.read(compressedEnd - this.ImgDataOffset), this.decompressedImage, this.Width, this.Height);
      } else {
        logger.debug(`SHP image ${this.f.fileName.split(/[\\/]/).pop()} frame ${this.frameIndex} has unknown compression!`);
      }
    }
    return this.decompressedImage;
  }
}

export class ShpFile extends VirtualFile {
  Width = 0;
  Height = 0;
  NumImages = 0;
  Images: ShpImage[] = [];
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
    logger.trace(`Initializing SHP data for file ${this.fileName.split(/[\\/]/).pop()}`);
    this.readInt16(); // Zero
    this.Width = this.readInt16();
    this.Height = this.readInt16();
    this.NumImages = this.readInt16();

    this.Images = new Array<ShpImage>(this.NumImages);
    for (let i = 0; i < this.NumImages; i++) {
      const img = new ShpImage();
      img.read(this, i);
      this.Images[i] = img;
    }
    this.isInitialized = true;
  }

  getImage(imageIndex: number): ShpImage {
    if (!Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex >= this.Images.length)
      return new ShpImage();
    return this.Images[imageIndex] ?? new ShpImage();
  }
}

registerFormat(FileFormat.Shp, (b, f, o, l, c) => new ShpFile(b, f, o, l, c));