// Batch B #12: PreCapture technology buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IniFile } from '../IniFile.js';
import { MapFile } from './MapFile.js';
import { RenderSettings } from '../../shared/RenderSettings.js';

// Seven tags on one map: a plain hand-over, one whose trigger is disabled, one waiting on a
// timer, one waiting on a zero timer (which the game springs at once), one naming a start
// position nobody occupies, one whose second Change House names an occupied slot, and one
// pointing at a trigger that is not there.
const Map = `[Tags]
0100000A=0,plain,01000001
0100000B=0,off,01000002
0100000C=0,timed,01000003
0100000D=0,nodelay,01000004
0100000E=0,empty slot,01000005
0100000F=0,two actions,01000006
01000010=0,dangling,0100BEEF
[Triggers]
01000001=Neutral,<none>,plain,0,1,1,1,0
01000002=Neutral,<none>,off,1,1,1,1,0
01000003=Neutral,<none>,timed,0,1,1,1,0
01000004=Neutral,<none>,nodelay,0,1,1,1,0
01000005=Neutral,<none>,empty slot,0,1,1,1,0
01000006=Neutral,<none>,two actions,0,1,1,1,0
[Events]
01000001=1,8,0,0
01000002=1,8,0,0
01000003=1,13,0,5
01000004=1,13,0,0
01000005=1,8,0,0
01000006=2,61,2,0,GTGCAN,8,0,0
[Actions]
01000001=1,14,0,4475,0,0,0,0,A
01000002=1,14,0,4475,0,0,0,0,A
01000003=1,14,0,4476,0,0,0,0,A
01000004=1,14,0,4476,0,0,0,0,A
01000005=1,14,0,4478,0,0,0,0,A
01000006=3,14,0,4477,0,0,0,0,A,14,0,4478,0,0,0,0,A,21,6,EVA_Tech,0,0,0,0,A
`;

function parse(content: string): IniFile {
  const bytes = new Uint8Array(Buffer.from(content, 'latin1'));
  return new IniFile(bytes, 'test.ini', 0, bytes.length);
}

test('PreCapture: game-start handovers resolve to their start slot', () => {
  // Start positions A, B and C exist; D does not.
  const available = [true, true, true, false, false, false, false, false];
  const slots = MapFile.ResolveTagOwnerSlots(parse(Map), available);

  assert.equal(slots.get('0100000A'), 0); // Any Event
  assert.equal(slots.get('0100000D'), 1); // Elapsed Time 0 springs at once
  assert.equal(slots.get('0100000F'), 2); // last action naming an OCCUPIED slot wins
  assert.equal(slots.has('0100000B'), false); // trigger is disabled
  assert.equal(slots.has('0100000C'), false); // Elapsed Time 5 has not fired
  assert.equal(slots.has('0100000E'), false); // nobody starts at D
  assert.equal(slots.has('01000010'), false); // tag points at a trigger that is not there
});

test('PreCapture: no start positions means no handovers', () => {
  const slots = MapFile.ResolveTagOwnerSlots(parse(Map), new Array(8).fill(false));
  assert.equal(slots.size, 0);
});

test('PreCapture: missing sections are tolerated', () => {
  const slots = MapFile.ResolveTagOwnerSlots(parse('[Basic]\nName=x\n'), new Array(8).fill(false));
  assert.equal(slots.size, 0);
});

test('PreCapture: --precapture parses names, empties and "none"', () => {
  const none = new RenderSettings();
  none.ConfigureFromArgs(['--precapture=none']);
  assert.equal(none.PreCaptureColors, null);

  const custom = new RenderSettings();
  custom.ConfigureFromArgs(['--precapture=Gold,,DarkBlue']);
  assert.deepEqual(custom.PreCaptureColors, ['Gold', null, 'DarkBlue', null, null, null, null, null]);

  const dflt = new RenderSettings();
  dflt.ConfigureFromArgs([]);
  assert.deepEqual(dflt.PreCaptureColors, RenderSettings.DefaultPreCaptureColors);
});