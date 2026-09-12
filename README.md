# softie · 软乎乎

可揉捏、提起、回弹和喂糖的三维凝胶角色。使用 Three.js / WebGPU 渲染，保留凝胶材质纹理、体内气泡、软体变形与糖果吸收效果。

**[在线体验](https://softie-jelly-play.zhaorong.chatgpt.site/)**

本仓库从线上第 17 版整理，源版本为 `76def5a364c290bed3f526f731c8cd97c5424a71`（2026-09-12）。发布到 GitHub 时仅整理说明与忽略规则，应用代码、模型、材质和测试与该版本一致。

四张离线 Cycles 参考 PNG 已移除包含本机路径的文本元数据，压缩像素数据与颜色信息保持原样。

## 当前玩法

- 拖动身体揉捏、拉伸或提起，松手后回弹与落地。
- 从托盘选择糖果，点击放入或拖动喂给角色。糖果可以被压入、撤回、吸收和溶解，并影响身体颜色。
- 设置中可切换固定桌面与自由空间，调整身体手感、运动和外观。
- 小屏或触控设备默认固定中央视角，双指可缩放；可在设置中解除视角固定。
- 同时保留外观、接触与吸收等开发样片页面，入口代码见 `app/`。

手机专用的局部揉捏、减少翻滚和进一步优化进食性能仍属于后续工作，本快照未包含这些改动。

## 本地运行

需要 Bun 1.4.2（版本固定在 `.bun-version`）和 Node.js 24。Bun 管理依赖和脚本；构建工具及现有测试继续使用 Node.js。

```sh
git clone https://github.com/haoshenqi777/softie-jelly-play.git
cd softie-jelly-play
bun install --frozen-lockfile
bun run dev
```

打开终端显示的本地地址。WebGPU 需要浏览器支持及图形加速，并通过 HTTPS 或 localhost 访问。模型和纹理已经包含在仓库中，日常运行不需要 Blender。

```sh
# 类型检查
bun run typecheck

# 生产构建
bun run build

# 预览构建后的 Worker
bun run start
```

## 测试

快速检查本次手机视角与输入功能：

```sh
bun run test:smoke
```

完整回归包含耗时较长的真实软体及进食模拟：

```sh
bun run test
```

具体版本的验证范围与设备限制记录在 `docs/verification/`。第 17 版记录见 [手机交互验证](docs/verification/2026-09-12-mobile-interaction.md)。

## 代码结构

| 路径 | 内容 |
| --- | --- |
| `app/softbody/` | 当前主页面、设置与糖果托盘；`app/page.tsx` 导出此页面 |
| `lib/studio-scene.ts` | 主场景、镜头、输入协调和渲染 |
| `lib/softbody/` | 体积软体求解、抓取、表面、姿态与进食接触 |
| `lib/game-intake.ts` | 糖果吸收与颜色变化的协调 |
| `lib/studio-gel.ts`、`lib/studio-dyed-gel.ts` | 凝胶与染色材质 |
| `public/` | 模型、材质纹理、WASM 和参考资源 |
| `assets/` | 模型生成脚本与材质来源说明 |
| `tools/wasm-compiler/` | 可选的物理内核编译源码 |
| `tests/` | 输入、物理、材质、进食与回归测试 |

项目使用 React、TypeScript、vinext 和 Cloudflare Worker 构建工具。依赖版本由 `bun.lock` 固定；第三方许可说明位于 `third-party-licenses/`。

GitHub Actions 在推送到 `main` 和提交 PR 时使用 Bun 执行冻结安装、类型检查、快速回归和生产构建。`bun run test` 调用现有 Node 测试运行器；请勿用 `bun test` 替代。

## 部署

当前在线版本由 Sites 托管，`.openai/hosting.json` 保留其项目关联配置。GitHub 仓库用于保存和协作开发源代码；推送到本仓库不会自动更新在线站点。

当前构建包含服务端 Worker，不能直接把仓库根目录作为 GitHub Pages 静态站点发布。后续若需要独立部署，应针对目标托管平台配置构建与发布流程。

早期实现及外观研究记录已归档至 [开发历史](docs/development-history.md)，其中的旧玩法和测量数据以对应日期为准。
