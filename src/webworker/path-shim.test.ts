import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodePath from 'node:path';
import * as shim from './path-shim.js';

test('join matches posix semantics for engine paths', () => {
  assert.equal(shim.join('/game', 'ra2md.mix'), nodePath.posix.join('/game', 'ra2md.mix'));
  assert.equal(shim.join('/maps', 'a.map'), nodePath.posix.join('/maps', 'a.map'));
  assert.equal(shim.join('/game', 'sub', 'x.ini'), '/game/sub/x.ini');
  assert.equal(shim.join('', '/game'), '/game');
});

test('basename/dirname/extname match posix semantics', () => {
  const samples = ['/game/ra2md.mix', '/game/sub/x.ini', '/a', '/x.map', 'plain.mix'];
  for (const p of samples) {
    assert.equal(shim.basename(p), nodePath.posix.basename(p), `basename ${p}`);
    assert.equal(shim.dirname(p), nodePath.posix.dirname(p), `dirname ${p}`);
    assert.equal(shim.extname(p), nodePath.posix.extname(p), `extname ${p}`);
  }
  assert.equal(shim.basename('/game/x.map', '.map'), 'x');
});

test('resolve normalizes to an absolute path', () => {
  assert.equal(shim.resolve('/game'), '/game');
  assert.equal(shim.resolve('/game/../maps'), '/maps');
  assert.equal(shim.resolve(''), '/');
});
