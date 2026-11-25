// Port of CNCMaps.Engine.Map.Map
import { Point, Rectangle, Size, Color } from '../../shared/Geometry.js';
import {
  EngineType,
  TheaterType,
  CollectionType,
  PaletteType,
  LightingType,
  StartPositionMarking,
  PreviewMarkersType,
  SizeMode,
  OverlayTibType,
} from '../../shared/Enums.js';
import { logger, LogLevel } from '../../shared/Log.js';
import { PngWriter } from '../../rendering/PngWriter.js';
import { ModConfig } from '../../shared/ModConfig.js';
import { VirtualFileSystem } from '../../formats/vfs/VirtualFileSystem.js';
import { IniFile, IniSection } from '../../formats/IniFile.js';
import { MapFile } from '../../formats/map/MapFile.js';
import { Palette } from '../../rendering/Palette.js';
import { DrawingSurface, SurfaceFormat } from '../../rendering/DrawingSurface.js';
import { LayerCategory } from '../../rendering/LayerCategory.js';
import { Theater } from '../game/Theater.js';
import { RenderProgress } from '../RenderProgress.js';
import { Operations } from './Operations.js';
import { TileLayer, TileDirection } from './TileLayer.js';
import { MapTile } from './MapTile.js';
import {
  GameObject,
  NamedObject,
  OwnableObject,
  AircraftObject,
  InfantryObject,
  LightSource,
  OverlayObject,
  SmudgeObject,
  StructureObject,
  TerrainObject,
  UnitObject,
} from './GameObjects.js';
import { CsfFile } from '../../formats/CsfFile.js';
import { SpecialOverlays } from '../game/SpecialOverlays.js';
import { PaletteCollection } from '../game/PaletteCollection.js';
import { GameCollectionLike } from '../game/Theater.js';
import { ShpDrawable } from '../drawables/ShpDrawable.js';
import { TileDrawable } from '../drawables/TileDrawable.js';
import { HsvColor } from '../utility/HsvColor.js';
import { MarkerResources } from '../../rendering/MarkerResources.js';
import { ThumbInjector } from './ThumbInjector.js';
import {
  drawDashedLine,
  drawImage,
  drawLine,
  fillEllipse,
  fillPolygon,
  fillRect,
} from '../../rendering/MapDrawing.js';
import { Format5 } from '../../formats/encodings/Format5.js';
import { TileCollection } from '../game/TileCollection.js';
import { MapStats, StartPositionPixel } from './MapStats.js';
import { resizeBicubic } from '../../rendering/ImageUtil.js';

const LIGHTING_FULL: LightingType = 4; // LightingType.Full

export class MapRenderer {
  private _theaterType: TheaterType = TheaterType.None;
  get TheaterType(): TheaterType {
    return this._theaterType;
  }

  IgnoreLighting = false;
  StartPosMarking: StartPositionMarking = StartPositionMarking.Squared;
  StartMarkerSize: number | null = null;
  MarkOreFields = false;
  /// <summary>Have the voxel blit record which pixels it wrote (for --debug-voxelmask).</summary>
  TrackVoxelMask = false;
  /// <summary>Have every blit record the layer category of the pixel (for --output-psd).</summary>
  TrackCategories = false;

  /// <summary>One rules [Colors] name per start position A-H, empty where nobody starts.
  /// null switches the pre-capture pass off entirely.</summary>
  PreCaptureColors: (string | null)[] | null = null;

  FullSize = Rectangle.Empty;
  LocalSize = Rectangle.Empty;
  /** Starts admitted by the map metadata (8 retail, up to 30 with VERA20k). */
  StartCapacity = 8;
  Progress: RenderProgress | null = null;

  private _config!: ModConfig;
  private _vfs!: VirtualFileSystem;
  private _theater!: Theater;
  private _rules!: IniFile;
  private _art!: IniFile;
  private _tiles!: TileLayer;

  private readonly _overlayObjects: OverlayObject[] = [];
  private readonly _smudgeObjects: SmudgeObject[] = [];
  private readonly _terrainObjects: TerrainObject[] = [];
  private readonly _structureObjects: StructureObject[] = [];
  private readonly _infantryObjects: InfantryObject[] = [];
  private readonly _unitObjects: UnitObject[] = [];
  private readonly _aircraftObjects: AircraftObject[] = [];
  private readonly _wayPoints = new Array<any>();

  private readonly _countryColors = new Map<string, HsvColor>();
  private readonly _namedColors = new Map<string, HsvColor>();

  private _lighting: any = null;
  private readonly _lightSources: LightSource[] = [];
  private readonly _palettePerLevel: Palette[] = [];
  private readonly _palettesToBeRecalculated = new Set<Palette>();

  private _drawingSurface!: DrawingSurface;
  private _mapFile!: MapFile;
  private _overlaysAltered = false;
  /** CSF string table, used only for PSD layer names (localized object names). */
  private _csf: CsfFile | null = null;
  private readonly _displayNames = new Map<string, string>();

  Initialize(mf: MapFile, config: ModConfig, vfs: VirtualFileSystem): boolean {
    this._mapFile = mf;
    this._config = config;
    this._vfs = vfs;
    this._theaterType = Theater.TheaterTypeFromString(mf.readString('Map', 'Theater'));
    this.FullSize = mf.FullSize;
    this.LocalSize = mf.LocalSize;
    this.StartCapacity = mf.StartCapacity;

    this._tiles = new TileLayer(this.FullSize.Size, config);

    // Before the objects are copied in: a map trigger can hand a neutral tech building to a
    // starting player at game start, and rewriting the owner here lets the usual owner-to-colour
    // path pick it up.
    if (this.PreCaptureColors != null) mf.ApplyPreCapturedOwners(this.PreCaptureSlotOwners());

    this.LoadAllObjects(mf);

    if (!this.IgnoreLighting) {
      this._lighting = mf.Lighting;
      const extra = this._config.ExtraOptions[0];
      if (extra != null) {
        let ambient = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        const argb = extra.LightingAmbientRGBDelta;
        const ambientParts = argb.split(',');
        if (ambientParts.length > 0 && ambientParts[0] != null) ambient = parseFloat(ambientParts[0]);
        if (ambientParts.length > 1 && ambientParts[1] != null) red = parseFloat(ambientParts[1]);
        if (ambientParts.length > 2 && ambientParts[2] != null) green = parseFloat(ambientParts[2]);
        if (ambientParts.length > 3 && ambientParts[3] != null) blue = parseFloat(ambientParts[3]);
        if (ambient <= 1 && ambient >= -1) {
          this._lighting.Ambient += ambient;
          this._lighting.Ambient = this._lighting.Ambient < 0 ? 0 : this._lighting.Ambient;
        }
        if (red <= 1 && red >= -1) {
          this._lighting.Red += red;
          this._lighting.Red = this._lighting.Red < 0 ? 0 : this._lighting.Red;
        }
        if (green <= 1 && green >= -1) {
          this._lighting.Green += green;
          this._lighting.Green = this._lighting.Green < 0 ? 0 : this._lighting.Green;
        }
        if (blue <= 1 && blue >= -1) {
          this._lighting.Blue += blue;
          this._lighting.Blue = this._lighting.Blue < 0 ? 0 : this._lighting.Blue;
        }
      }
    } else {
      this._lighting = { Level: 0, Ambient: 1, Red: 1, Green: 1, Blue: 1, Ground: 0 };
    }

    for (const w of mf.Waypoints) this._wayPoints.push(w);
    if (!this.LoadInis()) {
      logger.fatal('Ini files couldnt be loaded');
      return false;
    }

    logger.info('Overriding rules.ini with map INI entries');
    // InvisibleInGame is sticky in the engine: Read_INI sets the hide flag on yes and never
    // clears it (gamemd 0x460e07), so a map override of no leaves a rules-invisible
    // building undrawn.
    const stickyInvisible = mf.Sections.filter(
      (s) => this._rules.getSection(s.Name)?.readBool('InvisibleInGame') === true,
    ).map((s) => s.Name);
    this._rules.mergeWith(mf);
    for (const name of stickyInvisible) this._rules.getSection(name)!.setValue('InvisibleInGame', 'yes');

    return true;
  }

  private LoadAllObjects(mf: MapFile): void {
    // import tiles
    for (const iso of mf.Tiles) {
      this._tiles.set(
        iso.Dx,
        Math.trunc(iso.Dy / 2),
        new MapTile(iso.Dx, iso.Dy, iso.Rx, iso.Ry, iso.Z, iso.TileNum, iso.SubTile, iso.IceGrowth, this._tiles),
      );
    }

    // import terrain
    for (const terr of mf.Terrains) {
      const t = new TerrainObject(terr.Name);
      this._terrainObjects.push(t);
      const tile = this._tiles.getTile(terr.Tile!);
      if (tile != null) tile.AddObject(t);
    }

    // import smudges
    for (const sm of mf.Smudges) {
      const s = new SmudgeObject(sm.Name);
      const tile = this._tiles.getTile(sm.Tile!);
      if (tile != null) tile.AddObject(s);
      this._smudgeObjects.push(s);
    }

    // import overlays
    for (const o of mf.Overlays) {
      const ovl = new OverlayObject(o.OverlayID, o.OverlayValue);
      const tile = this._tiles.getTile(o.Tile!);
      if (tile != null) tile.AddObject(ovl);
      this._overlayObjects.push(ovl);
    }

    // A skirmish game creates only the players' houses, Neutral and Special; a pre-placed object
    // owned by a country is never created (the Americans lamps, civilians and buildings on the
    // multiplayer maps stay absent in captures). Trigger-captured objects carry the "<Player @ X>"
    // owner the pre-capture pass gave them.
    const skirmish =
      this._config.Engine >= EngineType.RedAlert2 &&
      (mf.getSection('Basic')?.readBool('MultiplayerOnly') ?? false);
    const exists = (owner: string) =>
      !skirmish || owner === 'Neutral' || owner === 'Special' || owner.startsWith('<Player');

    // import infantry
    for (const i of mf.Infantries) {
      if (!exists(i.Owner)) continue;
      const inf = new InfantryObject(i.Owner, i.Name, i.Health, i.Direction, i.SubCell, i.OnBridge);
      const tile = this._tiles.getTile(i.Tile!);
      if (tile != null) tile.AddObject(inf);
      this._infantryObjects.push(inf);
    }

    for (const u of mf.Units) {
      if (!exists(u.Owner)) continue;
      const un = new UnitObject(u.Owner, u.Name, u.Health, u.Direction, u.OnBridge);
      const tile = this._tiles.getTile(u.Tile!);
      if (tile != null) tile.AddObject(un);
      this._unitObjects.push(un);
    }

    for (const a of mf.Aircrafts) {
      if (!exists(a.Owner)) continue;
      const ac = new AircraftObject(a.Owner, a.Name, a.Health, a.Direction, a.OnBridge);
      const tile = this._tiles.getTile(a.Tile!);
      if (tile != null) tile.AddObject(ac);
      this._aircraftObjects.push(ac);
    }

    for (const s of mf.Structures) {
      if (!exists(s.Owner)) continue;
      const str = new StructureObject(s.Owner, s.Name, s.Health, s.Direction);
      str.Upgrade1 = s.Upgrade1;
      str.Upgrade2 = s.Upgrade2;
      str.Upgrade3 = s.Upgrade3;
      str.PreCaptured = s.PreCaptured;
      const tile = this._tiles.getTile(s.Tile!);
      if (tile != null) tile.AddObject(str);
      this._structureObjects.push(str);
    }

  }

  /** The object pass used to call GetObjectsAt() for every cell, which allocated
   * an array and scanned the tile seven times. Build it once after
   * RemoveUnknownObjects(): that cleanup runs after LoadAllObjects and can drop
   * invalid infantry/units/structures, so building earlier would leave the draw
   * lists pointing at removed objects. Terrain, smudges and overlays are drawn
   * by their own passes; the rest keep the engine's order: infantry, units,
   * structures, aircraft. */
  private BuildDrawObjects(): void {
    for (const tile of this._tiles) {
      const src = tile.AllObjects;
      const out = tile.DrawObjects;
      out.length = 0;
      for (const o of src) if (o instanceof InfantryObject) out.push(o);
      for (const o of src) if (o instanceof UnitObject) out.push(o);
      for (const o of src) if (o instanceof StructureObject) out.push(o);
      for (const o of src) if (o instanceof AircraftObject) out.push(o);
    }
  }

  LoadInis(): boolean {
    if (this._config.CustomRulesIniFiles.length === 0) {
      if (this._config.Engine === EngineType.YurisRevenge) {
        this._rules = this._vfs.openIni('rulesmd.ini') as IniFile;
      } else {
        this._rules = this._vfs.openIni('rules.ini') as IniFile;
        if (this._rules != null && this._config.Engine === EngineType.Firestorm) {
          logger.info('Merging Firestorm rules with TS rules');
          this._rules.mergeWith(this._vfs.open('firestrm.ini') as IniFile);
        }
      }
    } else {
      this._rules = this.LoadCustomInis(this._config.CustomRulesIniFiles);
    }

    if (this._config.CustomArtIniFiles.length === 0) {
      if (this._config.Engine === EngineType.YurisRevenge) {
        this._art = this._vfs.openIni('artmd.ini') as IniFile;
      } else {
        this._art = this._vfs.openIni('art.ini') as IniFile;
        if (this._art != null && this._config.Engine === EngineType.Firestorm) {
          logger.info('Merging Firestorm art with TS art');
          this._art.mergeWith(this._vfs.open('artfs.ini') as IniFile);
        }
      }
    } else {
      this._art = this.LoadCustomInis(this._config.CustomArtIniFiles);
    }

    if (this._rules == null || this._art == null) {
      logger.fatal(
        'Rules or art config file could not be loaded! Verify that the mix file directory ' +
          'is correct and that any required expansion is installed.',
      );
      return false;
    }

    // PSD layer names prefer the localized object name from the game's string table.
    if (this.TrackCategories && this._config.Engine >= EngineType.RedAlert2) {
      const csfFile = this._config.Engine === EngineType.YurisRevenge ? 'ra2md.csf' : 'ra2.csf';
      this._csf = this._vfs.openFile(csfFile) as unknown as CsfFile | null;
    }
    return true;
  }

  /** `Name:<ID>` from the game CSF, or the internal ID when the table has no entry. */
  private DisplayName(id: string): string {
    if (id === '' || this._csf == null) return id;
    const cached = this._displayNames.get(id);
    if (cached != null) return cached;
    const value = this._csf.getValue('Name:' + id);
    const name = value.trim() !== '' ? value : id;
    this._displayNames.set(id, name);
    return name;
  }

  private LoadCustomInis(fileNames: string[]): IniFile {
    let ini = this._vfs.openIni(fileNames[0]) as IniFile;
    if (ini == null) {
      logger.error(`Custom ini file ${fileNames[0]} could not be loaded`);
      return null as unknown as IniFile;
    }
    for (let i = 1; i < fileNames.length; i++) {
      logger.info(`Merging ${fileNames[i]} with ${fileNames[0]}`);
      const extra = this._vfs.openIni(fileNames[i]) as IniFile;
      if (extra == null) logger.warn(`Custom ini file ${fileNames[i]} could not be loaded, skipping`);
      ini.mergeWith(extra);
    }
    return ini;
  }

  LoadTheater(): boolean {
    this._theater = new Theater(this._theaterType, this._config, this._vfs, this._rules, this._art);
    if (!this._theater.Initialize()) return false;

    this.RemoveUnknownObjects();
    this.BuildDrawObjects();
    this.SetDrawables();
    this.ExpandSmudgeFootprints();

    this.LoadColors();
    if (this._config.Engine >= EngineType.RedAlert2) this.LoadCountries();
    this.LoadHouses();

    Operations.FixTiles(this._tiles, this._theater.GetTileCollection());
    if (this._config.Engine <= EngineType.Firestorm) Operations.RecalculateVeinsSpread(this._overlayObjects);

    this.RevisitWallBuildings();

    this.CreateLevelPalettes();
    this.LoadPalettes();
    this.ApplyRemappables();
    if (!this.IgnoreLighting) {
      this.LoadLightSources();
      this.ApplyLightSources();
    }
    this.LightTunnelRoofs();

    this.SetBaseTiles();

    this.RecalculatePalettes();

    return true;
  }

  private RevisitWallBuildings(): void {
    const generalSection = this._rules.getOrCreateSection('General');
    const EWGate1 = generalSection.readString('GDIGateOne', '');
    const NSGate1 = generalSection.readString('GDIGateTwo', '');
    const EWGate2 = generalSection.readString('NodGateOne', '');
    const NSGate2 = generalSection.readString('NodGateTwo', '');
    const WallTower = generalSection.readString('WallTower', '');

    for (const obj of this._structureObjects) {
      if (obj.Drawable != null && obj.Drawable.IsActualWall) {
        let frame = 0;
        const t = this._tiles.GetTileR(obj.Tile!.Rx, obj.Tile!.Ry);
        if (t == null || t.Layer == null) {
          obj.WallBuildingFrame = frame;
          continue;
        }
        const ne = t.Layer.GetNeighbourTile(t, TileDirection.TopRight);
        const se = t.Layer.GetNeighbourTile(t, TileDirection.BottomRight);
        const sw = t.Layer.GetNeighbourTile(t, TileDirection.BottomLeft);
        const nw = t.Layer.GetNeighbourTile(t, TileDirection.TopLeft);

        if (
          ne != null &&
          (ne.AllObjects.some(
            (o) =>
              o instanceof StructureObject &&
              o.Drawable != null &&
              ((o.Drawable.IsActualWall && obj.Name === o.Name) || o.Name === WallTower),
          ) ||
            ne.AllObjects.some((o) => o instanceof OverlayObject && o.Drawable != null && o.Drawable.Name === obj.Name))
        )
          frame |= 1;
        if (
          se != null &&
          (se.AllObjects.some(
            (o) =>
              o instanceof StructureObject &&
              o.Drawable != null &&
              ((o.Drawable.IsActualWall && obj.Name === o.Name) || o.Drawable.IsGate || o.Name === WallTower),
          ) ||
            se.AllObjects.some((o) => o instanceof OverlayObject && o.Drawable != null && o.Drawable.Name === obj.Name))
        )
          frame |= 2;
        if (
          sw != null &&
          (sw.AllObjects.some(
            (o) =>
              o instanceof StructureObject &&
              o.Drawable != null &&
              ((o.Drawable.IsActualWall && obj.Name === o.Name) || o.Drawable.IsGate || o.Name === WallTower),
          ) ||
            sw.AllObjects.some((o) => o instanceof OverlayObject && o.Drawable != null && o.Drawable.Name === obj.Name))
        )
          frame |= 4;
        if (
          nw != null &&
          (nw.AllObjects.some(
            (o) =>
              o instanceof StructureObject &&
              o.Drawable != null &&
              ((o.Drawable.IsActualWall && obj.Name === o.Name) || o.Name === WallTower),
          ) ||
            nw.AllObjects.some((o) => o instanceof OverlayObject && o.Drawable != null && o.Drawable.Name === obj.Name))
        )
          frame |= 8;

        if (ne != null && ne.Layer != null) {
          const ne2 = ne.Layer.GetNeighbourTile(ne, TileDirection.TopRight);
          if (ne2 != null && ne2.Layer != null) {
            const ne3 = ne2.Layer.GetNeighbourTile(ne2, TileDirection.TopRight);
            if (
              ne3 != null &&
              ne3.AllObjects.some(
                (o) => o instanceof StructureObject && o.Drawable != null && o.Drawable.IsGate && (o.Name === NSGate1 || o.Name === NSGate2),
              )
            )
              frame |= 1;
          }
        }
        if (nw != null && nw.Layer != null) {
          const nw2 = nw.Layer.GetNeighbourTile(nw, TileDirection.TopLeft);
          if (nw2 != null && nw2.Layer != null) {
            const nw3 = nw2.Layer.GetNeighbourTile(nw2, TileDirection.TopLeft);
            if (
              nw3 != null &&
              nw3.AllObjects.some(
                (o) => o instanceof StructureObject && o.Drawable != null && o.Drawable.IsGate && (o.Name === EWGate1 || o.Name === EWGate2),
              )
            )
              frame |= 8;
          }
        }
        obj.WallBuildingFrame = frame;
      }
    }

    // Overlay walls (RA2 sandbags and walls): the stored overlay value is the connection frame,
    // but hand-edited maps carry stale pieces — connections to walls that were deleted and
    // missing connections to walls added later — while the game resolves the piece from the
    // current neighbours. Bits are the four edge neighbours: 1=north(0,-1), 2=east(+1,0),
    // 4=south(0,+1), 8=west(-1,0); any wall type connects, as do gates and wall towers.
    for (const obj of this._overlayObjects) {
      if (obj.Drawable == null || !obj.Drawable.IsWall || obj.Tile == null) continue;
      let frame = 0;
      const dirs = [
        [0, -1, 1],
        [1, 0, 2],
        [0, 1, 4],
        [-1, 0, 8],
      ] as const;
      for (const [dx, dy, bit] of dirs) {
        const n = this._tiles.GetTileR(obj.Tile.Rx + dx, obj.Tile.Ry + dy);
        if (n == null) continue;
        if (
          n.AllObjects.some(
            (o) =>
              (o instanceof OverlayObject && o.Drawable != null && o.Drawable.IsWall) ||
              (o instanceof StructureObject &&
                o.Drawable != null &&
                (o.Drawable.IsWall || o.Drawable.IsGate || o.Name === WallTower)),
          )
        )
          frame |= bit;
      }
      obj.WallBuildingFrame = frame;
    }
  }

  private SetBaseTiles(): void {
    for (const obj of [...this._structureObjects, ...this._overlayObjects, ...this._smudgeObjects]) {
      if (obj.BottomTile == null) {
        const foundation = obj.Drawable != null ? obj.Drawable.Foundation : new Size(1, 1);
        const bottom = this._tiles.GetTileR(obj.Tile!.Rx + foundation.Width - 1, obj.Tile!.Ry + foundation.Height - 1);
        obj.BottomTile = bottom ?? obj.Tile;
        obj.TopTile = obj.Tile;
      }
    }

    for (const obj of [...this._unitObjects, ...this._aircraftObjects, ...this._infantryObjects]) {
      const bounds = obj.GetBounds();
      const occupy = new Size(
        Math.max(1, Math.ceil(bounds.Width / this._config.TileWidth)),
        Math.max(1, Math.ceil(bounds.Height / this._config.TileHeight)),
      );
      const bridge = (obj as unknown as OwnableObject).OnBridge ? -2 : 0;
      const top = this._tiles.GetTileR(obj.Tile!.Rx + bridge - 1 + occupy.Width, obj.Tile!.Ry + bridge - 1 + occupy.Height);
      const bottom = this._tiles.GetTileR(obj.Tile!.Rx, obj.Tile!.Ry);
      obj.BottomTile = bottom ?? obj.Tile;
      obj.TopTile = top ?? obj.Tile;
    }

    for (const obj of this._overlayObjects.filter(SpecialOverlays.IsHighBridge)) {
      const bottom = this._tiles.GetTileR(obj.Tile!.Rx + 2, obj.Tile!.Ry + 2);
      obj.BottomTile = bottom ?? obj.Tile;
      obj.TopTile = obj.BottomTile;
    }
  }

  private RemoveUnknownObjects(): void {
    let c = this._theater.GetCollection(CollectionType.Terrain) as unknown as GameCollectionLike;
    for (const obj of [...this._terrainObjects]) {
      if (!c.HasObject(obj)) {
        this._terrainObjects.splice(this._terrainObjects.indexOf(obj), 1);
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
      }
    }

    c = this._theater.GetCollection(CollectionType.Infantry) as unknown as GameCollectionLike;
    for (const obj of [...this._infantryObjects]) {
      if (!c.HasObject(obj)) {
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
        this._infantryObjects.splice(this._infantryObjects.indexOf(obj), 1);
      }
    }

    c = this._theater.GetCollection(CollectionType.Vehicle) as unknown as GameCollectionLike;
    for (const obj of [...this._unitObjects]) {
      if (!c.HasObject(obj)) {
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
        this._unitObjects.splice(this._unitObjects.indexOf(obj), 1);
      }
    }

    c = this._theater.GetCollection(CollectionType.Aircraft) as unknown as GameCollectionLike;
    for (const obj of [...this._aircraftObjects]) {
      if (!c.HasObject(obj)) {
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
        this._aircraftObjects.splice(this._aircraftObjects.indexOf(obj), 1);
      }
    }

    c = this._theater.GetCollection(CollectionType.Smudge) as unknown as GameCollectionLike;
    for (const obj of [...this._smudgeObjects]) {
      if (!c.HasObject(obj)) {
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
        this._smudgeObjects.splice(this._smudgeObjects.indexOf(obj), 1);
      }
    }

    c = this._theater.GetCollection(CollectionType.Building) as unknown as GameCollectionLike;
    const cAlt = this._theater.GetCollection(CollectionType.Overlay) as unknown as GameCollectionLike;
    for (const obj of [...this._structureObjects]) {
      if (!c.HasObject(obj) && !cAlt.HasObject(obj)) {
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
        this._structureObjects.splice(this._structureObjects.indexOf(obj), 1);
      }
    }

    // Overlay check
    this._overlaysAltered = false;
    c = this._theater.GetCollection(CollectionType.Overlay) as unknown as GameCollectionLike;
    for (const obj of [...this._overlayObjects]) {
      if (!c.HasObject(obj)) {
        if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
        this._overlayObjects.splice(this._overlayObjects.indexOf(obj), 1);
        this._overlaysAltered = true;
      } else {
        const drawable = c.GetDrawable(obj) as ShpDrawable;
        if (drawable == null) continue;
        if (drawable.Shp == null) {
          // Image-less veins overlays (VEINHOLEDUMMY) are valid game objects; they
          // receive the real veins drawable in RecalculateVeinsSpread.
          if (!drawable.IsVeins) {
            if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
            this._overlayObjects.splice(this._overlayObjects.indexOf(obj), 1);
            this._overlaysAltered = true;
          }
        } else {
          drawable.Shp.Initialize();
          if (drawable.Shp.NumImages - 1 < obj.OverlayValue) {
            if (obj.Tile != null) obj.Tile.RemoveObject(obj, true);
            this._overlayObjects.splice(this._overlayObjects.indexOf(obj), 1);
            this._overlaysAltered = true;
          }
        }
      }
    }
  }

  private SetDrawables(): void {
    const tileTypes = this._theater.GetTileCollection();
    let unknownTiles = 0;
    for (const tile of this._tiles) {
      tile.Drawable = this._theater.GetCollection(CollectionType.Tiles).GetDrawable(tile);
      if (tile.Drawable == null) unknownTiles++;
      for (const obj of tile.AllObjects) {
        obj.Collection = this._theater.GetObjectCollection(obj);
        if (obj.Collection == null) {
          logger.warn(`No collection for object ${obj} at ${obj.Tile}; skipping it`);
          continue;
        }
        obj.Drawable = obj.Collection.GetDrawable(obj);

        if (obj instanceof OverlayObject) Operations.ApplyTiberiumArt(tile, obj, this._config.Engine);
      }
    }
    if (unknownTiles > 0)
      logger.warn(
        `${unknownTiles} cells use tile indices beyond this theater's ${tileTypes.NumTiles} tiles (a terrain expansion this game data lacks); they stay black`,
      );
  }

  // gamemd draws a multi-cell smudge once from every cell of its foundation (CellClass::Draw_It
  // 0x480350 -> SmudgeTypeClass::DrawIt 0x6b55f0): each copy at the entry cell's screen spot, lifted
  // by the drawing cell's own level and lit by that cell. The copies get their own objects so the
  // tile pass draws them in the game's cell order with the drawing cell's height and palette.
  private ExpandSmudgeFootprints(): void {
    for (const sm of this._smudgeObjects) {
      if (sm.Tile == null) continue;
      const fnd = sm.Drawable?.Foundation ?? new Size(1, 1);
      for (let j = 0; j < fnd.Height; j++) {
        for (let i = 0; i < fnd.Width; i++) {
          if (i === 0 && j === 0) continue;
          const tile = this._tiles.GetTileR(sm.Tile!.Rx + i, sm.Tile!.Ry + j);
          if (tile == null) continue;
          const copy = new SmudgeObject(sm.Name);
          copy.FoundationCell = new Point(i, j);
          copy.Collection = sm.Collection;
          copy.Drawable = sm.Drawable;
          copy.BottomTile = tile;
          copy.TopTile = tile;
          tile.AddObject(copy);
        }
      }
    }
  }

  private CreateLevelPalettes(): void {
    logger.info('Creating per-height palettes');
    const palettes = this._theater.GetPalettes();
    for (let i = 0; i < 19; i++) {
      const isoHeight = palettes.IsoPalette!.clone();
      isoHeight.applyLighting(this._lighting, i);
      isoHeight.IsShared = true;
      isoHeight.Name = `${isoHeight.Name} lvl.${i}`;
      this._palettePerLevel.push(isoHeight);
      this._palettesToBeRecalculated.add(isoHeight);
    }
  }

  private LoadPalettes(): void {
    const before = this._palettesToBeRecalculated.size;

    // get the default palettes
    const pc = this._theater.GetPalettes();
    for (const p of pc) this._palettesToBeRecalculated.add(p);

    // InfantryClass/UnitClass/AircraftClass::Draw_It add the [AudioVisual] Extra*Light of their
    // class to the cell brightness (gamemd 0x51944d, 0x73d0c9, 0x41492a; rulesmd.ini has 0.2 for
    // all three), so units draw a shade lighter than the ground they stand on
    const audioVisual = this._rules.getOrCreateSection('AudioVisual');
    const extraUnitLight = audioVisual.readDouble('ExtraUnitLight');
    const extraInfantryLight = audioVisual.readDouble('ExtraInfantryLight');
    const extraAircraftLight = audioVisual.readDouble('ExtraAircraftLight');

    for (const tile of this._tiles) {
      if (tile == null) continue;
      for (const obj of [...tile.AllObjects, tile]) {
        if (obj == null) continue;

        let p: Palette;
        let lt: LightingType;
        let pt: PaletteType;

        if (obj instanceof MapTile) {
          lt = LIGHTING_FULL;
          pt = PaletteType.Iso;
        } else {
          obj.Collection = this._theater.GetObjectCollection(obj);
          pt = obj.Drawable!.Props.PaletteType;
          lt = obj.Drawable!.Props.LightingType;
        }

        // level, ambient and full benefit from sharing
        if (lt === LightingType.Full && pt === PaletteType.Iso) {
          const z = obj.Tile!.Z + (obj.Drawable != null ? obj.Drawable.TileElevation : 0);
          p = this._palettePerLevel[z];
        } else if (lt >= LightingType.Level) {
          p = this._theater.GetPalette(obj.Drawable as any).clone();
          const z = obj.Tile!.Z + (obj.Drawable != null ? obj.Drawable.TileElevation : 0);
          p.applyLighting(this._lighting, z, lt === LightingType.Full);
          if (obj instanceof InfantryObject) p.addLight(extraInfantryLight);
          else if (obj instanceof UnitObject) p.addLight(extraUnitLight);
          else if (obj instanceof AircraftObject) p.addLight(extraAircraftLight);
        } else {
          p = this._theater.GetPalette(obj.Drawable as any).clone();
        }
        this._palettesToBeRecalculated.add(p);
        obj.Palette = p;
      }
    }
    logger.debug(`Loaded ${this._palettesToBeRecalculated.size - before} different palettes`);
  }

  private ApplyRemappables(): void {
    const before = this._palettesToBeRecalculated.size;

    const ownables = [
      ...this._structureObjects,
      ...this._unitObjects,
      ...this._aircraftObjects,
      ...this._infantryObjects,
    ] as (GameObject & OwnableObject)[];
    for (const obj of ownables) {
      const g = obj as GameObject;
      if (g != null && g.Drawable != null && g.Drawable.IsRemapable) {
        if (g.Palette != null && g.Palette.IsShared) g.Palette = g.Palette.clone();
        const color = this._countryColors.has(obj.Owner)
          ? this._countryColors.get(obj.Owner)!
          : this._countryColors.values().next().value;
        if (g.Palette != null && color != null) g.Palette.remap(color);
        if (g.Palette != null) this._palettesToBeRecalculated.add(g.Palette);
      }
    }

    // Original TS needs tiberium remapped
    let disableTibRemapping = false;
    const extra = this._config.ExtraOptions[0];
    if (extra != null) disableTibRemapping = extra.DisableTibRemap;
    if (this._config.Engine <= EngineType.Firestorm && !disableTibRemapping) {
      const tiberiumSec = this._rules.getOrCreateSection('Tiberiums');
      const tiberiums = tiberiumSec.OrderedEntries.map((tib) => tib.Value.toString());
      const remaps = tiberiums.map((tib) => this._rules.getOrCreateSection(tib).readString('Color'));
      const tibRemaps = new Map<string, string>();
      tiberiums.forEach((k, i) => tibRemaps.set(k, remaps[i]));

      for (const ovl of this._overlayObjects) {
        if (ovl == null) continue;
        const tibType = SpecialOverlays.GetOverlayTibType(ovl, this._config.Engine);
        if (tibType !== OverlayTibType.NotSpecial) {
          if (ovl.Palette != null) ovl.Palette = ovl.Palette.clone();
          const tibName = SpecialOverlays.GetTibName(ovl, this._config.Engine);
          if (tibRemaps.has(tibName) && this._namedColors.has(tibRemaps.get(tibName)!)) {
            if (ovl.Palette != null) ovl.Palette.remap(this._namedColors.get(tibRemaps.get(tibName)!)!);
          }
          if (ovl.Palette != null) this._palettesToBeRecalculated.add(ovl.Palette);
        }
      }
    }
    logger.debug(`Determined palettes to be recalculated due to remappables (${this._palettesToBeRecalculated.size - before})`);
  }

  private LoadLightSources(): void {
    logger.info('Loading light sources');
    for (const s of [...this._structureObjects]) {
      const section = this._rules.getSection(s.Name);
      if (section != null && section.hasKey('LightVisibility')) {
        const ls = new LightSource(section, this._lighting);
        ls.Tile = s.Tile;
        const fnd = s.Drawable?.Foundation ?? new Size(1, 1);
        ls.PosX = s.Tile!.Rx + (fnd.Width - 1) * 0.5;
        ls.PosY = s.Tile!.Ry + (fnd.Height - 1) * 0.5;
        const mapSection = this._mapFile.getSection(s.Name);
        if (mapSection != null) ls.truncateKeysOmittedBy(mapSection);
        this._lightSources.push(ls);
      }
    }
  }

  private ApplyLightSources(): void {
    const before = this._palettesToBeRecalculated.size;
    for (const lamp of this._lightSources) {
      for (const t of this._tiles) {
        if (t == null || t.Palette == null) continue;

        const wasShared = t.Palette.IsShared;
        // make sure this tile can only end up in the "to-be-recalculated list" once
        if (!lamp.ApplyLamp(t)) continue;

        if (wasShared && !t.Palette.IsShared) this._palettesToBeRecalculated.add(t.Palette);

        for (const obj of t.AllObjects.filter((o) => o.Lighting === LightingType.Full || o.Lighting === LightingType.Ambient)) {
          if (obj.Palette == null) continue;
          const oWasShared = obj.Palette.IsShared;
          lamp.ApplyLamp(obj, obj.Lighting === LightingType.Ambient);
          this._palettesToBeRecalculated.add(obj.Palette);
          if (oWasShared && !obj.Palette.IsShared) this._palettesToBeRecalculated.add(obj.Palette);
        }
      }
    }
    logger.debug(`Determined palettes to be recalculated due to lightsources (${this._palettesToBeRecalculated.size - before})`);
  }

  // A tunnel piece keeps every cell at the road level while its extra image carries the cliff
  // face and roof above it, so the game lights that roof as the tunnel floor. Light the extra
  // art like the highest cardinal neighbour instead, the plateau it belongs to.
  private LightTunnelRoofs(): void {
    const coll = this._theater.GetTileCollection();
    for (const t of this._tiles) {
      if (t == null || !coll.IsTunnel(t.SetNum)) continue;
      const img = (t.Drawable as TileDrawable | null)?.GetTileImage(t);
      if (img == null || !img.hasExtraData) continue;
      let top: MapTile | null = null;
      for (const n of [
        this._tiles.GetTileR(t.Rx - 1, t.Ry),
        this._tiles.GetTileR(t.Rx + 1, t.Ry),
        this._tiles.GetTileR(t.Rx, t.Ry - 1),
        this._tiles.GetTileR(t.Rx, t.Ry + 1),
      ])
        if (n != null && n.Z > t.Z && (top == null || n.Z > top.Z)) top = n;
      if (top != null) t.ExtraPalette = top.Palette;
    }
  }

  private RecalculatePalettes(): void {
    logger.info('Calculating palette-values for all objects');
    for (const p of this._palettesToBeRecalculated) p.recalculate();
  }

  MarkIceGrowth(): void {
    logger.info('Marking ice growth cells');
    this._drawingSurface.setCategory(LayerCategory.Terrain);
    const surface = this._drawingSurface;
    const tileWidth = this._config.TileWidth;
    const tileHeight = this._config.TileHeight;
    const vert = this.FullSize.Height * 2 > this.FullSize.Width;
    const radius = vert
      ? Math.trunc(Math.trunc((this.FullSize.Height * tileHeight) / 2) / 144 / 3)
      : Math.trunc(Math.trunc((this.FullSize.Width * tileWidth) / 2) / 133 / 3);
    const halfRadius = Math.trunc(radius / 2);
    const track = surface.trackingCategories;
    for (const tile of this._tiles) {
      if (tile == null) continue;
      const t = this._mapFile.Tiles.getTileR(tile.Rx, tile.Ry);
      if (t == null || t.IceGrowth <= 0) continue;

      // banded surfaces hold one strip: keep the cell's spacing but move it into surface rows
      const destX = Math.trunc((tile.Dx * tileWidth) / 2) - surface.OriginX;
      const destY = Math.trunc(((tile.Dy - tile.Z) * tileHeight) / 2) - surface.OriginY;
      if (destY + radius < 0 || destY - radius >= surface.Height) continue;

      const yStart = Math.max(0, destY - halfRadius);
      const yEnd = Math.min(surface.Height, destY + radius);
      const xStart = Math.max(0, destX - halfRadius);
      const xEnd = Math.min(surface.Width, destX + radius);
      for (let drawY = yStart; drawY < yEnd; drawY++) {
        let idx = (drawY * surface.Width + xStart) * 3;
        for (let drawX = xStart; drawX < xEnd; drawX++, idx += 3) {
          surface.data[idx] = 0x88;
          surface.data[idx + 1] = 0xff;
          surface.data[idx + 2] = 0x00;
          if (track) surface.markCategory(drawY * surface.Width + drawX);
        }
      }
    }
  }

  MarkTiledStartPositions(): void {
    const red = Palette.makePalette(new Color(255, 0, 0, 255));
    // a player start area is 4x4 cells in RA2/YR but 3x3 in TS/FS
    const markSize = Math.trunc(this.StartMarkerSize ?? (this._config.Engine >= EngineType.RedAlert2 ? 4 : 3));
    let delta1: number;
    let delta2: number;
    switch (markSize) {
      case 2:
        delta1 = -1;
        delta2 = 1;
        break;
      case 3:
        delta1 = -1;
        delta2 = 2;
        break;
      case 4:
        delta1 = -1;
        delta2 = 3;
        break;
      case 5:
        delta1 = -2;
        delta2 = 3;
        break;
      case 6:
        delta1 = -2;
        delta2 = 4;
        break;
      default:
        delta1 = -1;
        delta2 = 3;
        break;
    }
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < this.StartCapacity)) {
      for (let x = w.Tile.Rx + delta1; x < w.Tile.Rx + delta2; x++) {
        for (let y = w.Tile.Ry + delta1; y < w.Tile.Ry + delta2; y++) {
          const t = this._tiles.GetTileR(x, y);
          if (t != null && t.Palette != null) t.Palette = Palette.merge(t.Palette, red, 0.4);
        }
      }
    }
  }

  RedrawTiledStartPositions(reset = false): void {
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < this.StartCapacity)) {
      for (let x = w.Tile.Rx - 5; x < w.Tile.Rx + 5; x++) {
        for (let y = w.Tile.Ry - 5; y < w.Tile.Ry + 5; y++) {
          const t = this._tiles.GetTileR(x, y);
          if (t == null) continue;
          if (reset && t.Palette != null) t.Palette = this._palettePerLevel[t.Z];
          this._theater.Draw(t, this._drawingSurface);
        }
      }
      for (let x = w.Tile.Rx - 7; x < w.Tile.Rx + 7; x++) {
        for (let y = w.Tile.Ry - 7; y < w.Tile.Ry + 7; y++) {
          const t = this._tiles.GetTileR(x, y);
          if (t == null) continue;
          const objs = this.GetObjectsAt(t.Dx, Math.trunc(t.Dy / 2));
          for (const o of objs) this.DrawObjectElement(o);
        }
      }
    }
  }

  private DrawStartMarkersBittah(canvas: DrawingSurface, fullImage: Rectangle, previewImage: Rectangle): void {
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < this.StartCapacity)) {
      const t = this._tiles.getTile(w.Tile);
      if (t == null) continue;
      const center = new Point(Math.trunc((t.Dx * this._config.TileWidth) / 2), Math.trunc(((t.Dy - t.Z) * this._config.TileHeight) / 2));
      const pctFullX = (center.X - fullImage.Left) / fullImage.Width;
      const pctFullY = (center.Y - fullImage.Top) / fullImage.Height;
      const dest = new Point(Math.trunc(pctFullX * previewImage.Width), Math.trunc(pctFullY * previewImage.Height));
      const img = MarkerResources.Get(`bittah_marker_${w.Number + 1}`);
      if (img != null) {
        dest.Offset(-Math.trunc(img.Width / 2), -Math.trunc(img.Height / 2));
        drawImage(canvas, img, dest.X, dest.Y, 1.0);
      }
    }
  }

  private DrawStartMarkersAro(canvas: DrawingSurface, fullImage: Rectangle, previewImage: Rectangle): void {
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < this.StartCapacity)) {
      const t = this._tiles.getTile(w.Tile);
      if (t == null) continue;
      const center = new Point(Math.trunc((t.Dx * this._config.TileWidth) / 2), Math.trunc(((t.Dy - t.Z) * this._config.TileHeight) / 2));
      const pctFullX = (center.X - fullImage.Left) / fullImage.Width;
      const pctFullY = (center.Y - fullImage.Top) / fullImage.Height;
      const dest = new Point(Math.trunc(pctFullX * previewImage.Width), Math.trunc(pctFullY * previewImage.Height));
      const img = MarkerResources.Get(`aro_marker_${w.Number + 1}`);
      if (img != null) {
        dest.Offset(-Math.trunc(img.Width / 2), -Math.trunc(img.Height / 2));
        drawImage(canvas, img, dest.X, dest.Y, 1.0);
      }
    }
  }

  private LoadColors(): void {
    const colorsSection = this._rules.getOrCreateSection('Colors');
    for (const entry of colorsSection.OrderedEntries) {
      const colorComponents = entry.Value.toString().split(',');
      const h = new HsvColor(parseInt(colorComponents[0], 10), parseInt(colorComponents[1], 10), parseInt(colorComponents[2], 10));
      this._namedColors.set(entry.Key, h);
    }
  }

  private LoadHouses(): void {
    logger.info('Loading houses');
    const housesSection = this._rules.getOrCreateSection('Houses');
    for (const v of housesSection.OrderedEntries) {
      const houseSection = this._rules.getSection(v.Value.toString());
      if (houseSection == null) continue;

      let color: string;
      if (v.Value.toString() === 'Neutral' || v.Value.toString() === 'Special') color = 'LightGrey';
      else color = houseSection.readString('Color');
      if (color !== '' && v.Value.toString() !== '') {
        if (this._namedColors.has(color)) this._countryColors.set(v.Value.toString(), this._namedColors.get(color)!);
        else this._countryColors.set(v.Value.toString(), this._namedColors.get('LightGrey')!);
      }
    }

    // Last in LoadTheater, so nothing overwrites these. An unknown colour name falls back to
    // the neutral grey the object would have had anyway.
    const slotOwners = this.PreCaptureColors == null ? null : this.PreCaptureSlotOwners();
    for (let i = 0; slotOwners != null && i < slotOwners.length; i++) {
      if (slotOwners[i] == null) continue;
      const colorName = this.PreCaptureColors![i];
      this._countryColors.set(
        slotOwners[i]!,
        colorName != null && this._namedColors.has(colorName) ? this._namedColors.get(colorName)! : this._namedColors.get('LightGrey')!,
      );
    }
  }

  /// <summary>The owner name given to objects handed to each start position, or null for a
  /// slot with no colour. FinalSun's own label for the house, so a render log reads plainly.</summary>
  private PreCaptureSlotOwners(): (string | null)[] {
    const owners: (string | null)[] = [];
    for (let i = 0; i < this.PreCaptureColors!.length; i++) {
      const color = this.PreCaptureColors![i];
      owners.push(color == null || color === '' ? null : `<Player @ ${String.fromCharCode(65 + i)}>`);
    }
    return owners;
  }

  private LoadCountries(): void {
    logger.info('Loading countries');

    const sectionName = this._config.Engine >= EngineType.RedAlert2 ? 'Countries' : 'Houses';
    const countriesSection = this._rules.getSection(sectionName);
    if (countriesSection == null) {
      logger.warn(`Rules contain no [${sectionName}] section; house colors will be missing`);
      return;
    }
    for (const entry of countriesSection.OrderedEntries) {
      const countrySection = this._rules.getSection(entry.Value.toString());
      if (countrySection == null) continue;
      // the game draws the civilian houses in LightGrey whatever their Color= says
      const colorName =
        entry.Value.toString() === 'Neutral' || entry.Value.toString() === 'Special'
          ? 'LightGrey'
          : countrySection.readString('Color');
      let c: HsvColor;
      if (!this._namedColors.has(colorName)) c = this._namedColors.values().next().value as HsvColor;
      else c = this._namedColors.get(colorName)!;
      this._countryColors.set(entry.Value.toString(), c);
    }
  }

  DrawStartPositions(): void {
    logger.info('Marking start positions');
    this._drawingSurface.setCategory(LayerCategory.Terrain);
    const markerSize = this.StartMarkerSize ?? 4.0;
    for (const entry of this._wayPoints) {
      if (entry.Number < this.StartCapacity) {
        const t = this._tiles.getTile(entry.Tile);
        if (t == null) continue;
        const centerX = Math.trunc(((t.Dx + 1) * this._config.TileWidth) / 2);
        const centerY = Math.trunc(((t.Dy - t.Z + 1) * this._config.TileHeight) / 2);
        const halfWidth = Math.trunc(this._config.TileWidth * (markerSize / 2.0));
        const halfHeight = Math.trunc(this._config.TileHeight * (markerSize / 2.0));
        let opacity = 155 + Math.trunc((7.2 - markerSize) * 18);
        if (opacity < 145) opacity = 145;
        if (opacity > 255) opacity = 255;

        if (
          this.StartPosMarking === StartPositionMarking.Squared ||
          this.StartPosMarking === StartPositionMarking.Ellipsed ||
          this.StartPosMarking === StartPositionMarking.Circled) {
          const startX = centerX - halfWidth;
          const startY = centerY - halfHeight;
          let width = Math.trunc(this._config.TileWidth * markerSize);
          const height = Math.trunc(this._config.TileHeight * markerSize);

          if (this.StartPosMarking === StartPositionMarking.Ellipsed) {
            // fillEllipse takes radii; the game's ellipse is width x height across
            fillEllipse(this._drawingSurface, startX + width / 2, startY + height / 2, width / 2, height / 2, 255, 0, 0, opacity);
          } else {
            width = Math.trunc(width / 2);
            const nstartX = centerX - Math.trunc(halfWidth / 2);
            if (this.StartPosMarking === StartPositionMarking.Squared) {
              fillRect(this._drawingSurface, nstartX, startY, width, height, 255, 0, 0, opacity);
            } else {
              fillEllipse(this._drawingSurface, nstartX + width / 2, startY + height / 2, width / 2, height / 2, 255, 0, 0, opacity);
            }
          }
        } else if (this.StartPosMarking === StartPositionMarking.Diamond) {
          const rhombus = [
            new Point(centerX, centerY - halfHeight),
            new Point(centerX + halfWidth, centerY),
            new Point(centerX, centerY + halfHeight),
            new Point(centerX - halfWidth, centerY),
          ];
          fillPolygon(this._drawingSurface, rhombus, 255, 0, 0, opacity);
        } else if (this.StartPosMarking === StartPositionMarking.Starred) {
          const star: Point[] = [];
          const angle = Math.PI / 5;
          const shorter = (halfWidth + halfHeight) / 4.0;
          const longer = shorter * 2.3;
          for (let i = 0; i < 10; i += 2) {
            star[i] = new Point(
              centerX + Math.trunc(longer * Math.cos((i - 0.5) * angle)),
              centerY + Math.trunc(longer * Math.sin((i - 0.5) * angle)),
            );
            star[i + 1] = new Point(
              centerX + Math.trunc(shorter * Math.cos((i + 0.5) * angle)),
              centerY + Math.trunc(shorter * Math.sin((i + 0.5) * angle)),
            );
          }
          fillPolygon(this._drawingSurface, star, 255, 0, 0, opacity);
        }
      }
    }
    this._drawingSurface.lock();
  }

  FindCutoffHeight(): number {
    let y: number;
    for (y = this.FullSize.Height - 1; y > this.FullSize.Height - 10; y--) {
      let isRowFilled = true;
      if (y < 0) break;
      for (let x = 1; x < this.FullSize.Width * 2 - 3; x++) {
        if (this._tiles.GridTouched[x] == null || this._tiles.GridTouched[x][y] === 0 /* TouchType.Untouched */) {
          isRowFilled = false;
          break;
        }
      }
      if (isRowFilled) break;
    }
    logger.debug(`Cutoff-height determined at ${y}, cutting off ${this.FullSize.Height - y} rows (full height ${this.FullSize.Height})`);
    return y;
  }

  /** Walks the draw passes on a 1x1 surface so the touched-tile state the cutoff row reads is
   * complete before a banded render decides which rows the preview covers. */
  MeasureTileTouchState(): void {
    const previous = this._drawingSurface;
    this._drawingSurface = new DrawingSurface(1, 1, SurfaceFormat.Bgr24);
    this._drawingSurface.MeasureOnly = true;
    this._bandOriginY = 0;
    this._bandHeight = Number.MAX_SAFE_INTEGER;
    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) this.DrawTilePass(this._tiles.GetTile(x, y));
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) this.DrawTilePass(this._tiles.GetTile(x, y));
    }
    const [cellRowStart, cellRowEnd] = this.GetBandRowWindow(240);
    for (let y = cellRowEnd; y >= cellRowStart; y--) {
      for (let x = 1; x <= this.FullSize.Width * 2 - 3; x += 2) this.DrawCellPass(this._tiles.GetTile(x, y));
      for (let x = 0; x <= this.FullSize.Width * 2 - 2; x += 2) this.DrawCellPass(this._tiles.GetTile(x, y));
    }
    this._drawingSurface = previous;
  }

  /** Drops the strip surface so the next strip does not keep two canvases alive at once. */
  ReleaseDrawingSurface(): void {
    this._drawingSurface = new DrawingSurface(1, 1, SurfaceFormat.Bgr24);
  }

  GetSizePixels(sizeMode: SizeMode): Rectangle {
    switch (sizeMode) {
      case SizeMode.Local:
        return this.GetLocalSizePixels();
      case SizeMode.Full:
        return this.GetFullMapSizePixels();
      case SizeMode.Auto:
        return this.GetAutoSizePixels();
    }
    return Rectangle.Empty;
  }

  GetAutoSizePixels(): Rectangle {
    const full = this.GetFullMapSizePixels();
    const local = this.GetLocalSizePixels();
    const delta = 0.15;
    if (
      Math.abs(full.Left - local.Left) / full.Width < delta &&
      Math.abs(full.Width - local.Width) / full.Width < delta &&
      Math.abs(full.Top - local.Top) / full.Height < delta &&
      Math.abs(full.Bottom - local.Bottom) / full.Height < delta
    )
      return local;
    else return full;
  }

  GetFullMapSizePixels(): Rectangle {
    const left = Math.trunc(this._config.TileWidth / 2);
    const top = Math.trunc(this._config.TileHeight / 2);
    const right = (this.FullSize.Width - 1) * this._config.TileWidth;
    const cutoff = this.FindCutoffHeight();
    const bottom = cutoff * this._config.TileHeight + (1 + (cutoff % 2)) * Math.trunc(this._config.TileHeight / 2);
    return Rectangle.FromLTRB(left, top, right, bottom);
  }

  GetLocalSizePixels(): Rectangle {
    const left = Math.max(this.LocalSize.Left * this._config.TileWidth, 0);
    const top = Math.max(this.LocalSize.Top - 3, 0) * this._config.TileHeight + Math.trunc(this._config.TileHeight / 2);
    const right = (this.LocalSize.Left + this.LocalSize.Width) * this._config.TileWidth;

    let bottom1 = 2 * (this.LocalSize.Top - 3 + this.LocalSize.Height + 5);
    const extra = this._config.ExtraOptions[0];
    if (extra != null) {
      let bottomCrop = 0;
      if (!Number.isNaN(parseInt(extra.MapLocalSizeBottomCropValue, 10))) bottomCrop = parseInt(extra.MapLocalSizeBottomCropValue, 10);
      bottomCrop = Math.abs(bottomCrop);
      if (bottom1 > bottomCrop && bottomCrop >= 0 && bottomCrop < 17) bottom1 -= bottomCrop;
    }
    const cutoff = this.FindCutoffHeight() * 2;
    const bottom2 = cutoff + 1 + (cutoff % 2);
    const bottom = Math.min(bottom1, bottom2) * Math.trunc(this._config.TileHeight / 2);
    return Rectangle.FromLTRB(left, top, right, bottom);
  }

  MarkOreAndGems(): void {
    logger.info('Marking ore and gems');
    const markerPalettes = new Map<OverlayTibType, Palette>();

    // init sensible defaults
    if (this._config.Engine >= EngineType.RedAlert2) {
      markerPalettes.set(OverlayTibType.Ore, Palette.makePalette(new Color(255, 255, 0, 255)));
      markerPalettes.set(OverlayTibType.Ore2, Palette.makePalette(new Color(255, 255, 0, 255)));
      markerPalettes.set(OverlayTibType.Ore3, Palette.makePalette(new Color(255, 255, 0, 255)));
      markerPalettes.set(OverlayTibType.Gems, Palette.makePalette(new Color(128, 0, 128, 255)));
    }

    const tiberiums = this._rules
      .getOrCreateSection('Tiberiums')
      .OrderedEntries.map((kvp) => kvp.Value.toString());
    const remaps = tiberiums.map((tib) =>
      this._rules.getOrCreateSection(tib).readString(this._config.Engine >= EngineType.RedAlert2 ? 'MapRendererColor' : 'Color'),
    );

    for (let i = 0; i < tiberiums.length; i++) {
      const type = stringToOverlayTibType(tiberiums[i]);
      const namedColor = remaps[i];
      if (this._namedColors.has(namedColor)) markerPalettes.set(type, Palette.makePalette(this._namedColors.get(namedColor)!.toRGB()));
    }

    for (const o of this._overlayObjects) {
      if (o == null) continue;
      const ovlType = SpecialOverlays.GetOverlayTibType(o, this._config.Engine);
      if (!markerPalettes.has(ovlType)) continue;

      const opacityBase =
        (ovlType === OverlayTibType.Ore || ovlType === OverlayTibType.Ore2 || ovlType === OverlayTibType.Ore3) &&
        this._config.Engine === EngineType.RedAlert2
          ? 0.3
          : 0.15;
      const opacity = Math.max(0, 12 - o.OverlayValue) / 11.0 * 0.5 + opacityBase;
      if (o.Tile != null && o.Tile.Palette != null) {
        const original = o.Tile.Palette;
        o.Tile.Palette = Palette.merge(original, markerPalettes.get(ovlType)!, opacity);
        this._orePaletteRestores.push(() => { o.Tile!.Palette = original; });
      }
      if (o.Palette != null) {
        const original = o.Palette;
        o.Palette = Palette.merge(original, markerPalettes.get(ovlType)!, opacity);
        this._orePaletteRestores.push(() => { o.Palette = original; });
      }
    }
  }

  /** Undoes the temporary ore/gem palette merge so the next band or render starts from the
   * original colours instead of merging the marker on top of an already marked palette. */
  RestoreOrePalettes(): void {
    for (const restore of this._orePaletteRestores) restore();
    this._orePaletteRestores.length = 0;
  }

  RedrawOreAndGems(): void {
    const tileCollection = this._theater.GetTileCollection();
    const checkFunc = (ovl: OverlayObject): boolean =>
      SpecialOverlays.GetOverlayTibType(ovl, this._config.Engine) !== OverlayTibType.NotSpecial;

    // first redraw all required tiles (zigzag method)
    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && this.InBand(tile, 240) && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a)))
          this._theater.Draw(tile, this._drawingSurface);
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && this.InBand(tile, 240) && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a)))
          this._theater.Draw(tile, this._drawingSurface);
      }
    }
    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && this.InBand(tile, 240) && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a))) {
          const objs = this.GetObjectsAt(x, y);
          for (const o of objs) this.DrawObjectElement(o);
        }
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && this.InBand(tile, 240) && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a))) {
          const objs = this.GetObjectsAt(x, y);
          for (const o of objs) this.DrawObjectElement(o);
        }
      }
    }
  }

  Draw(band?: { originY: number; height: number }): void {
    const fullWidth = this.FullSize.Width * this._config.TileWidth;
    const fullHeight = this.FullSize.Height * this._config.TileHeight;
    const originY = band != null ? Math.max(0, Math.min(band.originY, fullHeight)) : 0;
    const bandHeight = band != null ? Math.max(1, Math.min(band.height, fullHeight - originY)) : fullHeight;
    // A band surface holds one horizontal strip of the map: at 500x500 cells the full canvas is
    // 29760x14805 (2.2 GB of pixels + z), which no longer fits a normal render budget
    const reusable = this._bandSurface != null
      && this._bandSurface.Width === fullWidth
      && this._bandSurface.Height === bandHeight
      && !this.TrackCategories && !this.TrackVoxelMask;
    let surface: DrawingSurface;
    if (reusable) {
      // Same strip size as the previous band: clear and re-aim instead of allocating 5 B/px again.
      surface = this._bandSurface!;
      surface.OriginX = 0;
      surface.OriginY = originY;
      surface.reset();
    } else {
      surface = new DrawingSurface(fullWidth, bandHeight, SurfaceFormat.Bgr24, 0, originY);
      this._bandSurface = !this.TrackCategories && !this.TrackVoxelMask ? surface : null;
    }
    this._drawingSurface = surface;
    surface.TrackVoxelMask = this.TrackVoxelMask;
    surface.TrackCategories = this.TrackCategories;
    surface.getCategories();
    surface.setCategory(LayerCategory.Terrain);
    this._bandOriginY = originY;
    this._bandHeight = bandHeight;

    let lastReported = 0.0;
    const [tileRowStart, tileRowEnd] = this.GetBandRowWindow(40);
    for (let y = tileRowStart; y <= tileRowEnd; y++) {
      if (logger.isEnabled(LogLevel.Trace)) logger.trace(`Drawing tiles row ${y}`);
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) this.DrawTilePass(this._tiles.GetTile(x, y));
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) this.DrawTilePass(this._tiles.GetTile(x, y));

      if (this.Progress != null)
        this.Progress.Span(20, 20 + Math.trunc((this.Progress.DrawEnd - 20) / 2), y / this.FullSize.Height, 'drawing tiles');
      const pct = (50.0 * y) / this.FullSize.Height;
      if (pct > lastReported + 5) {
        logger.info(`Drawing tiles... ${Math.round(pct)}%`);
        lastReported = pct;
      }
    }
    logger.info('Tiles drawn');
    // [DEBUG] 瓦片 pass 后立即落盘（环境变量 CNC_MIDPOINT_DUMP 指定输出路径）
    if (process.env.CNC_MIDPOINT_DUMP) {
      const rect = new Rectangle(0, 0, this._drawingSurface.Width, this._drawingSurface.Height);
      PngWriter.save(process.env.CNC_MIDPOINT_DUMP, this._drawingSurface.data, this._drawingSurface.Width, 3, rect, 1);
      logger.info('Midpoint surface dumped to ' + process.env.CNC_MIDPOINT_DUMP);
    }

    // the game's overlay pass (TacticalClass 0x6d6d10) and its terrain pass walk the map from the
    // bottom row up and left to right; with the strict z-test the earlier drawing keeps a tie, so
    // this order decides which of two equal-z deck pieces or neighbouring trees shows. Overlay z
    // (walls, ore, bridge decks) is written before any object is tested, and units, which never
    // write z, cannot be repainted by an overlay
    this._drawingSurface.setCategory(LayerCategory.Overlay);
    const [cellRowStart, cellRowEnd] = this.GetBandRowWindow(240);
    for (let y = cellRowEnd; y >= cellRowStart; y--) {
      for (let x = 1; x <= this.FullSize.Width * 2 - 3; x += 2) this.DrawCellPass(this._tiles.GetTile(x, y));
      for (let x = 0; x <= this.FullSize.Width * 2 - 2; x += 2) this.DrawCellPass(this._tiles.GetTile(x, y));
    }
    logger.info('Overlays drawn');

    // Tiberian Sun darkens the ground beside cliff and slope pieces with a shadow of their own
    // (Tactical::Draw_Tile_Shadows). The engine's tile pass has already painted the cell overlays
    // into its tile surface by then, so the shadow's strict test loses on their pixels and veins
    // and ore stay bright on darkened ground; that is why the pass runs after the overlays here
    const tileTypes = this._theater.GetTileCollection();
    this._drawingSurface.setCategory(LayerCategory.Terrain);
    const [shadowRowStart, shadowRowEnd] = this.GetBandRowWindow(180);
    for (let y = shadowRowStart; y <= shadowRowEnd; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const t = this._tiles.GetTile(x, y);
        if (t != null && this.InBand(t, 180)) tileTypes.DrawTileShadow(t, this._drawingSurface);
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const t = this._tiles.GetTile(x, y);
        if (t != null && this.InBand(t, 180)) tileTypes.DrawTileShadow(t, this._drawingSurface);
      }
    }

    // gamemd draws every TerrainClass before the techno layer (TREE -> BLDG -> ANIM): a tree's
    // write-only shadow lands on the tile art first and anything standing in front repaints it
    // with its own z
    this._drawingSurface.setCategory(LayerCategory.TerrainObject);
    const [terrainRowStart, terrainRowEnd] = this.GetBandRowWindow(240);
    for (let y = terrainRowEnd; y >= terrainRowStart; y--) {
      for (let x = 1; x <= this.FullSize.Width * 2 - 3; x += 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && this.InBand(tile, 240))
          for (const o of tile.AllObjects) if (o instanceof TerrainObject) this.DrawObjectElement(o);
      }
      for (let x = 0; x <= this.FullSize.Width * 2 - 2; x += 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && this.InBand(tile, 240))
          for (const o of tile.AllObjects) if (o instanceof TerrainObject) this.DrawObjectElement(o);
      }
    }
    logger.info('Terrain objects drawn');

    lastReported = 0.0;
    const [objectRowStart, objectRowEnd] = this.GetBandRowWindow(420);
    for (let y = objectRowStart; y <= objectRowEnd; y++) {
      if (logger.isEnabled(LogLevel.Trace)) logger.trace(`Drawing objects row ${y}`);
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile == null || !this.InBand(tile, 420)) continue;
        for (const o of tile.DrawObjects) {
          this.DrawObjectElement(o);
        }
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile == null || !this.InBand(tile, 420)) continue;
        for (const o of tile.DrawObjects) {
          this.DrawObjectElement(o);
        }
      }

      if (this.Progress != null)
        this.Progress.Span(20 + Math.trunc((this.Progress.DrawEnd - 20) / 2), this.Progress.DrawEnd, y / this.FullSize.Height, 'drawing objects');
      const pct = 50 + (50.0 * y) / this.FullSize.Height;
      if (pct > lastReported + 5) {
        logger.info(`Drawing objects... ${Math.round(pct)}%`);
        lastReported = pct;
      }
    }

    this._drawingSurface.drawDeferredAnims();
    this._drawingSurface.drawDeferredAlpha();

    // Highlight ore & gem fields when requested (marked + redrawn on top).
    if (this.MarkOreFields) {
      logger.info('Highlighting ore and gems');
      this._drawingSurface.setCategory(LayerCategory.Overlay);
      this.MarkOreAndGems();
      this.RedrawOreAndGems();
      this.RestoreOrePalettes();
    }
    logger.info('Map drawing completed');
  }

  // the game's tile walk (TacticalClass 0x6d7560, top row down) blits each cell's smudge right after
  // its tile without a z-test, so the tiles of later cells paint over it and, for a multi-cell
  // smudge, the copy from the last cell of the foundation ends on top
  // the band a pass is drawing into, in map render rows; anchorY is where a tile's diamond sits
  private _bandOriginY = 0;
  private _bandHeight = 0;
  /** Strip surface kept between bands so a banded render does not allocate 5 B/px per strip. */
  private _bandSurface: DrawingSurface | null = null;
  /** Palette swaps made by MarkOreAndGems, undone once the band is painted. */
  private readonly _orePaletteRestores: (() => void)[] = [];

  /** Can a sprite anchored on this tile still paint inside the current band? A sprite draws
   * upward from its anchor, so a tile below the band can still reach into it. */
  private InBand(t: MapTile, margin: number): boolean {
    const anchorY = Math.trunc(((t.Dy - t.Z) * this._config.TileHeight) / 2);
    return anchorY + margin >= this._bandOriginY && anchorY - margin <= this._bandOriginY + this._bandHeight;
  }

  /** Rows whose tiles can pass InBand() for this band. A banded render used to walk every map
   * row for each of the five passes; for a 500x500 map and 45px strips that is ~8e8 checks that
   * can only fail. maxZ is the highest tile height the engine supports (RA2 cliffs reach 12). */
  private GetBandRowWindow(margin: number): [number, number] {
    const rows = this.FullSize.Height;
    if (this._bandHeight >= rows * this._config.TileHeight) return [0, rows - 1];
    const th = this._config.TileHeight;
    const maxZ = 20;
    const start = Math.max(0, Math.floor((this._bandOriginY - margin - th / 2) / th) - 1);
    const end = Math.min(
      rows - 1,
      Math.ceil((this._bandOriginY + this._bandHeight + margin + (maxZ * th) / 2) / th) + 1,
    );
    return [start, end];
  }

  private DrawTilePass(tile: MapTile | null): void {
    if (tile == null) return;
    if (!this.InBand(tile, 40)) return;
    this._drawingSurface.setCategory(LayerCategory.Terrain);
    this._theater.Draw(tile, this._drawingSurface);
    for (const o of tile.AllObjects) {
      if (o instanceof SmudgeObject) {
        this.DrawObjectElement(o);
      }
    }
  }

  private DrawCellPass(tile: MapTile | null): void {
    if (tile == null) return;
    if (!this.InBand(tile, 240)) return;
    for (const o of tile.AllObjects) if (o instanceof OverlayObject) this.DrawObjectElement(o);
  }

  /** PSD category for a techno/terrain object in the object pass. */
  private CategoryForObject(o: GameObject): LayerCategory {
    if (o instanceof StructureObject) return LayerCategory.Structure;
    if (o instanceof InfantryObject) return LayerCategory.Infantry;
    if (o instanceof AircraftObject) return LayerCategory.Aircraft;
    if (o instanceof UnitObject) return o.Drawable?.Naval ? LayerCategory.Naval : LayerCategory.Vehicle;
    if (o instanceof TerrainObject) return LayerCategory.TerrainObject;
    if (o instanceof OverlayObject) return LayerCategory.Overlay;
    if (o instanceof SmudgeObject) return LayerCategory.Smudge;
    return LayerCategory.Terrain;
  }

  /** Draws one object. For PSD export every non-terrain object also collects its own art in a
   * layer inside its category group, instead of merging into one category layer. */
  private DrawObjectElement(o: GameObject): void {
    const ds = this._drawingSurface;
    const category = this.CategoryForObject(o);
    ds.setCategory(category);
    if (category === LayerCategory.Terrain) {
      this._theater.Draw(o, ds);
      return;
    }
    ds.beginElement(this.ElementName(o), category);
    try {
      this._theater.Draw(o, ds);
    } finally {
      ds.endElement();
    }
  }

  /** Layer name inside a category group. Techno and terrain objects carry their cell so two
   * objects of the same type stay separate; the name itself is the game's localized
   * `Name:<ID>` string when the CSF has one, and overlays and smudges merge by type so a
   * field of ore does not become thousands of one-cell layers. */
  private ElementName(o: GameObject): string {
    if (o instanceof OverlayObject) return o.Drawable?.Name || `Overlay ${o.OverlayID}`;
    if (o instanceof SmudgeObject) return o.Name;
    if (o instanceof NamedObject) {
      const t = o.Tile;
      const name = this.DisplayName(o.Name);
      return t != null ? `${name} (${t.Rx},${t.Ry})` : name;
    }
    return 'Object';
  }

  GeneratePreviewPack(previewMarkers: PreviewMarkersType, sizeMode: SizeMode, map: IniFile, fixDimensions: boolean): void {
    logger.info('Generating PreviewPack data');

    this._drawingSurface.lock();
    if (this.MarkOreFields === false) {
      logger.trace('Marking ore and gems areas');
      this.MarkOreAndGems();
      logger.debug('Redrawing ore and gems areas');
      this.RedrawOreAndGems();
    }

    switch (previewMarkers) {
      case PreviewMarkersType.None:
        this.RedrawTiledStartPositions(true);
        break;
      case PreviewMarkersType.SelectedAsAbove:
        if (this.StartPosMarking === StartPositionMarking.Tiled) {
          this.RedrawTiledStartPositions(true);
          this.MarkTiledStartPositions();
          this.RedrawTiledStartPositions(false);
        } else if (
          this.StartPosMarking === StartPositionMarking.Squared ||
          this.StartPosMarking === StartPositionMarking.Ellipsed ||
          this.StartPosMarking === StartPositionMarking.Diamond ||
          this.StartPosMarking === StartPositionMarking.Circled ||
          this.StartPosMarking === StartPositionMarking.Starred
        ) {
          this.RedrawTiledStartPositions(true);
          this.DrawStartPositions();
        }
        break;
      case PreviewMarkersType.Bittah:
      case PreviewMarkersType.Aro:
        this.RedrawTiledStartPositions(true);
        break;
    }
    this._drawingSurface.unlock();

    let pw: number;
    let ph: number;
    switch (this._config.Engine) {
      case EngineType.TiberianSun:
      case EngineType.Firestorm:
      case EngineType.RedAlert2:
        pw = Math.ceil((fixDimensions ? 1.975 : 2.0) * this.FullSize.Width);
        ph = Math.ceil((fixDimensions ? 0.995 : 1.0) * this.FullSize.Height);
        break;
      case EngineType.YurisRevenge:
        pw = Math.ceil((fixDimensions ? 1.975 : 2.0) * this.LocalSize.Width);
        ph = Math.ceil((fixDimensions ? 1.0 : 1.0) * this.LocalSize.Height);
        break;
      default:
        throw new RangeError('Unsupported engine');
    }

    const srcRect = this.GetSizePixels(sizeMode);
    const dstRect = new Rectangle(0, 0, pw, ph);
    let preview = this._drawingSurface.copyRegion(srcRect);
    preview = resizeBicubic(preview, pw, ph);

    switch (previewMarkers) {
      case PreviewMarkersType.None:
      case PreviewMarkersType.SelectedAsAbove:
        break;
      case PreviewMarkersType.Bittah:
        this.DrawStartMarkersBittah(preview, srcRect, dstRect);
        break;
      case PreviewMarkersType.Aro:
        this.DrawStartMarkersAro(preview, srcRect, dstRect);
        break;
    }

    logger.info('Injecting thumbnail into map');
    ThumbInjector.InjectThumb(preview, map);
  }

  DebugDrawTile(tile: MapTile): void {
    this._theater.Draw(tile, this._drawingSurface);
    for (const o of this.GetObjectsAt(tile.Dx, Math.trunc(tile.Dy / 2))) this._theater.Draw(o, this._drawingSurface);
  }

  GetObjectsAt(dx: number, dy: number, includeOverlays = true): GameObject[] {
    const tile = this._tiles.GetTile(dx, dy);
    if (tile == null) return [];
    const ret: GameObject[] = [];
    for (const o of tile.AllObjects) if (o instanceof SmudgeObject) ret.push(o);
    // the main draw handles overlays in the terrain pass; localized redraws
    // (ore markers, tiled start positions) still want them here
    if (includeOverlays) for (const o of tile.AllObjects) if (o instanceof OverlayObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof TerrainObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof InfantryObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof UnitObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof StructureObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof AircraftObject) ret.push(o);
    return ret;
  }

  GetDrawingSurface(): DrawingSurface {
    return this._drawingSurface;
  }
  GetTiles(): TileLayer {
    return this._tiles;
  }
  GetTheater(): Theater {
    return this._theater;
  }

  /// <summary>Iso tile dimensions in pixels; 60x30 for RA2/YR, 48x24 for TS/FS.</summary>
  get TileWidth(): number {
    return this._config.TileWidth;
  }
  get TileHeight(): number {
    return this._config.TileHeight;
  }

  /// <summary>Start waypoints with their cell and the pixel centre of that cell on the
  /// drawing surface. Subtract the saved image's crop origin to reach coordinates in the
  /// saved file. Used to align a render against an engine capture of the same map.</summary>
  GetStartPositionPixels(): StartPositionPixel[] {
    const positions: StartPositionPixel[] = [];
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < this.StartCapacity).sort((a, b) => a.Number - b.Number)) {
      const t = this._tiles.getTile(w.Tile);
      if (t == null) continue;
      const sp = new StartPositionPixel();
      sp.Number = w.Number;
      sp.Rx = t.Rx;
      sp.Ry = t.Ry;
      sp.Z = t.Z;
      sp.X = Math.trunc(((t.Dx + 1) * this._config.TileWidth) / 2);
      sp.Y = Math.trunc(((t.Dy - t.Z + 1) * this._config.TileHeight) / 2);
      positions.push(sp);
    }
    return positions;
  }

  /// <summary>Derives map statistics for --meta-json. Requires rules to still be loaded,
  /// so call before FreeUseless.</summary>
  ComputeStats(): MapStats {
    const stats = new MapStats();
    const coll = this._theater.GetTileCollection();
    const cliffSets = new Set<number>([
      coll.CliffSet,
      coll.WaterCliffs,
      coll.DestroyableCliffs,
      coll.WaterCliffAPieces,
      coll.MMWaterCliffAPieces,
      coll.CrystalCliff,
    ]);
    const rampSets = new Set<number>([
      coll.RampBase,
      coll.RampSmooth,
      coll.SlopeSetPieces,
      coll.SlopeSetPieces2,
      coll.CliffRamps,
      coll.PavedRoadSlopes,
      coll.DirtRoadSlopes,
      coll.MonorailSlopes,
    ]);
    cliffSets.delete(-1);
    rampSets.delete(-1);

    stats.HeightMin = 0x7fffffff; // int.MaxValue
    for (const t of this._tiles) {
      if (t == null) continue;
      stats.TotalTiles++;
      if (t.Z < stats.HeightMin) stats.HeightMin = t.Z;
      if (t.Z > stats.HeightMax) stats.HeightMax = t.Z;
      if (t.SetNum === -1) continue;
      if (t.SetNum === coll.WaterSet || (t.SetNum === coll.WaterCaves && coll.WaterCaves !== -1)) stats.WaterTiles++;
      else if (t.SetNum === coll.ShorePieces) stats.ShoreTiles++;
      else if (cliffSets.has(t.SetNum)) stats.CliffTiles++;
      else if (rampSets.has(t.SetNum)) stats.RampTiles++;
    }
    if (stats.HeightMin === 0x7fffffff) stats.HeightMin = 0;

    // full ore cell = 12 * Value credits: a cell holds OverlayValue+1 units
    const oreValue = this._rules.getOrCreateSection('Riparius').readInt('Value', 25);
    const gemValue = this._rules.getOrCreateSection('Cruentus').readInt('Value', 50);
    const ore2Value = this._rules.getOrCreateSection('Vinifera').readInt('Value', 25);
    const ore3Value = this._rules.getOrCreateSection('Aboreus').readInt('Value', 25);
    for (const ovl of this._overlayObjects) {
      const tib = SpecialOverlays.GetOverlayTibType(ovl, this._config.Engine);
      switch (tib) {
        case OverlayTibType.Ore:
          stats.OreCells++;
          stats.TotalCredits += (ovl.OverlayValue + 1) * oreValue;
          break;
        case OverlayTibType.Gems:
          stats.GemCells++;
          stats.TotalCredits += (ovl.OverlayValue + 1) * gemValue;
          break;
        case OverlayTibType.Vinifera:
          stats.OreCells++;
          stats.TotalCredits += (ovl.OverlayValue + 1) * ore2Value;
          break;
        case OverlayTibType.Aboreus:
          stats.OreCells++;
          stats.TotalCredits += (ovl.OverlayValue + 1) * ore3Value;
          break;
      }
      // overlay ids 59/60 are rail bridges in TS but plain train tracks in RA2/YR
      if (
        SpecialOverlays.IsHighBridge(ovl) ||
        (this._config.Engine <= EngineType.Firestorm && SpecialOverlays.IsTSHighRailsBridge(ovl)) ||
        (ovl.Drawable != null && ovl.Drawable.Name.toUpperCase().startsWith('LOBRDG'))
      )
        stats.HasBridges = true;
    }

    for (const s of this._structureObjects) {
      stats.Structures++;
      const rs = this._rules.getSection(s.Name);
      if (rs == null) continue;
      if (rs.readBool('NeedsEngineer')) {
        stats.TechStructures++;
        stats.TechStructureTypes.set(s.Name, (stats.TechStructureTypes.get(s.Name) ?? 0) + 1);
      }
      if (rs.readBool('CanBeOccupied')) stats.GarrisonableStructures++;
    }
    stats.TerrainObjects = this._terrainObjects.length;
    stats.OreSpawners = this._terrainObjects.filter((t) => t.Name.toUpperCase().startsWith('TIBTRE')).length;
    stats.Units = this._unitObjects.length;
    stats.Infantry = this._infantryObjects.length;
    stats.Aircraft = this._aircraftObjects.length;
    stats.Smudges = this._smudgeObjects.length;
    return stats;
  }

  FreeUseless(): void {
    this._bandSurface = null;
    this._countryColors.clear();
    this._namedColors.clear();
    this._lightSources.length = 0;
    this._palettePerLevel.length = 0;
    this._palettesToBeRecalculated.clear();
  }

  FixupTileLayer(): void {
    logger.info('Locating undefined tiles on map');
    const coll = this._theater.GetTileCollection();
    let brokenTiles = 0;
    for (const tile of [...this._tiles]) {
      if (tile.TileNum >= coll.NumTiles) {
        logger.warn(`Removing tile at (${tile.Rx},${tile.Ry}) with tilenum ${tile.TileNum} because it is not valid in this theathers tileset`);
        this.ChangeTileToClear(coll, tile);
        brokenTiles++;
        continue;
      }
      const drawable = coll.GetDrawable(tile) as TileDrawable;
      if (drawable == null) {
        logger.warn(`Removing tile at (${tile.Rx},${tile.Ry}) with tilenum ${tile.TileNum} because no definition for it was found`);
        this.ChangeTileToClear(coll, tile);
        brokenTiles++;
        continue;
      }

      const tmp = drawable.GetTileFile(tile);
      if (tmp == null) {
        logger.warn(
          `Removing tile #${tile.TileNum}@(${tile.Rx},${tile.Ry}) because no tmp file for it was found; set ` +
            `${drawable.Name} (${drawable.TsEntry?.MemberOfSet?.SetName ?? ''}), expected filename ${drawable.TsEntry?.MemberOfSet?.FileName ?? ''}xx${ModConfig.ActiveTheater?.Extension ?? ''}`,
        );
        brokenTiles++;
        this.ChangeTileToClear(coll, tile);
      } else {
        try {
          if (!drawable.DoesSubTileExist(tile)) {
            logger.warn(
              `Removing tile-subtile,count #${tile.TileNum}-${tile.SubTile}@(${tile.Rx},${tile.Ry}) because subtile for it was not found; set ` +
                `${drawable.Name} (${drawable.TsEntry?.MemberOfSet?.SetName ?? ''}), expected filename ${drawable.TsEntry?.MemberOfSet?.FileName ?? ''}xx${ModConfig.ActiveTheater?.Extension ?? ''}`,
            );
            brokenTiles++;
            this.ChangeTileToClear(coll, tile);
          }
        } catch {
          // the game lets a broken tsentry here take the process down; a render should not
        }
      }
    }
    if (brokenTiles === 0) {
      logger.info('No undefined/broken tiles found, not altering IsoMapPack5 section');
    } else {
      logger.info(`Fixing IsoMapPack5 section with ${brokenTiles} broken tiles`);
      this._mapFile.Tiles.serializeIsoMapPack5(this._mapFile.getSection('IsoMapPack5') as IniSection);
    }
  }

  private ChangeTileToClear(coll: TileCollection | null, tile: MapTile): void {
    tile.TileNum = 0;
    tile.SubTile = 0;
    tile.Drawable = coll != null ? coll.GetDrawable(0) : null;

    const t = this._mapFile.Tiles.getTileR(tile.Rx, tile.Ry);
    if (t != null) {
      t.TileNum = 0;
      t.SubTile = 0;
    }
  }

  FixupOverlays(): void {
    // The plane width follows [Map] Size on VERA20k maps (512 retail, 1024 extended).
    const side = this._mapFile.GridSide;
    const overlayPack = new Uint8Array(side * side);
    const overlayDataPack = new Uint8Array(side * side);

    if (this._overlaysAltered) {
      overlayPack.fill(255);

      for (const obj of [...this._overlayObjects]) {
        const location = obj.Tile!.Ry * side + obj.Tile!.Rx;
        if (location < overlayPack.length) {
          overlayPack[location] = obj.OverlayID;
          overlayDataPack[location] = obj.OverlayValue;
        }
      }

      const oPackEncoded = Buffer.from(Format5.Encode(overlayPack, 80)).toString('base64');
      const oDataPackEncoded = Buffer.from(Format5.Encode(overlayDataPack, 80)).toString('base64');

      const overlayPackSection = this._mapFile.getSection('OverlayPack');
      if (overlayPackSection != null) {
        overlayPackSection.clear();
        let rowNum = 1;
        for (let i = 0; i < oPackEncoded.length; i += 70) {
          overlayPackSection.setValue((rowNum++).toString(), oPackEncoded.substring(i, Math.min(70, oPackEncoded.length - i)));
        }

        const overlayDataPackSection = this._mapFile.getSection('OverlayDataPack');
        if (overlayDataPackSection != null) {
          overlayDataPackSection.clear();
          rowNum = 1;
          for (let i = 0; i < oDataPackEncoded.length; i += 70) {
            overlayDataPackSection.setValue((rowNum++).toString(), oDataPackEncoded.substring(i, Math.min(70, oDataPackEncoded.length - i)));
          }
        }
      }
    }
  }

  CompressIsoMapPack5(): void {
    logger.info('Generating compressed IsoMapPack5 section. Please wait ...');
    this._mapFile.Tiles.serializeIsoMapPack5(this._mapFile.getSection('IsoMapPack5') as IniSection, true);
  }

  PlotTunnels(adjustPosition = true): void {
    logger.info('Plotting Tunnel path');
    this._drawingSurface.setCategory(LayerCategory.Terrain);
    let lineColor = { r: 255, g: 0, b: 0, a: 148 };
    let dashColor = { r: 0, g: 255, b: 205, a: 180 };
    const dashValues = [2, 1];

    const endCells = new Set<number>();

    for (const tunnelLine of this._mapFile.TunnelEntries) {
      let deltaFromCenterY = 1;
      let deltaFromCenterX = 0;
      const linePoints: Point[] = [];

      const startTile = this._tiles.GetTileR(tunnelLine.StartX, tunnelLine.StartY);
      const endTile = this._tiles.GetTileR(tunnelLine.EndX, tunnelLine.EndY);
      if (startTile == null || endTile == null) continue;

      const startTileCenter = new Point(
        Math.trunc(((startTile.Dx + 1) * this._config.TileWidth) / 2),
        Math.trunc(((startTile.Dy - startTile.Z + 1 - (adjustPosition ? 4 : 0)) * this._config.TileHeight) / 2),
      );
      const endTileCenter = new Point(
        Math.trunc(((endTile.Dx + 1) * this._config.TileWidth) / 2),
        Math.trunc(((endTile.Dy - endTile.Z + 1 - (adjustPosition ? 4 : 0)) * this._config.TileHeight) / 2),
      );

      endCells.add(tunnelLine.EndX + 1000 * tunnelLine.EndY);
      if (endCells.has(tunnelLine.StartX + 1000 * tunnelLine.StartY)) {
        lineColor = { r: 255, g: 30, b: 255, a: 148 };
        dashColor = { r: 0, g: 0, b: 255, a: 180 };
        deltaFromCenterY = 2;
      } else {
        lineColor = { r: 255, g: 0, b: 0, a: 148 };
        dashColor = { r: 0, g: 255, b: 205, a: 180 };
        deltaFromCenterY = -2;
      }

      let currentTile = startTile;
      let nextTile: MapTile | null = currentTile;
      const currentPoint = new Point(startTileCenter.X, startTileCenter.Y + deltaFromCenterY);
      let addWidth = 0;
      let addHeight = 0;

      linePoints.push(currentPoint);

      if (tunnelLine.Direction != null) {
        for (const d of tunnelLine.Direction) {
          deltaFromCenterX = 0;
          switch (d) {
            case 0:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.TopRight);
              addWidth = Math.trunc(this._config.TileWidth / 2);
              addHeight = -Math.trunc(this._config.TileHeight / 2);
              break;
            case 1:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.Right);
              addWidth = this._config.TileWidth;
              addHeight = 0;
              break;
            case 2:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.BottomRight);
              addWidth = Math.trunc(this._config.TileWidth / 2);
              addHeight = Math.trunc(this._config.TileHeight / 2);
              break;
            case 3:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.Bottom);
              addWidth = 0;
              addHeight = this._config.TileHeight;
              deltaFromCenterX = deltaFromCenterY - 6;
              break;
            case 4:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.BottomLeft);
              addWidth = -Math.trunc(this._config.TileWidth / 2);
              addHeight = Math.trunc(this._config.TileHeight / 2);
              break;
            case 5:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.Left);
              addWidth = -this._config.TileWidth;
              addHeight = 0;
              break;
            case 6:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.TopLeft);
              addWidth = -Math.trunc(this._config.TileWidth / 2);
              addHeight = -Math.trunc(this._config.TileHeight / 2);
              break;
            case 7:
              nextTile = currentTile.Layer!.GetNeighbourTile(currentTile, TileDirection.Top);
              addWidth = 0;
              addHeight = -this._config.TileHeight;
              deltaFromCenterX = deltaFromCenterY + 6;
              break;
          }
          if (nextTile != null) {
            currentTile = nextTile;
            currentPoint.X += addWidth;
            currentPoint.Y += addHeight;
            linePoints.push(new Point(currentPoint.X + deltaFromCenterX, currentPoint.Y + deltaFromCenterY));
          }
        }
        if (linePoints.length > 1) {
          for (let i = 0; i < linePoints.length - 1; i++) {
            drawLine(this._drawingSurface, linePoints[i].X, linePoints[i].Y, linePoints[i + 1].X, linePoints[i + 1].Y, 3, lineColor.r, lineColor.g, lineColor.b, lineColor.a);
          }
        }
      }

      if (endTile.Rx !== currentTile.Rx || endTile.Ry !== currentTile.Ry) {
        const dashlineStart = new Point(currentPoint.X, currentPoint.Y + deltaFromCenterY);
        const dashlineEnd = new Point(endTileCenter.X, endTileCenter.Y + deltaFromCenterY);
        drawDashedLine(this._drawingSurface, dashlineStart.X, dashlineStart.Y, dashlineEnd.X, dashlineEnd.Y, 3, dashColor.r, dashColor.g, dashColor.b, dashColor.a, dashValues);
      }

      fillEllipse(this._drawingSurface, startTileCenter.X, startTileCenter.Y, 10, 5, 255, 0, 0, 138);
      fillEllipse(this._drawingSurface, endTileCenter.X, endTileCenter.Y, 10, 5, 255, 0, 0, 138);
    }
  }
}

function stringToOverlayTibType(name: string): OverlayTibType {
  switch (name.toLowerCase()) {
    case 'riparis':
    case 'ore':
      return OverlayTibType.Riparius;
    case 'cruentus':
    case 'gems':
      return OverlayTibType.Cruentus;
    case 'vinifera':
    case 'ore2':
      return OverlayTibType.Vinifera;
    case 'aboreus':
    case 'ore3':
      return OverlayTibType.Aboreus;
    default:
      return OverlayTibType.NotSpecial;
  }
}

