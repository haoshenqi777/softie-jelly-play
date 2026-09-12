# Bun 与静态部署迁移

开发工具链使用 Bun 1.4.2；部署目标为 `dist/client/`，线上不需要 JavaScript 服务端运行时。保留 vinext 的构建时预渲染与客户端导航，移除 Cloudflare Worker 和 Sites 发布集成。

## 已验证

- 本机 Bun 冻结安装、类型检查、smoke 测试和生产构建通过。
- 8 个业务页面及 404 页面成功预渲染，无页面被跳过。
- 静态 HTTP 检查覆盖业务页面、元信息、导航 RSC 数据、必需脚本/样式、12 个公开资源的字节一致性，以及 404、HEAD 和路径边界。
- oxlint、oxfmt 的 CLI 可由 Bun 启动；已有 lint 规则违规不属于本次迁移修复范围。
- 锁文件删除失效依赖，没有引入新的包版本。

## 保留问题与验证边界

- vinext 的 `trailingSlash: true` 在本版本中导致深层路由预渲染被跳过，因此继续使用现有无尾斜杠地址，静态托管需将 `/lookdev` 等地址映射到对应 `.html`。
- [vinext #3064](https://github.com/cloudflare/vinext/issues/3064)：RSC 清单为 CSS-only 块生成不存在的 JS modulepreload 提示。本项目涉及 absorption/colors 两个 CSS 块。静态检查只对清单确认的这类可选提示报告警告；必需脚本、样式、页面和资源仍严格检查。不在本次迁移中修补上游框架。
- WASM 生成器提取的代码引用未声明的 `floorHeight`，导致 volume 编译失败。用户要求保留此既有问题；生成源码及已提交 WASM 均保持原样。详见工具目录 README。
- 完整回归曾发现 `studio-candies.test.mjs` 的 re-pick 用例期望 `down()` 后立即设置 `heldId`，而当前实现先保存 pending 状态。未更改该业务行为或断言。
- 测试迁移已替换 `node:test`、Node TestContext 的 `diagnostic`，并在完整测试命令中显式设置 5 分钟超时和文件级隔离。按用户要求停止耗时物理回归，不宣称完整套件通过。
- 无 Node 的 Docker 本地验证未获授权，未执行；CI 已配置 Bun 容器和 Node 不可用检查，实际结果待 CI 确认。
- 未进行视觉或浏览器交互验证，也未发布网站。
