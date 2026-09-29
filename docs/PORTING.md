# TS 对齐 .NET 3.1.0 移植清单

对照 `ccmaps-net` 3.1.0（`RELEASE_NOTES.md`）逐项核对当前 TypeScript 移植版的实现状态。
标记含义：**已实现** / **部分** / **未实现**。参考列指向 .NET 源码位置，TS 现状列指向本仓库源码位置。

> 排序原则：先做被其它改动依赖的底层（深度模型 → 光照），再补「独立且收益大」的项，最后补工具 / CLI / 健壮性 / 测试。

---

## P0 — 底层地基（其余项依赖）

### 1. 逐像素深度模型 —— 已实现
- 目标：站立形状每 3 行退 1z、起点对齐 3 的倍数；严格 `>`（平局保留先绘制）；单位 / 动画只测深度不写深度；平面形状沿地面斜坡。
- 参考：`CNCMaps.Engine/Rendering/ShpRenderer.cs#L217-L279`
- TS 现状：`src/rendering/ShpRenderer.ts`（深度模型、BUILDNGZ 采样、严格深度测试）
- 被依赖：本清单 #4 / #6 / #8 / #14
- 范围：L

### 2. 光照量化 + 归一化 —— 已实现
- 目标：63 级强度量化；ambient / tint 钳制 [0,2] 并按最大通道归一化（`CellClass::ComputeLighting`）。
- 参考：`CNCMaps.Engine/Rendering/Palette.cs#L86-L162`
- TS 现状：`src/rendering/Palette.ts`（63 级量化、钳制归一化、`QuantizeIntensity` 开关）
- 被依赖：本清单 #7
- 范围：S–M

---

## P1 — 独立且收益大

### 3. tile 变体确定性选取 —— 已实现
- 目标：小集合 4×4 Latin square、大集合 8×8 lattice，按 `(x&7,y&7)` 索引。
- 参考：`CNCMaps.Engine/Game/TileCollection.cs#L91-L142`
- TS 现状：`src/engine/game/TileCollection.ts#L84-L129`（`VariantPattern4` + `VariantLattice` + `SetVariantLattice`，含单测）
- 范围：S

### 4. 斜坡 lift 取整（RampHeight） —— 已实现
- 目标：`Z_Lepton_To_Pixel` 7/8px 取整，对象落到坡面。
- 参考：`CNCMaps.Engine/Rendering/RampHeight.cs`
- TS 现状：`src/rendering/RampHeight.ts`（含单测 `RampHeight.test.ts`）
- 依赖：#1；范围：M

### 5. 队伍配色 remap ramp —— 已实现
- 目标：hue 保留、饱和 sin 提升、明度 cos 压暗 + 整数 HSV 转换。
- 参考：`CNCMaps.Engine/Rendering/Palette.cs#L192-L210`
- TS 现状：`src/rendering/Palette.ts`（sin/cos ramp + `engineHsvToRgb`）
- 范围：S

### 6. InvisibleInGame 收敛 —— 已实现
- 目标：只用 rules `InvisibleInGame` 判定；地图覆盖 `=no` 不回显；删除硬编码 lamp 列表。
- 参考：`CNCMaps.Engine/Drawables/BuildingDrawable.cs#L54`、`CNCMaps.Engine/Map/Map.cs#L135-L143`
- TS 现状：`src/engine/drawables/BuildingDrawable.ts#L62`（读 rules）、`src/engine/map/Map.ts#L166-L173`（sticky 覆盖）；无 `LampNames`
- 范围：S–M

---

## P2 — 行为细节（部分依赖 P0 / P1）

### 7. 额外单位光照 + 隧道屋顶光照 —— 已实现
- 目标：`ExtraUnitLight/ExtraInfantryLight/ExtraAircraftLight`；隧道屋顶按台地光照。
- 参考：`CNCMaps.Engine/Map/Map.cs#L550-L552`、`#L685`
- TS 现状：`src/engine/map/Map.ts#L555-L592`
- 依赖：#2

### 8. BUILDNGZ 金字塔采样 + 建筑 ZAdjust / turret —— 已实现
- 目标：采样 z-shape 金字塔、`NormalZAdjust`、turret 独立绘制。
- 参考：`CNCMaps.Engine/Rendering/ShpRenderer.cs#L42-L84/L224-L259`、`CNCMaps.Engine/Drawables/BuildingDrawable.cs#L168-L170`
- TS 现状：`src/rendering/ShpRenderer.ts`（`BuildingZShape` 加载 `.sha`/`.shp` + `sampleZShape` 金字塔采样，`zShapeX`/`zShapeY` 按 `ZShapePointMove` 与 foundation 计算，`_zShapeBias` 引擎常量）、`src/engine/drawables/BuildingDrawable.ts#L182-L184`（body `Props.ZAdjust = NormalZAdjust`）、`#L135-L138`（turret `TurretAnimZAdjust` + `IsTurret` 独立绘制）
- 依赖：#1

### 9. 矿 / 宝石 pooled 图 —— 已实现
- 目标：`GetPooledDrawId`，按 `pool[(x*y)%12]` 出图；高架桥按 cell 变帧。
- 参考：`CNCMaps.Engine/Game/SpecialOverlays.cs#L84-L113`、`CNCMaps.Engine/Map/Operations.cs#L22-L34`
- TS 现状：`src/engine/game/SpecialOverlays.ts#L86-L117`、`src/engine/map/Operations.ts#L22-L31`、`Map.ts#L557`（`ApplyTiberiumArt` + `StoredDrawable` 阴影，含单测）

### 10. 雪地路面 MediansFix —— 已实现
- 目标：雪地 pavement 归入 paved road bits，无过渡边。
- 参考：`CNCMaps.Engine/Game/TileCollection.cs#L279`
- TS 现状：`src/engine/game/TileCollection.ts#L282-L286`

### 11. 着火动画完整化 —— 已实现
- 目标：每建筑一次 roll、round-robin、ConditionRed 门控、lepton 取整。
- 参考：`CNCMaps.Engine/Drawables/BuildingDrawable.cs#L243-L299`
- TS 现状：`src/engine/drawables/BuildingDrawable.ts#L247-L315`（`LoadFireAnimations` + `DamageFireOffset` + `OffsetHack`）

### 12. PreCapture 科技建筑 —— 已实现
- 目标：触发授予起始玩家的建筑按其颜色、首帧起转；`--precapture` 控制。
- 参考：`CNCMaps.Engine/Map/Map.cs#L882-L900`
- TS 现状：`src/formats/map/MapFile.ts`（`ApplyPreCapturedOwners` 归属改写 + `PreCaptured` 标记）、`src/engine/map/Map.ts`（`PreCaptureSlotOwners` + `_countryColors` 配色）、`src/engine/drawables/AnimDrawable.ts#L55-L58`（`HoldUntilCaptured` + `obj.PreCaptured` 决定首帧起转，接 #17）、`src/shared/RenderSettings.ts`（`--precapture`，含单测）
- 依赖：#5

### 13. 步兵 sub-cell —— 已实现
- 目标：按地图给的 sub-cell 落点、用自身段的美术。
- 参考：`CNCMaps.Engine/Map/GameObjects.cs#L95-L111`、`CNCMaps.Engine/Game/DrawProperties.cs#L54-L67`、`CNCMaps.Engine/Game/ObjectCollection.cs#L169-L175`
- TS 现状：`src/formats/map/MapFile.ts`（解析 entries[5]）、`src/engine/game/DrawProperties.ts#L72-L102`（`InfantrySubCell`）、`src/engine/game/ObjectCollection.ts#L196-L202`；含单测

### 14. Tiberian Sun 专项 —— 已实现
- 目标：悬崖 / 斜坡 `C_SHADOW`；Blossom 树 +16px；Green LAT 豁免。
- 参考：`CNCMaps.Engine/Game/TileCollection.cs#L514-L549`、`CNCMaps.Engine/Rendering/ShpRenderer.cs#L380-L423`、`CNCMaps.Engine/Drawables/Drawable.cs#L175-L205`、`CNCMaps.Engine/Map/Map.cs#L1189-L1268`
- TS 现状：`src/engine/game/TileCollection.ts`（`ShadowCaster` 解析、`CliffCasters`/`SlopeCasters`、`DrawTileShadow`、`ConnectTiles` green 豁免）、`src/rendering/ShpRenderer.ts#DrawTileShadow`、`src/engine/map/Map.ts#Draw`（五段：tile+smudge → overlay → 阴影 → terrain → techno，`GetObjectsAt` 加 `includeOverlays`）、`src/engine/drawables/Drawable.ts`（`YDrawFudge`、veins/veinhole、`SpawnsTiberium` `-16` + Ambient）
- 依赖：#1

---

## P3 — 工具、CLI、健壮性与测试

### 15. CLI 补齐 —— 已实现
- 目标：补齐 3.1.0 新增命令行选项与字段。
- 新增字段：`NoExpandMixes`、`ThumbnailMarkers`、`DebugZBufferFile`、`DebugTilesFile`、`DebugVoxelMaskFile`、`VeinRandomizer`、`PinRandomDraws`、`AnimFrame`。
- 新增选项：`--no-expand-mixes`、`--thumb-markers`、`--debug-zbuffer`、`--debug-tiles`、`--debug-voxelmask`、`--vein-rng`、`--pin-random`、`--anim-frame`。
- 已接线：`--no-expand-mixes`（`VirtualFileSystem.loadMixes(dir, engine, loadExpandMixes)`）、`--pin-random`（`Rand.Pinned`）、`--vein-rng`（`Operations.SetVeinRandomizer` + `Random2`/`Roll3`/`Roll2`）、`--debug-zbuffer`/`--debug-tiles`/`--debug-voxelmask`（`RenderEngine.dumpZBuffer`/`dumpTiles`/`dumpVoxelMask`；含 `DrawingSurface.TrackVoxelMask` + `getVoxelMask`，`VoxelDrawable` 写入掩码）、`--anim-frame`（设置 `FrameDeciders.AnimSimFrame`，绘制端消费见 #17）。
- 参考：`CNCMaps.Shared/RenderSettings.cs#L147-L222`、`CNCMaps.Engine/RenderEngine.cs#L56-L77`、`#L258-L268`、`#L815-L859`、`CNCMaps.FileFormats/VirtualFileSystem/VirtualFileSystem.cs#L124-L142`
- TS 现状：`src/shared/RenderSettings.ts`、`src/shared/Util.ts`（`Rand.Pinned`）、`src/formats/vfs/VirtualFileSystem.ts`、`src/rendering/DrawingSurface.ts`、`src/engine/drawables/VoxelDrawable.ts`、`src/engine/map/Operations.ts`、`src/engine/map/Map.ts`、`src/engine/RenderEngine.ts`、`src/engine/game/FrameDeciders.ts`；单测 `src/shared/RenderSettings.test.ts`
- 依赖：#17（`--anim-frame` 的实际动画帧模拟）

### 16. meta 统计 —— 已实现
- 目标：`MapStats`，`--meta-json` 带地形 / 资源 / 对象统计。
- 参考：`CNCMaps.Engine/Map/MapStats.cs`、`CNCMaps.Engine/Map/Map.cs#L1038-L1053`（`GetStartPositionPixels`）、`#L1410-L1489`（`ComputeStats`）、`CNCMaps.Engine/RenderEngine.cs#L554-L631`（`WriteMetadataJson`）、`#L635-L813`（`DetermineMapName`）
- TS 现状：`src/engine/map/MapStats.ts`（`MapStats` + `StartPositionPixel`）、`src/engine/map/Map.ts`（`TileWidth`/`TileHeight`、`GetStartPositionPixels`、`ComputeStats`）、`src/engine/RenderEngine.ts`（`determineMapName`、`writeMetadataJson`，`Render` 中在 `FreeUseless` 前统计、存图后写出；`--meta-json`）
- 说明：名称解析覆盖非官方地图（`Basic.Name`）、PKT/CSF 官方地图路径；`.map` 输入经私有 VFS 兜底的路径受 TS VFS `addItem` 限制（原始 `.map` 未包装为虚拟 mix），失败时回退文件名。
- 范围：M

### 17. 动画按 tick 帧 —— 已实现
- 目标：`AnimSimFrame` + 加载期相位，配合 `--anim-frame`。
- 参考：`CNCMaps.Engine/RenderEngine.cs#L59`、`CNCMaps.Engine/Game/FrameDeciders.cs`
- TS 现状：`src/engine/game/FrameDeciders.ts`（`simulateAnimStage` + `AnimTickFrameDecider`，含 normalized/pingpong/reverse/loop）、`src/engine/drawables/AnimDrawable.ts`（按 `AnimSimFrame` 选择决策器 + `HoldAtStart`/`HoldUntilCaptured`）、`src/engine/drawables/BuildingDrawable.ts`（按 `Powered`/`NeedsEngineer` 设置）

### 18. 健壮性 —— 已实现
- 目标：facing 越界、负帧、IsoMapPack5 越界、base64 尾、缺失 buildngz、超大地形扩展画黑格；preview plugin。
- 参考：`RELEASE_NOTES.md#L63-L67`、`CNCMaps.FileFormats/Map/MapFile.cs#L276/L310/L341/L373`、`CNCMaps.Engine/Map/Map.cs#L480-L503`、`CNCMaps.Engine/Rendering/ShpRenderer.cs#L45-L77/L472-L485`
- TS 现状：
  - facing：`src/formats/map/MapFile.ts`（`readInfantry`/`readUnits`/`readAircraft`/`readStructures` 的 `Direction` 均 `& 0xff`，游戏按字节存朝向）
  - 负帧：`src/formats/ShpFile.ts#L105-L109`（`getImage` 对非整数 / 越界 / 负索引返回空 `ShpImage`）+ `src/rendering/ShpRenderer.ts`（`Draw`/`DrawShadow` 显式 `frameIndex < 0 || >= Images.length` 跳过）
  - IsoMapPack5 越界 + base64 尾：`src/formats/map/MapFile.ts`（`decodePackBase64` + 越界条目跳过并计数告警）
  - 缺失 buildngz：`src/rendering/ShpRenderer.ts#L80-L115`（`try/catch` 包裹加载，缺失 / 损坏都回退平面站立 z 剖面）
  - 超大地形扩展画黑格：`src/engine/map/Map.ts#L549-L570`（`unknownTiles` 计数并按 `NumTiles` 告警；无 `Drawable` 的 cell 直接不画，保持黑色不崩溃）
  - preview plugin：TS 为库 / CLI，无闭源插件绑定；`GetObjectsAt(dx, dy, includeOverlays = true)` 保留两参调用形式

### 19. 回归测试 —— 已实现（golden 需游戏数据时跳过）
- 现状：`npm test` = `tsc` + `node --test "dist/**/*.test.js"`，当前 51 项（45 通过 / 6 跳过）。
- 单测骨架：#4 `RampHeight`、#2 `Palette` 量化 / 归一化 / remap ramp、#3 `TileCollection` 变体 + green LAT、#12 `PreCapture`、#9 `SpecialOverlays`、#13 `InfantrySubCell`、#15 `RenderSettings` CLI、#20 `FixTiles`。
- Golden 端到端：`src/engine/GoldenRender.test.ts`（移植 `CNCMaps.Tests/GoldenRenderTests.cs`）+ `test-assets/`（复用 .NET 的 5 张地图与 `golden.json`）。
  - 设 `CNCMAPS_MIX_DIR`（RA2/YR）或 `CNCMAPS_TS_MIX_DIR`（TS）指向含 mix 的目录即运行；未设置时 6 项自动 skip。
  - 像素哈希与 .NET 一致：解码 PNG 为 RGB24，对 `"WxH:" + 行数据` 求 SHA256（`test-assets/golden.json` 为原始无改动游戏数据的哈希）。
  - 复用 `PngWriter` 的自校验：`Golden: pixel hash round-trips a written PNG` 无需游戏数据即可验证解码 / 哈希链路。
  - 未移植 `.NET` 的 `PreviewPackInjection`：TS 渲染不回写地图文件，注入结果无法落盘断言。

### 20. LAT 重算补漏 + 对象筛选（发布说明里未列入 #1–#19 的新行为）—— 已实现
- 目标：
  - 坡面平滑（ramp smoothing）按游戏 LAT 重算替换：`RampBase` 与 `RampSmooth` 都参与；越界邻居按空地算「平」；无平地邻居时回退到普通 ramp；进入修正后刷新 Drawable。
  - CLAT→LAT 转换后立即刷新 Drawable，避免 autolat 保持 plain 时仍画 CLAT 美术。
  - multiplayer-only 地图上由国家（country）预置的对象不生成（skirmish 只建玩家 / Neutral / Special；被触发捕获的对象带 `<Player @ X>` 归属）。
  - 无 rules 段的对象类型（CALOND02、CALA02）按 `IsUndefined` 丢弃，而不是画成占位方块。
- 参考：`CNCMaps.Engine/Map/Operations.cs#L192-L314`、`CNCMaps.Engine/Map/Map.cs#L176-L215`、`#L409-L456`、`CNCMaps.Engine/Game/ObjectCollection.cs#L42-L74`、`CNCMaps.Engine/Game/GameCollection.cs#L76-L79`
- TS 现状：`src/engine/map/Operations.ts#FixTiles`（`RampBase || RampSmooth` + `flatAt` 越界计平 + 回退分支 + CLAT 转换后刷新 Drawable）、`src/engine/map/Map.ts#LoadAllObjects`（`skirmish`/`exists` 归属过滤，置于 PreCapture 改写之后）、`src/engine/drawables/Drawable.ts`（`IsUndefined`）、`src/engine/game/ObjectCollection.ts#MakeDrawable`（`Rules.getSection == null` 判定）、`src/engine/game/GameCollection.ts#HasObject`（`!IsUndefined`）；单测 `src/engine/map/FixTiles.test.ts`
- 说明：TS 本就有 `Map.RemoveUnknownObjects` 移除过程，此前因 `HasObject` 未判 `IsUndefined` 而无效。

---

## 建议批次与依赖顺序

1. **批次 A（地基）**：#19 测试骨架 → #1 深度模型 → #4 斜坡 lift → #8 BUILDNGZ 采样
2. **批次 B（光照）**：#2 量化 / 归一化 → #7 额外光照 + 隧道屋顶 → #5 remap ramp → #12 PreCapture
3. **批次 C（地形 / 对象独立项）**：#3 #6 #9 #10 #11 #13 #14
4. **批次 D（工具）**：#15 CLI → #17 动画帧 → #16 meta 统计 → #18 健壮性
5. **批次 E（补漏）**：#20 LAT 重算补漏 + 对象筛选

## 验证手段（每批都要）
- 复用 `tools/ab/` 思路：TS 渲染与 .NET golden / 引擎截图做像素对齐。
- 每项补最小单测（如 `RampHeight`、`Palette` 量化、`PickVariant` 的已知 cell→variant 映射）。