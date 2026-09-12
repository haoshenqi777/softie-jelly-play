import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  color,
  normalView,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { sampleLinearCapture } from './gel-linear-capture';

/** Second-stage device diagnostic. Normal product rendering is unchanged.
 * Mode 2 bypasses image upload / mipmaps / sRGB sampling / hardware interpolation.
 * Mode 3 uses a separate shader without any textures or optical calculations. */
export class GelRenderCheck {
  readonly reflection = uniform(1);
  readonly fixedDepth = uniform(0);
  readonly interior = uniform(1);
  readonly compatibility = uniform(0);
  readonly element: HTMLDivElement;
  private readonly capture: THREE.DataTexture;
  private readonly gray = new THREE.MeshBasicNodeMaterial();
  private previousMaterial: THREE.Material | THREE.Material[] | null = null;
  private mode = 0;
  constructor(
    host: HTMLElement,
    capture: THREE.DataTexture,
    compatibleByDefault = false,
  ) {
    this.capture = capture;
    this.mode = compatibleByDefault ? 1 : 0;
    this.compatibility.value = compatibleByDefault ? 1 : 0;
    this.gray.colorNode = color('#c9c7c4').mul(
      normalView
        .normalize()
        .dot(vec3(-0.4, 0.65, 0.65).normalize())
        .max(0)
        .mul(0.65)
        .add(0.35),
    );
    this.element = document.createElement('div');
    this.element.setAttribute('aria-label', '手机横纹对照');
    this.element.style.cssText =
      'position:absolute;z-index:30;top:108px;left:16px;right:16px;display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-radius:14px;background:#fffef3ed;font:12px sans-serif;color:#333';
    const title = document.createElement('span');
    title.textContent = '横纹检查 2 · 同一造型，切换贴图读取方式';
    title.style.width = '100%';
    this.element.appendChild(title);
    const labels = ['① 原版', '② 兼容贴图', '③ 无贴图灰模'];
    const buttons = labels.map((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText =
        'padding:9px;border:1px solid #ddd;border-radius:8px;background:white;color:#333';
      b.setAttribute('aria-pressed', String(i === this.mode));
      b.style.background = i === this.mode ? '#f5d8df' : 'white';
      b.onclick = () => {
        this.mode = i;
        this.compatibility.value = i === 1 ? 1 : 0;
        buttons.forEach((button, j) => {
          button.setAttribute('aria-pressed', String(i === j));
          button.style.background = i === j ? '#f5d8df' : 'white';
        });
      };
      this.element.appendChild(b);
      return b;
    });
    host.appendChild(this.element);
  }
  sample(source: THREE.Texture, uv: ReturnType<typeof vec2>) {
    return Fn(() => {
      const value = vec4(0).toVar();
      If(this.compatibility.greaterThan(0.5), () => {
        value.assign(sampleLinearCapture(this.capture, uv));
      }).Else(() => {
        value.assign(texture(source, uv));
      });
      return value;
    })();
  }
  apply(body: THREE.Mesh) {
    if (this.mode === 2) {
      if (body.material !== this.gray) this.previousMaterial = body.material;
      body.material = this.gray;
    } else if (body.material === this.gray && this.previousMaterial) {
      body.material = this.previousMaterial;
    }
  }
  dispose() {
    this.gray.dispose();
    this.element.remove();
  }
}
