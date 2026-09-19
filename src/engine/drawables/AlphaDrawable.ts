// Port of CNCMaps.Engine.Drawables.AlphaDrawable
import { Point } from '../../shared/Geometry.js';
import type { IniSection } from '../../formats/IniFile.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { ShpRenderer } from '../../rendering/ShpRenderer.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import type { GameObjectLike } from '../Types.js';
import { ShpDrawable } from './ShpDrawable.js';
import { registerAlphaDrawableFactory } from './Drawable.js';

export class AlphaDrawable extends ShpDrawable {
  constructor(renderer: ShpRenderer, alphaShpFile: ShpFile | null);
  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection | null, art: IniSection | null, alphaShpFile: ShpFile);
  constructor(
    configOrRenderer: ModConfig | ShpRenderer,
    vfsOrShp: VirtualFileSystem | ShpFile | null,
    rules?: IniSection | null,
    art?: IniSection | null,
    alphaShpFile?: ShpFile,
  ) {
    if (configOrRenderer instanceof ShpRenderer) {
      super(configOrRenderer, vfsOrShp as ShpFile | null);
      this.Props.Offset = new Point(0, 15);
      this.Props.FrameDecider = FrameDeciders.AlphaImageFrameDecider(this.Shp!) as unknown as ((obj: GameObjectLike) => number);
    } else {
      super(configOrRenderer as ModConfig, vfsOrShp as VirtualFileSystem, rules ?? null, art ?? null, alphaShpFile ?? null);
      this.Props.Offset = new Point(0, 15);
      this.Props.FrameDecider = FrameDeciders.AlphaImageFrameDecider(this.Shp!) as unknown as ((obj: GameObjectLike) => number);
    }
  }

  override Draw(obj: GameObject, ds: DrawingSurface, shadow = true): void {
    if (!obj.Drawable!.Props.Cloakable)
      this._renderer.DrawAlpha(obj as unknown as GameObjectLike, this.Shp!, this.Props, ds);
  }
}

// Register the factory so the base Drawable class can construct alpha
// drawables without a circular import.
registerAlphaDrawableFactory((renderer, shp) => new AlphaDrawable(renderer, shp));