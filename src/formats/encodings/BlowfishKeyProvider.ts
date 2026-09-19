// Port of CNCMaps.FileFormats.Encodings.BlowfishKeyProvider
//
// Derives a Blowfish key from an encrypted MIX archive's 80-byte key block.
// The C# original is a direct translation of the classic OpenRA "predata"
// RSA-style big-number routine using unsafe pointer arithmetic on the low
// (little-endian) 16-bit words of 32-bit digits. We reproduce the exact same
// word-level operations using ushort-indexed accessors so results bit-match.

// The public key encoded as a 64-char base64-ish string.
const pubkeyStr = 'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V';

const char2num = new Int8Array([
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63,
  52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1,
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1,
  -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
]);

function l16(arr: Uint32Array, us: number): number {
  return us & 1 ? (arr[us >> 1]! >>> 16) & 0xffff : arr[us >> 1]! & 0xffff;
}
function w16(arr: Uint32Array, us: number, v: number): void {
  const w = us >> 1;
  if (us & 1) arr[w] = ((arr[w]! & 0xffff) | ((v & 0xffff) << 16)) >>> 0;
  else arr[w] = ((arr[w]! & 0xffff0000) | (v & 0xffff)) >>> 0;
}

export class BlowfishKeyProvider {
  private readonly pubkey = {
    key1: new Uint32Array(64),
    key2: new Uint32Array(64),
    len: 0,
  };

  private readonly glob1 = new Uint32Array(64);
  private glob1Bitlen = 0;
  private glob1LenX2 = 0;
  private readonly glob2 = new Uint32Array(130);
  private readonly glob1hi = new Uint32Array(4);
  private readonly glob1hiInv = new Uint32Array(4);
  private glob1hiBitlen = 0;
  private glob1hiInvLo = 0;
  private glob1hiInvHi = 0;

  private initBignum(n: Uint32Array, val: number, len: number): void {
    n.fill(0, 0, len);
    n[0] = val >>> 0;
  }

  private moveKeyToBig(n: Uint32Array, key: Uint8Array, klen: number, blen: number): void {
    const sign = (key[0]! & 0x80) !== 0 ? 0xff : 0;
    const nb = new Uint8Array(n.buffer, n.byteOffset, n.length * 4);
    let i = blen * 4;
    for (; i > klen; i--) nb[i - 1] = sign;
    for (; i > 0; i--) nb[i - 1] = key[klen - i]!;
    void nb;
    // nb aliases n's buffer (little-endian), writes landed directly.
  }

  private keyToBignum(n: Uint32Array, key: Uint8Array, len: number): void {
    let j = 0;
    if (key[j] !== 2) return;
    j++;
    let keylen: number;
    if ((key[j]! & 0x80) !== 0) {
      keylen = 0;
      for (let i = 0; i < (key[j]! & 0x7f); i++) keylen = (keylen << 8) | key[j + i + 1]!;
      j += (key[j]! & 0x7f) + 1;
    } else {
      keylen = key[j]!;
      j++;
    }
    if (keylen <= len * 4) {
      this.moveKeyToBig(n, key.subarray(j), keylen, len);
    }
  }

  private lenBignum(n: Uint32Array, len: number): number {
    let i = len - 1;
    while (i >= 0 && n[i] === 0) i--;
    return i + 1;
  }

  private bitlenBignum(n: Uint32Array, len: number): number {
    const ddlen = this.lenBignum(n, len);
    if (ddlen === 0) return 0;
    let bitlen = ddlen * 32;
    let mask = 0x80000000;
    while ((mask & n[ddlen - 1]!) === 0) {
      mask >>>= 1;
      bitlen--;
    }
    return bitlen;
  }

  private initPubkey(): void {
    let i = 0;
    let i2 = 0;
    const keytmp = new Uint8Array(256);
    this.initBignum(this.pubkey.key2, 0x10001, 64);
    while (i < pubkeyStr.length) {
      let tmp = char2num[pubkeyStr.charCodeAt(i++)]!;
      tmp = (tmp << 6) | char2num[pubkeyStr.charCodeAt(i++)]!;
      tmp = (tmp << 6) | char2num[pubkeyStr.charCodeAt(i++)]!;
      tmp = (tmp << 6) | char2num[pubkeyStr.charCodeAt(i++)]!;
      keytmp[i2++] = (tmp >> 16) & 0xff;
      keytmp[i2++] = (tmp >> 8) & 0xff;
      keytmp[i2++] = tmp & 0xff;
    }
    this.keyToBignum(this.pubkey.key1, keytmp, 64);
    this.pubkey.len = this.bitlenBignum(this.pubkey.key1, 64) - 1;
  }

  private lenPredata(): number {
    const a = Math.floor((this.pubkey.len - 1) / 8);
    return (Math.floor(55 / a) + 1) * (a + 1);
  }

  private cmpBignum(n1: Uint32Array, n2: Uint32Array, len: number): number {
    while (len > 0) {
      --len;
      if (n1[len]! < n2[len]!) return -1;
      if (n1[len]! > n2[len]!) return 1;
    }
    return 0;
  }

  private movBignum(dest: Uint32Array, src: Uint32Array, len: number): void {
    dest.set(src.subarray(0, len), 0);
  }

  private shrBignum(n: Uint32Array, bits0: number, len: number): void {
    let bits = bits0;
    const i2 = Math.trunc(bits / 32);
    if (i2 > 0) {
      for (let i = 0; i < len - i2; i++) n[i] = n[i + i2]!;
      for (let i = len - i2; i < len; i++) n[i] = 0;
      bits = bits % 32;
    }
    if (bits === 0) return;
    for (let i = 0; i < len - 1; i++) {
      n[i] = ((n[i]! >>> bits) | (n[i + 1]! << (32 - bits))) >>> 0;
    }
    n[len - 1] = n[len - 1]! >>> bits;
  }

  private shlBignum(n: Uint32Array, bits0: number, len: number): void {
    let bits = bits0;
    const i2 = Math.trunc(bits / 32);
    if (i2 > 0) {
      for (let i = len - 1; i > i2; i--) n[i] = n[i - i2]!;
      for (let i = i2; i > 0; i--) n[i] = 0;
      bits = bits % 32;
    }
    if (bits === 0) return;
    for (let i = len - 1; i > 0; i--) {
      n[i] = ((n[i]! << bits) | (n[i - 1]! >>> (32 - bits))) >>> 0;
    }
    n[0] = (n[0]! << bits) >>> 0;
  }

  // dest[destUs..] = src1[src1Us..] - src2[src2Us..], 16-bit words, returns final borrow.
  private subU16(
    dest: Uint32Array,
    src1: Uint32Array,
    src1Us: number,
    src2: Uint32Array,
    src2Us: number,
    nUs: number,
    carry0: number,
  ): number {
    let carry = carry0;
    for (let k = 0; k < nUs; k++) {
      const i1 = l16(src1, src1Us + k);
      const i2 = l16(src2, src2Us + k);
      const sub = i1 - i2 - carry;
      w16(dest, src1Us + k, sub & 0xffff);
      carry = (sub & 0x10000) !== 0 ? 1 : 0;
    }
    return carry;
  }

  private subBignum(dest: Uint32Array, src1: Uint32Array, src2: Uint32Array, carry: number, len: number): number {
    return this.subU16(dest, src1, 0, src2, 0, len * 2, carry);
  }

  private invBignum(n1: Uint32Array, n2: Uint32Array, len: number): void {
    const nTmp = new Uint32Array(64);
    this.initBignum(nTmp, 0, len);
    this.initBignum(n1, 0, len);
    let n2Bitlen = this.bitlenBignum(n2, len);
    let bit = (1 << (n2Bitlen % 32)) >>> 0;
    let j = Math.floor((n2Bitlen + 32) / 32) - 1;
    const n2Bytelen = Math.floor((n2Bitlen - 1) / 32) * 4;
    nTmp[Math.floor(n2Bytelen / 4)] = (nTmp[Math.floor(n2Bytelen / 4)]! | (1 << ((n2Bitlen - 1) & 0x1f))) >>> 0;
    while (n2Bitlen > 0) {
      n2Bitlen--;
      this.shlBignum(nTmp, 1, len);
      if (this.cmpBignum(nTmp, n2, len) !== -1) {
        this.subBignum(nTmp, nTmp, n2, 0, len);
        n1[j] = (n1[j]! | bit) >>> 0;
      }
      bit >>>= 1;
      if (bit === 0) {
        j--;
        bit = 0x80000000;
      }
    }
    this.initBignum(nTmp, 0, len);
  }

  private incBignum(n: Uint32Array, len: number): void {
    let i = 0;
    while (++n[i] === 0 && --len > 0) i++;
  }

  private initTwoDw(n: Uint32Array, len: number): void {
    this.movBignum(this.glob1, n, len);
    this.glob1Bitlen = this.bitlenBignum(this.glob1, len);
    this.glob1LenX2 = Math.floor((this.glob1Bitlen + 15) / 16);
    const ln = this.lenBignum(this.glob1, len);
    this.movBignum(this.glob1hi, this.glob1.subarray(ln - 2, ln), 2);
    this.glob1hiBitlen = this.bitlenBignum(this.glob1hi, 2) - 32;
    this.shrBignum(this.glob1hi, this.glob1hiBitlen, 2);
    this.invBignum(this.glob1hiInv, this.glob1hi, 2);
    this.shrBignum(this.glob1hiInv, 1, 2);
    this.glob1hiBitlen = ((this.glob1hiBitlen + 15) % 16) + 1;
    this.incBignum(this.glob1hiInv, 2);
    if (this.bitlenBignum(this.glob1hiInv, 2) > 32) {
      this.shrBignum(this.glob1hiInv, 1, 2);
      this.glob1hiBitlen--;
    }
    this.glob1hiInvLo = l16(this.glob1hiInv, 0);
    this.glob1hiInvHi = l16(this.glob1hiInv, 1);
  }

  // dest[destUs..] += src1[0..] * mul over n 16-bit words.
  private mulBignumWord(dest: Uint32Array, destUs: number, src1: Uint32Array, mul: number, n: number): void {
    let carry = 0;
    for (let k = 0; k < n; k++) {
      const tmp = mul * l16(src1, k) + l16(dest, destUs + k) + carry;
      w16(dest, destUs + k, tmp & 0xffff);
      carry = Math.floor(tmp / 0x10000) & 0xffff;
    }
    w16(dest, destUs + n, (l16(dest, destUs + n) + carry) & 0xffff);
  }

  private mulBignum(dest: Uint32Array, src1: Uint32Array, src2: Uint32Array, len: number): void {
    this.initBignum(dest, 0, len * 2);
    const digits = len * 2;
    for (let i = 0; i < len * 2; i++) {
      this.mulBignumWord(dest, i, src1, l16(src2, i), digits);
    }
  }

  private notBignum(n: Uint32Array, len: number): void {
    for (let i = 0; i < len; i++) n[i] = (~n[i]!) >>> 0;
  }

  private negBignum(n: Uint32Array, len: number): void {
    this.notBignum(n, len);
    this.incBignum(n, len);
  }

  // n points to a word in glob2; getMulWord(ediUs) treats edi as a ushort index.
  private getMulWord(ediUs: number): number {
    const wn = l16(this.glob2, ediUs);
    const wn1 = l16(this.glob2, ediUs - 1);
    const wn2 = l16(this.glob2, ediUs - 2);
    const ginvl = this.glob1hiInvLo;
    const ginvh = this.glob1hiInvHi;

    const A = (wn1 ^ 0xffff) * ginvl + 0x10000;
    const B = (wn2 ^ 0xffff) * ginvh + ginvh;
    const X = (A >>> 1) + ((B >>> 1) + 1);
    const S = (X >>> 16) + ((wn1 ^ 0xffff) * ginvh >>> 1) + ((wn ^ 0xffff) * ginvl >>> 1) + 1;
    const T = (S >>> 14) + ginvh * (wn ^ 0xffff) * 2;
    const i = T >>> this.glob1hiBitlen;
    return i > 0xffff ? 0xffff : (i & 0xffff);
  }

  private decBignum(n: Uint32Array, len: number): void {
    let i = 0;
    while (--n[i] === 0xffffffff && --len > 0) i++;
  }

  private calcABignum(n1: Uint32Array, n2: Uint32Array, n3: Uint32Array, len: number): void {
    this.mulBignum(this.glob2, n2, n3, len);
    this.glob2[len * 2] = 0;
    const g2LenX2 = this.lenBignum(this.glob2, len * 2 + 1) * 2;
    if (g2LenX2 >= this.glob1LenX2) {
      this.incBignum(this.glob2, len * 2 + 1);
      this.negBignum(this.glob2, len * 2 + 1);
      let lenDiff = g2LenX2 + 1 - this.glob1LenX2;
      let esi = 1 + g2LenX2 - this.glob1LenX2;
      let edi = g2LenX2 + 1;
      for (; lenDiff !== 0; lenDiff--) {
        edi--;
        const tmp = this.getMulWord(edi);
        esi--;
        if (tmp > 0) {
          this.mulBignumWord(this.glob2, esi, this.glob1, tmp, 2 * len);
          if ((l16(this.glob2, edi) & 0x8000) === 0) {
            if (this.subU16(this.glob2, this.glob2, esi, this.glob1, 0, 2 * len, 0) !== 0) {
              w16(this.glob2, edi, (l16(this.glob2, edi) - 1) & 0xffff);
            }
          }
        }
      }
      this.negBignum(this.glob2, len);
      this.decBignum(this.glob2, len);
    }
    this.movBignum(n1, this.glob2, len);
  }

  private clearTmpVars(len: number): void {
    this.initBignum(this.glob1, 0, len);
    this.initBignum(this.glob2, 0, len);
    this.initBignum(this.glob1hiInv, 0, 4);
    this.initBignum(this.glob1hi, 0, 4);
    this.glob1Bitlen = 0;
    this.glob1hiBitlen = 0;
    this.glob1LenX2 = 0;
    this.glob1hiInvLo = 0;
    this.glob1hiInvHi = 0;
  }

  private calcAKey(n1: Uint32Array, n2: Uint32Array, n3: Uint32Array, n4: Uint32Array, len: number): void {
    const nTmp = new Uint32Array(64);
    this.initBignum(n1, 1, len);
    const n4Len = this.lenBignum(n4, len);
    this.initTwoDw(n4, n4Len);
    let n3Bitlen = this.bitlenBignum(n3, n4Len);
    const n3Len = Math.floor((n3Bitlen + 31) / 32);
    let bitMask = ((1 << ((n3Bitlen - 1) % 32)) >>> 0) >>> 1;
    let pn3 = n3Len - 1;
    n3Bitlen--;
    this.movBignum(n1, n2, n4Len);
    while (--n3Bitlen !== -1) {
      if (bitMask === 0) {
        bitMask = 0x80000000;
        pn3--;
      }
      this.calcABignum(nTmp, n1, n1, n4Len);
      if ((n3[pn3]! & bitMask) !== 0) this.calcABignum(n1, nTmp, n2, n4Len);
      else this.movBignum(n1, nTmp, n4Len);
      bitMask >>>= 1;
    }
    this.initBignum(nTmp, 0, n4Len);
    this.clearTmpVars(len);
  }

  private processPredata(pre: Uint8Array, preLen: number, buf: Uint8Array): void {
    const n2 = new Uint32Array(64);
    const n3 = new Uint32Array(64);
    const a = Math.floor((this.pubkey.len - 1) / 8);
    let preOffset = 0;
    let bufOffset = 0;
    while (a + 1 <= preLen) {
      this.initBignum(n2, 0, 64);
      // memcpy((byte*)n2, pre, a+1) — aliases n2's little-endian byte layout
      new Uint8Array(n2.buffer).set(pre.subarray(preOffset, preOffset + a + 1));
      this.calcAKey(n3, n2, this.pubkey.key2, this.pubkey.key1, 64);
      buf.set(new Uint8Array(n3.buffer).subarray(0, a), bufOffset);
      preLen -= a + 1;
      preOffset += a + 1;
      bufOffset += a;
    }
  }

  decryptKey(src: Uint8Array): Uint8Array {
    this.initPubkey();
    const dest = new Uint8Array(256);
    this.processPredata(src, this.lenPredata(), dest);
    return dest.subarray(0, 56);
  }
}