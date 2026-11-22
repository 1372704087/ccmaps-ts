// Installs the Buffer global before any engine module is evaluated.
// Must be the first import in the worker entry.
import { Buffer as NodeBuffer } from 'buffer';

const g = globalThis as any;
if (!g.Buffer) g.Buffer = NodeBuffer;

export {};
