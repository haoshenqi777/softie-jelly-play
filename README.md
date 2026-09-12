# softie · 软乎乎

可揉捏、提起、回弹和喂糖的三维凝胶角色，使用 React、TypeScript、vinext 和 Three.js / WebGPU。

[在线体验](https://softie-jelly-play.zhaorong.chatgpt.site/)是独立托管的版本，不随本仓库推送更新。

## 文档入口

- [AGENTS](AGENTS.md)：目录地图与开发、测试、文档维护约定。
- [产品](docs/product.md)：玩法、输入语义和体验边界。
- [架构](docs/architecture.md)：模块协作、数据流和控制权。
- [物理](docs/physics.md)：软体、接触、吸收与 WASM 内核维护。
- [渲染](docs/rendering.md)：凝胶材质、移动端采样和资源制作。
- [验证](docs/verification.md)：检查选择、诊断方法和证据边界。

## 本地运行

使用 Bun，版本以 [.bun-version](.bun-version) 为准；依赖由 `bun.lock` 固定。应用工具链不要求安装 Node.js，模型和纹理已包含在仓库，日常运行不需要 Blender。

```sh
bun install --frozen-lockfile
bun run dev
```

打开终端显示的地址。WebGPU 需要浏览器支持、图形加速以及 HTTPS 或 localhost。

## 常用检查

```sh
bun run typecheck
bun run test:smoke
bun run lint
bun run build
bun run check:static
```

`check:static` 在构建后检查页面、导航数据和公开资源，仅临时监听本机随机端口。

完整物理与进食回归耗时较长：`bun run test` 使用四个隔离工作进程，每项测试允许最多五分钟；顺序执行可用 `bun test --timeout=300000 ./tests`。针对改动选取测试的方法见[验证文档](docs/verification.md)。

`bun run format` 会格式化文件，应限制在本次改动范围内使用。实际脚本以 [package.json](package.json) 为准。

## 构建与部署

```sh
bun run build
bun run start
```

本地静态预览默认使用 `http://127.0.0.1:4173`，可通过 `PORT` 环境变量改变端口。

只发布 `dist/client/`。它包含 HTML、导航所需的 `.rsc` 数据，以及脚本、样式、模型、纹理和 WASM。`dist/server/` 仅用于构建时预渲染，线上无需 Bun、Node.js 或 Worker。

静态托管需支持 HTTPS 和无扩展名页面路径，例如 `/lookdev` 对应 `lookdev.html`，根路径对应 `index.html`。保留 `.rsc` 文件，不要把资源请求重写为首页。资源使用根路径，默认部署到域名根目录；子目录部署需要另行配置。更换域名不会自动迁移原域名的浏览器设置。

当前仓库没有可执行的 GitHub Actions 工作流，也没有 Sites/Cloudflare Worker 发布集成。推送代码不代表完成检查或发布。

## 逃生舱

临时、未决定及过程性文本统一放在这里，便于提交前集中检查。允许保存尚未整理的调查与交接信息；形成长期结论后迁入对应主题文档，失效内容直接删除。未解决的必要事项可以随提交保留，不累积已完成事项或变更历史。

### 当前问题与验证缺口

- `bun run build:wasm` 的 volume 生成器会提取未声明的 `floorHeight` 引用，导致编译失败；目前使用已提交的 WASM。失败的生成过程也可能改写 `kernel.ts`，执行后需检查差异。维护方法见[物理文档](docs/physics.md)。
- vinext 的 `trailingSlash: true` 存在深层路由预渲染被跳过的问题，目前保持无尾斜杠地址。
- [vinext #3064](https://github.com/cloudflare/vinext/issues/3064)：CSS-only 块可能产生不存在的 JS modulepreload 提示。静态检查仅对清单确认的这类可选提示报告警告，必需资源仍严格检查。
- 完整回归中曾发现 `studio-candies.test.mjs` 的 re-pick 断言与 pending 持有状态不一致，尚待单独处理。完整套件及无 Node 环境的验证尚未形成完整结论，不应宣称全部通过。
- 实际手机的持续帧率、输入延迟、深压与缩放表现仍需真机确认；桌面视口模拟不能补足这些证据。

### 待决定方向

- 手机局部揉捏、减少翻滚与进食性能仍有优化空间，具体范围待确定。
- 将身体拖拽扩展为向屏幕前后移动和抛掷，是待评估的空间玩法方向，不作为当前功能承诺。
