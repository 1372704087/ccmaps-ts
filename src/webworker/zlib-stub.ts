// Placeholder for node:zlib in the browser worker. The browser render path
// encodes images with OffscreenCanvas, so PngWriter is never invoked.
export const constants = {
  Z_NO_FLUSH: 0,
  Z_SYNC_FLUSH: 2,
  Z_FINISH: 4,
};

export function deflateRawSync(): never {
  throw new Error('zlib is not available in the browser worker');
}
