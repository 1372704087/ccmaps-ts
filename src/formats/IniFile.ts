// Port of CNCMaps.FileFormats.IniFile (+ nested IniSection / IniValue)
import { VirtualTextFile } from './vfs/VirtualTextFile.js';
import { VirtualFileSystem } from './vfs/VirtualFileSystem.js';
import { FileFormat } from './FileFormat.js';
import { registerFormat } from './FormatHelper.js';
import { Point, Size, Color, Vector3 } from '../shared/Geometry.js';
import { logger } from '../shared/Log.js';

export class IniValue {
  private value: string;
  constructor(value: string) {
    this.value = value;
  }
  overrideToString(): string {
    return this.value;
  }
  static fromString(value: string): IniValue {
    return new IniValue(value);
  }
  toString(): string {
    return this.value;
  }
  set(value: string): void {
    this.value = value;
  }
  equals(obj: unknown): boolean {
    return this.value === (obj == null ? '' : String(obj));
  }
}

export type OrderedPair = { Key: string; Value: IniValue };

const TrueValues = ['yes', '1', 'true', 'on'];
const FalseValues = ['no', '0', 'false', 'off'];

const MaxInheritanceDepth = 8;

export class IniSection {
  Index: number;
  Name: string;
  File: IniFile | null = null;
  SortedEntries: Map<string, IniValue> = new Map();
  OrderedEntries: OrderedPair[] = [];
  AlreadyInherited = false;

  constructor(name = '', index = -1) {
    this.Name = name;
    this.Index = index;
  }

  toString(): string {
    let sb = `[${this.Name}]\n`;
    for (const v of this.OrderedEntries) {
      sb += `${v.Key}=${v.Value}\n`;
    }
    return sb;
  }

  clear(): void {
    this.SortedEntries.clear();
    this.OrderedEntries = [];
  }

  parseLine(line: string): number {
    if (line[0] === ';') return 0;
    const pos = line.indexOf('=');
    if (pos !== -1) {
      let key = line.substring(0, pos);
      let value = line.substring(pos + 1);
      key = IniSection.fixLine(key);
      value = IniSection.fixLine(value);
      this.setValue(key, value, false);
      return 1;
    }
    return 0;
  }

  setValue(key: string, value: string, override = true): void {
    if (!this.SortedEntries.has(key)) {
      const val = IniValue.fromString(value);
      this.OrderedEntries.push({ Key: key, Value: val });
      this.SortedEntries.set(key, val);
    } else if (override) {
      this.SortedEntries.get(key)!.set(value);
      this.OrderedEntries = this.OrderedEntries.filter((e) => e.Key !== key);
      this.OrderedEntries.push({ Key: key, Value: IniValue.fromString(value) });
    }
  }

  static fixLine(line: string): string {
    let start = 0;
    while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start++;

    let end = line.indexOf(';', start);
    if (end === -1) end = line.length;

    while (end > 1 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;

    // length = end - start, and JS substring's second arg is an absolute end
    // index (unlike C# Substring's length), so add it back onto start.
    return line.substring(start, start + Math.max(end - start, 0));
  }

  hasKey(keyName: string): boolean {
    return this.SortedEntries.has(keyName);
  }

  readBool(key: string, defaultValue = false): boolean {
    const entry = this.readString(key);
    if (TrueValues.includes(entry.toLowerCase())) return true;
    else if (FalseValues.includes(entry.toLowerCase())) return false;
    return defaultValue;
  }

  readString(key: string, defaultValue = ''): string {
    let section: IniSection | null = this;
    for (let depth = 0; section != null && depth <= MaxInheritanceDepth; depth++) {
      const ret = section.SortedEntries.get(key);
      if (ret !== undefined) return ret.toString();
      section = section.getBaseSection();
    }
    return defaultValue;
  }

  private getBaseSection(): IniSection | null {
    if (this.File == null) return null;
    const baseName = this.SortedEntries.get('BaseSection');
    if (baseName === undefined) return null;
    const baseSection = this.File.getSection(baseName.toString());
    return baseSection === this ? null : baseSection;
  }

  readInt(key: string, defaultValue = 0): number {
    const ret = parseInt(this.readString(key), 10);
    return Number.isNaN(ret) ? defaultValue : ret;
  }

  readXY(key: string, defaultValue?: Point): Point {
    const def = defaultValue ?? Point.Empty;
    const val = this.readString(key).split(',');
    const x = parseInt(val[0], 10);
    const y = parseInt(val[1], 10);
    if (val.length === 2 && !Number.isNaN(x) && !Number.isNaN(y)) return new Point(x, y);
    return def;
  }

  readShort(key: string, defaultValue = 0): number {
    const ret = parseInt(this.readString(key), 10);
    return Number.isNaN(ret) ? defaultValue : ret;
  }

  readFloat(key: string, defaultValue = 0): number {
    const ret = parseFloat(this.readString(key).replace(',', '.'));
    return Number.isNaN(ret) ? defaultValue : ret;
  }

  readDouble(key: string, defaultValue = 0): number {
    const ret = parseFloat(this.readString(key).replace(',', '.'));
    return Number.isNaN(ret) ? defaultValue : ret;
  }

  readPercent(key: string, defaultValue = 0): number {
    let ret = defaultValue;
    const val = this.readString(key);
    if (val !== '') {
      if (val.includes('%')) {
        const c = val.split('%');
        const p = parseInt(c[0], 10);
        if (!Number.isNaN(p)) ret = p;
      } else {
        const valDec = parseFloat(val.replace(',', '.'));
        if (!Number.isNaN(valDec)) ret = Math.trunc(valDec * 100);
      }
    }
    return ret;
  }

  readColor(key: string): Color {
    const colorStr = this.readString(key, '0,0,0');
    const colorParts = colorStr.split(',').filter((s) => s !== '');
    const r = parseInt(colorParts[0], 10);
    const g = parseInt(colorParts[1], 10);
    const b = parseInt(colorParts[2], 10);
    if (colorParts.length === 3 && !Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b))
      return Color.FromRgb(r, g, b);
    return new Color(0, 0, 0, 0);
  }

  readEnum<T extends string>(key: string, def: T): T {
    if (this.hasKey(key)) {
      const s = this.readString(key);
      const found = Object.keys(def as unknown as object).find(
        (k) => k.toLowerCase() === s.toLowerCase(),
      );
      if (found !== undefined) return found as T;
    }
    return def;
  }

  readList(key: string): string[] {
    return this.readString(key).split(',').filter((s) => s !== '');
  }

  concatenatedValues(): string {
    let sb = '';
    for (const v of this.OrderedEntries) sb += v.Value.toString();
    return sb;
  }

  findValueIndex(p: string): number {
    for (let i = 0; i < this.OrderedEntries.length; i++)
      if (this.OrderedEntries[i].Value.toString() === p) return i;
    return -1;
  }

  readXYZ(key: string, defaultValue?: Vector3): Vector3 {
    const def = defaultValue ?? new Vector3(0, 0, 0);
    const parts = this.readString(key).split(',');
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    const z = parseInt(parts[2], 10);
    if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) return new Vector3(x, y, z);
    return def;
  }

  readSize(key: string, defaultValue?: Size): Size {
    const def = defaultValue ?? Size.Empty;
    const parts = this.readString(key).split(',');
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return new Size(x, y);
    return def;
  }

  readPoint(key: string, defaultValue?: Point): Point {
    const def = defaultValue ?? Point.Empty;
    const parts = this.readString(key).split(',');
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return new Point(x, y);
    return def;
  }
}

export class IniFile extends VirtualTextFile {
  Sections: IniSection[] = [];
  CurrentSection: IniSection | null = null;
  private sectionsByName = new Map<string, IniSection>();

  constructor(
    baseStream: Uint8Array,
    fileName = '',
    baseOffset = 0,
    length = -1,
    isBuffered = true,
  ) {
    super(baseStream, fileName, baseOffset, length < 0 ? baseStream.length : length, isBuffered);
    this.Parse();
  }

  getSection(sectionName: string): IniSection | null {
    return this.sectionsByName.get(sectionName) ?? null;
  }

  private addSection(section: IniSection): void {
    section.File = this;
    if (!this.sectionsByName.has(section.Name)) this.sectionsByName.set(section.Name, section);
  }

  getOrCreateSection(sectionName: string, insertAfter?: string): IniSection {
    let ret = this.getSection(sectionName);
    if (ret == null) {
      const insertIdx =
        insertAfter != null ? this.Sections.findIndex((s) => s.Name === insertAfter) : -1;

      ret = new IniSection(sectionName);
      if (insertIdx !== -1) {
        this.Sections.splice(insertIdx, 0, ret);
        ret.Index = insertIdx;
        for (let i = insertIdx + 1; i < this.Sections.length; i++) this.Sections[i].Index++;
      } else {
        this.Sections.push(ret);
        ret.Index = this.Sections.length;
      }
      this.addSection(ret);
    }
    return ret;
  }

  Parse(): void {
    logger.info(`Parsing ${this.fileName.split(/[\\/]/).pop()}`);
    while (this.canRead) {
      const line = this.readLine();
      this.processLine(line);
    }
  }

  loadAresIncludes(vfs: VirtualFileSystem): void {
    const includes = this.getOrCreateSection('#include');
    for (const entry of includes.OrderedEntries) {
      const include = vfs.open(entry.Value.toString()) as IniFile | null;
      if (include == null) {
        logger.debug(`Include ini ${entry.Value} not found`);
        continue;
      }
      include.loadAresIncludes(vfs);
      this.mergeWith(include);
    }
  }

  loadPhobosIncludes(vfs: VirtualFileSystem): void {
    const includes = this.getOrCreateSection('$Include');
    for (const entry of includes.OrderedEntries) {
      const include = vfs.open(entry.Value.toString()) as IniFile | null;
      if (include == null) {
        logger.debug(`Include ini ${entry.Value} not found`);
        continue;
      }
      include.loadPhobosIncludes(vfs);
      this.mergeWith(include);
    }
  }

  solvePhobosInheritance(): void {
    for (const section of this.Sections) this.Inherit(section);
  }

  private Inherit(section: IniSection): void {
    if (section.AlreadyInherited) return;
    section.AlreadyInherited = true;
    if (!section.hasKey('$Inherits')) return;

    for (const parentName of section.readString('$Inherits').split(',')) {
      const parent = this.getSection(parentName.trim());
      if (parent == null) {
        logger.warn(`Section ${section.Name} names missing parent ${parentName.trim()} in $Inherits`);
        continue;
      }
      this.Inherit(parent);
      for (const pair of parent.OrderedEntries) {
        if (!section.hasKey(pair.Key)) section.setValue(pair.Key, pair.Value.toString());
      }
    }
  }

  private processLine(line: string): number {
    line = IniSection.fixLine(line);
    if (line.length === 0) return 0;

    if (line[0] === '[' && line[line.length - 1] === ']') {
      const sectionName = line.substring(1, line.length - 1);
      const iniSection = new IniSection(sectionName, this.Sections.length);
      this.Sections.push(iniSection);
      this.addSection(iniSection);
      this.CurrentSection = iniSection;
    } else if (this.CurrentSection != null) {
      return this.CurrentSection.parseLine(line);
    }
    return 0;
  }

  private setCurrentSection(sectionName: string): void {
    this.CurrentSection = this.getSection(sectionName);
  }

  setCurrentSectionObj(section: IniSection): void {
    if (this.Sections.includes(section)) this.CurrentSection = section;
    else throw new Error('Invalid section');
  }

  readString(section: string, key: string, def = ''): string {
    if (this.CurrentSection == null || this.CurrentSection.Name !== section)
      this.setCurrentSection(section);
    return this.CurrentSection ? this.CurrentSection.readString(key, def) : def;
  }

  readBool(key: string, section?: string): boolean {
    if (section !== undefined) {
      if (this.CurrentSection == null || this.CurrentSection.Name !== section)
        this.setCurrentSection(section);
    }
    return this.CurrentSection ? this.CurrentSection.readBool(key) : false;
  }

  saveString(): string {
    let sb = '';
    for (let i = 0; i < this.Sections.length; i++) {
      const section = this.Sections[i];
      if (section.Name === '#include' && section.OrderedEntries.length === 0) continue;
      sb += section.toString();
      if (i < this.Sections.length - 1) sb += '\n';
    }
    return sb;
  }

  mergeWith(ini: IniFile | null): void {
    if (ini == null) return;

    for (const v of ini.Sections) {
      const ownSection = this.getOrCreateSection(v.Name);
      if (IniFile.isObjectArray(v.Name)) {
        let number: number | null = null;
        if (ownSection.OrderedEntries.length > 0) {
          const lastKey = parseInt(ownSection.OrderedEntries[ownSection.OrderedEntries.length - 1].Key, 10);
          if (!Number.isNaN(lastKey)) number = 1 + lastKey;
        }
        if (number != null) {
          for (const kvp of v.OrderedEntries) ownSection.setValue((number++).toString(), kvp.Value.toString());
        } else {
          for (const kvp of v.OrderedEntries) ownSection.setValue(kvp.Key, kvp.Value.toString());
        }
      } else {
        for (const kvp of v.OrderedEntries) ownSection.setValue(kvp.Key, kvp.Value.toString());
      }
    }
  }

  private static isObjectArray(p: string): boolean {
    return [
      'BuildingTypes',
      'AircraftTypes',
      'InfantryTypes',
      'OverlayTypes',
      'TerrainTypes',
      'SmudgeTypes',
      'VehicleTypes',
    ].includes(p);
  }
}

registerFormat(FileFormat.Ini, (b, f, o, l, c) => new IniFile(b, f, o, l, c));