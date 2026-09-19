// Port of CNCMaps.Engine.Types.Animation (art subset used by AnimDrawable and others).
import type { IniSection } from '../../formats/IniFile.js';

export class Animation {
  ID = '';

  // ONLY ART STUFF
  Shadow = false;
  Layer = 'Ground';
  AltPalette = false;
  DoubleThick = false;
  Flat = false;
  Flamer = false;
  Normalized = false;
  Translucent = false;
  Scorch = false;
  Crater = false;
  ForceBigCraters = false;
  Sticky = false;
  PingPong = false;
  Reverse = false;
  PsiWarning = false;
  TiberiumChainReaction = false;
  Rate = 0;
  Damage = 0;
  Start = 0;
  End = 0;
  LoopStart = 0;
  LoopEnd = 0;
  LoopCount = 0;
  DetailLevel = 0;
  TranslucencyDetailLevel = 0;
  RandomLoopDelay = { X: 0, Y: 0 };
  Translucency = 0;
  IsTiberium = false;
  HideIfNoOre = false;
  YSortAdjust = 0;
  Elasticity = 0;
  MaxXYVel = 0;
  MinZVel = 0;
  MakeInfantry = 0;
  SpawnCount = 0;
  IsMeteor = false;
  IsVeins = false;
  TiberiumSpreadRadius = 0;
  IsAnimatedTiberium = false;
  ShouldFogRemove = true;
  IsFlamingGuy = false;
  RunningFrames = 0;
  YDrawOffset = 0;
  ZAdjust = 0;
  TrailerSeperation = 0;
  DamageRadius = 0;
  Bouncer = false;
  Tiled = false;
  ShouldUseCellDrawer = true;
  UseNormalLight = false;
  NumParticles = 0;
  RandomRate = { X: 0, Y: 0 };

  constructor(id: string) {
    this.ID = id;
  }

  LoadArt(art: IniSection | null): void {
    if (art == null) return;

    this.Shadow = art.readBool('Shadow');
    // Layer enum left as the raw key string; no callers depend on it.
    this.Layer = art.readString('Layer', 'Ground');
    this.AltPalette = art.readBool('AltPalette');
    this.DoubleThick = art.readBool('DoubleThick');
    this.Flat = art.readBool('Flat');
    this.Flamer = art.readBool('Flamer');
    this.Normalized = art.readBool('Normalized');
    this.Translucent = art.readBool('Translucent');
    this.Scorch = art.readBool('Scorch');
    this.Crater = art.readBool('Crater');
    this.ForceBigCraters = art.readBool('ForceBigCraters');
    this.Sticky = art.readBool('Sticky');
    this.PingPong = art.readBool('PingPong');
    this.Reverse = art.readBool('Reverse');
    this.PsiWarning = art.readBool('PsiWarning');
    this.TiberiumChainReaction = art.readBool('TiberiumChainReaction');
    this.Rate = art.readInt('Rate', 1);
    this.Damage = art.readFloat('Damage');
    this.Start = art.readInt('Start');
    this.End = art.readInt('End');
    this.LoopStart = art.readInt('LoopStart');
    this.LoopEnd = art.readInt('LoopEnd');
    this.LoopCount = art.readInt('LoopCount');
    this.DetailLevel = art.readInt('DetailLevel');
    this.TranslucencyDetailLevel = art.readInt('TranslucencyDetailLevel');
    this.RandomLoopDelay = art.readXY('RandomLoopDelay');
    this.Translucency = art.readInt('Translucency');
    this.IsTiberium = art.readBool('IsTiberium');
    this.HideIfNoOre = art.readBool('HideIfNoOre');
    this.YSortAdjust = art.readInt('YSortAdjust');
    this.Elasticity = art.readFloat('Elasticity', 0.8);
    this.MaxXYVel = art.readFloat('MaxXYVel', 2.71875);
    this.MinZVel = art.readFloat('MinZVel', 2.1875);
    this.MakeInfantry = art.readInt('MakeInfantry', -1);
    this.SpawnCount = art.readInt('SpawnCount');
    this.IsMeteor = art.readBool('IsMeteor');
    this.IsVeins = art.readBool('IsVeins');
    this.TiberiumSpreadRadius = art.readInt('TiberiumSpreadRadius');
    this.IsAnimatedTiberium = art.readBool('IsAnimatedTiberium');
    this.ShouldFogRemove = art.readBool('ShouldFogRemove', true);
    this.IsFlamingGuy = art.readBool('IsFlamingGuy');
    this.RunningFrames = art.readInt('RunningFrames');
    this.YDrawOffset = art.readInt('YDrawOffset');
    this.ZAdjust = art.readInt('ZAdjust');
    this.TrailerSeperation = art.readInt('TrailerSeperation', 0);
    this.DamageRadius = art.readInt('DamageRadius', 0);
    this.Bouncer = art.readBool('Bouncer');
    this.Tiled = art.readBool('Tiled');
    this.ShouldUseCellDrawer = art.readBool('ShouldUseCellDrawer', true);
    this.UseNormalLight = art.readBool('UseNormalLight');
    this.NumParticles = art.readInt('NumParticles');
    this.RandomRate = art.readXY('RandomRate');
  }
}