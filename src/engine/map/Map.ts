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
import { logger } from '../../shared/Log.js';
import { ModConfig } from '../../shared/ModConfig.js';
import { VirtualFileSystem } from '../../formats/vfs/VirtualFileSystem.js';
import { IniFile, IniSection } from '../../formats/IniFile.js';
import { MapFile } from '../../formats/map/MapFile.js';
import { Palette } from '../../rendering/Palette.js';
import { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { Theater } from '../game/Theater.js';
import { RenderProgress } from '../RenderProgress.js';
import { Operations } from './Operations.js';
import { TileLayer, TileDirection } from './TileLayer.js';
import { MapTile } from './MapTile.js';
import {
  GameObject,
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
import { resizeBilinear } from '../../rendering/ImageUtil.js';

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

  FullSize = Rectangle.Empty;
  LocalSize = Rectangle.Empty;
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

  private readonly _countryColors = new Map<string, Color>();
  private readonly _namedColors = new Map<string, Color>();

  private _lighting: any = null;
  private readonly _lightSources: LightSource[] = [];
  private readonly _palettePerLevel: Palette[] = [];
  private readonly _palettesToBeRecalculated = new Set<Palette>();

  private _drawingSurface!: DrawingSurface;
  private _mapFile!: MapFile;
  private _overlaysAltered = false;

  Initialize(mf: MapFile, config: ModConfig, vfs: VirtualFileSystem): boolean {
    this._mapFile = mf;
    this._config = config;
    this._vfs = vfs;
    this._theaterType = Theater.TheaterTypeFromString(mf.readString('Map', 'Theater'));
    this.FullSize = mf.FullSize;
    this.LocalSize = mf.LocalSize;

    this._tiles = new TileLayer(this.FullSize.Size, config);

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
    this._rules.mergeWith(mf);

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

    // import infantry
    for (const i of mf.Infantries) {
      const inf = new InfantryObject(i.Owner, i.Name, i.Health, i.Direction, i.OnBridge);
      const tile = this._tiles.getTile(i.Tile!);
      if (tile != null) tile.AddObject(inf);
      this._infantryObjects.push(inf);
    }

    for (const u of mf.Units) {
      const un = new UnitObject(u.Owner, u.Name, u.Health, u.Direction, u.OnBridge);
      const tile = this._tiles.getTile(u.Tile!);
      if (tile != null) tile.AddObject(un);
      this._unitObjects.push(un);
    }

    for (const a of mf.Aircrafts) {
      const ac = new AircraftObject(a.Owner, a.Name, a.Health, a.Direction, a.OnBridge);
      const tile = this._tiles.getTile(a.Tile!);
      if (tile != null) tile.AddObject(ac);
      this._aircraftObjects.push(ac);
    }

    for (const s of mf.Structures) {
      const str = new StructureObject(s.Owner, s.Name, s.Health, s.Direction);
      str.Upgrade1 = s.Upgrade1;
      str.Upgrade2 = s.Upgrade2;
      str.Upgrade3 = s.Upgrade3;
      const tile = this._tiles.getTile(s.Tile!);
      if (tile != null) tile.AddObject(str);
      this._structureObjects.push(str);
    }
  }

  LoadInis(): boolean {
    if (this._config.CustomRulesIniFiles.length === 0) {
      if (this._config.Engine === EngineType.YurisRevenge) {
        this._rules = this._vfs.open('rulesmd.ini') as IniFile;
      } else {
        this._rules = this._vfs.open('rules.ini') as IniFile;
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
        this._art = this._vfs.open('artmd.ini') as IniFile;
      } else {
        this._art = this._vfs.open('art.ini') as IniFile;
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
    return true;
  }

  private LoadCustomInis(fileNames: string[]): IniFile {
    let ini = this._vfs.open(fileNames[0]) as IniFile;
    if (ini == null) {
      logger.error(`Custom ini file ${fileNames[0]} could not be loaded`);
      return null as unknown as IniFile;
    }
    for (let i = 1; i < fileNames.length; i++) {
      logger.info(`Merging ${fileNames[i]} with ${fileNames[0]}`);
      const extra = this._vfs.open(fileNames[i]) as IniFile;
      if (extra == null) logger.warn(`Custom ini file ${fileNames[i]} could not be loaded, skipping`);
      ini.mergeWith(extra);
    }
    return ini;
  }

  LoadTheater(): boolean {
    this._theater = new Theater(this._theaterType, this._config, this._vfs, this._rules, this._art);
    if (!this._theater.Initialize()) return false;

    // needs to be done before drawables are set
    let disableOreRandomizing = false;
    const extra = this._config.ExtraOptions[0];
    if (extra != null) disableOreRandomizing = extra.DisableOreRandomization;
    if (!disableOreRandomizing) Operations.RecalculateOreSpread(this._overlayObjects, this._config.Engine);

    this.RemoveUnknownObjects();
    this.SetDrawables();

    this.LoadColors();
    if (this._config.Engine >= EngineType.RedAlert2) this.LoadCountries();
    this.LoadHouses();

    Operations.FixTiles(this._tiles, this._theater.GetTileCollection());
    if (this._config.Engine <= EngineType.Firestorm) Operations.RecalculateVeinsSpread(this._overlayObjects, this._tiles);

    this.RevisitWallBuildings();

    this.CreateLevelPalettes();
    this.LoadPalettes();
    this.ApplyRemappables();
    if (!this.IgnoreLighting) {
      this.LoadLightSources();
      this.ApplyLightSources();
    }

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
    for (const tile of this._tiles) {
      tile.Drawable = this._theater.GetCollection(CollectionType.Tiles).GetDrawable(tile);
      for (const obj of tile.AllObjects) {
        obj.Collection = this._theater.GetObjectCollection(obj);
        if (obj.Collection == null) {
          logger.warn(`No collection for object ${obj} at ${obj.Tile}; skipping it`);
          continue;
        }
        obj.Drawable = obj.Collection.GetDrawable(obj);
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

  private RecalculatePalettes(): void {
    logger.info('Calculating palette-values for all objects');
    for (const p of this._palettesToBeRecalculated) p.recalculate();
  }

  MarkIceGrowth(): void {
    logger.info('Marking ice growth cells');
    for (const tile of [...this._tiles]) {
      if (tile == null) continue;
      const t = this._mapFile.Tiles.getTileR(tile.Rx, tile.Ry);

      if (t != null && t.IceGrowth > 0) {
        const destX = Math.trunc((tile.Dx * this._config.TileWidth) / 2);
        const destY = Math.trunc(((tile.Dy - tile.Z) * this._config.TileHeight) / 2);
        const vert = this.FullSize.Height * 2 > this.FullSize.Width;

        let radius: number;
        if (vert) radius = Math.trunc(Math.trunc((this.FullSize.Height * this._config.TileHeight) / 2) / 144 / 3);
        else radius = Math.trunc(Math.trunc((this.FullSize.Width * this._config.TileWidth) / 2) / 133 / 3);

        const h = radius;
        const w = radius;
        const yStart = Math.max(0, destY - Math.trunc(h / 2));
        const yEnd = Math.min(this._drawingSurface.Height, destY + h);
        const xStart = Math.max(0, destX - Math.trunc(w / 2));
        const xEnd = Math.min(this._drawingSurface.Width, destX + w);
        for (let drawY = yStart; drawY < yEnd; drawY++) {
          for (let drawX = xStart; drawX < xEnd; drawX++) {
            const idx = (drawY * this._drawingSurface.Width + drawX) * 3;
            this._drawingSurface.data[idx] = 0x88;
            this._drawingSurface.data[idx + 1] = 0xff;
            this._drawingSurface.data[idx + 2] = 0x00;
          }
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
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < 8)) {
      for (let x = w.Tile.Rx + delta1; x < w.Tile.Rx + delta2; x++) {
        for (let y = w.Tile.Ry + delta1; y < w.Tile.Ry + delta2; y++) {
          const t = this._tiles.GetTileR(x, y);
          if (t != null && t.Palette != null) t.Palette = Palette.merge(t.Palette, red, 0.4);
        }
      }
    }
  }

  RedrawTiledStartPositions(reset = false): void {
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < 8)) {
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
          for (const o of objs) this._theater.Draw(o, this._drawingSurface);
        }
      }
    }
  }

  private DrawStartMarkersBittah(canvas: DrawingSurface, fullImage: Rectangle, previewImage: Rectangle): void {
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < 8)) {
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
    for (const w of this._wayPoints.filter((w) => w.Tile != null && w.Number < 8)) {
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
      this._namedColors.set(entry.Key, h.toRGB());
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
      let c: Color;
      const colorName = countrySection.readString('Color');
      if (!this._namedColors.has(colorName)) c = this._namedColors.values().next().value as Color;
      else c = this._namedColors.get(colorName)!;
      this._countryColors.set(entry.Value.toString(), c);
    }
  }

  DrawStartPositions(): void {
    logger.info('Marking start positions');
    const markerSize = this.StartMarkerSize ?? 4.0;
    for (const entry of this._wayPoints) {
      if (entry.Number < 8) {
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
            fillEllipse(this._drawingSurface, startX + width / 2, startY + height / 2, width, height, 255, 0, 0, opacity);
          } else {
            width = Math.trunc(width / 2);
            const nstartX = centerX - Math.trunc(halfWidth / 2);
            if (this.StartPosMarking === StartPositionMarking.Squared) {
              fillRect(this._drawingSurface, nstartX, startY, width, height, 255, 0, 0, opacity);
            } else {
              fillEllipse(this._drawingSurface, nstartX + width / 2, startY + height / 2, width, height, 255, 0, 0, opacity);
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
    logger.debug(`Cutoff-height determined at ${y}, cutting off ${this.FullSize.Height - y} rows`);
    return y;
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
      if (this._namedColors.has(namedColor)) markerPalettes.set(type, Palette.makePalette(this._namedColors.get(namedColor)!));
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
      if (o.Tile != null && o.Tile.Palette != null) o.Tile.Palette = Palette.merge(o.Tile.Palette, markerPalettes.get(ovlType)!, opacity);
      if (o.Palette != null) o.Palette = Palette.merge(o.Palette, markerPalettes.get(ovlType)!, opacity);
    }
  }

  RedrawOreAndGems(): void {
    const tileCollection = this._theater.GetTileCollection();
    const checkFunc = (ovl: OverlayObject): boolean =>
      SpecialOverlays.GetOverlayTibType(ovl, this._config.Engine) !== OverlayTibType.NotSpecial;

    // first redraw all required tiles (zigzag method)
    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a)))
          this._theater.Draw(tile, this._drawingSurface);
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a)))
          this._theater.Draw(tile, this._drawingSurface);
      }
    }
    for (let y = 0; y < this.FullSize.Height; y++) {
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a))) {
          const objs = this.GetObjectsAt(x, y);
          for (const o of objs) this._theater.Draw(o, this._drawingSurface);
        }
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null && tile.AllObjects.some((a) => a instanceof OverlayObject && checkFunc(a))) {
          const objs = this.GetObjectsAt(x, y);
          for (const o of objs) this._theater.Draw(o, this._drawingSurface);
        }
      }
    }
  }

  Draw(): void {
    this._drawingSurface = new DrawingSurface(this.FullSize.Width * this._config.TileWidth, this.FullSize.Height * this._config.TileHeight);

    let lastReported = 0.0;
    for (let y = 0; y < this.FullSize.Height; y++) {
      logger.trace(`Drawing tiles row ${y}`);
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null) this._theater.Draw(tile, this._drawingSurface);
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const tile = this._tiles.GetTile(x, y);
        if (tile != null) this._theater.Draw(tile, this._drawingSurface);
      }

      if (this.Progress != null)
        this.Progress.Span(20, 20 + Math.trunc((this.Progress.DrawEnd - 20) / 2), y / this.FullSize.Height, 'drawing tiles');
      const pct = (50.0 * y) / this.FullSize.Height;
      if (pct > lastReported + 5) {
        logger.info(`Drawing tiles... ${Math.round(pct)}%`);
        lastReported = pct;
      }
    }
    logger.info('Tiles drawn');

    lastReported = 0.0;
    for (let y = 0; y < this.FullSize.Height; y++) {
      logger.trace(`Drawing objects row ${y}`);
      for (let x = this.FullSize.Width * 2 - 2; x >= 0; x -= 2) {
        const objs = this.GetObjectsAt(x, y);
        for (const o of objs) this._theater.Draw(o, this._drawingSurface);
      }
      for (let x = this.FullSize.Width * 2 - 3; x >= 0; x -= 2) {
        const objs = this.GetObjectsAt(x, y);
        for (const o of objs) this._theater.Draw(o, this._drawingSurface);
      }

      if (this.Progress != null)
        this.Progress.Span(20 + Math.trunc((this.Progress.DrawEnd - 20) / 2), this.Progress.DrawEnd, y / this.FullSize.Height, 'drawing objects');
      const pct = 50 + (50.0 * y) / this.FullSize.Height;
      if (pct > lastReported + 5) {
        logger.info(`Drawing objects... ${Math.round(pct)}%`);
        lastReported = pct;
      }
    }
    // Highlight ore & gem fields when requested (marked + redrawn on top).
    if (this.MarkOreFields) {
      logger.info('Highlighting ore and gems');
      this.MarkOreAndGems();
      this.RedrawOreAndGems();
    }
    logger.info('Map drawing completed');
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
    preview = resizeBilinear(preview, pw, ph);

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
    Operations.CountNeighbouringVeins(tile, Operations.IsVeins);
  }

  GetObjectsAt(dx: number, dy: number): GameObject[] {
    const tile = this._tiles.GetTile(dx, dy);
    if (tile == null) return [];
    const ret: GameObject[] = [];
    for (const o of tile.AllObjects) if (o instanceof SmudgeObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof OverlayObject && (o.Drawable == null || !o.Drawable.Overrides)) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof TerrainObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof InfantryObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof UnitObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof StructureObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof AircraftObject) ret.push(o);
    for (const o of tile.AllObjects) if (o instanceof OverlayObject && o.Drawable != null && o.Drawable.Overrides) ret.push(o);
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

  FreeUseless(): void {
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
            `${drawable.Name} (${drawable.TsEntry?.MemberOfSet.SetName ?? ''}), expected filename ${drawable.TsEntry?.MemberOfSet.FileName ?? ''}xx${ModConfig.ActiveTheater?.Extension ?? ''}`,
        );
        brokenTiles++;
        this.ChangeTileToClear(coll, tile);
      } else {
        if (!drawable.DoesSubTileExist(tile)) {
          logger.warn(
            `Removing tile-subtile,count #${tile.TileNum}-${tile.SubTile}@(${tile.Rx},${tile.Ry}) because subtile for it was not found; set ` +
              `${drawable.Name} (${drawable.TsEntry?.MemberOfSet.SetName ?? ''}), expected filename ${drawable.TsEntry?.MemberOfSet.FileName ?? ''}xx${ModConfig.ActiveTheater?.Extension ?? ''}`,
          );
          brokenTiles++;
          this.ChangeTileToClear(coll, tile);
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
    // Byte arrays of 256KB fixed size
    const overlayPack = new Uint8Array(1 << 18);
    const overlayDataPack = new Uint8Array(1 << 18);

    if (this._overlaysAltered) {
      for (let x = 0; x < 262144; x++) {
        overlayPack[x] = 255;
        overlayDataPack[x] = 0;
      }

      for (const obj of [...this._overlayObjects]) {
        const location = obj.Tile!.Ry * 512 + obj.Tile!.Rx;
        overlayPack[location] = obj.OverlayID;
        overlayDataPack[location] = obj.OverlayValue;
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

      fillEllipse(this._drawingSurface, startTileCenter.X, startTileCenter.Y, 20, 10, 255, 0, 0, 138);
      fillEllipse(this._drawingSurface, endTileCenter.X, endTileCenter.Y, 20, 10, 255, 0, 0, 138);
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

