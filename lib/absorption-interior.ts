import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

/** A small opt-in candy-only capture. Its actual depth plane prevents the
 * bubble pass's approximate thickness UV from stretching a cube at the foot. */
export class AbsorptionInterior {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly centerView = uniform(new THREE.Vector3());
  readonly center = new THREE.Vector3();
  private target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
  readonly image = this.target.texture;
  private clear = Object.assign(new THREE.Color(), { a: 1 });
  constructor() {
    this.root.matrixAutoUpdate = false;
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight('#fff8ee', '#9e7d78', 0.38));
    const key = new THREE.DirectionalLight('#fff8f1', 2.5);
    key.position.set(-3.5, 5, 4);
    this.scene.add(key);
  }
  render(
    renderer: THREE.WebGPURenderer,
    camera: THREE.Camera,
    body: THREE.Mesh,
  ) {
    const w = Math.max(1, Math.round(renderer.domElement.width * 0.75));
    const h = Math.max(1, Math.round(renderer.domElement.height * 0.75));
    if (this.target.width !== w || this.target.height !== h)
      this.target.setSize(w, h);
    this.root.matrix.copy(body.matrixWorld);
    this.centerView.value
      .copy(this.center)
      .applyMatrix4(body.matrixWorld)
      .applyMatrix4(camera.matrixWorldInverse);
    const before = renderer.getRenderTarget(),
      alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    renderer.setClearColor(0, 0);
    try {
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, camera);
    } finally {
      renderer.setRenderTarget(before);
      renderer.setClearColor(this.clear, alpha);
    }
  }
  dispose() {
    this.target.dispose();
  }
}
