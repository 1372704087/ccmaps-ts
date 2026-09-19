// Port of CNCMaps.FileFormats.Map.MapFile
import { IniFile, IniSection } from '../IniFile.js';
import { registerFormat } from '../FormatHelper.js';
import { FileFormat } from '../FileFormat.js';
import { Format5 } from '../encodings/Format5.js';
import { logger } from '../../shared/Log.js';
import { Rectangle } from '../../shared/Geometry.js';
import { Lighting } from './Lighting.js';
import { TileLayer } from './TileLayer.js';
import {
  IsoTile,
  Overlay,
  Smudge,
  Terrain,
  Structure,
  Infantry,
  Unit,
  Aircraft,
  Waypoint,
  TunnelLine,
} from './MapObjects.js';

/// <summary>Map file.</summary>
export class MapFile extends IniFile {
  FullSize = Rectangle.Empty;
  LocalSize = Rectangle.Empty;

  Tiles!: TileLayer;
  Overlays: Overlay[] = [];
  Smudges: Smudge[] = [];
  Terrains: Terrain[] = [];
  Structures: Structure[] = [];
  Infantries: Infantry[] = [];
  Units: Unit[] = [];
  Aircrafts: Aircraft[] = [];
  Waypoints: Waypoint[] = [];
  MiscSections: IniSection[] = [];
  TunnelEntries: TunnelLine[] = [];
  Lighting = new Lighting();

  /// <summary>Constructor.</summary>
  constructor(baseStream: Uint8Array, fileName = '', baseOffset = 0, length = -1, isBuffered = true) {
    super(baseStream, fileName, baseOffset, length, isBuffered);
    this.Initialize();
  }

  Initialize(): void {
    const map = this.getSection('Map');
    if (map == null)
      throw new Error(
        'Map file has no [Map] section. If it uses [INISystem]BasedOn inheritance, ' +
          'the base map file must be present next to it.',
      );
    let size = map.readString('Size').split(',');
    this.FullSize = new Rectangle(
      parseInt(size[0], 10),
      parseInt(size[1], 10),
      parseInt(size[2], 10),
      parseInt(size[3], 10),
    );
    this.Tiles = new TileLayer(this.FullSize.Width, this.FullSize.Height);
    size = map.readString('LocalSize').split(',');
    this.LocalSize = new Rectangle(
      parseInt(size[0], 10),
      parseInt(size[1], 10),
      parseInt(size[2], 10),
      parseInt(size[3], 10),
    );

    logger.info('Reading map');
    logger.debug('Reading tiles');
    this.readTiles();

    logger.debug('Reading map overlay');
    this.readOverlay();

    logger.debug('Reading map terrain objects');
    this.readTerrain();

    logger.debug('Reading map smudge objects');
    this.readSmudges();

    logger.debug('Reading infantry on map');
    this.readInfantry();

    logger.debug('Reading vehicles on map');
    this.readUnits();

    logger.debug('Reading aircraft on map');
    this.readAircraft();

    logger.debug('Reading map structures');
    this.readStructures();

    logger.debug('Waypoints');
    this.readWaypoints();

    logger.debug('Reading tunnels');
    this.readTubes();

    this.Lighting = new Lighting(this.getOrCreateSection('Lighting'));
  }

  /// <summary>Reads the tiles.</summary>
  private readTiles(): void {
    const mapSection = this.getSection('IsoMapPack5');
    if (mapSection == null) {
      logger.warn('IsoMapPack5 section unavailable, tiles will be empty');
      return;
    }
    const lzoData = Buffer.from(mapSection.concatenatedValues(), 'base64');
    const cells = (this.FullSize.Width * 2 - 1) * this.FullSize.Height;
    const lzoPackSize = cells * 11 + 4; // last 4 bytes contains a lzo pack header saying no more data is left

    const isoMapPack = new Uint8Array(lzoPackSize);

    // In case IsoMapPack5 contains less entries than the number of cells, fill up any number greater
    // than 511 and filter later.
    let j = 0;
    for (let i = 0; i < cells; i++) {
      isoMapPack[j] = 0x88;
      isoMapPack[j + 1] = 0x40;
      isoMapPack[j + 2] = 0x88;
      isoMapPack[j + 3] = 0x40;
      j += 11;
    }

    Format5.DecodeInto(lzoData, isoMapPack);

    // Fill level 0 clear tiles for all array values
    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = 0; x <= this.FullSize.Width * 2 - 2; x++) {
        const dx = x;
        const dy = y * 2 + (x % 2);
        const rx = Math.trunc((dx + dy) / 2) + 1;
        const ry = dy - rx + this.FullSize.Width + 1;
        this.Tiles.set(x, y, new IsoTile(dx, dy, rx, ry, 0, 0, 0, 0));
      }
    }

    // Overwrite with actual entries found in IsoMapPack5
    const r = { pos: 0 };
    const buf = isoMapPack;
    const readUInt16 = () => {
      const v = (buf[r.pos] | (buf[r.pos + 1] << 8)) & 0xffff;
      r.pos += 2;
      return v;
    };
    const readInt32 = () => {
      const v =
        (buf[r.pos] | (buf[r.pos + 1] << 8) | (buf[r.pos + 2] << 16) | (buf[r.pos + 3] << 24)) | 0;
      r.pos += 4;
      return v;
    };
    let numtiles = 0;
    for (let i = 0; i < cells; i++) {
      const rx = readUInt16();
      const ry = readUInt16();
      let tilenum = readInt32();
      const subtile = buf[r.pos++];
      const z = buf[r.pos++];
      const icegrowth = buf[r.pos++];

      if (tilenum >= 65535) tilenum = 0; // Tile 0xFFFF used as empty/clear

      if (rx <= 511 && ry <= 511) {
        const dx = rx - ry + this.FullSize.Width - 1;
        const dy = rx + ry - this.FullSize.Width - 1;
        numtiles++;
        if (dx >= 0 && dx < 2 * this.Tiles.Width && dy >= 0 && dy < 2 * this.Tiles.Height) {
          const tile = new IsoTile(dx, dy, rx, ry, z, tilenum, subtile, icegrowth);
          this.Tiles.set(dx, Math.trunc(dy / 2), tile);
        }
      }
    }

    logger.debug(`Read ${numtiles} tiles`);
  }

  /// <summary>Reads the terrain.</summary>
  private readTerrain(): void {
    const terrainSection = this.getSection('Terrain');
    if (terrainSection == null) return;
    for (const v of terrainSection.OrderedEntries) {
      const pos = parseInt(v.Key, 10);
      if (!Number.isNaN(pos)) {
        const name = v.Value.toString();
        const rx = pos % 1000;
        const ry = Math.trunc(pos / 1000);
        const t = new Terrain(name);
        t.Tile = this.Tiles.getTileR(rx, ry);
        if (t.Tile != null) this.Terrains.push(t);
      }
    }
    logger.debug(`Read ${this.Terrains.length} terrain objects`);
  }

  /// <summary>Reads the smudges.</summary>
  private readSmudges(): void {
    const smudgesSection = this.getSection('Smudge');
    if (smudgesSection == null) return;
    for (const v of smudgesSection.OrderedEntries) {
      try {
        const entries = v.Value.toString().split(',');
        if (entries.length <= 2) continue;
        const name = entries[0];
        const rx = parseInt(entries[1], 10);
        const ry = parseInt(entries[2], 10);
        const s = new Smudge(name);
        s.Tile = this.Tiles.getTileR(rx, ry);
        if (s.Tile != null) this.Smudges.push(s);
      } catch {
        // ignore malformed entries
      }
    }
    logger.debug(`Read ${this.Smudges.length} smudges`);
  }

  /// <summary>Reads the overlay.</summary>
  private readOverlay(): void {
    const overlaySection = this.getSection('OverlayPack');
    if (overlaySection == null) {
      logger.info('OverlayPack section unavailable, overlay will be unavailable');
      return;
    }

    const overlayPack = new Uint8Array(1 << 18);
    Format5.DecodeInto(Buffer.from(overlaySection.concatenatedValues(), 'base64'), overlayPack, 80);

    const overlayDataSection = this.getSection('OverlayDataPack');
    if (overlayDataSection == null) {
      logger.debug('OverlayDataPack section unavailable, overlay will be unavailable');
      return;
    }
    const overlayDataPack = new Uint8Array(1 << 18);
    Format5.DecodeInto(Buffer.from(overlayDataSection.concatenatedValues(), 'base64'), overlayDataPack, 80);

    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x--) {
        const t = this.Tiles.get(x, y);
        if (t == null) continue;
        const idx = t.Rx + 512 * t.Ry;
        const overlay_id = overlayPack[idx];
        if (overlay_id !== 0xff) {
          const overlay_value = overlayDataPack[idx];
          const ovl = new Overlay(overlay_id, overlay_value);
          ovl.Tile = t;
          this.Overlays.push(ovl);
        }
      }
    }

    logger.debug(`Read ${this.Overlays.length} overlay types`);
  }

  /// <summary>Reads the infantry.</summary>
  private readInfantry(): void {
    const infantrySection = this.getSection('Infantry');
    if (infantrySection == null) {
      logger.info('Infantry section unavailable');
      return;
    }

    for (const v of infantrySection.OrderedEntries) {
      try {
        const entries = v.Value.toString().split(',');
        if (entries.length <= 8) continue;
        const owner = entries[0];
        const name = entries[1];
        const health = parseInt(entries[2], 10);
        const rx = parseInt(entries[3], 10);
        const ry = parseInt(entries[4], 10);
        const direction = parseInt(entries[7], 10);
        const onBridge = entries[11] === '1';
        const i = new Infantry(owner, name, health, direction, onBridge);
        i.Tile = this.Tiles.getTileR(rx, ry);
        if (i.Tile != null) this.Infantries.push(i);
      } catch {
        // ignore malformed entries
      }
    }
    logger.trace(`Read ${this.Infantries.length} infantry objects`);
  }

  /// <summary>Reads the units.</summary>
  private readUnits(): void {
    const unitsSection = this.getSection('Units');
    if (unitsSection == null) {
      logger.info('Units section unavailable');
      return;
    }
    for (const v of unitsSection.OrderedEntries) {
      try {
        const entries = v.Value.toString().split(',');
        if (entries.length <= 11) continue;

        const owner = entries[0];
        const name = entries[1];
        const health = parseInt(entries[2], 10);
        const rx = parseInt(entries[3], 10);
        const ry = parseInt(entries[4], 10);
        const direction = parseInt(entries[5], 10);
        const onBridge = entries[10] === '1';
        const u = new Unit(owner, name, health, direction, onBridge);
        u.Tile = this.Tiles.getTileR(rx, ry);
        if (u.Tile != null) this.Units.push(u);
      } catch {
        // ignore malformed entries
      }
    }
    logger.trace(`Read ${this.Units.length} units`);
  }

  /// <summary>Reads the aircraft.</summary>
  private readAircraft(): void {
    const aircraftSection = this.getSection('Aircraft');
    if (aircraftSection == null) {
      logger.info('Aircraft section unavailable');
      return;
    }
    for (const v of aircraftSection.OrderedEntries) {
      try {
        const entries = v.Value.toString().split(',');
        const owner = entries[0];
        const name = entries[1];
        const health = parseInt(entries[2], 10);
        const rx = parseInt(entries[3], 10);
        const ry = parseInt(entries[4], 10);
        const direction = parseInt(entries[5], 10);
        const onBridge = entries[entries.length - 4] === '1';
        const a = new Aircraft(owner, name, health, direction, onBridge);
        a.Tile = this.Tiles.getTileR(rx, ry);
        if (a.Tile != null) this.Aircrafts.push(a);
      } catch {
        // ignore malformed entries
      }
    }
    logger.trace(`Read ${this.Aircrafts.length} aircraft objects`);
  }

  /// <summary>Reads the structures.</summary>
  private readStructures(): void {
    const structsSection = this.getSection('Structures');
    if (structsSection == null) {
      logger.info('Structures section unavailable');
      return;
    }
    for (const v of structsSection.OrderedEntries) {
      try {
        const entries = v.Value.toString().split(',');
        if (entries.length <= 15) continue;
        const owner = entries[0];
        const name = entries[1];
        const health = parseInt(entries[2], 10);
        const rx = parseInt(entries[3], 10);
        const ry = parseInt(entries[4], 10);
        const direction = parseInt(entries[5], 10);
        const s = new Structure(owner, name, health, direction);
        s.Upgrade1 = entries[12];
        s.Upgrade2 = entries[13];
        s.Upgrade3 = entries[14];
        s.Tile = this.Tiles.getTileR(rx, ry);

        if (s.Tile != null) this.Structures.push(s);
      } catch {
        // ignore malformed entries
      }
    }
    logger.trace(`Read ${this.Structures.length} structures`);
  }

  private readWaypoints(): void {
    const basic = this.getSection('Basic');
    if (basic == null || !basic.readBool('MultiplayerOnly')) return;
    const waypoints = this.getOrCreateSection('Waypoints');

    for (const entry of waypoints.OrderedEntries) {
      try {
        const num = parseInt(entry.Key, 10);
        const pos = parseInt(entry.Value.toString(), 10);
        if (!Number.isNaN(num) && !Number.isNaN(pos)) {
          const ry = Math.trunc(pos / 1000);
          const rx = pos - ry * 1000;

          const wp = new Waypoint();
          wp.Number = num;
          wp.Tile = this.Tiles.getTileR(rx, ry);
          this.Waypoints.push(wp);
        }
      } catch {
        // ignore malformed entries
      }
    }
  }

  private readTubes(): void {
    const tubesSection = this.getSection('Tubes');
    if (tubesSection == null) {
      logger.info('Tubes section unavailable');
      return;
    }

    for (const v of tubesSection.OrderedEntries) {
      try {
        const entries = v.Value.toString().split(',');
        if (entries.length <= 5) continue;
        const startx = parseInt(entries[0], 10);
        const starty = parseInt(entries[1], 10);
        const facing = parseInt(entries[2], 10);
        const endx = parseInt(entries[3], 10);
        const endy = parseInt(entries[4], 10);
        const directions: number[] = [];

        // Game takes a maximum of 100 direction entries with at least one last being -1.
        for (let i = 5; i < 105 && i < entries.length; i++) {
          const direction = parseInt(entries[i], 10);
          if (direction < 0 || direction >= 8) break;
          directions.push(direction);
        }
        if (startx > 0 && startx < 512 && starty > 0 && starty < 512 && facing >= 0 && facing < 8 && endx > 0 && endx < 512 && endy > 0 && endy < 512)
          this.TunnelEntries.push(new TunnelLine(startx, starty, facing, endx, endy, directions));
      } catch {
        // ignore malformed entries
      }
    }
    logger.trace(`Read ${this.TunnelEntries.length} tunnel entries`);
  }
}

// Register the map format factory so VFS.open() returns typed MapFile instances.
registerFormat(FileFormat.Map, (b, f, o, l, c) => new MapFile(b, f, o, l, c));
