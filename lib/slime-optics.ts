import * as THREE from 'three/webgpu';
import {
  positionView,
  screenUV,
  texture,
  vec4,
  normalView,
  vec2,
} from 'three/tsl';

// Capture the actual deformed front/back boundaries in camera-space metres.
// The interior has its own depth buffer, so embedded objects keep their depth
// ordering without competing with the outer gel's opaque depth write.
export class SlimeOptics {
  private frontTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  private backTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  private innerTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  private boundaryScene = new THREE.Scene();
  readonly interiorScene = new THREE.Scene();
  readonly interior = new THREE.Group();
  private boundary: THREE.Mesh;
  private depthMaterial = new THREE.MeshBasicNodeMaterial({
    toneMapped: false,
  });
  private backMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    toneMapped: false,
  });
  readonly front = texture(this.frontTarget.texture, screenUV).r;
  readonly back = texture(this.backTarget.texture, screenUV).r;
  readonly backImage = texture(this.backTarget.texture, screenUV);
  readonly innerImage = texture(this.innerTarget.texture, screenUV);
  readonly thickness = this.back.sub(positionView.z.negate()).max(0.025).min(5);
  readonly light = texture(
    this.innerTarget.texture,
    screenUV.add(
      normalView.xy.mul(vec2(-0.009, 0.009)).mul(this.thickness.clamp(0, 2)),
    ),
  );
  private clearColor = Object.assign(new THREE.Color(), { a: 1 });
  constructor(
    private body: THREE.Mesh,
    scene: THREE.Scene,
    private resolution = 1,
  ) {
    this.depthMaterial.fragmentNode = vec4(positionView.z.negate(), 0, 0, 1);
    this.backMaterial.fragmentNode = this.depthMaterial.fragmentNode;
    this.boundary = new THREE.Mesh(body.geometry, this.depthMaterial);
    this.boundary.morphTargetInfluences = body.morphTargetInfluences;
    this.boundary.frustumCulled = false;
    this.boundary.matrixAutoUpdate = false;
    this.boundaryScene.add(this.boundary);
    this.interior.matrixAutoUpdate = false;
    this.interiorScene.add(this.interior);
    this.interiorScene.environment = scene.environment;
    this.interiorScene.environmentIntensity = 0.75;
    this.interiorScene.add(new THREE.HemisphereLight(0xffffff, 0xaa8790, 1.2));
  }
  render(renderer: THREE.WebGPURenderer, camera: THREE.Camera) {
    const width = Math.max(
        1,
        Math.round(renderer.domElement.width * this.resolution),
      ),
      height = Math.max(
        1,
        Math.round(renderer.domElement.height * this.resolution),
      );
    for (const t of [this.frontTarget, this.backTarget, this.innerTarget])
      if (t.width !== width || t.height !== height) t.setSize(width, height);
    this.body.updateWorldMatrix(true, false);
    this.boundary.matrix.copy(this.body.matrixWorld);
    this.interior.matrix.copy(this.body.matrixWorld);
    const before = renderer.getRenderTarget(),
      alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setClearColor(0, 0);
    this.boundary.material = this.depthMaterial;
    renderer.setRenderTarget(this.frontTarget);
    renderer.render(this.boundaryScene, camera);
    this.boundary.material = this.backMaterial;
    renderer.setRenderTarget(this.backTarget);
    renderer.render(this.boundaryScene, camera);
    renderer.setRenderTarget(this.innerTarget);
    renderer.render(this.interiorScene, camera);
    renderer.setRenderTarget(before);
    renderer.setClearColor(this.clearColor, alpha);
  }
  dispose() {
    this.frontTarget.dispose();
    this.backTarget.dispose();
    this.innerTarget.dispose();
    this.depthMaterial.dispose();
    this.backMaterial.dispose();
  }
}
