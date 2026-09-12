import * as THREE from 'three/webgpu';
import {
  color,
  float,
  normalView,
  pmremTexture,
  reflectVector,
  positionView,
  uv,
  vec3,
  mix,
} from 'three/tsl';
import { SlimeOptics } from './slime-optics';
import {
  STUDIO_ENVIRONMENT_COLOR,
  STUDIO_LIGHTS,
} from './studio-optical-config';

export function createStudioEnvironment(renderer: THREE.WebGPURenderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(STUDIO_ENVIRONMENT_COLOR);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  for (const [x, y, z, w, h, power] of STUDIO_LIGHTS) {
    const edge = uv().sub(0.5).abs().mul(2);
    const shape = float(1).sub(edge.x.max(edge.y).smoothstep(0.83, 1));
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    m.colorNode = color('#ffffff').mul(float(0.02).add(shape.mul(power)));
    const g = new THREE.PlaneGeometry(w, h);
    const p = new THREE.Mesh(g, m);
    p.position.set(x, y, z);
    p.lookAt(0, 1, 0);
    studio.add(p);
    materials.push(m);
    geometries.push(g);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const result = generator.fromScene(studio, 0.008, 0.1, 30, { size: 256 });
  generator.dispose();
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
  return result;
}

export function createStudioBubble(
  optics: SlimeOptics,
  environment: THREE.Texture,
) {
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const depth = positionView.z.negate().sub(optics.front).max(0);
  const cosine = normalView.dot(positionView.negate().normalize()).abs();
  const fresnel = float(1).sub(cosine);
  const lobe = normalView.x
    .mul(-0.452)
    .add(normalView.y.mul(0.723))
    .add(normalView.z.mul(0.522))
    .clamp(0, 1);
  const reflected = pmremTexture(environment, reflectVector, float(0.08));
  const lowerGlint = normalView.x
    .mul(0.55)
    .sub(normalView.y.mul(0.58))
    .add(normalView.z.mul(0.59))
    .clamp(0, 1)
    .pow(80);
  // The air interface has a critical ring: gel -> air, eta=1.34.
  const ring = cosine.oneMinus().smoothstep(0.3, 0.55);
  const brightSide = normalView.y
    .mul(0.65)
    .sub(normalView.x.mul(0.45))
    .add(0.2)
    .clamp(0, 1);
  const white = lobe
    .pow(58)
    .mul(0.95)
    .add(lowerGlint.mul(0.55))
    .add(ring.mul(brightSide).mul(0.7))
    .clamp(0, 1);
  const bubbleColor = mix(
    mix(color('#f6a6b1'), color('#bf697a'), ring),
    vec3(1.3),
    white,
  );
  const tint = vec3(
    depth.mul(-0.025).exp(),
    depth.mul(-0.34).exp(),
    depth.mul(-0.29).exp(),
  );
  m.colorNode = bubbleColor.add(reflected.mul(0.016)).mul(tint);
  m.opacityNode = ring
    .mul(0.62)
    .add(lobe.pow(58).mul(0.9))
    .add(lowerGlint.mul(0.5))
    .add(cosine.pow(2).mul(0.14))
    .add(fresnel.mul(0.08))
    .mul(depth.mul(-0.06).exp())
    .min(0.92);
  m.maskNode = positionView.z.negate().greaterThan(optics.front.add(0.003));
  return m;
}
