# ccmaps-ts 移植改动包（全部修改文件）

TS 版对齐 .NET `ccmaps-net` 3.1.0 的全部改动文件（共 48 个，含新增文件与测试资产），保留仓库内相对路径，可直接覆盖到 `ccmaps-ts-main/` 对应位置。

- 清单基准：`PORTING.md`（#1–#20 项，均已实现）
- 文件清单来源：本机无 git 仓库，以原始发布包（解压于 2026-09-22）为基线，用目录级 diff 筛出全部新增 / 修改文件

## 按移植项归类

| 移植项 | 文件 |
| --- | --- |
| #1 逐像素深度模型 | `src/rendering/ShpRenderer.ts`、`src/engine/map/MapTile.ts`、`src/engine/game/GameCollection.ts` |
| #2 光照量化/归一化 | `src/rendering/Palette.ts`、`src/rendering/Palette.test.ts` |
| #3 tile 变体确定性 | `src/engine/game/TileCollection.ts`、`src/engine/game/TileCollection.test.ts` |
| #4 斜坡 lift | `src/rendering/RampHeight.ts`、`src/rendering/RampHeight.test.ts` |
| #5 remap ramp | `src/rendering/Palette.ts` |
| #6 InvisibleInGame | `src/engine/drawables/BuildingDrawable.ts`、`src/engine/map/Map.ts` |
| #7 额外单位/隧道光照 | `src/engine/map/Map.ts` |
| #8 BUILDNGZ 采样 | `src/rendering/ShpRenderer.ts` |
| #9 矿/宝石 pooled | `src/engine/game/SpecialOverlays.ts`、`src/engine/game/SpecialOverlays.test.ts`、`src/engine/map/Operations.ts`、`src/engine/map/Map.ts` |
| #10 雪地路面 | `src/engine/game/TileCollection.ts` |
| #11 着火动画 | `src/engine/drawables/BuildingDrawable.ts` |
| #12 PreCapture | `src/engine/map/Map.ts`、`src/formats/map/MapFile.ts`、`src/formats/map/PreCapture.test.ts` |
| #13 步兵 sub-cell | `src/formats/map/MapFile.ts`、`src/formats/map/MapObjects.ts`、`src/engine/game/DrawProperties.ts`、`src/engine/game/DrawProperties.test.ts`、`src/engine/game/ObjectCollection.ts` |
| #14 Tiberian Sun 专项 | `src/engine/game/TileCollection.ts`、`src/rendering/ShpRenderer.ts`、`src/engine/map/Map.ts`、`src/engine/drawables/Drawable.ts`、`src/rendering/TmpRenderer.ts`、`src/engine/drawables/TileDrawable.ts` |
| #15 CLI 补齐 | `src/shared/RenderSettings.ts`、`src/shared/RenderSettings.test.ts`、`src/shared/Util.ts`、`src/formats/vfs/VirtualFileSystem.ts`、`src/rendering/DrawingSurface.ts`、`src/engine/drawables/VoxelDrawable.ts`、`src/engine/map/Operations.ts`、`src/engine/RenderEngine.ts`、`src/engine/game/FrameDeciders.ts` |
| #16 meta 统计 | `src/engine/map/MapStats.ts`（新增）、`src/engine/map/Map.ts`、`src/engine/RenderEngine.ts` |
| #17 动画按 tick 帧 | `src/engine/game/FrameDeciders.ts`、`src/engine/drawables/AnimDrawable.ts`、`src/engine/drawables/BuildingDrawable.ts`、`src/engine/map/GameObjects.ts` |
| #18 健壮性 | `src/engine/drawables/ShpDrawable.ts`、`src/engine/Types.ts` |
| #19 回归测试 | `src/engine/GoldenRender.test.ts`（新增）、`test-assets/`（新增，5 张地图 + `golden.json`）、各 `*.test.ts` |
| #20 LAT 重算补漏 + 对象筛选 | `src/engine/map/Operations.ts`、`src/engine/map/Map.ts`、`src/engine/drawables/Drawable.ts`、`src/engine/game/ObjectCollection.ts`、`src/engine/game/GameCollection.ts`、`src/engine/map/FixTiles.test.ts`（新增） |

### 本轮追加（deferred 渲染 + 体素 + 光源定位）

| 主题 | 文件 |
| --- | --- |
| Deferred ANIM / ALPHA 两段式绘制 | `src/rendering/DrawingSurface.ts`、`src/engine/map/Map.ts`、`src/engine/drawables/BuildingDrawable.ts`、`src/engine/drawables/AlphaDrawable.ts` |
| 体素渲染重写（正交投影 + 8.8 定点 + ShadowIndex 底面阴影） | `src/rendering/VxlRenderer.ts` |
| 光源定位（按 foundation 求中心 + map 段缺省的整数截断） | `src/engine/map/GameObjects.ts` |
| 其它 | `package.json`（test 脚本改为 `tsc` + `node --test`）、`PORTING.md`（清单状态） |

> 说明：一个文件可能同时服务多个移植项（如 `Map.ts`、`ShpRenderer.ts`、`BuildingDrawable.ts`），上表按主要关联列出。

## #20 具体补齐内容

1. **坡面平滑替换**：`FixTiles` 的 ramp 分支现同时处理 `RampBase` 与 `RampSmooth`；越界（off-map）邻居按空地算「平」；无平地邻居时回退到普通 ramp；修正后刷新 `Drawable`。
2. **CLAT→LAT 后刷新 Drawable**：避免 autolat 把该 cell 保持为 plain 时仍画 CLAT 美术。
3. **multiplayer-only 归属过滤**：skirmish 地图只生成玩家 / `Neutral` / `Special` / `<Player…` 归属的对象，由国家预置的对象不生成；过滤置于 PreCapture 归属改写之后。
4. **无 rules 段对象丢弃**：`Drawable.IsUndefined` + `ObjectCollection.MakeDrawable` 的 `Rules.getSection == null` 判定 + `GameCollection.HasObject` 的 `!IsUndefined`，使既有的 `Map.RemoveUnknownObjects` 真正生效。

## 验证

- `npx tsc -p tsconfig.json` 通过（无类型错误）
- `node --test "dist/**/*.test.js"`：51 项（45 通过 / 0 失败 / 6 跳过）；跳过项为需游戏 MIX 数据的 golden 端到端用例（`CNCMAPS_MIX_DIR` / `CNCMAPS_TS_MIX_DIR` 未设置时自动 skip）
- 新增 `src/engine/map/FixTiles.test.ts`（6 项）覆盖 #20 的 ramp 替换 / 回退 / 越界计平 / RampSmooth / 越界 ramp 值
- `node dist/cli.js --help` 正常，3.1.0 新增选项（`--no-expand-mixes`、`--thumb-markers`、`--debug-zbuffer`、`--debug-tiles`、`--debug-voxelmask`、`--vein-rng`、`--pin-random`、`--anim-frame`、`--meta-json`、`--precapture`）均已接线

## 已知差异

- #16 `--meta-json`：`.map` 输入经私有 VFS 解析 PKT 的兜底分支受 TS `VirtualFileSystem.addItem` 限制，失败时回退文件名。
- #19 未移植 .NET 的 `PreviewPackInjection`：TS 渲染不回写地图文件，注入结果无法落盘断言。
- VXL 的 `UseBuffer=yes` 2px z-buffer 绘制路径未建模（与 .NET 保持一致）。

## 解包

```bash
tar -xzf ccmaps-ts-porting-all.tar.gz
# 覆盖到 ccmaps-ts-main/
cp -r ccmaps-ts-porting-all/{src,test-assets,package.json,PORTING.md} /path/to/ccmaps-ts-main/
```