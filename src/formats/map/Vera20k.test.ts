// VERA20k extended maps: width+height > 512 selects the 1024 cell grid, overlay
// packs use the same stride, and [Basic] MaxPlayers admits up to 30 starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapFile } from './MapFile.js';
import { Format5 } from '../encodings/Format5.js';

function packSection(name: string, bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 74) {
    lines.push(`${lines.length + 1}=${b64.slice(i, i + 74)}`);
  }
  return `[${name}]\n${lines.join('\n')}\n`;
}

function cellRecord(rx: number, ry: number): Uint8Array {
  const b = Buffer.alloc(11);
  b.writeUInt16LE(rx, 0);
  b.writeUInt16LE(ry, 2);
  b.writeInt32LE(0, 4);
  return b;
}

function waypointLines(count: number, missing = -1): string {
  return Array.from({ length: count }, (_, i) => i)
    .filter((i) => i !== missing)
    .map((i) => `${i}=${100100 + i}`)
    .join('\n');
}

function extendedMapText(): string {
  const side = 1024;
  const overlays = new Uint8Array(side * side).fill(0xff);
  const overlayData = new Uint8Array(side * side);
  const index = 517 * side + 952;
  overlays[index] = 5;
  overlayData[index] = 3;
  return [
    '[Basic]',
    'MultiplayerOnly=1',
    'MaxPlayers=30',
    '',
    '[Map]',
    'Size=0,0,500,500',
    'LocalSize=2,5,496,489',
    '',
    '[Waypoints]',
    waypointLines(30),
    '',
    packSection('IsoMapPack5', Format5.Encode(cellRecord(952, 517), 5)),
    packSection('OverlayPack', Format5.Encode(overlays, 80)),
    packSection('OverlayDataPack', Format5.Encode(overlayData, 80)),
  ].join('\n');
}

test('VERA20k: width+height > 512 uses the 1024 grid and keeps high-rx cells', () => {
  const map = new MapFile(Buffer.from(extendedMapText(), 'latin1'), 'extended.map');
  assert.equal(map.GridSide, 1024);
  assert.equal(map.FullSize.Width, 500);
  assert.equal(map.FullSize.Height, 500);

  const tile = map.Tiles.getTileR(952, 517);
  assert.notEqual(tile, null, 'a cell above rx/ry 511 must survive parsing');
  assert.equal(tile!.Rx, 952);
  assert.equal(tile!.Ry, 517);

  assert.equal(map.Overlays.length, 1);
  assert.equal(map.Overlays[0].Tile!.Rx, 952);
  assert.equal(map.Overlays[0].Tile!.Ry, 517);
  assert.equal(map.Overlays[0].OverlayID, 5);
  assert.equal(map.Overlays[0].OverlayValue, 3);
});

test('VERA20k: MaxPlayers=30 needs a complete 0..29 waypoint run', () => {
  const complete = new MapFile(Buffer.from(extendedMapText(), 'latin1'), 'extended.map');
  assert.equal(complete.StartCapacity, 30);
  assert.equal(complete.Waypoints.length, 30);

  const incompleteText = extendedMapText().replace('29=100129\n', '');
  const incomplete = new MapFile(Buffer.from(incompleteText, 'latin1'), 'incomplete.map');
  assert.equal(incomplete.StartCapacity, 8, 'an incomplete run falls back to retail starts');
});

test('retail maps keep the 512 grid and eight-start ceiling', () => {
  const text = [
    '[Basic]',
    'MultiplayerOnly=1',
    'MaxPlayers=8',
    '',
    '[Map]',
    'Size=0,0,100,100',
    'LocalSize=2,5,96,89',
    '',
    '[Waypoints]',
    waypointLines(8),
  ].join('\n');
  const map = new MapFile(Buffer.from(text, 'latin1'), 'retail.map');
  assert.equal(map.GridSide, 512);
  assert.equal(map.StartCapacity, 8);
});
