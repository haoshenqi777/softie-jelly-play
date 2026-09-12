# 物理与接触

## 软体与表面

体积软体采用四面体 XPBD 离散，结合稳定 neo-Hookean 能量中的形状与体积约束。节点质量来自静止几何体积；抓取、重力、阻尼和地面接触共同决定运动。它不是只对外观网格做缩放的动画。

求解笼驱动可见表面，材料坐标锚点把脸部和接触位置绑定到持续变形的身体。修改表面映射时应同时考虑抓取、脸部附着、接触与内部糖的位置。

桌面模式是空间与输入策略：限制过度的整体移动，保留局部形变和相对节点速度。不能用每帧复位、清空速度或整体变硬代替空间约束。

## 糖果与吸收

糖果采用小凸体接触近似，包含重力、冲量、摩擦与休眠，软硬糖的变形和运动存在区别。避免为少量糖引入不必要的完整软体引擎。

`BodyIntake` 将接触锚定在材料空间，通过接触壳与接触流推进包裹、进入、封合和体内溶解。深度、覆盖与持续接触决定状态转换；手动持有、释放和撤回必须保留空间连续性。

落地接触受桌面遮挡，不能把悬空的完整覆盖条件机械套用到所有落地场景；应基于实际支撑和受力判断。修正条件时必须保留无支撑、覆盖不足和撤回场景的保护。

接触计算有独立调度时钟，降低细接触频率时仍需保持材料锚点传输连续。性能优化不能通过跳过吸收阶段、提前删除糖或移动身体来掩盖问题。

细接触表面通过局部应变与二面角正则约束抑制三角形尖刺，粗体积网格仍负责体积和整体运动。二面角梯度参考 Bridson 及 PositionBasedDynamics 的实现，许可说明保留在 [PositionBasedDynamics.txt](../third-party-licenses/PositionBasedDynamics.txt)。

## WASM 与源码依据

`public/physics/volume.wasm` 加速四面体投影和翻转屏障计算；`public/physics/contact-skin.wasm` 加速接触皮肤和碰撞投影。内核使用双精度和每实例内存区，避免每步分配。

- volume 生成器从 `lib/softbody/solver.ts` 及数学辅助模块提取算法，TypeScript 是参考实现。
- contact 生成器从 `lib/softbody/contact-skin.ts` 提取数学，并结合 `tools/wasm-compiler/contact-collision.ts`。
- `kernel.ts` 和 `contact-kernel.ts` 是生成源码，不手工修补来替代参考实现的修改。
- 修改提取源后重新生成对应二进制，并验证 JS/WASM 一致性；不要只提交其中一边。
- JS 负责输入、积分与外围协调，接触加速器可回退到 JS。volume 内核为本项目求解器实现，不包含 Jelly Baby 源码。

## 编译与一致性检查

编译器依赖隔离在工具目录，版本以该目录 `package.json` 为准。以下命令从仓库根目录执行；当前生成阻碍见 [README 逃生舱](../README.md#逃生舱)。

```sh
bun install --cwd tools/wasm-compiler --ignore-scripts
bun run build:wasm
```

只构建某个内核时：

```sh
bun tools/wasm-compiler/build.mjs
bun tools/wasm-compiler/build-contact.mjs
```

注册表安装失败时，`bun tools/wasm-compiler/bootstrap.mjs` 可下载固定的官方 npm 包，校验 SHA-512 完整性和归档路径后解压到工具目录。编译器不发布到浏览器，仅发布生成的内核。

```sh
bun test tests/softbody-wasm.test.mjs
bun test tests/contact-kernel.test.mjs
```

前者比较实际软体笼上的冲击与拖拽结果，后者覆盖皮肤重绑定、受压旋转碰撞与润湿。设置 `CONTACT_SKIN_WASM=1` 可使支持该开关的形状与进食测试使用原生接触路径。更广的验证选择见[验证文档](verification.md)。
