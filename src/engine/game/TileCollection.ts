// Port of CNCMaps.Engine.Game.TileCollection
import { GameCollection } from './GameCollection.js';
import type { ObjectCollection } from './ObjectCollection.js';
import { TileDrawable } from '../drawables/TileDrawable.js';
import type { TileSetEntry as TileSetEntryShape } from '../drawables/TileDrawable.js';
import type { Drawable } from '../drawables/Drawable.js';
import type { MapTile } from '../map/MapTile.js';
import type { IniFile } from '../../formats/IniFile.js';
import { FileFormat } from '../../formats/FileFormat.js';
import type { TmpFile } from '../../formats/TmpFile.js';
import '../../formats/TmpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import { TheaterSettings, ModConfig } from '../../shared/ModConfig.js';
import { TheaterType, CollectionType } from '../../shared/Enums.js';
import { Rand } from '../../shared/Util.js';
import { logger } from '../../shared/Log.js';

// C# inner class CNCMaps.Engine.Game.TileCollection.TileSet
// (hoisted to module scope since TypeScript has no nested classes)
export class TileSet {
  FileName: string;
  SetName: string;
  TilesInSet: number;
  Entries: TileSetEntry[] = [];
  TileSetNum: number; // short

  constructor(fileName: string, setName: string, tilesInSet: number, tileSetNum: number) {
    this.FileName = fileName;
    this.SetName = setName;
    this.TilesInSet = tilesInSet;
    this.TileSetNum = tileSetNum;
    this.Entries = [];
  }

  toString(): string {
    return this.SetName;
  }
}

// C# inner class CNCMaps.Engine.Game.TileCollection.TileSetEntry.
// `implements` the TileSetEntry contract reused from TileDrawable.ts.
export class TileSetEntry implements TileSetEntryShape {
  TmpFiles: TmpFile[] = [];
  AnimationDrawable: Drawable | null = null;
  AnimationSubtile = -1;
  MemberOfSet: TileSet;
  Index: number;

  constructor(owner: TileSet, index: number) {
    this.MemberOfSet = owner;
    this.Index = index;
  }

  AddTile(tmpFile: TmpFile): void {
    this.TmpFiles.push(tmpFile);
  }

  AddAnimation(subtile: number, drawable: Drawable): void {
    this.AnimationSubtile = subtile;
    this.AnimationDrawable = drawable;
  }

  GetTmpFile(t: MapTile, damaged = false): TmpFile | null {
    if (this.TmpFiles.length === 0) return null;
    const randomChosen = this.TmpFiles[Rand.nextMax(this.TmpFiles.length)];
    // if this is not a randomizing tileset, but instead one with damaged data,
    // then return the "undamaged" version
    randomChosen.Initialize();
    if (randomChosen.Images[Math.min(t.SubTile, randomChosen.Images.length - 1)].hasDamagedData) {
      // the fallback is a different file than the one initialized above, and
      // callers expect to receive tiles ready to draw
      const undamaged = this.TmpFiles[Math.min(damaged ? 1 : 0, this.TmpFiles.length - 1)];
      undamaged.Initialize();
      return undamaged;
    } else {
      return randomChosen;
    }
  }

  toString(): string {
    return `${this.MemberOfSet.SetName} (${this.Index})`;
  }
}

export class TileCollection extends GameCollection {
  _theaterIni!: IniFile;
  readonly _tileNumToSet: number[] = [];
  readonly _setNumToFirstTile: number[] = [];
  readonly _tileSets: TileSet[] = [];

  private readonly _theaterSettings: TheaterSettings;

  // ReSharper disable InconsistentNaming
  ACliffMMPieces!: number; // short
  ACliffPieces!: number;
  BlackTile!: number;
  BlueMoldTile!: number;
  BridgeBottomLeft1!: number;
  BridgeBottomLeft2!: number;
  BridgeBottomRight1!: number;
  BridgeBottomRight2!: number;
  BridgeMiddle1!: number;
  BridgeMiddle2!: number;
  BridgeSet!: number;
  BridgeTopLeft1!: number;
  BridgeTopLeft2!: number;
  BridgeTopRight1!: number;
  BridgeTopRight2!: number;
  ClearTile!: number;
  ClearToBlueMoldLat!: number;
  ClearToCrystalLat!: number;
  ClearToGreenLat!: number;
  ClearToPaveLat!: number;
  ClearToRoughLat!: number;
  ClearToSandLat!: number;
  CliffRamps!: number;
  CliffSet!: number;
  CrystalCliff!: number;
  CrystalTile!: number;
  DestroyableCliffs!: number;
  DirtRoadCurve!: number;
  DirtRoadJunction!: number;
  DirtRoadSlopes!: number;
  DirtRoadStraight!: number;
  DirtTrackTunnels!: number;
  DirtTunnels!: number;
  GreenTile!: number;
  HeightBase!: number;
  Ice1Set!: number;
  Ice2Set!: number;
  Ice3Set!: number;
  IceShoreSet!: number;
  MMRampBase!: number;
  MMWaterCliffAPieces!: number;
  Medians!: number;
  MiscPaveTile!: number;
  MonorailSlopes!: number;
  PaveTile!: number;
  PavedRoadEnds!: number;
  PavedRoadSlopes!: number;
  PavedRoads!: number;
  RampBase!: number;
  RampSmooth!: number;
  Rocks!: number;
  RoughGround!: number;
  RoughTile!: number;
  SandTile!: number;
  ShorePieces!: number;
  SlopeSetPieces!: number;
  SlopeSetPieces2!: number;
  SwampTile!: number;
  TrackTunnels!: number;
  TrainBridgeSet!: number;
  Tunnels!: number;
  WaterBridge!: number;
  WaterCaves!: number;
  WaterCliffAPieces!: number;
  WaterCliffs!: number;
  WaterSet!: number;
  WaterfallEast!: number;
  WaterfallNorth!: number;
  WaterfallSouth!: number;
  WaterfallWest!: number;
  WaterToSwampLat!: number;
  WoodBridgeSet!: number;
  // ReSharper restore InconsistentNaming

  private _animsSectionsStartIdx = -1;

  constructor(
    theater: TheaterType,
    config: ModConfig,
    vfs: VirtualFileSystem,
    rules: IniFile | null,
    art: IniFile | null,
    theaterSettings: TheaterSettings,
    theaterIni: IniFile | null = null,
  ) {
    super(CollectionType.Tiles, theater, config, vfs, rules as IniFile, art as IniFile);
    this._theaterSettings = theaterSettings;
    if (theaterIni == null) {
      this._theaterIni = this._vfs.open(theaterSettings.TheaterIni) as IniFile;
      if (this._theaterIni == null) {
        logger.warn('Unavailable theater loaded, theater.ini not found');
        return;
      }
    } else {
      this._theaterIni = theaterIni;
    }

    const General = this._theaterIni.getSection('General');
    if (General == null) return;

    // Set numbers
    this.ACliffMMPieces = General.readShort('ACliffMMPieces', -1);
    this.ACliffPieces = General.readShort('ACliffPieces', -1);
    this.BlackTile = General.readShort('BlackTile', -1);
    this.BlueMoldTile = General.readShort('BlueMoldTile', -1);
    this.BridgeBottomLeft1 = General.readShort('BridgeBottomLeft1', -1);
    this.BridgeBottomLeft2 = General.readShort('BridgeBottomLeft2', -1);
    this.BridgeBottomRight1 = General.readShort('BridgeBottomRight1', -1);
    this.BridgeBottomRight2 = General.readShort('BridgeBottomRight2', -1);
    this.BridgeMiddle1 = General.readShort('BridgeMiddle1', -1);
    this.BridgeMiddle2 = General.readShort('BridgeMiddle2', -1);
    this.BridgeSet = General.readShort('BridgeSet', -1);
    this.BridgeTopLeft1 = General.readShort('BridgeTopLeft1', -1);
    this.BridgeTopLeft2 = General.readShort('BridgeTopLeft2', -1);
    this.BridgeTopRight1 = General.readShort('BridgeTopRight1', -1);
    this.BridgeTopRight2 = General.readShort('BridgeTopRight2', -1);
    this.ClearTile = General.readShort('ClearTile', -1);
    this.ClearToBlueMoldLat = General.readShort('ClearToBlueMoldLat', -1);
    this.ClearToCrystalLat = General.readShort('ClearToCrystalLat', -1);
    this.ClearToGreenLat = General.readShort('ClearToGreenLat', -1);
    this.ClearToPaveLat = General.readShort('ClearToPaveLat', -1);
    this.ClearToRoughLat = General.readShort('ClearToRoughLat', -1);
    this.ClearToSandLat = General.readShort('ClearToSandLat', -1);
    this.CliffRamps = General.readShort('CliffRamps', -1);
    this.CliffSet = General.readShort('CliffSet', -1);
    this.CrystalCliff = General.readShort('CrystalCliff', -1);
    this.CrystalTile = General.readShort('CrystalTile', -1);
    this.DestroyableCliffs = General.readShort('DestroyableCliffs', -1);
    this.DirtRoadCurve = General.readShort('DirtRoadCurve', -1);
    this.DirtRoadJunction = General.readShort('DirtRoadJunction', -1);
    this.DirtRoadSlopes = General.readShort('DirtRoadSlopes', -1);
    this.DirtRoadStraight = General.readShort('DirtRoadStraight', -1);
    this.DirtTrackTunnels = General.readShort('DirtTrackTunnels', -1);
    this.DirtTunnels = General.readShort('DirtTunnels', -1);
    this.GreenTile = General.readShort('GreenTile', -1);
    this.HeightBase = General.readShort('HeightBase', -1);
    this.Ice1Set = General.readShort('Ice1Set', -1);
    this.Ice2Set = General.readShort('Ice2Set', -1);
    this.Ice3Set = General.readShort('Ice3Set', -1);
    this.IceShoreSet = General.readShort('IceShoreSet', -1);
    this.MMRampBase = General.readShort('MMRampBase', -1);
    this.MMWaterCliffAPieces = General.readShort('MMWaterCliffAPieces', -1);
    this.Medians = General.readShort('Medians', -1);
    this.MiscPaveTile = General.readShort('MiscPaveTile', -1);
    this.MonorailSlopes = General.readShort('MonorailSlopes', -1);
    this.PaveTile = General.readShort('PaveTile', -1);
    this.PavedRoadEnds = General.readShort('PavedRoadEnds', -1);
    this.PavedRoadSlopes = General.readShort('PavedRoadSlopes', -1);
    this.PavedRoads = General.readShort('PavedRoads', -1);
    this.RampBase = General.readShort('RampBase', -1);
    this.RampSmooth = General.readShort('RampSmooth', -1);
    this.Rocks = General.readShort('Rocks', -1);
    this.RoughGround = General.readShort('RoughGround', -1);
    this.RoughTile = General.readShort('RoughTile', -1);
    this.SandTile = General.readShort('SandTile', -1);
    this.ShorePieces = General.readShort('ShorePieces', -1);
    this.SlopeSetPieces = General.readShort('SlopeSetPieces', -1);
    this.SlopeSetPieces2 = General.readShort('SlopeSetPieces2', -1);
    this.SwampTile = General.readShort('SwampTile', -1);
    this.TrackTunnels = General.readShort('TrackTunnels', -1);
    this.TrainBridgeSet = General.readShort('TrainBridgeSet', -1);
    this.Tunnels = General.readShort('Tunnels', -1);
    this.WaterBridge = General.readShort('WaterBridge', -1);
    this.WaterCaves = General.readShort('WaterCaves', -1);
    this.WaterCliffAPieces = General.readShort('WaterCliffAPieces', -1);
    this.WaterCliffs = General.readShort('WaterCliffs', -1);
    this.WaterSet = General.readShort('WaterSet', -1);
    this.WaterfallEast = General.readShort('WaterfallEast', -1);
    this.WaterfallNorth = General.readShort('WaterfallNorth', -1);
    this.WaterfallSouth = General.readShort('WaterfallSouth', -1);
    this.WaterfallWest = General.readShort('WaterfallWest', -1);
    this.WaterToSwampLat = General.readShort('WaterToSwampLat', -1);
    this.WoodBridgeSet = General.readShort('WoodBridgeSet', -1);
  }

  InitTilesets(): void {
    let sectionIdx = 0;
    let setNum = 0;
    while (true) {
      const sectionName = 'TileSet' + sectionIdx.toString().padStart(4, '0');
      const sect = this._theaterIni.getSection(sectionName);
      if (sect == null) break;

      logger.trace(`Loading tileset ${sectionName}`);
      const ts = new TileSet(
        sect.readString('FileName'),
        sect.readString('SetName'),
        sect.readInt('TilesInSet'),
        sectionIdx,
      );
      this._setNumToFirstTile.push(this._drawables.length);
      this._tileSets.push(ts);
      sectionIdx++;

      for (let j = 1; j <= ts.TilesInSet; j++) {
        this._tileNumToSet.push(setNum);
        const rs = new TileSetEntry(ts, j - 1);

        // add as many tiles (with randomized name) as can be found
        for (let r = 'a'.charCodeAt(0) - 1; r <= 'z'.charCodeAt(0); r++) {
          if (
            r >= 'a'.charCodeAt(0) &&
            (ts.TileSetNum === this.BridgeSet ||
              ts.TileSetNum === this.TrainBridgeSet ||
              ts.TileSetNum === this.WoodBridgeSet)
          ) {
            continue;
          }

          // filename = set filename + dd + .tmp/.urb/.des etc
          let filename = ts.FileName + j.toString().padStart(2, '0');
          if (r >= 'a'.charCodeAt(0)) filename += String.fromCharCode(r);
          filename += this._theaterSettings.Extension;
          let tmpFile = this._vfs.open(filename, FileFormat.Tmp) as TmpFile | null;
          if (tmpFile == null && this._theaterSettings.Type === TheaterType.NewUrban) {
            tmpFile = this._vfs.open(filename.replace('.ubn', '.tem'), FileFormat.Tmp) as TmpFile | null;
          }
          if (tmpFile != null) rs.AddTile(tmpFile);
          else break;
        }
        ts.Entries.push(rs);
        this._drawableIndexNameMap[this._drawables.length] = ts.SetName;

        const td = this.AddObject(sectionName) as TileDrawable;
        td.TsEntry = rs;
      }
      setNum++;
    }

    this._animsSectionsStartIdx = sectionIdx + 1;
  }

  protected override MakeDrawable(objName: string): Drawable {
    return new TileDrawable(this._config, this._vfs, null, null, null);
  }

  InitAnimations(animations: ObjectCollection): void {
    // the remaining sections contain animations to be attached to certain tiles
    for (let j = this._animsSectionsStartIdx; j < this._theaterIni.Sections.length; j++) {
      const extraSection = this._theaterIni.Sections[j];
      const tileSet = this._tileSets.find(ts => ts.SetName === extraSection.Name);
      if (tileSet == null) continue;

      for (let a = 1; a <= tileSet.TilesInSet; a++) {
        const n = `Tile${a.toString().padStart(2, '0')}`;
        const anim = extraSection.readString(n + 'Anim');
        const drawable = animations.GetDrawable(anim);

        if (anim === '' || drawable == null) {
          logger.trace(`Missing anim ${anim} (${n}) for tileset ${tileSet.SetName}`);
          continue;
        }

        // clone, so that the tile-specific offset doesn't require setting on the original
        // drawable, meaning it can be reused
        const drawableClone = drawable.Clone();

        // in pixels
        const attachTo = extraSection.readInt(n + 'AttachesTo');
        const offsetX = extraSection.readInt(n + 'XOffset');
        const offsetY = extraSection.readInt(n + 'YOffset');
        drawableClone.Props.Offset.Offset(offsetX, offsetY);
        drawableClone.Props.ZAdjust = extraSection.readInt(n + 'ZAdjust');
        tileSet.Entries[a - 1].AddAnimation(attachTo, drawableClone);
      }
    }
  }

  ConnectTiles(setNum1: number, setNum2: number): boolean {
    if (setNum1 === setNum2) return false;
    // grass doesn't connect with shores
    else if (
      (setNum1 === this.GreenTile && setNum2 === this.ShorePieces) ||
      (setNum2 === this.GreenTile && setNum1 === this.ShorePieces)
    )
      return false;
    // grass doesn't connect with waterbridges
    else if (
      (setNum1 === this.GreenTile && setNum2 === this.WaterBridge) ||
      (setNum2 === this.GreenTile && setNum1 === this.WaterBridge)
    )
      return false;
    // pave's don't connect with paved roads
    else if (
      (setNum1 === this.PaveTile && setNum2 === this.PavedRoads) ||
      (setNum2 === this.PaveTile && setNum1 === this.PavedRoads)
    )
      return false;
    // pave's don't connect with medians
    else if (
      (setNum1 === this.PaveTile && setNum2 === this.Medians) ||
      (setNum2 === this.PaveTile && setNum1 === this.Medians)
    )
      return false;
    // pave's don't connect with misc pave tiles.
    else if (
      (setNum1 === this.PaveTile && setNum2 === this.MiscPaveTile) ||
      (setNum2 === this.PaveTile && setNum1 === this.MiscPaveTile)
    )
      return false;
    // all other transitions are connected with a CLAT set
    return true;
  }

  IsLAT(setNum: number): boolean {
    return (
      setNum === this.RoughTile ||
      setNum === this.SandTile ||
      setNum === this.GreenTile ||
      setNum === this.PaveTile ||
      setNum === this.BlueMoldTile ||
      setNum === this.CrystalTile ||
      setNum === this.SwampTile
    );
  }

  IsSlope(setNum: number): boolean {
    return setNum === this.SlopeSetPieces || setNum === this.SlopeSetPieces2;
  }

  IsCLAT(setNum: number): boolean {
    return (
      setNum === this.ClearToRoughLat ||
      setNum === this.ClearToSandLat ||
      setNum === this.ClearToGreenLat ||
      setNum === this.ClearToPaveLat ||
      setNum === this.ClearToBlueMoldLat ||
      setNum === this.ClearToCrystalLat ||
      setNum === this.WaterToSwampLat
    );
  }

  GetLAT(clatSetNum: number): number {
    if (clatSetNum === this.ClearToRoughLat) return this.RoughTile;
    else if (clatSetNum === this.ClearToSandLat) return this.SandTile;
    else if (clatSetNum === this.ClearToGreenLat) return this.GreenTile;
    else if (clatSetNum === this.ClearToPaveLat) return this.PaveTile;
    else if (clatSetNum === this.ClearToBlueMoldLat) return this.BlueMoldTile;
    else if (clatSetNum === this.ClearToCrystalLat) return this.CrystalTile;
    else if (clatSetNum === this.WaterToSwampLat) return this.SwampTile;
    else return -1;
  }

  GetCLATSet(setNum: number): number {
    if (setNum === this.RoughTile) return this.ClearToRoughLat;
    else if (setNum === this.SandTile) return this.ClearToSandLat;
    else if (setNum === this.GreenTile) return this.ClearToGreenLat;
    else if (setNum === this.PaveTile) return this.ClearToPaveLat;
    else if (setNum === this.BlueMoldTile) return this.ClearToBlueMoldLat;
    else if (setNum === this.CrystalTile) return this.ClearToCrystalLat;
    else if (setNum === this.SwampTile) return this.WaterToSwampLat;
    else return -1;
  }

  IsCrystalLAT(setNum: number): boolean {
    return setNum === this.CrystalTile;
  }

  IsSwampLAT(setNum: number): boolean {
    return setNum === this.SwampTile;
  }

  IsCrystalCliff(setNum: number): boolean {
    return setNum === this.CrystalCliff;
  }

  GetSetNum(tileNum: number): number {
    if (tileNum < 0 || tileNum >= this._tileNumToSet.length) return 0;
    return this._tileNumToSet[tileNum];
  }

  GetTileNumFromSet(setNum: number, tileNumWithinSet = 0): number {
    return this._setNumToFirstTile[setNum] + tileNumWithinSet;
  }

  get NumTiles(): number {
    return this._drawables.length;
  }
}