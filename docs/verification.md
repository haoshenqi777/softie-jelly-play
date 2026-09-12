# 验证方法

本文件描述如何选择检查与解释结果，不保存逐次通过记录。当前失败、未决结果及临时证据集中在 [README 逃生舱](../README.md#逃生舱)，常用命令也在 README。

## 按改动选择检查

| 改动领域 | 优先覆盖 |
| --- | --- |
| 纯文档 | 文件归属、链接有效性、与代码配置一致性、过期和重复内容 |
| 页面与触摸输入 | `mobile-experience`、`touch-takeover`、`touch-orbit`、`candy-pointer` |
| 镜头和取景 | `studio-camera`、`softbody-camera-motion`、`softbody-frame-budget` |
| 软体与空间限制 | `softbody-solver`、`softbody-support`、`softbody-recovery`、`tabletop-play` |
| 接触、持有与吸收 | `game-intake`、`candy-handoff`、`contact-intake`、`cohesive-intake`、`candy-surface-continuity` |
| 行为与表情 | `softbody-behavior`、`softbody-expression`、`softbody-emotion`、`product-motion` |
| 模型与材质 | `studio-asset`、`studio-silhouette`、`studio-reference`、`studio-pigment`、`gel-linear-capture`、`gel-capture-mode` |
| WASM 数学与生成 | `softbody-wasm`、`contact-kernel`，必要时实际进食路径 |
| 构建与部署 | 类型检查、smoke、生产构建及静态 HTTP 检查 |

表中名称对应 `tests/<名称>.test.mjs`。依照依赖关系补充相关用例，避免机械地执行整张表。完整模拟耗时长，只有改动范围或未解风险需要时才扩大回归。

## 关键不变量

- 多指接管、两种抬手顺序、取消、失焦及捕获丢失不会串改持有权。
- 连续重复抓取不会无限积累高度或整体速度，同时保留局部拉伸和按压。
- 相机手动缩放保留，抓取时取景稳定，释放后的大跳不被裁出画面。
- 糖在抓取、压入、撤回、封合和溶解间空间连续；一次真实接触只完成一次吸收。
- 自由与桌面模式的不同方向进食都能结束，手动深压和中途释放不能永久卡住。
- 脸部和内部效果跟随变形表面；模型、参考图和来源清单保持一致。
- WASM 与 JS 在实际几何上的结果一致，不只验证内核能够加载。
- 复位与卸载清理指针、行为、糖果与图形资源，后台恢复不产生大步长跳变。

## 视觉与设备验证

没有明确要求时，先取得允许再执行视觉验证，不关闭其他人正在运行的开发服务。

获准后，按问题选择连续操作：正侧视角、揉压与提放、双指接管、完整进食、撤回或连续换色。静态截图只能证明某一帧，不能证明持有权、运动连续性或进食闭环。

桌面窄屏模拟可检查布局和事件处理，不证明 iPhone 的 GPU 路径、触摸延迟和持续性能。自动事件 harness 也不等于真实双指操作。手机采样问题需要对应设备确认，不能以桌面无条纹结论替代。

性能结果应说明设备、浏览器、前后台状态、视口与渲染分辨率、像素比以及测量口径。GPU render pass 时长、页面回调频率和实际呈现帧率不能混用。诊断开关见[渲染文档](rendering.md)。

## 结果与提交

区分已执行通过、失败、未执行和设备限制，不把旧记录当作当前结果。通过数值回归不能自动视为视觉批准。

临时日志和截图可放在被忽略的 `outputs/` 中。需要交接时在 README 简述结论与缺口；docs 中的长期知识应能脱离临时文件独立理解。需要成为固定回归输入的资料放入测试 fixture 或正式参考资源，不建立日期报告目录。

提交前检查 README 逃生舱、docs 内容归属以及内部链接。仅整理文档时不启动应用、不运行完整模拟，也不顺带修复发现的业务问题。
