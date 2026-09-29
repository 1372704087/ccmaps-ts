// Port of CNCMaps.Engine.Drawables.AnimDrawable
import { CollectionType, PaletteType } from '../../shared/Enums.js';
import type { IniSection } from '../../formats/IniFile.js';
import type { ShpFile } from '../../formats/ShpFile.js';
import { VirtualFileSystem } from '../../formats/vfs/index.js';
import type { ModConfig } from '../../shared/ModConfig.js';
import type { GameObject } from '../map/GameObjects.js';
import { StructureObject } from '../map/GameObjects.js';
import type { DrawingSurface } from '../../rendering/DrawingSurface.js';
import { logger } from '../../shared/Log.js';
import { Defaults } from '../game/Defaults.js';
import { FrameDeciders } from '../game/FrameDeciders.js';
import type { GameObjectLike } from '../Types.js';
import { Animation } from '../types/Animation.js';
import { ShpDrawable } from './ShpDrawable.js';

export class AnimDrawable extends ShpDrawable {
  // AnimClass never carries SHAPE_ZWRITE (it is constructed with SHAPE_WIN_REL|SHAPE_CENTER and
  // no draw path adds the flag), so an anim paints colour without storing depth. The renderer
  // reads this flag instead of an instanceof check to keep the drawable classes out of its
  // import graph.
  override IsAnim = true;

  private _animProps: Animation | null = null;
  private _translucency = 0;

  /// <summary>Power-gated anim on a building whose owner has no power: the game holds it at
  /// its start frame.</summary>
  HoldAtStart = false;
  /// <summary>Power-gated anim on a building that must be captured before it operates (e.g. an
  /// oil derrick's pump): held at its start frame unless a game-start trigger captured it.</summary>
  HoldUntilCaptured = false;

  constructor(config: ModConfig, vfs: VirtualFileSystem, rules: IniSection | null, art: IniSection | null, shpFile?: ShpFile | null) {
    super(config, vfs, rules, art, shpFile);
  }

  override LoadFromRules(): void {
    super.LoadFromArtEssential();

    this._animProps = new Animation(this.Name);
    this._animProps.LoadArt(this.Art);

    this._translucency = this.Art!.readBool('Translucent') ? 50 : this.Art!.readInt('Translucency', 0);

    this.Props.HasShadow = this.Art!.readBool('Shadow', Defaults.GetShadowAssumption(CollectionType.Animation));

    if (FrameDeciders.AnimSimFrame < 0)
      this.Props.FrameDecider = FrameDeciders.LoopFrameDecider(
        this.Art!.readInt('LoopStart'),
        this.Art!.readInt('LoopEnd', 1),
      ) as unknown as ((obj: GameObjectLike) => number);
    else if (this.HoldAtStart)
      this.Props.FrameDecider = (() => this._animProps!.Start) as unknown as (obj: GameObjectLike) => number;
    else if (this.HoldUntilCaptured) {
      const tick = FrameDeciders.AnimTickFrameDecider(this._animProps!, this);
      this.Props.FrameDecider = ((obj: GameObject) =>
        obj instanceof StructureObject && obj.PreCaptured ? tick(obj) : this._animProps!.Start) as unknown as (
        obj: GameObjectLike,
      ) => number;
    } else
      this.Props.FrameDecider = FrameDeciders.AnimTickFrameDecider(this._animProps!, this) as unknown as (
        obj: GameObjectLike,
      ) => number;

    this.Flat =
      this.Art!.readBool('DrawFlat', Defaults.GetFlatnessAssumption(this.OwnerCollection!.Type)) || this.Art!.readBool('Flat');

    if (!this._animProps.ShouldUseCellDrawer) this.Props.PaletteType = PaletteType.Anim;
  }

  override Draw(obj: GameObject, ds: DrawingSurface, omitShadow = false): void {
    const gobj = obj as unknown as GameObjectLike;
    if (this.Props.HasShadow && !omitShadow && obj.Drawable != null && !obj.Drawable.Props.Cloakable)
      this._renderer.DrawShadow(gobj, this.Shp!, this, this.Props, ds);
    if (this._translucency === 0) super.Draw(obj, ds, omitShadow);
    else if (!(obj.Drawable != null && obj.Drawable.Props.Cloakable && this._translucency > 0)) {
      logger.debug(`Drawing object ${obj} with ${this._translucency}% translucency`);
      this._renderer.Draw(this.Shp!, gobj, this, this.Props, ds, this._translucency);
    }
  }
}