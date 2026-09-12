# Softie 实体糖与性格开发计划

> **For agentic workers:** Follow the approved spec and implement task-by-task. Use the execution and verification workflows; the Sites owner performs all source edits, integration and publishing. Independent agents may only perform bounded read-only research/review.

**Goal:** 将已确认的四张设计图落成可玩的 WebGPU 软体宠物：实体糖、多颗投喂、饱腹、精致吞咽、可揉鼓气、丰富表情、泡泡与睡眠。

**Architecture:** 纯 TypeScript 的糖果物理、食欲/情绪与行动选择可以在 Node 中独立验证。Three.js 场景负责把这些状态映射到共享表面形变、实体糖网格和内部糖浆；React 只控制托盘与设置。新增能力不使用 DOM 糖果或 WebGL 后备。

**Tech Stack:** Three.js 0.183.2 WebGPU + TSL、React 19、Vinext、现有 pnpm 锁文件、Node test runner。

**Spec:** `../specs/2026-09-09-personality.md`，来自已批准的 `outputs/softie-personality-design/design-v2.md`。美术参照为 storyboard-v2、expressions-v2、candy-physics-v4、swallow-detail-v2。

## Global Constraints

- 严格 WebGPU；保留 `_getFallback = null` 和后端检查。
- 圆润小跳，小嘴小于眼睛；脸与身体共享形变，不能长出侧向长嘴或外挂脸颊球。
- 糖从手里、空中到地面始终为同一个 3D 实体；软硬材质有不同碰撞反馈。
- 多颗糖继续运动，一次只吃一颗；饱了停止主动吃，剩糖保留且可再次抓取。
- 吃饱与鼓气独立；下腹松软饱满与全身憋气撑起有不同手感。
- 吞咽包含入口遮挡、三次轻嚼、下传起伏、内部细丝晕色，不使用廉价色球覆盖。
- 背景页面暂停行为计时；指针取消与复位不遗留抓取或错误进食。
- 目标 30 颗实体糖时前台 60 FPS；通过真实浏览器与多糖场景验证。
- 所有阶段连续推进，已获得修改和私有发布授权，不逐段重复请求批准。

## 执行记录

- 基线：26 项已有测试全部通过。使用独立工作目录 `work/softie-personality`，分支 `feature/softie-personality`；保留原站点源码作为可回退基线。
- 决策：维护当前项目的依赖，糖果采用小颗凸体近似碰撞、固定步长及软糖形变模式，避免为几十颗小糖引入整套高成本软体引擎。真实接触、冲量、摩擦和休眠决定运动；外观仍须浏览器验收。
- 决策：扩展身体的前后位移以捡不同深度的糖；整只史莱姆大范围扔远/拖近属于后续空间玩法，本轮保证可玩桌面范围内的深度与接触。

## Task 1：实体软硬糖与投掷

**Files:** 新建 `lib/candy-physics.ts`、`lib/candy-renderer.ts`、`tests/candy-physics.test.mjs`；修改 `lib/slime-scene.ts`、`app/page.tsx`、`app/globals.css`。

**Interfaces:** `CandyWorld.spawn(hex, kind, position, velocity?)` 返回具有稳定 id 的 `CandyBody`；`grab(id)`、`moveHeld(position, dt)`、`release()`、`remove(id)`、`advance(dt, collider?)` 控制实体，`candies` 提供可渲染列表。`CandyKind = 'gummy' | 'hard'`。每颗包含位置、速度、角度、角速度、压缩量和睡眠状态。

- [x] 先写失败测试：抛物线受重力；落地不穿透；硬糖比软糖反弹高；碰撞传递速度；松手保留速度；静止糖休眠且碰撞唤醒；30 颗长时间模拟保持有限值并留在场内。

```js
const world = new CandyWorld();
const candy = world.spawn('#6ecfb1', 'gummy', {x:0,y:2,z:1});
for (let i=0;i<1200;i++) world.advance(1/120);
assert.ok(candy.y >= candy.radius - 0.002);
assert.equal(world.candies.length, 1);
assert.ok(candy.sleeping);
```

- [x] 运行新测试，确认缺少模块/行为导致失败；实现固定 120 Hz 模拟、桌面/边界/糖间接触、摩擦和软糖局部压缩回弹。
- [x] 使用共享低面数倒角几何和物理节点材质、每颗地面影子；替换 `.candy-ghost`，拖动与投掷维持同一网格。
- [x] 托盘增加软糖/硬糖切换，进食中保持可继续投糖；地上糖射线命中优先于身体抓取，取消/移回托盘正确释放。
- [x] 测试通过后浏览器验证轻放、甩出、重新抓取以及多颗碰撞，记录截图。

## Task 2：主动接捡与饱腹

**Files:** 新建 `lib/slime-feeding.ts`、`tests/feeding.test.mjs`；修改 `lib/slime-character.ts`、`lib/slime-physics.ts`、`lib/slime-scene.ts`、`tests/character.test.mjs`、`tests/physics.test.mjs`。

**Interfaces:** `SlimeFeeding.update(dt, candies, body, hungry)` 返回锁定目标、移动/跳跃方向、捡糖冲量与命中 id；`SlimeCharacter.fullness`、`isFull`、`eat()`、`phase` 驱动食欲；`SlimeDynamics.z/vz/driveZ` 支持前后靠近，`hopTo(x,height,z?)` 保持圆润。

- [x] 先写失败测试：目标锁定不在两颗糖之间抖动；嘴部真实接触才能接受；满腹不再选择；目标被拿走能重新选择；连续投糖不会打断当前口中糖。
- [x] 扩展角色饱腹：吞下才计数，约 6–8 颗吃饱；满腹后闭嘴友好偏开；经过一段休息重新有食欲；复位清空。

```js
const character = new SlimeCharacter();
for (let n=0;n<8;n++) {
  if (character.eat()) for(let f=0;f<800;f++) character.advance(1/120);
}
assert.ok(character.isFull);
assert.equal(character.eat(), false);
```

- [x] 根据实际位置和速度选择可达糖；地面糖先靠近，蹲低并以小冲量拱到嘴边。空中糖按轨迹预测，接不到就落地再找。
- [x] 玩家抓身体时暂停追逐；一次嘴里只有一颗，吃完再选。所有抓取与捡糖使用物理接触而非直接删除远处目标。
- [x] 连续投 30 颗验证它能吃、吃饱停下、剩糖可抓；左右与不同深度均能完成拾取。

## Task 3：精致的入口、咀嚼、吞咽和染色

**Files:** 新建 `lib/slime-syrup.ts`、`tests/meal-motion.test.mjs`；修改 `lib/slime-scene.ts`、`lib/slime-character.ts`、`lib/slime-physics.ts`。

**Interfaces:** `sampleMeal(age)` 给出 bite/chewSide/swallow/dispersion 连续参数；内部细丝节点使用这些参数与共享形变，不绑定屏幕坐标。

- [x] 先验证进食顺序、三个咀嚼峰、吞咽发生在嚼完后、混色连续且复位可清除。
- [x] 同一颗糖进入嘴后逐渐被外皮遮挡，再缩软淡入；去掉旧 candyCore 球和球形 pigmentMask。
- [x] 以几条细薄的三维糖浆曲线表现内部形态，沿身体形变并受晃动惯性影响；透明边缘、颜色深浅和折光控制层次，外皮高光保持稳定。
- [x] 给吞咽增加从嘴下向腹部移动的很浅局部波；轻嚼只有连续脸颊起伏，避免独立鼓球。
- [x] 新旧糖色平滑混合，连续投喂不重置旧颜色、不叠加到发白；淡淡纹理先在下腹，逐步染遍身体。
- [x] 浏览器抓取入口、嚼、咽、晕开关键帧，并在晃动与连续异色投喂时检查遮挡与空间感。

## Task 4：鼓气、情绪表情与安抚

**Files:** 修改 `lib/slime-character.ts`、`lib/slime-physics.ts`、`lib/slime-scene.ts`；扩展角色和物理测试。

**Interfaces:** 角色提供 `puff`、`disappointment`、`soothed`、`noticeFood(dt)`、`withdrawFood()`；物理提供 pressure/fullness/sleep 参数及连续压力形变。

- [x] 先写失败测试：未期待时拿走不生气；期待半秒后收回会鼓气；普通松手投掷不算撤回；满腹时收回不触发委屈；短时间反复逗不会无限膨胀；抚摸会逐渐安抚。
- [x] 失落停顿 → 吸气 → 温和鼓胖 → 偷看 → 呼气恢复；全身局部压力形变区别于单纯等比放大。
- [x] 验证局部按压、拖拽、松手连续性和不同阻尼；脸、身体与泡泡共用表面位移。双指触屏允许两侧受压，单指不混淆揉捏与拖动。
- [x] 实现丰富眼形与嘴弧：期待、扑空、委屈、微怒、被按单眼、安抚、满足、满腹婉拒；避免突然切脸和大嘴。
- [x] 浏览器对照鼓气与吃饱的轮廓、被按凹陷和松手回晃，确认手感与可爱程度。

## Task 5：泡泡、睡眠与轻音效

**Files:** 新建 `lib/slime-feedback.ts`、`tests/feedback.test.mjs`；修改角色、场景及页面。

**Interfaces:** 角色状态提供睡意、惊醒、落地晕眩；反馈管理器 `emit(kind)`、`update(dt)`、`pop(id)`；音效 `setEnabled(boolean)`、`play(kind,strength)`。

- [x] 先验证闲置才累积睡意；进食/拖动/鼓气不会入睡；活动唤醒有过渡；满腹被糖唤醒仍不吃；泡泡数量与寿命受限。
- [x] 爱心泡泡在抚摸满意/被哄好后出现，重落地两颗星星；泡泡可点破并引起视线反应。
- [x] 35–45 秒犯困，约 60 秒体积向两侧摊软，嘴边睡泡随呼吸；点醒先惊一下再装没睡。
- [x] 添加默认关闭的轻音效开关，首次用户操作后启用音频上下文，碰撞声音限频并按强度限幅。
- [x] 后台暂停行为，回来不快进；复位和卸载完整清理糖、泡泡、声音与指针状态。

## Task 6：整体校验与私有更新

- [x] `node --experimental-strip-types --test tests/*.test.mjs`：全部行为回归通过。
- [x] 运行本项目 TypeScript、oxlint、oxfmt 与 Vinext 构建，修复实际错误。
- [x] 在已有预览中检验鼠标、键盘、窄屏以及指针取消；静态外观对照批准图，连续动作验证因果。
- [x] 前台记录 30 颗糖的帧率/P95、后端、画布尺寸和像素比；如需优化先减材质/绘制成本，保留物理物体。
- [x] 请求一次有界独立只读审查并处理有效发现；更新计划执行记录和用户向说明。
- [ ] 将验证后的提交合回项目交付目录，按既有私有权限发布精确版本，确认部署成功后复用原站点标签页。

## 计划自审

| 共享接口 | 产出/消费关系 | 决策 |
|---|---|---|
| Task 1 → 2 | CandyBody id、位置、速度、held 状态供选择器读取 | 选择器不删除糖；真实咬住才转入口中状态 |
| Task 2 → 3 | 进食时钟和目标颜色供吞咽与晕色 | 饱腹在吞下计一次，染色可以继续，不阻塞新投糖 |
| Task 3 → 4 | 共享表面形变与脸颊参数 | 物理抓取优先，情绪与进食姿势有明确权重 |
| Task 4 → 5 | 安抚、冲击、睡意驱动反馈 | 饱腹独立于情绪，满腹不等于不允许互动 |
| Task 1–5 | 重置/卸载/后台状态 | 统一由场景生命周期收口，Node 行为测试与浏览器复位检查共同覆盖 |

所有规格条目均映射到任务；源码由站点负责人集中集成，以避免共享场景文件冲突。最终不以静态图或旧的帧率数据替代当前动态验证。

## 最终实施记录

- 已完成实体软硬糖、30颗保留、再抓取、主动接捡、7颗饱腹、精细进食、可揉鼓气、双点压力、丰富表情、睡眠和泡泡、默认关闭轻音效。
- 69项回归、TypeScript、oxlint、oxfmt与生产构建通过。独立只读审查发现并修复失焦误删糖、头顶碰撞低于外皮、满腹拾取被下腹阻挡、下一口打断晕色。
- 真实前台预览完成30颗连续投喂，吃7颗后剩23颗；再投7颗保留30颗，地上id2软糖重新抓起后仍为同一实体。采样92–144 FPS，P95 7–12ms，像素比1.5，画布1281×1599。不是Chrome或所有硬件的保证。
- 390×844窄屏无横向溢出，内容总高1120、控件底部1009，均可滚动访问。双指压力由物理回归验证，本轮没有真实双指硬件实测；爱心/星星的数量、寿命与点击状态由回归和代码审查覆盖。
- 内部糖浆使用真正的3D曲线、深度缓冲及半分辨率内部光层；避免实体被整块玻璃的折射近似完全藏住。保留连续外皮高光、从下腹向上扩散及后续进食的连续性。
