import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vfs from './fs-shim.js';

test('mounts files case-insensitively and reads bytes', () => {
  vfs.reset();
  vfs.mountFile('/game/RA2MD.MIX', new Uint8Array([1, 2, 3]));
  assert.equal(vfs.existsSync('/game/ra2md.mix'), true);
  assert.deepEqual(Array.from(vfs.readFileSync('/game/ra2md.mix')), [1, 2, 3]);
  assert.equal(vfs.statSync('/game').isDirectory(), true);
  assert.equal(vfs.statSync('/game/RA2MD.MIX').size, 3);
});

test('readdir lists only direct children', () => {
  vfs.reset();
  vfs.mountFile('/game/a.mix', new Uint8Array([1]));
  vfs.mountFile('/game/sub/b.ini', new Uint8Array([2]));
  assert.deepEqual(vfs.readdirSync('/game').sort(), ['a.mix', 'sub']);
  assert.deepEqual(vfs.readdirSync('/game/sub'), ['b.ini']);
});

test('open/write/close produces a readable file', () => {
  vfs.reset();
  const fd = vfs.openSync('/out/y.bin');
  vfs.writeSync(fd, new Uint8Array([9, 8]));
  vfs.writeSync(fd, new Uint8Array([7]));
  vfs.closeSync(fd);
  assert.deepEqual(Array.from(vfs.readFileSync('/out/y.bin')), [9, 8, 7]);
});

test('missing files throw ENOENT', () => {
  vfs.reset();
  assert.throws(() => vfs.readFileSync('/nope'), /ENOENT/);
  assert.throws(() => vfs.readdirSync('/nope'), /ENOENT/);
});

test('mountFile overwrites existing content', () => {
  vfs.reset();
  vfs.mountFile('/game/x.mix', new Uint8Array([1]));
  vfs.mountFile('/game/x.mix', new Uint8Array([2, 3]));
  assert.deepEqual(Array.from(vfs.readFileSync('/game/x.mix')), [2, 3]);
});
