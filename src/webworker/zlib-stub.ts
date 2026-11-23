// Placeholder for node:zlib in the browser worker. The browser render path
// encodes images with OffscreenCanvas, so PngWriter is never invoked.
export const constants = {
  Z_NO_FLUSH: 0,
  Z_SYNC_FLUSH: 2,
  Z_FINISH: 4,
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Matches Node's zlib.crc32(data, previous) chaining for the PNG writer. The
 * browser path encodes with OffscreenCanvas, but PngWriter is still reachable
 * through the shared module graph and must not pull node:zlib into the bundle. */
export function crc32(data: Uint8Array, value = 0): number {
  let crc = ((value >>> 0) ^ 0xffffffff) >>> 0;
  for (const b of data) crc = (crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

export function deflateRawSync(): never {
  throw new Error('zlib is not available in the browser worker');
}
