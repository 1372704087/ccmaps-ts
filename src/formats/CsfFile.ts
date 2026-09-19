// Port of CNCMaps.FileFormats.CsfFile (based on XCCU project)
import { VirtualFile } from './vfs/VirtualFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';
import { logger } from '../shared/Log.js';

// little-endian integer spellings of the tag strings OR'd through Reverse()
const CSF_FILE_ID = readLeInt('CSF ');
const CSF_LABEL_ID = readLeInt('LBL ');
const CSF_STRING_ID = readLeInt('STR ');
const CSF_STRING_W_ID = readLeInt('STRW');

function readLeInt(s: string): number {
  let v = 0;
  for (let i = 0; i < s.length; i++) v = (v << 8) | s.charCodeAt(i);
  return v | 0;
}

class CsfEntry {
  Value: string;
  ExtraValue: string;
  constructor(value: string, extraValue: string) {
    this.Value = value;
    this.ExtraValue = extraValue;
  }
}

export class CsfFile extends VirtualFile {
  Id = 0;
  Flags1 = 0;
  NumLabels = 0;
  NumExtraValues = 0;
  Zero = 0;
  Language = 0;
  private labelMap = new Map<string, CsfEntry>();

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    fileSize = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, fileSize < 0 ? baseStream.length : fileSize, isBuffered);
    this.Parse();
  }

  private Parse(): void {
    logger.info(`Parsing ${this.fileName.split(/[\\/]/).pop()}`);
    this.Id = this.readInt32();
    this.Flags1 = this.readInt32();
    this.NumLabels = this.readInt32();
    this.NumExtraValues = this.readInt32();
    this.Zero = this.readInt32();
    this.Language = this.readInt32();

    for (let i = 0; i < this.NumLabels; i++) {
      this.readInt32(); // label id
      const flags = this.readInt32();
      const name = this.readString();
      if ((flags & 1) !== 0) {
        const has_extra_value = this.readInt32() === CSF_STRING_W_ID;
        const value = this.readWstring();
        let extraValue = '';
        if (has_extra_value) extraValue = this.readString();
        this.setValue(name, value, extraValue);
      } else {
        this.setValue(name, '', '');
      }
    }
    logger.debug(`Loaded ${this.labelMap.size} csf entries`);
  }

  private setValue(name: string, value: string, extraValue: string): void {
    this.labelMap.set(name.toLowerCase(), new CsfEntry(value, extraValue));
  }

  getValue(name: string): string {
    const entry = this.labelMap.get(name.toLowerCase());
    return entry ? entry.Value : '';
  }

  private convertToString(s: string): string {
    let r = '';
    for (let i = 0; i < s.length; i++) r += String.fromCharCode(~(s.charCodeAt(i) & 0xffff) & 0xffff);
    return r;
  }

  private readString(): string {
    const len = this.readInt32();
    const arr = this.read(len);
    let out = '';
    for (let i = 0; i < len; i++) out += String.fromCharCode(arr[i]);
    return out;
  }

  private readWstring(): string {
    const len = this.readInt32();
    const arr = this.read(len * 2);
    let out = '';
    for (let i = 0; i < len; i++) out += String.fromCharCode(arr[i * 2] | (arr[i * 2 + 1] << 8));
    return this.convertToString(out);
  }
}

void CSF_LABEL_ID;
void CSF_STRING_ID;

registerFormat(FileFormat.Csf, (b, f, o, l, c) => new CsfFile(b, f, o, l, c));