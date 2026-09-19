// Port of CNCMaps.FileFormats.PktFile
import { IniFile, IniSection } from './IniFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';

export enum GameMode {
  None = 0x00,
  Standard = 0x01,
  MeatGrind = 0x02,
  NavalWar = 0x04,
  NukeWar = 0x08,
  AirWar = 0x10,
  Cooperative = 0x20,
  Duel = 0x40,
  Megawealth = 0x80,
  TeamGame = 0x100,
  Siege = 0x200,
}

export class PktMapEntry {
  Description = '';
  MinPlayers = 0;
  MaxPlayer = 0;
  GameModes = GameMode.None;

  constructor(sect: IniSection) {
    this.Description = sect.readString('Description');
    this.MinPlayers = sect.readInt('MinPlayers');
    this.MaxPlayer = sect.readInt('MaxPlayers');
    const modes = sect.readString('GameMode').split(/[, ]/).filter((s) => s !== '');
    for (const g of modes) {
      this.GameModes |= gameModeFromName(g);
    }
  }
}

const GameModeNames: Record<string, GameMode> = {
  None: GameMode.None,
  Standard: GameMode.Standard,
  MeatGrind: GameMode.MeatGrind,
  NavalWar: GameMode.NavalWar,
  NukeWar: GameMode.NukeWar,
  AirWar: GameMode.AirWar,
  Cooperative: GameMode.Cooperative,
  Duel: GameMode.Duel,
  Megawealth: GameMode.Megawealth,
  TeamGame: GameMode.TeamGame,
  Siege: GameMode.Siege,
};

function gameModeFromName(name: string): GameMode {
  const lower = name.toLowerCase();
  for (const k of Object.keys(GameModeNames)) {
    if (k.toLowerCase() === lower) return GameModeNames[k];
  }
  return GameMode.None;
}

export class PktFile extends IniFile {
  MapEntries: Map<string, PktMapEntry> = new Map();

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    length = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, length, isBuffered);
    this.parsePkt();
  }

  private parsePkt(): void {
    this.MapEntries = new Map<string, PktMapEntry>();
    const maplist = this.getSection('MultiMaps');
    if (maplist == null) return;
    for (const v of maplist.OrderedEntries) {
      const mapsection = this.getSection(v.Value.toString());
      if (mapsection != null) this.MapEntries.set(v.Value.toString().toLowerCase(), new PktMapEntry(mapsection));
    }
  }

  getMapEntry(mapname: string): PktMapEntry | undefined {
    if (mapname.includes('.')) mapname = mapname.substring(0, mapname.indexOf('.'));
    return this.MapEntries.get(mapname.toLowerCase());
  }
}

registerFormat(FileFormat.Pkt, (b, f, o, l, c) => new PktFile(b, f, o, l, c));