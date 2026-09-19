// Port of Format2 (simple RLE-zero compression).
export class Format2 {
  static DecodeInto(src: Uint8Array, dest: Uint8Array): number {
    let i = 0;
    let s = 0;
    const srcLen = src.length;
    while (s < srcLen) {
      const cmd = src[s++];
      if (cmd === 0) {
        let count = src[s] & 0xff;
        // NOTE: in the C# version the count byte is read but position is NOT advanced
        // inside the loop for the zero case in the pointer variant; the array variant
        // uses ReadUInt8 which DOES advance. We mirror the array variant here.
        s++;
        while (count-- > 0) dest[i++] = 0;
      } else {
        dest[i++] = cmd;
      }
    }
    return i;
  }
}