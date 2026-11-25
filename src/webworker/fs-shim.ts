// Minimal in-memory file system used by the browser render worker.
// Directories and files are mounted from user-selected File objects (read
// synchronously with FileReaderSync) or from Uint8Array buffers (tests).
import { Buffer } from 'buffer';

interface DirEntry {
  kind: 'dir';
  name: string;
}

interface FileEntry {
  kind: 'file';
  name: string;
  size: number;
  blob?: Blob;
  data?: Uint8Array;
}

type Entry = DirEntry | FileEntry;

const entries = new Map<string, Entry>();

function normalizePath(p: string): string {
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

function keyOf(p: string): string {
  return normalizePath(p).toLowerCase();
}

function ensureDir(p: string): void {
  const normalized = normalizePath(p);
  if (normalized === '/') {
    if (!entries.has('/')) entries.set('/', { kind: 'dir', name: '' });
    return;
  }
  const key = normalized.toLowerCase();
  if (entries.has(key)) return;
  const parent = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
  ensureDir(parent);
  entries.set(key, { kind: 'dir', name: normalized.slice(normalized.lastIndexOf('/') + 1) });
}

function find(p: string): Entry | null {
  return entries.get(keyOf(p)) ?? null;
}

function siblingKeys(dir: string): string[] {
  const prefix = dir === '/' ? '/' : dir + '/';
  const out: string[] = [];
  for (const [key, entry] of entries) {
    if (key === keyOf(dir)) continue;
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue;
    out.push(entry.name);
  }
  return out;
}

const openFiles = new Map<number, { path: string; chunks: Uint8Array[]; writable: boolean }>();
let nextFd = 3;

function toBytes(data: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof data === 'string') return new Uint8Array(Buffer.from(data, 'utf8'));
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data);
}

function readBlob(blob: Blob): Uint8Array {
  const Reader = (globalThis as any).FileReaderSync;
  if (typeof Reader !== 'function') throw new Error('FileReaderSync is not available');
  return new Uint8Array(new Reader().readAsArrayBuffer(blob));
}

export function mountFile(p: string, source: Blob | Uint8Array | ArrayBuffer): void {
  const normalized = normalizePath(p);
  ensureDir(normalized.slice(0, normalized.lastIndexOf('/')) || '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (source instanceof Blob) {
    entries.set(normalized.toLowerCase(), { kind: 'file', name, size: source.size, blob: source });
  } else {
    const data = toBytes(source);
    entries.set(normalized.toLowerCase(), { kind: 'file', name, size: data.length, data });
  }
}

export function reset(): void {
  entries.clear();
  openFiles.clear();
  nextFd = 3;
  ensureDir('/');
}

export function existsSync(p: string): boolean {
  return entries.has(keyOf(p));
}

export function statSync(p: string): any {
  const entry = find(p);
  if (!entry) {
    const err: any = new Error(`ENOENT: no such file or directory, stat '${p}'`);
    err.code = 'ENOENT';
    throw err;
  }
  return {
    isDirectory: () => entry.kind === 'dir',
    isFile: () => entry.kind === 'file',
    size: entry.kind === 'file' ? entry.size : 0,
    mtimeMs: 0,
  };
}

export function readdirSync(p: string): string[] {
  const entry = find(p);
  if (!entry || entry.kind !== 'dir') {
    const err: any = new Error(`ENOENT: no such file or directory, scandir '${p}'`);
    err.code = 'ENOENT';
    throw err;
  }
  return siblingKeys(normalizePath(p)).sort();
}

export function readFileSync(p: string): Buffer {
  const entry = find(p);
  if (!entry) {
    const err: any = new Error(`ENOENT: no such file or directory, open '${p}'`);
    err.code = 'ENOENT';
    throw err;
  }
  if (entry.kind !== 'file') {
    const err: any = new Error(`EISDIR: illegal operation on a directory, read '${p}'`);
    err.code = 'EISDIR';
    throw err;
  }
  // Do not cache blob data: the render engine keeps its own buffers for the
  // duration of a render, and retaining another copy would pin the whole game
  // install in worker memory between renders.
  const data = entry.data ?? readBlob(entry.blob as Blob);
  return Buffer.from(data.buffer, data.byteOffset, data.length);
}

export function mkdirSync(p: string): void {
  ensureDir(p);
}

export function writeFileSync(p: string, data: Uint8Array | ArrayBuffer | string): void {
  mountFile(p, toBytes(data));
}

export function openSync(p: string, flags = 'w'): number {
  ensureDir(normalizePath(p).slice(0, normalizePath(p).lastIndexOf('/')) || '/');
  const fd = nextFd++;
  openFiles.set(fd, {
    path: normalizePath(p),
    chunks: [],
    // the render engine opens mixes with 'r'; PNG writers open with 'w'
    writable: !String(flags).includes('r'),
  });
  return fd;
}

export function fstatSync(fd: number): any {
  const file = openFiles.get(fd);
  if (!file) throw new Error(`EBADF: bad file descriptor ${fd}`);
  return statSync(file.path);
}

export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number | null = null,
): number {
  const file = openFiles.get(fd);
  if (!file) throw new Error(`EBADF: bad file descriptor ${fd}`);
  const entry = find(file.path);
  if (!entry || entry.kind !== 'file') throw new Error(`ENOENT: no such file '${file.path}'`);
  const start = Math.max(0, position ?? 0);
  if (start >= entry.size) return 0;
  const want = Math.min(length, entry.size - start);
  if (entry.data != null) {
    const n = Math.min(want, entry.data.length - start);
    if (n <= 0) return 0;
    buffer.set(entry.data.subarray(start, start + n), offset);
    return n;
  }
  const Reader = (globalThis as any).FileReaderSync;
  if (typeof Reader !== 'function') throw new Error('FileReaderSync is not available');
  const slice = entry.blob!.slice(start, start + want);
  const bytes = new Uint8Array(new Reader().readAsArrayBuffer(slice));
  buffer.set(bytes, offset);
  return bytes.length;
}

export function writeSync(fd: number, data: Uint8Array | ArrayBuffer | string): number {
  const file = openFiles.get(fd);
  if (!file) throw new Error(`EBADF: bad file descriptor ${fd}`);
  const bytes = toBytes(data);
  file.chunks.push(bytes);
  return bytes.length;
}

export function closeSync(fd: number): void {
  const file = openFiles.get(fd);
  if (!file) return;
  openFiles.delete(fd);
  if (!file.writable) return;
  const total = file.chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of file.chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  mountFile(file.path, merged);
}

reset();
