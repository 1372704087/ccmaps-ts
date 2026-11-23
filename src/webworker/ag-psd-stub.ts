// Browser worker stub: layered PSD export is only wired up in the server/CLI build.
// The worker bundle aliases 'ag-psd' to this module so the PSD writer (and its Node
// Buffers) never end up in the browser renderer.
export function writePsdBuffer(): never {
  throw new Error('PSD export is only available in server/CLI mode');
}
