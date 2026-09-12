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

需要 Bun 1.4.2（版本固定在 `.bun-version`）。依赖安装、开发、构建和测试均由 Bun 执行，无需安装 Node.js。

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

# 预览静态产物（默认 http://127.0.0.1:4173）
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

项目使用 React、TypeScript 和 vinext，在构建时生成静态 HTML 与导航数据。依赖版本由 `bun.lock` 固定；第三方许可说明位于 `third-party-licenses/`。

GitHub Actions 在推送到 `main` 和提交 PR 时，在 Bun 容器中执行冻结安装、类型检查、快速回归、静态构建和 HTTP 检查。完整回归运行 `bun run test`，使用 4 个隔离的 Bun 工作进程；`bun test --timeout=300000 ./tests` 可顺序运行。单项模拟允许最多 5 分钟。

## 部署

历史在线版本仍由 Sites 托管，本仓库已移除 Sites/Cloudflare Worker 发布集成。推送代码不会更新该在线版本。

执行 `bun run build` 后，只发布 `dist/client/`。其中包含所有页面的 HTML、导航所需的 `.rsc` 数据，以及脚本、样式、模型、纹理和 WASM。`dist/server/` 仅供构建时预渲染使用，不应发布；线上无需 Bun、Node.js 或 Worker。

静态托管需支持 HTTPS 和无扩展名页面路径（例如 `/lookdev` 对应 `lookdev.html`，根路径对应 `index.html`），保留 `.rsc` 文件，不要把资源请求重写为首页。当前链接及资源使用根路径，默认部署到域名根目录；部署到子目录需另行配置。更换域名不会自动迁移原域名的浏览器设置。

`bun run start` 使用 Bun 提供本地静态预览；可通过 `PORT` 环境变量改变端口。`bun run check:static` 检查全部页面、导航数据与公开资源，且仅临时监听本机随机端口。

早期实现及外观研究记录已归档至 [开发历史](docs/development-history.md)，其中的旧玩法和测量数据以对应日期为准。
