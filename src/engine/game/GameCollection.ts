// Port of CNCMaps.Engine.Game.GameCollection
import type { IniFile } from '../../formats/IniFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import { CollectionType, TheaterType } from '../../shared/Enums.js';
import type { Drawable } from '../drawables/Drawable.js';
import { GameObject, NamedObject, NumberedObject } from '../map/GameObjects.js';
import type { ObjectCollection } from './ObjectCollection.js';

export abstract class GameCollection {
  readonly Type: CollectionType;
  readonly Theater: TheaterType;
  protected readonly _config: ModConfig;
  protected readonly _vfs: VirtualFileSystem;
  readonly Rules: IniFile;
  readonly Art: IniFile;

  protected readonly _drawables: Drawable[] = [];
  protected readonly _drawableIndexNameMap: Record<number, string> = {};
  private readonly _drawablesDict = new Map<string, Drawable>();
  private readonly _drawableLoaded = new Map<Drawable, boolean>();

  protected constructor(
    type: CollectionType,
    theater: TheaterType,
    config: ModConfig,
    vfs: VirtualFileSystem,
    rules: IniFile,
    art: IniFile,
  ) {
    this._config = config;
    this._vfs = vfs;
    this.Theater = theater;
    this.Type = type;
    this.Rules = rules;
    this.Art = art;
  }

  protected AddObject(objName: string): Drawable {
    const sub = this.MakeDrawable(objName);
    sub.OwnerCollection = this as unknown as ObjectCollection;
    sub.Index = this._drawables.length;
    this._drawableIndexNameMap[this._drawables.length] = objName;
    this._drawables.push(sub);
    this._drawablesDict.set(objName, sub);
    this._drawableLoaded.set(sub, false);
    return sub;
  }

  GetDrawable(o: GameObject): Drawable | null;
  GetDrawable(name: string): Drawable | null;
  GetDrawable(index: number): Drawable;
  GetDrawable(o: GameObject | string | number): Drawable | null {
    if (typeof o === 'object' && o !== null) {
      if (o instanceof NamedObject) return this.GetDrawable((o as NamedObject).Name);
      if (o instanceof NumberedObject) {
        const idx = Math.max(0, (o as NumberedObject).Number);
        if (idx >= 0 && idx < this._drawables.length) return this.GetDrawable(idx);
      }
      return null;
    } else if (typeof o === 'number') {
      const ret = this._drawables[o];
      if (!this._drawableLoaded.get(ret)) {
        this._drawableLoaded.set(ret, true);
        this.LoadDrawable(ret);
      }
      return ret;
    } else {
      if (!this._drawablesDict.has(o as string)) return null;
      const ret = this._drawablesDict.get(o as string)!;
      if (!this._drawableLoaded.get(ret)) {
        this._drawableLoaded.set(ret, true);
        this.LoadDrawable(ret);
      }
      return ret;
    }
  }

  HasObject(o: GameObject): boolean {
    return this.GetDrawable(o) != null;
  }

  protected abstract MakeDrawable(objName: string): Drawable;

  protected LoadDrawable(_d: Drawable): void {}
}