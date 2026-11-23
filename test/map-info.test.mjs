import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/web/static/map-info.js'), 'utf8');

function api() {
  const context = { window: {}, TextDecoder, Blob };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CncmapsMapInfo;
}

function mapFile(sizeLine) {
  return new Blob([
    '[Basic]\nName=Size Test\nAuthor=Review\nMaxPlayers=4\n' +
    '[Map]\n' + sizeLine + '\nLocalSize=0,0,70,50\nTheater=Temperate\n',
  ]);
}

test('map-info reads [Map] Size as left,top,width,height', async () => {
  const info = await api().read(mapFile('Size=0,0,70,50'));
  assert.equal(info.width, 70);
  assert.equal(info.height, 50);
  assert.equal(info.players, 4);
});

test('map-info falls back to width,height for legacy maps', async () => {
  const info = await api().read(mapFile('Size=70,50'));
  assert.equal(info.width, 70);
  assert.equal(info.height, 50);
});
