// Small POSIX-like path implementation for the browser render worker.
// Only the operations used by the renderer are provided.
export const sep = '/';

export function normalize(p: string): string {
  const s = String(p ?? '').replace(/\\/g, '/');
  const parts: string[] = [];
  for (const part of s.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return '/' + parts.join('/');
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== '' && p != null).join('/'));
}

export function resolve(...parts: string[]): string {
  if (parts.length === 0) return '/';
  return normalize(parts.filter((p) => p !== '' && p != null).join('/'));
}

export function dirname(p: string): string {
  const s = String(p ?? '').replace(/\\/g, '/');
  if (s === '/') return '/';
  const trimmed = s.replace(/\/+$/, '');
  if (trimmed === '') return '.';
  const idx = trimmed.lastIndexOf('/');
  if (idx === -1) return '.';
  return idx === 0 ? '/' : trimmed.slice(0, idx);
}

export function basename(p: string, ext?: string): string {
  const s = normalize(p);
  let name = s === '/' ? '' : s.slice(s.lastIndexOf('/') + 1);
  if (ext && name.endsWith(ext)) name = name.slice(0, name.length - ext.length);
  return name;
}

export function extname(p: string): string {
  const name = basename(p);
  const idx = name.lastIndexOf('.');
  return idx <= 0 ? '' : name.slice(idx);
}
