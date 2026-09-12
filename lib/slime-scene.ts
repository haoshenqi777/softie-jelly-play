import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  float,
  mix,
  uniform,
  normalView,
  modelNormalMatrix,
  positionView,
  color,
  uv,
  vec2,
  vec3,
  vec4,
  pmremTexture,
  reflectVector,
  positionLocal,
} from 'three/tsl';
import { SlimeDynamics } from './slime-physics';
import { heightAt, radiusAt } from './slime-shape';
import { SlimeContactSurface } from './slime-contact';
import { SlimeCharacter, type FoodPhase } from './slime-character';
import {
  SlimeAbsorption,
  sampleAbsorption,
  absorptionPosition,
  absorptionCompression,
} from './slime-absorption';
import { CandyWorld, type CandyKind, type Point3 } from './candy-physics';
import { CandyRenderer } from './candy-renderer';
import { SlimeOptics } from './slime-optics';
import { SlimeFeedback, SlimeAudio } from './slime-feedback';
import { SlimeOrbit, grabPlane, fitSlimeZoom } from './slime-orbit';
export type SlimeHandle = {
  dispose(): void;
  poke(): void;
  reset(): void;
  resetView(): void;
  offerCandy(hex: string, x: number, y: number): boolean;
  moveCandy(x: number, y: number): void;
  dropCandy(): boolean;
  cancelCandy(): void;
  feedCandy(hex: string, x: number, y: number): void;
  setCandyKind(kind: CandyKind): void;
  setSound(enabled: boolean): void;
  setStiffness(n: number): void;
  setDamping(n: number): void;
};
type Callbacks = {
  onReady(): void;
  onFps(n: number): void;
  onError(message: string): void;
  onFoodPhase(phase: FoodPhase): void;
  onColor(hex: string): void;
};
const BG = '#f5f5f3',
  PINK = '#f5829e';
function section(y: number) {
  let lo = -1,
    hi = 1;
  for (let j = 0; j < 16; j++) {
    const m = (lo + hi) / 2;
    if (heightAt(m) < y) lo = m;
    else hi = m;
  }
  return radiusAt((lo + hi) / 2);
}
const skinHeight = heightAt(1),
  profile = Float32Array.from({ length: 1025 }, (_, i) =>
    section((i / 1024) * skinHeight),
  );
function skinZ(x: number, y: number) {
  const index = THREE.MathUtils.clamp((y / skinHeight) * 1024, 0, 1023.999),
    i = Math.floor(index);
  const r = profile[i] + (profile[i + 1] - profile[i]) * (index - i);
  return 1.18 * Math.sqrt(Math.max(0, r * r - (x / 1.64) ** 2));
}

export async function createSlime(
  host: HTMLDivElement,
  callbacks: Callbacks,
  signal?: AbortSignal,
): Promise<SlimeHandle> {
  signal?.throwIfAborted();
  if (!navigator.gpu)
    throw new Error(
      '请用支持 WebGPU 的新版 Chrome 或 Edge，并开启浏览器图形加速。',
    );
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  // Three r183 otherwise silently falls back to WebGL. This experience is WebGPU only.
  (renderer as unknown as { _getFallback: null })._getFallback = null;
  try {
    await renderer.init();
  } catch (e) {
    renderer.dispose();
    throw e;
  }
  if (signal?.aborted) {
    renderer.dispose();
    signal.throwIfAborted();
  }
  if (
    !(renderer.backend as unknown as { isWebGPUBackend: boolean })
      .isWebGPUBackend
  ) {
    renderer.dispose();
    throw new Error('当前设备没有可用的 WebGPU。');
  }
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    '互动史莱姆：轻扫抚摸，按住揉捏，拖动提起。拖空白处环绕观察，滚轮调整远近，方向键转动视角，Home 回正面。空格键戳一下。糖果可以拖放和投掷。',
  );
  host.appendChild(canvas);
  host.dataset.backend = 'WebGPU';
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  const orbit = new SlimeOrbit();
  const physics = new SlimeDynamics(),
    character = new SlimeCharacter(),
    foraging = new SlimeAbsorption(),
    group = new THREE.Group();
  scene.add(group);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // An off-white photography studio with two tall, feathered softboxes.
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0xd1c6ca);
  const cardShape = uv().sub(0.5).mul(2).abs().pow(vec2(4));
  const feather = float(1).sub(
    cardShape.x.add(cardShape.y).pow(0.25).smoothstep(0.66, 1),
  );
  for (const [x, y, z, w, h, power] of [
    [-4.6, 4.8, 3, 2.3, 4.6, 8],
    [4.4, 3.1, 2, 1.0, 4.2, 6],
    [-1, 1, -5, 3, 3, 1.3],
    [-2, 5, -3, 4.2, 1.3, 6],
    [-4, 1.5, 0, 3, 5, -0.25],
    [4, 1.5, 0, 3, 5, -0.25],
    [0, -4, 0, 9, 7, 0.7],
  ]) {
    const m = keep(new THREE.MeshBasicNodeMaterial());
    m.colorNode = vec3(float(0.6).add(feather.mul(power)));
    const p = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), m);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    studio.add(p);
  }
  const pmrem = keep(new THREE.PMREMGenerator(renderer));
  const environment = keep(
    pmrem.fromScene(studio, 0.015, 0.1, 40, { size: 512 }),
  );
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe7e3e5, 1.05));
  for (const [x, y, z, power] of [
    [-4, 6, 6, 1.7],
    [4, 3, 1, 0.75],
  ]) {
    const l = new THREE.DirectionalLight(0xffffff, power);
    l.position.set(x, y, z);
    scene.add(l);
  }

  const sphere = new THREE.SphereGeometry(1, 96, 64);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geometry = keep(mergeVertices(sphere));
  sphere.dispose();
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = THREE.MathUtils.clamp(positions.getY(i), -1, 1),
      z = positions.getZ(i);
    const radial = radiusAt(y) / Math.max(0.0001, Math.hypot(x, z));
    positions.setXYZ(i, x * radial * 1.64, heightAt(y), z * radial * 1.18);
  }
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.3, 0), 6);
  const rest = new Float32Array(positions.array);
  positions.setUsage(THREE.DynamicDrawUsage);
  const tint = uniform(new THREE.Color()),
    previousTint = uniform(new THREE.Color()),
    spread = uniform(1),
    pigmentOrigin = uniform(new THREE.Vector3(0, 0.5, 0));
  // A broad concentration field diffuses from the enclosed candy. A Gaussian
  // avoids a sharp travelling color front across the curved outer skin.
  const pigmentDistance = positionLocal
    .sub(pigmentOrigin)
    .length()
    .add(positionLocal.x.mul(4).add(positionLocal.z.mul(5)).sin().mul(0.04));
  const diffusionRadius = spread.mul(1.8).add(0.22);
  const concentration = pigmentDistance
    .div(diffusionRadius)
    .pow(2)
    .negate()
    .exp();
  const dispersed = spread.mul(spread).mul(float(3).sub(spread.mul(2)));
  const pigmentMask = mix(
    concentration.mul(spread.mul(4).min(1)),
    float(1),
    dispersed,
  );
  const localTint = mix(previousTint.rgb, tint.rgb, pigmentMask);
  const viewAngle = normalView
    .dot(positionView.negate().normalize())
    .abs()
    .clamp(0, 1);
  const material = keep(
    new THREE.MeshPhysicalNodeMaterial({
      color: 'white',
      roughness: 0.026,
      transmission: 1,
      ior: 1.44,
      thickness: 2.3,
      attenuationDistance: 2.5,
      clearcoat: 1,
      clearcoatRoughness: 0.085,
      envMapIntensity: 1.1,
    }),
  );
  const body = new THREE.Mesh(geometry, material);
  const optics = keep(new SlimeOptics(body, scene));
  material.thicknessNode = optics.thickness;
  material.attenuationColorNode = localTint;
  const skinRipple = vec3(
    positionLocal.y.mul(9).add(positionLocal.z.mul(7)).sin(),
    positionLocal.z.mul(8).add(positionLocal.x.mul(6)).sin(),
    positionLocal.x.mul(9).add(positionLocal.y.mul(5)).sin(),
  ).mul(0.017);
  material.normalNode = normalView
    .add(modelNormalMatrix.mul(skinRipple))
    .normalize();
  const baseOutput = material.setupOutput.bind(material);
  material.setupOutput = (builder, output) => {
    const rgba = output as ReturnType<typeof vec4>;
    const gel = rgba;
    const embedded = optics.light;
    const boundaryLight = mix(color(BG), localTint, 0.55).mul(0.94);
    const surfaceLight = mix(
      boundaryLight,
      gel.rgb,
      viewAngle.smoothstep(0.04, 0.22),
    );
    return baseOutput(
      builder,
      vec4(
        surfaceLight
          .mul(float(1).sub(embedded.a.mul(0.9)))
          .add(embedded.rgb.mul(0.9)),
        rgba.a,
      ),
    );
  };
  body.frustumCulled = false;
  group.add(body);
  // The rear interface remains visible through the gel's transmitted light.
  const rearMaterial = keep(
    new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  const reflection = pmremTexture(
    environment.texture,
    reflectVector,
    float(0.03),
  );
  rearMaterial.colorNode = mix(
    color(BG),
    reflection.rgb.mul(localTint.pow(vec3(0.3))),
    float(1).sub(viewAngle).pow(3).mul(0.78).add(0.025),
  );
  rearMaterial.maskNode = viewAngle.greaterThan(0.12);
  const rear = new THREE.Mesh(geometry, rearMaterial);
  rear.renderOrder = -1;
  rear.frustumCulled = false;
  rear.visible = true;
  group.add(rear);

  // Face vertices are skin coordinates, not rigid objects parented to the body.
  const faceMaterial = keep(
    new THREE.MeshPhysicalNodeMaterial({
      color: '#030203',
      roughness: 0.16,
      clearcoat: 0.85,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.45,
      transparent: true,
      depthWrite: false,
    }),
  );
  type SkinPart = {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    rest: Float32Array;
    kind: number;
    side: number;
  };
  const face: SkinPart[] = [];
  for (const side of [-1, 1]) {
    const g = keep(new THREE.SphereGeometry(1, 32, 24));
    const m = new THREE.Mesh(g, faceMaterial);
    m.frustumCulled = false;
    m.renderOrder = 3;
    group.add(m);
    face.push({
      mesh: m,
      geometry: g,
      rest: new Float32Array(g.attributes.position.array),
      kind: 0,
      side,
    });
  }
  // An open smile and a tiny surprised O share a deforming tube topology.
  const mouthGeometry = keep(new THREE.TorusGeometry(1, 0.12, 8, 40, Math.PI));
  const mouthMaterial = keep(
    new THREE.MeshBasicNodeMaterial({
      color: '#211920',
      transparent: true,
      depthWrite: false,
    }),
  );
  const mouthMesh = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouthMesh.frustumCulled = false;
  mouthMesh.renderOrder = 3;
  group.add(mouthMesh);
  face.push({
    mesh: mouthMesh,
    geometry: mouthGeometry,
    rest: new Float32Array(mouthGeometry.attributes.position.array),
    kind: 1,
    side: 0,
  });
  for (const side of [-1, 1]) {
    const g = keep(new THREE.SphereGeometry(1, 12, 8)),
      m = new THREE.Mesh(g, mouthMaterial);
    m.frustumCulled = false;
    m.renderOrder = 3;
    group.add(m);
    face.push({
      mesh: m,
      geometry: g,
      rest: new Float32Array(g.attributes.position.array),
      kind: 2,
      side,
    });
  }
  const mouthInsideGeometry = keep(new THREE.SphereGeometry(1, 24, 16));
  const mouthInside = new THREE.Mesh(mouthInsideGeometry, mouthMaterial);
  mouthInside.frustumCulled = false;
  mouthInside.renderOrder = 3;
  group.add(mouthInside);
  face.push({
    mesh: mouthInside,
    geometry: mouthInsideGeometry,
    rest: new Float32Array(mouthInsideGeometry.attributes.position.array),
    kind: 3,
    side: 0,
  });
  let gazeX = 0,
    gazeY = 0,
    gazeTargetX = 0,
    gazeTargetY = 0,
    expression = 0,
    joy = 0,
    blink = 1;
  const point = { x: 0, y: 0, z: 0 };
  const updateFace = (dt: number) => {
    const phase = character.phase;
    const chewing = false;
    const happy = phase === 'spreading' || phase === 'savoring';
    joy +=
      ((happy
        ? 1
        : chewing
          ? 0.72
          : character.isFull
            ? 0.8
            : character.comfort) -
        joy) *
      Math.min(1, dt * 7);
    gazeX +=
      (gazeTargetX * (1 - character.grump) + character.lean * 4 - gazeX) *
      Math.min(1, dt * 7);
    gazeY += (gazeTargetY - gazeY) * Math.min(1, dt * 7);
    expression +=
      (Math.max(
        (character.busy
          ? 0
          : Math.max(physics.excitement, character.surprise)) *
          (1 - character.grump),
        0,
        physics.held && physics.y > 0.18 ? 0.8 : 0,
      ) *
        (1 - character.sleep) *
        (character.isFull ? 0 : 1) -
        expression) *
      Math.min(1, dt * 12);
    const blinkTime = physics.time % 4.6;
    const blinkTarget =
      blinkTime > 4.38
        ? 1 - 0.96 * Math.sin(((blinkTime - 4.38) / 0.22) * Math.PI)
        : 1;
    blink += (blinkTarget - blink) * Math.min(1, dt * 45);
    const eyeOpen = Math.max(
      0.08,
      blink *
        (physics.held ? (physics.y > 0.18 ? 1.25 : 0.48) : 1) *
        (1 - joy * 0.88) *
        (1 - character.grump * 0.35) *
        (1 - character.sleep * 0.98) +
        expression * 0.3,
    );
    const open = Math.min(1, expression * 1.7),
      mouthRadiusX = 0.052 + character.appetite * 0.026,
      mouthRadiusY = 0.045 + character.appetite * 0.025;
    const smileWidth = chewing
        ? 0.105 + character.chew * 0.055
        : 0.108 * (1 + joy * 0.65),
      smileDepth = chewing
        ? 0.012 + (1 - character.chew) * 0.025
        : 0.055 +
          joy * 0.03 -
          character.grump * 0.13 -
          character.disappointment * 0.08;
    const mouthShift = 0;
    // One mouth silhouette at a time: blending a filled O over the smile makes
    // an accidental nose-and-mouth face halfway through the transition.
    mouthInside.visible = open >= 0.4;
    mouthMesh.visible = open < 0.4;
    for (const part of face) {
      if (part.kind === 2) part.mesh.visible = open < 0.4;
      const p = part.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const j = i * 3;
        let x, y, depth;
        if (part.kind === 0) {
          x =
            part.side * 0.43 +
            part.rest[j] * (0.127 + joy * 0.018) +
            gazeX * 0.055;
          const flinch =
            !character.busy && part.side === character.pokeSide
              ? 1 - character.surprise * 0.8
              : 1;
          y =
            1.17 +
            part.rest[j + 1] *
              0.139 *
              eyeOpen *
              flinch *
              (1 -
                (physics.held
                  ? THREE.MathUtils.clamp(
                      part.side * physics.anchor.x + 0.3,
                      0,
                      1,
                    ) * 0.6
                  : 0)) *
              (character.wakeAge > 0.3 && part.side > 0 ? 0.25 : 1) +
            gazeY * 0.045;
          y +=
            character.dizzy * Math.sin(physics.time * 12 + part.side) * 0.045;
          y +=
            (joy * (1 - character.sleep) * 0.075 - character.sleep * 0.027) *
              (1 - part.rest[j] ** 2) +
            part.side *
              part.rest[j] *
              (0.04 * character.grump - 0.045 * character.disappointment);
          depth = 0.012 + part.rest[j + 2] * 0.055;
        } else if (part.kind === 1) {
          const u = (i % 41) / 40,
            ring = (Math.floor(i / 41) / 8) * Math.PI * 2,
            angle = u * Math.PI,
            roundAngle = u * Math.PI * 2 - Math.PI / 2;
          const t = angle * (1 - open) + roundAngle * open;
          x =
            smileWidth * Math.cos(angle) * (1 - open) +
            mouthRadiusX * Math.cos(roundAngle) * open +
            Math.cos(t) * Math.cos(ring) * 0.013;
          y =
            (1.055 - smileDepth * Math.sin(angle)) * (1 - open) +
            (1.025 - mouthRadiusY * Math.sin(roundAngle)) * open -
            Math.sin(t) * Math.cos(ring) * 0.013;
          depth = 0.019 + Math.sin(ring) * 0.013;
        } else if (part.kind === 2) {
          x = part.side * smileWidth * (1 - open) + part.rest[j] * 0.013;
          y =
            1.055 * (1 - open) +
            (1.025 + mouthRadiusY) * open +
            part.rest[j + 1] * 0.013;
          depth = 0.019 + part.rest[j + 2] * 0.013;
        } else {
          x = part.rest[j] * mouthRadiusX * open;
          y = 1.025 + part.rest[j + 1] * mouthRadiusY * open;
          depth = 0.009 + part.rest[j + 2] * 0.004;
        }
        if (part.kind !== 0) x += mouthShift;
        physics.deform(x, y, skinZ(x, y) + depth, point);
        p.setXYZ(i, point.x, point.y, point.z);
      }
      p.needsUpdate = true;
      part.geometry.computeVertexNormals();
    }
  };

  const bubbleGeometry = keep(new THREE.SphereGeometry(1, 12, 8));
  const bubbleMaterial = keep(
    new THREE.MeshPhysicalNodeMaterial({
      roughness: 0.03,
      clearcoat: 1,
      envMapIntensity: 1.1,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    }),
  );
  bubbleMaterial.colorNode = mix(
    color('#ca6b87'),
    color('#fffaf6'),
    normalView
      .dot(vec3(-0.5, 0.7, 0.6).normalize())
      .mul(0.5)
      .add(0.5)
      .pow(3),
  );
  bubbleMaterial.emissiveNode = normalView
    .dot(vec3(-0.5, 0.7, 0.6).normalize())
    .max(0)
    .pow(36)
    .mul(0.6);
  bubbleMaterial.opacityNode = float(1)
    .sub(viewAngle)
    .pow(3)
    .mul(0.85)
    .add(
      normalView
        .dot(vec3(-0.3, 0.45, 0.85).normalize())
        .max(0)
        .pow(48)
        .mul(0.8),
    )
    .add(0.008)
    .clamp(0, 1)
    .mul(positionView.z.negate().sub(optics.front).max(0).mul(-0.34).exp());
  const bubbleCount = 84,
    bubbles = new THREE.InstancedMesh(
      bubbleGeometry,
      bubbleMaterial,
      bubbleCount,
    ),
    dummy = new THREE.Object3D();
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bubbles.renderOrder = 2;
  bubbles.frustumCulled = false;
  optics.interior.add(bubbles);
  let seed = 18;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bubbleRest = Array.from({ length: bubbleCount }, () => {
    const y = 0.19 + random() * 2.06,
      r = section(y),
      x = (random() * 2 - 1) * 1.64 * r * 0.88;
    return {
      x,
      y,
      z: skinZ(x, y) * (random() * 1.64 - 0.82),
      r: 0.013 + random() ** 3 * 0.075,
    };
  });

  const shadows = Array.from({ length: 3 }, (_, i) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const map = keep(new THREE.CanvasTexture(c));
    map.colorSpace = THREE.SRGBColorSpace;
    const m = keep(
      new THREE.MeshBasicNodeMaterial({
        map,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const mesh = new THREE.Mesh(
      keep(new THREE.PlaneGeometry([5.5, 4.5, 3.7][i], [3.5, 2.7, 2.2][i])),
      m,
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.001 + i * 0.002, i ? 0.3 : 0);
    mesh.renderOrder = -4 + i;
    scene.add(mesh);
    return { ctx, map, mesh, material: m };
  });
  const gelColor = (hex: string) => {
    const c = new THREE.Color(hex),
      max = Math.max(c.r, c.g, c.b);
    c.multiplyScalar(1 / max).lerp(new THREE.Color('white'), 0.07);
    return c;
  };
  const paintShadows = (hex: string) => {
    shadows.forEach((s, i) => {
      const ctx = s.ctx;
      ctx.clearRect(0, 0, 256, 256);
      ctx.save();
      ctx.translate(128, 128);
      ctx.scale(1, 0.65);
      const shade = i === 1 ? new THREE.Color(hex) : new THREE.Color('#73646a');
      const rgb = shade.getStyle();
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 125);
      const [r, b, v] = rgb.match(/\d+/g)!.map(Number);
      const alpha = i === 0 ? 0.18 : i === 1 ? 0.4 : 0.3;
      for (const [stop, opacity] of [
        [0, alpha],
        [0.3, alpha * 0.68],
        [0.65, alpha * 0.2],
        [1, 0],
      ])
        g.addColorStop(stop, `rgba(${r},${b},${v},${opacity})`);
      ctx.fillStyle = g;
      ctx.fillRect(-128, -200, 256, 400);
      ctx.restore();
      s.map.needsUpdate = true;
    });
  };
  let currentColor = PINK;
  const setColor = (hex: string) => {
    currentColor = hex;
    tint.value.copy(gelColor(hex));
    previousTint.value.copy(tint.value);
    spread.value = 1;
    material.attenuationColor.copy(tint.value);
    bubbleMaterial.color.set(hex).lerp(new THREE.Color('white'), 0.65);
    paintShadows(hex);
  };
  setColor(PINK);
  const candies = new CandyWorld();
  const contactSurface = new SlimeContactSurface(physics);
  const candyView = keep(new CandyRenderer(scene, optics));
  const feedback = keep(new SlimeFeedback(scene)),
    audio = keep(new SlimeAudio());
  let heartCooldown = 0,
    wasPuffed = false;
  let pigmentAge = -1;
  let candyKind: CandyKind = 'gummy';
  const thought = document.createElement('div');
  thought.className = 'sr-only';
  thought.setAttribute('role', 'status');
  thought.setAttribute('aria-live', 'polite');
  host.parentElement!.appendChild(thought);
  let food: {
    id: number;
    hex: string;
    start: Point3;
    local: Point3;
    normal: Point3;
    ate: boolean;
    compression: number;
  } | null = null;
  let heldScreen: { x: number; y: number; last: number } | null = null;
  let lastFoodPhase: FoodPhase = 'idle',
    lastThought = '';
  let lastLanding = 0;
  const screenPoint = new THREE.Vector3(),
    mouthScreen = { x: 0, y: 0 };
  const white = new THREE.Color('white');
  const mouthWorld = (): Point3 => {
    physics.deform(0, 1.025, skinZ(0, 1.025) + 0.015, point);
    return {
      x: point.x + physics.x,
      y: point.y + physics.y,
      z: point.z + physics.z,
    };
  };
  const projectScreen = (p: Point3, out: { x: number; y: number }) => {
    const r = canvas.getBoundingClientRect();
    screenPoint.set(p.x, p.y, p.z).project(camera);
    out.x = r.left + ((screenPoint.x + 1) * r.width) / 2;
    out.y = r.top + ((1 - screenPoint.y) * r.height) / 2;
  };
  const updateFood = (dt: number) => {
    const mouth = mouthWorld();
    projectScreen(mouth, mouthScreen);
    const target = candies.get(foraging.targetId);
    if (target && !character.busy) {
      gazeTargetX = THREE.MathUtils.clamp((target.x - mouth.x) * 1.4, -1, 1);
      gazeTargetY = THREE.MathUtils.clamp((target.y - mouth.y) * 0.8, -1, 1);
    }
    if (food && character.busy) {
      const c = candies.get(food.id);
      const pose = sampleAbsorption(character.mealAge);
      if (c) {
        const anchor = food.local;
        const depth = pose.enclosure;
        const local = absorptionPosition(
          anchor,
          food.normal,
          character.mealAge,
        );
        physics.deform(local.x, local.y, local.z, point);
        c.x = point.x + physics.x;
        c.y = point.y + physics.y;
        c.z = point.z + physics.z;
        c.rx += dt * 0.25 * (1 - pose.melt);
        c.ry += dt * 0.18;
        c.compression =
          c.kind === 'gummy'
            ? absorptionCompression(food.compression, character.mealAge)
            : 0;
        c.melt = pose.melt;
        physics.wrap = {
          point: anchor,
          normal: food.normal,
          amount: Math.sin(depth * Math.PI) * 0.17,
        };
        if (pose.melt >= 1) candies.remove(c.id);
      } else physics.wrap.amount = 0;
      if (!food.ate && character.mealAge >= 1.8) {
        food.ate = true;
        currentColor = food.hex;
        previousTint.value.copy(tint.value);
        tint.value.copy(gelColor(food.hex));
        const origin = absorptionPosition(
          food.local,
          food.normal,
          character.mealAge,
        );
        pigmentOrigin.value.set(origin.x, origin.y, origin.z);
        spread.value = 0;
        pigmentAge = 0;
        callbacks.onColor(food.hex);
      }

      gazeTargetX = gazeTargetY = 0;
    } else if (food) {
      candies.remove(food.id);
      food = null;
    }
    if (pigmentAge >= 0) {
      pigmentAge += dt;
      spread.value = Math.min(1, pigmentAge / 4.5);
      if (pigmentAge % 0.15 < dt)
        paintShadows(
          previousTint.value
            .clone()
            .lerp(tint.value, spread.value)
            .getHexString()
            .padStart(7, '#'),
        );
    }
    bubbleMaterial.color
      .copy(previousTint.value)
      .lerp(tint.value, spread.value)
      .lerp(white, 0.65);
    heartCooldown = Math.max(0, heartCooldown - dt);
    const head = { x: physics.x, y: physics.y + 2.85, z: physics.z + 0.2 };
    if (character.puff > 0.3) wasPuffed = true;
    if (
      heartCooldown <= 0 &&
      ((character.comfort > 0.82 && !character.busy) ||
        (wasPuffed && character.puff < 0.08 && character.comfort > 0.4))
    ) {
      feedback.emit('heart', head);
      heartCooldown = 7;
      wasPuffed = false;
    }
    physics.deform(0.24, 0.81, skinZ(0.24, 0.81) + 0.08, point);
    feedback.update(
      dt,
      character.sleep,
      {
        x: point.x + physics.x + 0.04,
        y: point.y + physics.y + 0.01,
        z: point.z + physics.z,
      },
      physics.time,
    );
    const phase = character.phase;
    if (phase !== lastFoodPhase) {
      if (phase === 'swallowing') audio.play('swallow');
      if (phase === 'savoring' && !character.isFull) {
        physics.vy += 0.5;
        physics.squashVelocity -= 0.5;
      }
      lastFoodPhase = phase;
      callbacks.onFoodPhase(phase);
    }
    const message = character.isFull
      ? '吃饱啦，歇一会'
      : phase === 'chewing'
        ? '抱住糖，慢慢融进去'
        : phase === 'swallowing'
          ? '甜甜的，慢慢吸收'
          : character.mood === 'grumpy'
            ? '哼，摸摸我'
            : character.sleep > 0.9
              ? '睡着了'
              : '';
    if (message !== lastThought) {
      lastThought = message;
      thought.textContent = message;
    }
    host.dataset.foodPhase = phase;
    host.dataset.motion = physics.y > 0.035 ? 'hop' : 'rest';
    host.dataset.mood = character.mood;
    host.dataset.mouth = JSON.stringify(mouthScreen);
    host.dataset.candyCount = String(candies.candies.length);
    host.dataset.fullness = character.fullness.toFixed(3);
    host.dataset.candies = JSON.stringify(
      candies.candies.map((c) => {
        const screen = { x: 0, y: 0 };
        projectScreen(c, screen);
        return {
          id: c.id,
          kind: c.kind,
          mode: c.mode,
          x: screen.x,
          y: screen.y,
          world: [c.x, c.y, c.z],
          sleeping: c.sleeping,
        };
      }),
    );
  };
  let cameraDistance = 9,
    focusX = -0.19,
    focusY = 1.27;
  const updateCamera = (dt: number) => {
    orbit.advance(dt);
    const distance = cameraDistance * orbit.distanceScale;
    camera.position.set(
      focusX + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * distance,
      focusY + Math.sin(orbit.pitch) * distance,
      Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * distance,
    );
    camera.lookAt(focusX, focusY, 0);
    camera.updateMatrixWorld();
    const fitted = fitSlimeZoom(camera, physics);
    const zoom = Math.min(candies.candies.length ? 0.8 : 1, fitted);
    // Follow outward motion immediately; ease back in only after it has room.
    camera.zoom =
      zoom < camera.zoom
        ? zoom
        : camera.zoom + (zoom - camera.zoom) * (1 - Math.exp(-dt * 3));
    camera.updateProjectionMatrix();
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const mobile = window.innerWidth <= 700,
      aspect = width / height;
    const fit = mobile
      ? Math.max(3.55, 4.05 / aspect)
      : Math.max(4.85, 4.7 / aspect);
    cameraDistance =
      (fit / (2 * Math.tan(THREE.MathUtils.degToRad(16)))) *
      Math.hypot(1, 0.145);
    focusX = mobile ? 0 : -0.19;
    focusY = mobile ? 1.28 : 1.27;
    camera.aspect = aspect;
    updateCamera(0);
    renderer.setSize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    hitPoint = new THREE.Vector3(),
    grabStart = new THREE.Vector3();
  let activePointer: number | null = null,
    orbiting = false,
    orbitTouch = { x: 0, y: 0 },
    origin = { x: 0, y: 0, z: 0 },
    pointerStart = { x: 0, y: 0 },
    moved = false,
    pressedAt = 0,
    lastStrokeAt = 0,
    lastStrokeX = 0,
    lastStrokeY = 0;
  const rayAt = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((x - r.left) / r.width) * 2 - 1,
      1 - ((y - r.top) / r.height) * 2,
    );
    raycaster.setFromCamera(pointer, camera);
  };
  const ray = (e: PointerEvent) => rayAt(e.clientX, e.clientY);
  const foodPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.18);
  const foodPoint = new THREE.Vector3();
  const feedingBound = () => 2.25;
  const cancelCandy = () => {
    const id = candies.heldId;
    if (id === null) return;
    if (foraging.targetId === id) {
      character.withdrawFood();
      foraging.reset();
    }
    candies.remove(id);
    heldScreen = null;
  };
  const offerCandy = (hex: string, x: number, y: number) => {
    if (activePointer !== null || candies.heldId !== null) return false;
    orbit.freeze();
    grabPlane(
      camera,
      new THREE.Vector3(physics.x, 1.2, physics.z + 1.18),
      foodPlane,
    );
    rayAt(x, y);
    if (!raycaster.ray.intersectPlane(foodPlane, foodPoint)) return false;
    const c = candies.spawn(hex, candyKind, {
      x: foodPoint.x,
      y: Math.max(0.15, foodPoint.y),
      z: foodPoint.z,
    });
    candies.grab(c.id);
    heldScreen = { x, y, last: performance.now() };
    character.wake();
    return true;
  };
  const moveCandy = (x: number, y: number) => {
    if (!heldScreen || candies.heldId === null) return;
    const now = performance.now(),
      dt = Math.max(0.008, (now - heldScreen.last) / 1000);
    heldScreen.x = x;
    heldScreen.y = y;
    heldScreen.last = now;
    rayAt(x, y);
    if (raycaster.ray.intersectPlane(foodPlane, foodPoint))
      candies.moveHeld(foodPoint, dt);
  };
  const acceptCandy = (id: number) => {
    const c = candies.get(id);
    if (!c || c.mode !== 'free' || !character.absorb()) return false;
    if (!candies.take(id)) return false;
    const start = { x: c.x, y: c.y, z: c.z };
    const hit = contactSurface.contact(c, c.radius + 0.05);
    const normal = hit?.normal || { x: 0, y: 0, z: 1 };
    const target = {
      x: c.x - physics.x,
      y: c.y - physics.y,
      z: c.z - physics.z,
    };
    const local = { ...target };
    for (let i = 0; i < 12; i++) {
      physics.deform(local.x, local.y, local.z, point);
      local.x += (target.x - point.x) * 0.8;
      local.y += (target.y - point.y) * 0.8;
      local.z += (target.z - point.z) * 0.8;
    }
    food = {
      id,
      hex: c.hex,
      start,
      local,
      normal,
      compression: c.compression,
      ate: false,
    };
    physics.tissue.impulse(Math.max(0.15, local.y), 0.4);
    if (heldScreen && candies.heldId === null) heldScreen = null;
    foraging.reset();
    physics.drive = physics.driveZ = null;

    return true;
  };
  const dropCandy = () => {
    if (candies.heldId === null) return Boolean(food);
    const r = canvas.getBoundingClientRect();
    if (
      heldScreen &&
      (heldScreen.x < r.left ||
        heldScreen.x > r.right ||
        heldScreen.y < r.top ||
        heldScreen.y > r.bottom)
    ) {
      cancelCandy();
      return false;
    }
    candies.release();
    heldScreen = null;
    return true;
  };
  let servingSide = 1;
  const feedCandy = (hex: string, _x: number, _y: number) => {
    const bound = feedingBound();
    const x = THREE.MathUtils.clamp(
      physics.x + servingSide * (0.85 + random() * 0.7),
      -bound,
      bound,
    );
    candies.spawn(
      hex,
      candyKind,
      { x, y: 1.7 + random() * 0.5, z: 0.65 + random() * 1.25 },
      {
        x: -servingSide * (0.25 + random() * 0.4),
        y: 0.5 + random() * 0.6,
        z: (random() - 0.5) * 0.7,
      },
    );
    servingSide *= -1;
    character.wake();
  };
  const updateBehavior = (dt: number) => {
    candies.bounds.x = feedingBound() + 0.08;
    physics.drive = physics.driveZ = null;
    physics.pose.lean = physics.held
      ? 0
      : character.lean + Math.sin(physics.time * 6) * character.refused * 0.035;
    physics.pose.squash =
      -character.comfort *
      (0.032 + Math.cos(physics.time * 4.4) * 0.008) *
      (1 - character.puff);
    physics.pose.oval = 0;
    physics.pose.reachX = physics.pose.reachY = 0;
    physics.pose.cheekL = physics.pose.cheekR = character.grump * 0.18;
    physics.pose.puff = character.puff;
    physics.pose.fullness = character.fullness;
    physics.pose.sleep = character.sleep;
    physics.pose.swallow = 0;
    const mouth = mouthWorld();
    foraging.update(
      dt,
      candies.candies,
      physics,
      !character.busy &&
        !character.isFull &&
        character.disappointment < 0.5 &&
        character.puff < 0.25,
    );
    if (foraging.targetId !== null) {
      if (!character.offered) character.offerFood();
      character.foodNear = foraging.distance < 1.8;
    } else if (character.offered) character.cancelFood();
    if (character.isFull && candies.heldId !== null) {
      const c = candies.get(candies.heldId)!;
      if (
        Math.hypot(c.x - mouth.x, c.y - mouth.y, c.z - mouth.z) < 0.9 &&
        character.refused < 0.05
      )
        character.refuse();
      gazeTargetX = THREE.MathUtils.clamp((c.x - mouth.x) * 0.6, -1, 1);
    }
    if (character.busy) {
      const pose = sampleAbsorption(character.mealAge);
      physics.pose.squash = -pose.squeeze * 0.65;
      physics.pose.lean = Math.sin(physics.time * 3) * 0.015 * (1 - pose.melt);
      physics.pose.cheekL = physics.pose.cheekR = 0;
    }
  };
  let secondaryPointer: number | null = null,
    pinchDistance = 1;
  let primaryTouch = { x: 0, y: 0 },
    secondaryTouch = { x: 0, y: 0 };
  const materialPoint = (hit: THREE.Intersection) => {
    const local = body.worldToLocal(hit.point.clone());
    // Recover material coordinates by barycentric interpolation on the hit triangle.
    if (hit.face) {
      const tri = new THREE.Triangle().setFromAttributeAndIndices(
          positions,
          hit.face.a,
          hit.face.b,
          hit.face.c,
        ),
        bary = new THREE.Vector3();
      tri.getBarycoord(local, bary);
      local.set(0, 0, 0);
      for (const [index, w] of [
        [hit.face.a, bary.x],
        [hit.face.b, bary.y],
        [hit.face.c, bary.z],
      ])
        local.addScaledVector(
          new THREE.Vector3().fromArray(rest, index * 3),
          w,
        );
    }
    return local;
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (activePointer !== null) {
      if (
        e.pointerType !== 'touch' ||
        secondaryPointer !== null ||
        !physics.held
      )
        return;
      ray(e);
      group.updateMatrixWorld(true);
      const hit = raycaster.intersectObject(body)[0];
      if (!hit) return;
      secondaryPointer = e.pointerId;
      secondaryTouch = { x: e.clientX, y: e.clientY };
      pinchDistance = Math.max(
        20,
        Math.hypot(
          primaryTouch.x - secondaryTouch.x,
          primaryTouch.y - secondaryTouch.y,
        ),
      );
      physics.grabSecond(materialPoint(hit));
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (candies.heldId !== null) return;
    if (activePointer !== null || e.button !== 0) return;
    ray(e);
    group.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    const bubbleHit = raycaster.intersectObjects(feedback.pickables)[0];
    if (bubbleHit) {
      gazeTargetX = THREE.MathUtils.clamp(
        (bubbleHit.point.x - physics.x) * 0.5,
        -1,
        1,
      );
      gazeTargetY = 0.65;
      character.surprise = Math.max(character.surprise, 0.35);
      if (bubbleHit.object.userData.sleepBubble) {
        feedback.popSleep();
        character.wake();
      } else feedback.pop(bubbleHit.object.userData.bubbleId as number);
      audio.play('pop');
      e.preventDefault();
      return;
    }
    const candyHit = raycaster.intersectObjects(candyView.pickables)[0];
    const hit = raycaster.intersectObject(body)[0];
    if (candyHit && (!hit || candyHit.distance < hit.distance + 0.025)) {
      const id = candyHit.object.userData.candyId as number;
      if (candies.grab(id)) {
        orbit.freeze();
        grabPlane(
          camera,
          new THREE.Vector3(
            candies.get(id)!.x,
            candies.get(id)!.y,
            candies.get(id)!.z,
          ),
          foodPlane,
        );
        e.preventDefault();
        activePointer = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('is-grabbing');
        heldScreen = {
          x: e.clientX,
          y: e.clientY,
          last: performance.now(),
        };
        character.wake();
        return;
      }
    }
    if (!hit) {
      orbit.freeze();
      activePointer = e.pointerId;
      orbiting = true;
      orbitTouch = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-grabbing');
      canvas.focus({ preventScroll: true });
      host.dataset.interaction = 'orbit';
      e.preventDefault();
      return;
    }
    orbit.freeze();
    if (character.sleep > 0.5) feedback.popSleep();
    character.wake();
    foraging.reset();
    character.cancelFood();
    e.preventDefault();
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-grabbing');
    canvas.focus({ preventScroll: true });
    moved = false;
    pressedAt = e.timeStamp;
    pointerStart = { x: e.clientX, y: e.clientY };
    primaryTouch = { ...pointerStart };
    grabPlane(camera, hit.point, plane);
    grabStart.copy(hit.point);
    origin = { x: physics.x, y: physics.y, z: physics.z };
    const local = materialPoint(hit);
    physics.grab(physics.x, physics.y, local, hit.face?.normal);
    host.dataset.interaction = 'press';
  };
  const move = (e: PointerEvent) => {
    if (orbiting) {
      if (e.pointerId !== activePointer) return;
      const height = canvas.getBoundingClientRect().height;
      orbit.rotate(
        ((orbitTouch.x - e.clientX) / height) * 5,
        ((e.clientY - orbitTouch.y) / height) * 3,
      );
      orbitTouch = { x: e.clientX, y: e.clientY };
      lastStrokeAt = 0;
      e.preventDefault();
      return;
    }
    if (
      secondaryPointer !== null &&
      (e.pointerId === activePointer || e.pointerId === secondaryPointer)
    ) {
      if (e.pointerId === activePointer)
        primaryTouch = { x: e.clientX, y: e.clientY };
      else secondaryTouch = { x: e.clientX, y: e.clientY };
      const distance = Math.hypot(
        primaryTouch.x - secondaryTouch.x,
        primaryTouch.y - secondaryTouch.y,
      );
      physics.pinchTo(
        0.15 + (pinchDistance - distance) / (pinchDistance * 0.5),
      );
      moved = true;
      e.preventDefault();
      return;
    }
    if (e.pointerId === activePointer)
      primaryTouch = { x: e.clientX, y: e.clientY };
    ray(e);
    gazeTargetX = THREE.MathUtils.clamp(pointer.x, -1, 1);
    gazeTargetY = THREE.MathUtils.clamp(pointer.y, -1, 1);
    if (e.pointerId !== activePointer) {
      const elapsed = (e.timeStamp - lastStrokeAt) / 1000;
      if (elapsed > 0.008) {
        if (
          lastStrokeAt &&
          elapsed < 0.12 &&
          !character.busy &&
          !character.offered
        ) {
          const hit = raycaster.intersectObject(body)[0];
          if (hit) {
            const speed =
              (Math.hypot(e.clientX - lastStrokeX, e.clientY - lastStrokeY) /
                elapsed /
                canvas.getBoundingClientRect().height) *
              4.85;
            character.stroke(speed, elapsed, (hit.point.x - physics.x) / 1.4);
          }
        }
        lastStrokeAt = e.timeStamp;
        lastStrokeX = e.clientX;
        lastStrokeY = e.clientY;
      }
      return;
    }
    if (candies.heldId !== null) {
      moveCandy(e.clientX, e.clientY);
      return;
    }
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;
    if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 4)
      moved = true;
    if (!moved) return;
    physics.dragTo(
      origin.x + hitPoint.x - grabStart.x,
      origin.y + hitPoint.y - grabStart.y,
      origin.z + hitPoint.z - grabStart.z,
    );
    host.dataset.interaction = 'drag';
  };
  const up = (e?: PointerEvent) => {
    if (e && e.pointerId === secondaryPointer) {
      const id = secondaryPointer;
      secondaryPointer = null;
      physics.releaseSecond();
      if (id !== null && canvas.hasPointerCapture(id))
        canvas.releasePointerCapture(id);
      origin = { x: physics.x, y: physics.y, z: physics.z };
      pointerStart = { ...primaryTouch };
      rayAt(primaryTouch.x, primaryTouch.y);
      raycaster.ray.intersectPlane(plane, grabStart);
      return;
    }
    if (activePointer === null || (e && e.pointerId !== activePointer)) return;
    const id = activePointer;
    const wasBody = physics.held;
    activePointer = null;
    if (orbiting) {
      orbiting = false;
      canvas.classList.remove('is-grabbing');
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      host.dataset.interaction = 'released';
      return;
    }
    if (secondaryPointer !== null) {
      const second = secondaryPointer;
      secondaryPointer = null;
      physics.releaseSecond();
      if (canvas.hasPointerCapture(second))
        canvas.releasePointerCapture(second);
    }
    if (candies.heldId !== null) {
      if (e?.type === 'pointerup') dropCandy();
      else {
        candies.release();
        heldScreen = null;
      }
    } else physics.release();
    if (
      wasBody &&
      e?.type === 'pointerup' &&
      !moved &&
      e.timeStamp - pressedAt < 340
    )
      character.poke(physics.anchor.x);
    canvas.classList.remove('is-grabbing');
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    host.dataset.interaction = 'released';
  };
  const blur = () => {
    up();
    cancelCandy();
  };
  const leave = () => {
    gazeTargetX = gazeTargetY = 0;
    lastStrokeAt = 0;
  };
  const wheel = (e: WheelEvent) => {
    if (activePointer !== null || candies.heldId !== null) return;
    e.preventDefault();
    const pixels =
      e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 500 : 1);
    orbit.zoom(THREE.MathUtils.clamp(pixels, -150, 150) * 0.0015);
  };
  const viewKey = (e: KeyboardEvent) => {
    if (activePointer !== null || candies.heldId !== null) return;
    if (e.key === 'Home') orbit.home();
    else if (e.key === 'ArrowLeft') orbit.rotate(-0.25, 0);
    else if (e.key === 'ArrowRight') orbit.rotate(0.25, 0);
    else if (e.key === 'ArrowUp') orbit.rotate(0, 0.12);
    else if (e.key === 'ArrowDown') orbit.rotate(0, -0.12);
    else return;
    e.preventDefault();
  };
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', viewKey);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('pointerleave', leave);
  window.addEventListener('blur', blur);
  let disposed = false,
    frames = 0,
    frameStart = performance.now(),
    lastTime = performance.now(),
    frame = 0,
    workMs = 0,
    queryPending = false;
  const frameTimes: number[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    observer.disconnect();
    void renderer.setAnimationLoop(null);
    window.removeEventListener('blur', blur);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('keydown', viewKey);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('lostpointercapture', up);
    canvas.removeEventListener('pointerleave', leave);
    disposables.forEach((r) => r.dispose());
    thought.remove();
    renderer.dispose();
    canvas.remove();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  updateFace(0);
  try {
    await renderer.compileAsync(scene, camera);
    signal?.throwIfAborted();
  } catch (e) {
    dispose();
    throw e;
  }
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const animate = () => {
    if (disposed) return;
    const now = performance.now(),
      delta = now - lastTime,
      dt = Math.min(delta / 1000, 0.1);
    lastTime = now;
    if (document.hidden) return;
    character.advance(dt, physics.held);
    updateBehavior(dt);
    physics.advance(dt);
    group.position.set(physics.x, physics.y, physics.z);
    updateCamera(dt);
    const mouth = mouthWorld();
    const preCapture = foraging.contact(
      candies.candies,
      contactSurface,
      physics,
    );
    if (preCapture !== null) acceptCandy(preCapture);
    candies.advance(dt, {
      x: physics.x,
      y: physics.y,
      z: physics.z,
      mouth,
      edibleId: null,
      contact: contactSurface.contact,
    });
    const biteId = foraging.contact(candies.candies, contactSurface, physics);
    if (biteId !== null) acceptCandy(biteId);
    for (const impact of candies.impacts)
      if (impact.body)
        physics.nudge(
          {
            x: impact.position.x - physics.x,
            y: impact.position.y - physics.y,
            z: impact.position.z - physics.z,
          },
          impact.strength,
        );
    if (lastLanding !== physics.impactSerial) {
      lastLanding = physics.impactSerial;
      character.land(physics.lastImpact);
      if (physics.lastImpact > 3) {
        feedback.emit('star', {
          x: physics.x - 0.22,
          y: physics.y + 2.9,
          z: physics.z + 0.1,
        });
        feedback.emit('star', {
          x: physics.x + 0.22,
          y: physics.y + 2.98,
          z: physics.z + 0.1,
        });
      }
      if (physics.lastImpact > 0.8) audio.play('gummy', physics.lastImpact);
    }
    for (const impact of candies.impacts)
      audio.play(impact.kind === 'gummy' ? 'gummy' : 'hard', impact.strength);
    for (let i = 0; i < positions.count; i++) {
      const j = i * 3;
      physics.deform(rest[j], rest[j + 1], rest[j + 2], point);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    updateFace(dt);
    updateFood(dt);
    candyView.update(candies.candies);
    for (let i = 0; i < bubbleCount; i++) {
      const b = bubbleRest[i];
      physics.deform(b.x, b.y, b.z, point);
      dummy.position.set(point.x, point.y, point.z);
      dummy.scale.set(
        b.r * Math.exp(-physics.squash / 2),
        b.r * Math.exp(physics.squash),
        b.r,
      );
      dummy.updateMatrix();
      bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;
    shadows.forEach((s, i) => {
      s.mesh.position.x = physics.x;
      s.mesh.position.z = physics.z + (i ? 0.3 : 0);
      s.mesh.scale.setScalar(1 + physics.y * (i ? 0.1 : 0.2));
      s.material.opacity = i
        ? Math.exp(-physics.y * (i === 1 ? 4.5 : 5))
        : 1 / (1 + physics.y * 0.5);
    });
    const before = performance.now();
    optics.render(renderer, camera);
    renderer.render(scene, camera);
    const renderCpu = performance.now() - before;
    frames++;
    frame++;
    if (delta > 0) frameTimes.push(delta);
    if (frameTimes.length > 600) frameTimes.shift();
    if (frame % 60 === 0 && !queryPending) {
      queryPending = true;
      device.queue
        .onSubmittedWorkDone()
        .then(() => {
          workMs = performance.now() - now;
          queryPending = false;
        })
        .catch(() => {
          queryPending = false;
        });
    }
    if (now - frameStart > 1200) {
      const measured = Math.round((frames * 1000) / (now - frameStart));
      callbacks.onFps(document.hidden ? 0 : measured);
      const sorted = [...frameTimes].sort((a, b) => a - b);
      host.dataset.diagnostics = JSON.stringify({
        backend: 'WebGPU',
        fps: measured,
        visibility: document.visibilityState,
        pixelRatio: renderer.getPixelRatio(),
        canvas: [canvas.width, canvas.height],
        frameP95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
        renderCpuMs: +renderCpu.toFixed(2),
        gpuCompletedFrameMs: +workMs.toFixed(2),
        samples: frameTimes.length,
        position: [+physics.x.toFixed(3), +physics.y.toFixed(3)],
        squash: +physics.squash.toFixed(3),
        press: +physics.press.toFixed(3),
        patch: { ...physics.patch },
        vertices: positions.count,
        mood: character.mood,
        comfort: +character.comfort.toFixed(3),
        grump: +character.grump.toFixed(3),
        foodPhase: character.phase,
        reach: [+physics.reachX.toFixed(3), +physics.reachY.toFixed(3)],
        foodDistance: Number.isFinite(foraging.distance)
          ? +foraging.distance.toFixed(3)
          : null,
        mealAge: +character.mealAge.toFixed(3),
        spread: +spread.value.toFixed(3),
        color: currentColor,
        candyCount: candies.candies.length,
        fullness: character.fullness,
        pressure: physics.puff,
        lean: physics.shear,
        view: {
          yaw: orbit.yaw,
          pitch: orbit.pitch,
          distance: orbit.distanceScale,
        },
        depth: physics.z,
        sleep: character.sleep,
        thoughtBubbles: feedback.world.bubbles.length,
      });
      if (
        !document.hidden &&
        measured > 15 &&
        measured < 52 &&
        renderer.getPixelRatio() > 0.85
      )
        renderer.setPixelRatio(Math.max(0.85, renderer.getPixelRatio() - 0.15));
      else if (
        !document.hidden &&
        measured > 85 &&
        renderer.getPixelRatio() < Math.min(devicePixelRatio, 1.5)
      )
        renderer.setPixelRatio(
          Math.min(devicePixelRatio, 1.5, renderer.getPixelRatio() + 0.1),
        );
      frameStart = now;
      frames = 0;
    }
  };
  await renderer.setAnimationLoop(animate);
  animate();
  callbacks.onReady();
  void device.lost.then(() => {
    if (!disposed) {
      void renderer.setAnimationLoop(null);
      callbacks.onError('WebGPU 连接暂时中断了，请重新唤醒小软团。');
    }
  });
  return {
    resetView: () => {
      if (candies.heldId !== null) return;
      up();
      orbit.home();
    },
    offerCandy,
    moveCandy,
    dropCandy,
    cancelCandy,
    feedCandy,
    setCandyKind: (kind) => {
      candyKind = kind;
    },
    setSound: (enabled) => audio.setEnabled(enabled),
    setStiffness: (n) => {
      physics.stiffness = n;
    },
    setDamping: (n) => {
      physics.damping = n;
    },
    poke: () => {
      if (character.busy) return;
      if (character.sleep > 0.5) feedback.popSleep();
      physics.poke();
      character.poke(1);
      host.dataset.interaction = 'poke';
    },
    reset: () => {
      up();
      orbit.home();
      character.reset();
      foraging.reset();
      food = null;
      candies.reset();
      heldScreen = null;
      feedback.reset();
      heartCooldown = 0;
      wasPuffed = false;
      pigmentAge = -1;
      callbacks.onFoodPhase('idle');
      physics.reset();
      setColor(PINK);
    },
    dispose,
  };
}
