// Port of CNCMaps.FileFormats.MissionsFile
import { IniFile, IniSection } from './IniFile.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';

export class MissionEntry {
  Briefing = '';
  UIName = ''; // used by RA2/YR, localized by CSF file
  Name = ''; // used by TS/FS
  LSLoadMessage = '';
  LSLoadBriefing = '';
  LS640BriefLocX = 0;
  LS640BriefLocY = 0;
  LS800BriefLocX = 0;
  LS800BriefLocY = 0;
  LS640BkgdName = '';
  LS800BkgdName = '';

  constructor(iniSection: IniSection) {
    this.Briefing = iniSection.readString('Briefing');
    this.UIName = iniSection.readString('UIName');
    this.Name = iniSection.readString('Name');
    this.LS640BriefLocX = iniSection.readInt('LS640BriefLocX');
    this.LS640BriefLocY = iniSection.readInt('LS640BriefLocY');
    this.LS800BriefLocX = iniSection.readInt('LS800BriefLocX');
    this.LS800BriefLocY = iniSection.readInt('LS800BriefLocY');
    this.LSLoadMessage = iniSection.readString('LSLoadMessage');
    this.LSLoadBriefing = iniSection.readString('LSLoadBriefing');
    this.LS640BkgdName = iniSection.readString('LS640BkgdName');
    this.LS800BkgdName = iniSection.readString('LS800BkgdName');
  }
}

export class MissionsFile extends IniFile {
  MissionEntries: Map<string, MissionEntry> = new Map();

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    length = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, length, isBuffered);
    this.ParseMissions();
  }

  private ParseMissions(): void {
    this.MissionEntries = new Map<string, MissionEntry>();
    for (const s of this.Sections) {
      this.MissionEntries.set(s.Name.toLowerCase(), new MissionEntry(s));
    }
  }

  getMissionEntry(missionName: string): MissionEntry | undefined {
    return this.MissionEntries.get(missionName.toLowerCase());
  }
}

registerFormat(FileFormat.Missions, (b, f, o, l, c) => new MissionsFile(b, f, o, l, c));