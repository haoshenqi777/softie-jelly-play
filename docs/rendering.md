# 渲染与资源

## 视觉与光学边界

角色由 WebGPU 实时渲染。凝胶采用材质捕获纹理与三维光学层结合的近似，身体、脸、气泡与形变仍实时计算。它不是路径追踪，不提供任意环境下的完整背景透射、多次体积散射或动态焦散。

材质适配当前摄影棚环境。改变光照、模型或镜头来补偿另一处问题容易破坏已确认外观，应先隔离根因。WebGPU 不可用或设备丢失时显示说明，不静默降级到 WebGL。

## 材质与颜色

- `slime-gel-matcap.png` 是按法线采样的材质光照纹理，不是角色图片；有效球形区域以外的透明背景按白色处理。
- `studio-gel` 与 `studio-dyed-gel` 组织凝胶和染色表现，世界空间环境与表面法线提供实时高光。
- 前后深度与内部光学层表达厚度、气泡和糖的遮挡及折射；内部颜色跟随材料空间，不能固定在屏幕坐标中。
- WebGPU 使用 `NoToneMapping`，保持一致的 sRGB 解码与编码，避免对已做显示变换的材质图重复压缩。仅设置材质的 `toneMapped=false` 不能替代全帧配置。
- 接触影是实时近似；离线参考图不能替代实际场景中的光学结果。

## 移动端采样

Apple 移动端使用 CPU sRGB 到线性 RGBA16F 转换与四次 `textureLoad` 手动双线性采样，原色和染色材质共享该路径。桌面与 Android 保留原有采样路径。

这条路径绕开原图上传、mipmap 和硬件过滤链的组合问题，但不能据此断言其中某个环节是唯一根因。生产路径共享一次线性捕获，不为诊断额外创建灰模和第二套资源。

固定 LOD 缺少自动缩小过滤，极端缩远可能出现混叠；显式纹理读取也有成本。手机优化还包括较小画布、光学分辨率、气泡几何和像素比控制。画面无条纹不等于持续帧率达标。

## 资源来源与再生成

| 资源 | 维护依据 |
| --- | --- |
| `assets/slime-studio.blend`、`public/models/slime-studio.glb` | `assets/create-slime-studio.py` 与 `assets/slime-rest-shape.json` |
| `public/materials/slime-gel-matcap.png` | `assets/slime-gel-matcap.prompt.txt` 保存来源及生成要求 |
| `public/reference/` | 角色外观与吸收参考图；参考用途以实际页面和测试为准 |
| `public/reference/cycles/` | 离线诊断图和 `manifest.json` |
| Cycles 材质、灯光与视角 | `assets/studio-cycles-recipe.json`、`assets/render-studio-cycles.py` |

修改模型源后再导出，不仅修改 GLB。冠部、腹部与接触底面的曲线连续性、脸部附着、气泡包含和形变态需要一起维护；不要把参考图的观察角度固化为模型倾斜。

在具备 Blender 的环境中，从仓库根目录生成：

```sh
blender --background --python-exit-code 1 --python assets/create-slime-studio.py
blender --background --python-exit-code 1 --python assets/render-studio-cycles.py -- --view all
```

Cycles 使用同一模型与气泡坐标，但采用独立物理材质和灯光。更新后应保持四张图、配方、GLB 与清单匹配。清单记录来源、设备和渲染参数；离线耗时不代表网页性能。空气球未布尔扣除吸收体积，这也是参考近似的边界。

资源制作或重新拍摄不属于普通运行步骤。涉及视觉验证时遵守 [AGENTS](../AGENTS.md) 的授权约定。

## 诊断入口

`?rendercheck=1` 提供原始采样、线性捕获与无纹理灰模等隔离手段；`?gelcapture=linear` 强制线性捕获路径。逐项比较时固定几何、镜头与姿态，不能把改变材质的诊断模式当作新的产品外观。

`?profile=1` 开启 GPU 时间戳诊断。时间戳度量采样帧 render pass 的执行时间，不包含 CPU、浏览器合成或显示延迟，并受量化影响；页面回调频率也不等同于实际呈现帧率。验证规则见[验证文档](verification.md)。
