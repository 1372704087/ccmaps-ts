// Port of CNCMaps.Engine.Drawables.AnimDrawable
import { CollectionType, PaletteType } from '../../shared/Enums.js';
import type { IniSection } from '../../formats/IniFile.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { logger } from '../../shared/Log.js';
import { Defaults } from '../game/Defaults.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import type { GameObjectLike } from '../Types.js';
import { Animation } from '../types/Animation.js';
import { ShpDrawable } from './ShpDrawable.js';

export class AnimDrawable extends ShpDrawable {
  private _animProps: Animation | null = null;
  private _translucency = 0;

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection | null, art: IniSection | null, shpFile?: ShpFile | null) {
    super(config, vfs, rules, art, shpFile);
  }

  override LoadFromRules(): void {
    super.LoadFromArtEssential();

    this._animProps = new Animation(this.Name);
    this._animProps.LoadArt(this.Art);

    this._translucency = this.Art!.readBool('Translucent') ? 50 : this.Art!.readInt('Translucency', 0);

    this.Props.HasShadow = this.Art!.readBool('Shadow', Defaults.GetShadowAssumption(CollectionType.Animation));

    this.Props.FrameDecider = FrameDeciders.LoopFrameDecider(
      this.Art!.readInt('LoopStart'),
      this.Art!.readInt('LoopEnd', 1),
    ) as unknown as ((obj: GameObjectLike) => number);

    this.Flat =
      this.Art!.readBool('DrawFlat', Defaults.GetFlatnessAssumption(this.OwnerCollection!.Type)) || this.Art!.readBool('Flat');

    if (!this._animProps.ShouldUseCellDrawer) this.Props.PaletteType = PaletteType.Anim;
  }

  override Draw(obj: GameObject, ds: DrawingSurface, omitShadow = false): void {
    const gobj = obj as unknown as GameObjectLike;
    if (this.Props.HasShadow && !omitShadow && obj.Drawable != null && !obj.Drawable.Props.Cloakable)
      this._renderer.DrawShadow(gobj, this.Shp!, this.Props, ds);
    if (this._translucency === 0) super.Draw(obj, ds, omitShadow);
    else if (!(obj.Drawable != null && obj.Drawable.Props.Cloakable && this._translucency > 0)) {
      logger.debug(`Drawing object ${obj} with ${this._translucency}% translucency`);
      this._renderer.Draw(this.Shp!, gobj, this, this.Props, ds, this._translucency);
    }
  }
}