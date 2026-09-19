// Port of CNCMaps.Engine.Game.SpecialOverlays
import { EngineType, OverlayTibType } from '../../shared/Enums.js';
import type { OverlayObject } from '../map/GameObjects.js';

export class SpecialOverlays {
  // Riparius = 1, Cruentus = 2, Vinifera = 3, Aboreus = 4
  static readonly Ra2MinIdRiparius = 102; // Ore
  static readonly Ra2MaxIdRiparius = 121; // Ore
  static readonly Ra2MinIdCruentus = 27; // Gems
  static readonly Ra2MaxIdCruentus = 38; // Gems
  static readonly Ra2MinIdVinifera = 127; // Ore2 unused
  static readonly Ra2MaxIdVinifera = 146; // Ore2 unused
  static readonly Ra2MinIdAboreus = 147; // Ore3 unused
  static readonly Ra2MaxIdAboreus = 166; // Ore3 unused

  static readonly TsMinIdRiparius = 102;
  static readonly TsMaxIdRiparius = 121;
  static readonly TsMinIdCruentus = 27;
  static readonly TsMaxIdCruentus = 38;
  static readonly TsMinIdVinifera = 127;
  static readonly TsMaxIdVinifera = 146;
  static readonly TsMinIdAboreus = 147;
  static readonly TsMaxIdAboreus = 166;

  static IsRA2_Riparius(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.Ra2MinIdRiparius && o.OverlayID <= SpecialOverlays.Ra2MaxIdRiparius;
  }
  static IsRA2_Cruentus(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.Ra2MinIdCruentus && o.OverlayID <= SpecialOverlays.Ra2MaxIdCruentus;
  }
  static IsRA2_Vinifera(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.Ra2MinIdVinifera && o.OverlayID <= SpecialOverlays.Ra2MaxIdVinifera;
  }
  static IsRA2_Aboreus(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.Ra2MinIdAboreus && o.OverlayID <= SpecialOverlays.Ra2MaxIdAboreus;
  }

  static IsTS_Riparius(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.TsMinIdRiparius && o.OverlayID <= SpecialOverlays.TsMaxIdRiparius;
  }
  static IsTS_Cruentus(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.TsMinIdCruentus && o.OverlayID <= SpecialOverlays.TsMaxIdCruentus;
  }
  static IsTS_Vinifera(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.TsMinIdVinifera && o.OverlayID <= SpecialOverlays.TsMaxIdVinifera;
  }
  static IsTS_Aboreus(o: OverlayObject): boolean {
    return o.OverlayID >= SpecialOverlays.TsMinIdAboreus && o.OverlayID <= SpecialOverlays.TsMaxIdAboreus;
  }
  static IsTib(o: OverlayObject): boolean {
    return (
      SpecialOverlays.IsTS_Riparius(o) ||
      SpecialOverlays.IsTS_Cruentus(o) ||
      SpecialOverlays.IsTS_Vinifera(o) ||
      SpecialOverlays.IsTS_Aboreus(o)
    );
  }

  static IsHighBridge(o: OverlayObject): boolean {
    return o.OverlayID === 24 || o.OverlayID === 25 || o.OverlayID === 238 || o.OverlayID === 237;
  }
  static IsTSHighRailsBridge(o: OverlayObject): boolean {
    return o.OverlayID === 59 || o.OverlayID === 60;
  }

  static GetOverlayTibType(o: OverlayObject, engine: EngineType): OverlayTibType {
    if (engine <= EngineType.Firestorm) {
      if (SpecialOverlays.IsTS_Riparius(o)) return OverlayTibType.Riparius;
      else if (SpecialOverlays.IsTS_Cruentus(o)) return OverlayTibType.Cruentus;
      else if (SpecialOverlays.IsTS_Vinifera(o)) return OverlayTibType.Vinifera;
      else if (SpecialOverlays.IsTS_Aboreus(o)) return OverlayTibType.Aboreus;
    } else {
      if (SpecialOverlays.IsRA2_Riparius(o)) return OverlayTibType.Riparius;
      else if (SpecialOverlays.IsRA2_Cruentus(o)) return OverlayTibType.Cruentus;
      else if (SpecialOverlays.IsRA2_Vinifera(o)) return OverlayTibType.Vinifera;
      else if (SpecialOverlays.IsRA2_Aboreus(o)) return OverlayTibType.Aboreus;
    }
    return OverlayTibType.NotSpecial;
  }

  static GetTibName(o: OverlayObject, engine: EngineType): string {
    if (engine <= EngineType.Firestorm) {
      if (SpecialOverlays.IsTS_Riparius(o)) return 'Riparius';
      else if (SpecialOverlays.IsTS_Cruentus(o)) return 'Cruentus';
      else if (SpecialOverlays.IsTS_Vinifera(o)) return 'Vinifera';
      else if (SpecialOverlays.IsTS_Aboreus(o)) return 'Aboreus';
    } else {
      if (SpecialOverlays.IsRA2_Riparius(o)) return 'Riparius';
      else if (SpecialOverlays.IsRA2_Cruentus(o)) return 'Cruentus';
      else if (SpecialOverlays.IsRA2_Vinifera(o)) return 'Vinifera';
      else if (SpecialOverlays.IsRA2_Aboreus(o)) return 'Aboreus';
    }
    return '';
  }
}