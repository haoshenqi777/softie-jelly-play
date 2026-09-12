import * as THREE from 'three/webgpu';
import { texture, screenUV, uniform } from 'three/tsl';
import { sampleMeal } from './meal-motion';
import { MEAL } from './slime-character';
import type { SlimeDynamics } from './slime-physics';

// Thin 3D strands share the skin's material coordinates and motion. Their
// depth-rendered light layer provides a restrained interior scattering term.
export class SlimeSyrup {
  private scene = new THREE.Scene();
  private target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
  private parent: THREE.Group;
  private clearColor = Object.assign(new THREE.Color(), { a: 1 });
  readonly amount = uniform(0);
  readonly light = texture(this.target.texture, screenUV);
  private group = new THREE.Group();
  private strands: {
    geometry: THREE.BufferGeometry;
    mesh: THREE.Mesh;
    material: THREE.MeshBasicNodeMaterial;
    phase: number;
  }[] = [];
  private drift = 0;
  private driftV = 0;
  private point = { x: 0, y: 0, z: 0 };
  private white = new THREE.Color('white');
  constructor(parent: THREE.Group) {
    this.parent = parent;
    this.scene.add(this.group);
    this.group.matrixAutoUpdate = false;
    for (let strand = 0; strand < 7; strand++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(41 * 6 * 3), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
      const indices: number[] = [];
      for (let i = 0; i < 40; i++)
        for (let k = 0; k < 6; k++) {
          const a = i * 6 + k,
            b = i * 6 + ((k + 1) % 6),
            c = (i + 1) * 6 + k,
            d = (i + 1) * 6 + ((k + 1) % 6);
          indices.push(a, c, b, b, c, d);
        }
      geometry.setIndex(indices);
      const material = new THREE.MeshBasicNodeMaterial({
        color: '#c5e9de',
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.strands.push({ geometry, mesh, material, phase: strand * 1.77 });
    }
    this.group.visible = false;
  }
  update(age: number, dt: number, physics: SlimeDynamics, hex: string) {
    const pose = sampleMeal(age, MEAL);
    this.group.visible = pose.visibility > 0.01;
    this.amount.value = pose.visibility;
    if (!this.group.visible) return;
    this.driftV += (-30 * this.drift - 8 * this.driftV - physics.vx * 0.8) * dt;
    this.drift = Math.max(-0.11, Math.min(0.11, this.drift + this.driftV * dt));
    for (const [index, strand] of this.strands.entries()) {
      strand.material.color.set(hex).lerp(this.white, 0.12 + index * 0.025);
      const positions = strand.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      for (let i = 0; i <= 40; i++) {
        const t = i / 40,
          envelope = Math.sin(Math.PI * t),
          seed = strand.phase;
        const curl = pose.dispersion;
        const x =
          pose.chewSide * 0.1 * (1 - pose.swallow) +
          this.drift +
          (index - 3) * 0.008 +
          Math.sin(t * 7.4 + seed + age * 0.38) *
            (0.008 + curl * 0.28) *
            envelope;
        const y =
          1.015 -
          pose.swallow * 0.43 +
          (t - 0.5) * (0.018 + curl * 0.44) +
          Math.sin(t * 11 + seed) * curl * 0.035;
        const z =
          0.99 -
          pose.swallow * 0.2 +
          Math.cos(t * 8 + seed) * (0.006 + curl * 0.075);
        const radius =
          (0.003 + 0.012 * envelope) * pose.visibility * (0.65 + curl * 0.35);
        for (let k = 0; k < 6; k++) {
          const angle = (k * Math.PI) / 3;
          physics.deform(
            x + Math.cos(angle) * radius,
            y + Math.sin(angle) * radius * 0.4,
            z + Math.sin(angle) * radius,
            this.point,
          );
          positions.setXYZ(i * 6 + k, this.point.x, this.point.y, this.point.z);
        }
      }
      positions.needsUpdate = true;
      strand.geometry.computeVertexNormals();
    }
  }
  reset() {
    this.group.visible = false;
    this.amount.value = 0;
    this.drift = this.driftV = 0;
  }
  render(renderer: THREE.WebGPURenderer, camera: THREE.Camera) {
    if (!this.group.visible) return;
    this.parent.updateWorldMatrix(true, false);
    this.group.matrix.copy(this.parent.matrixWorld);
    const width = Math.ceil(renderer.domElement.width * 0.5),
      height = Math.ceil(renderer.domElement.height * 0.5);
    if (this.target.width !== width || this.target.height !== height)
      this.target.setSize(width, height);
    const before = renderer.getRenderTarget(),
      alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0, 0);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(before);
    renderer.setClearColor(this.clearColor, alpha);
  }
  dispose() {
    this.target.dispose();
    this.group.removeFromParent();
    for (const s of this.strands) {
      s.geometry.dispose();
      s.material.dispose();
    }
  }
}
