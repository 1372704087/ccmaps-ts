// Port of CNCMaps.FileFormats.Map.Lighting
import { IniSection } from '../IniFile.js';
import { logger } from '../../shared/Log.js';

export class Lighting {
  Level = 0.0;
  Ambient = 1.0;
  Red = 1.0;
  Green = 1.0;
  Blue = 1.0;
  Ground = 0.0;

  constructor(iniSection?: IniSection) {
    if (iniSection != null) {
      this.Level = iniSection.readDouble('Level', 0.032);
      this.Ambient = iniSection.readDouble('Ambient', 1.0);
      this.Red = iniSection.readDouble('Red', 1.0);
      this.Green = iniSection.readDouble('Green', 1.0);
      this.Blue = iniSection.readDouble('Blue', 1.0);
      this.Ground = iniSection.readDouble('Ground', 0.0);

      logger.trace(
        `Lighting loaded: level: ${this.Level}, ambient: ${this.Ambient}, red: ${this.Red}, green: ${this.Green}, blue: ${this.Blue}, ground: ${this.Ground}`,
      );
    }
  }
}