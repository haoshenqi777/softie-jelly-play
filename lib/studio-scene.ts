import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { color, mix, positionWorld, uniform, vec2, vec3 } from 'three/tsl';
import { SlimeOptics } from './slime-optics';
import { GelRenderCheck } from './gel-render-check';
import { createLinearCapture } from './gel-linear-capture';
import { prefersLinearGelCapture } from './gel-capture-mode';
import {
  STUDIO_TARGET_Y,
  STUDIO_VIEW_YAW,
  studioCameraDistance,
  FixedStudioFrame,
  MOBILE_TARGET_Y,
} from './studio-camera';
import { createConceptGel } from './studio-gel';
import { createDyedGel, createDyedBubble } from './studio-dyed-gel';
import { PigmentLayer, type PigmentId } from './studio-pigment';
import { AbsorptionField } from './absorption-field';
import { AbsorptionInterior } from './absorption-interior';
import { StudioAbsorption } from './studio-absorption';
import {
  StudioContact,
  type ContactCommand,
  type ContactSnapshot,
} from './studio-contact';
import type { AbsorptionFrame } from './absorption-motion';
import { createStudioBubble, createStudioEnvironment } from './studio-material';
import { VolumeInteraction } from './softbody/interaction';
import { StudioCandies } from './studio-candies';
import { GameIntake } from './game-intake';
import {
  StudioDigestion,
  type DigestionCommand,
  type DigestionSnapshot,
} from './studio-digestion';
import { TouchOrbit, FramePointerInput } from './touch-orbit';
import type { PlayMode } from './play-mode';
import type { IntakeStage } from './contact-intake';
import type { CandyKind } from './candy-physics';
import type { FeelTuning } from './softbody/tuning';
import type { ExpressionSettings, ExpressionId } from './softbody/expression';
import type { EmotionEvent } from './softbody/emotion';
import type { RecoveryPhase } from './softbody/recovery';
import type { BehaviorPhase } from './softbody/behavior-types';
import type { SocialBeat } from './softbody/social-response';
export type StudioView = 'front' | 'three-quarter' | 'side';
export type StudioPose = 'rest' | 'squash' | 'puff';
export type StudioHandle = {
  setCameraLocked(locked: boolean): void;
  setPlayMode(mode: PlayMode): void;
  setDigestion(v: DigestionCommand): void;
  setContact(v: ContactCommand): void;
  setAbsorption(v: { time?: number; playing?: boolean; speed?: number }): void;
  spawnCandy(kind: CandyKind): boolean;
  beginCandy(
    kind: CandyKind,
    event: PointerEvent,
    owner?: HTMLElement,
  ): boolean;
  moveCandy(event: PointerEvent): void;
  releaseCandy(event: PointerEvent, cancelled?: boolean): void;
  clearCandies(): void;
  setView(v: StudioView): void;
  resetView(): void;
  setMaterial(v: 'gel' | 'clay'): void;
  setPigment(id: PigmentId, amount?: number): void;
  selectColor(id: PigmentId, strength?: number, hue?: number): void;
  saveColor(): unknown;
  colorAppearance(): { id: PigmentId; strength: number; hue: number };
  restoreColor(value: unknown): void;
  setCandyPigment(id: PigmentId): void;
  setMotion(v: boolean): void;
  setPose(v: StudioPose): void;
  alignReference(view: StudioView, pose: 'rest' | 'squash'): void;
  poke(): void;
  drop(): void;
  resetBody(): void;
  tip(): void;
  setRecoveryEnabled(enabled: boolean): void;
  setBreathing(enabled: boolean): void;
  setTuning(values: Partial<FeelTuning>): void;
  setExpression(values: Partial<ExpressionSettings>): void;
  blink(): void;
  react(event: EmotionEvent, amount?: number): void;
  dispose(): void;
};
type Bubble = {
  p: [number, number, number];
  r: number;
  poses: [number, number, number][];
};
type Callbacks = {
  onContact?(state: ContactSnapshot): void;
  onDigestion?(state: DigestionSnapshot): void;
  onAbsorption?(frame: AbsorptionFrame, playing: boolean): void;
  onReady(): void;
  onStats(fps: number): void;
  onError(s: string): void;
  onViewChange(v: StudioView | null): void;
  onExpression?(id: ExpressionId): void;
  onRecovery?(phase: RecoveryPhase): void;
  onCharacter?(phase: BehaviorPhase): void;
  onSocial?(beat: SocialBeat): void;
  onCandyCount?(count: number): void;
  onFeeding?(stage: IntakeStage, pigment: PigmentId): void;
};

export async function createStudio(
  host: HTMLElement,
  callbacks: Callbacks,
  options: {
    softbody?: boolean;
    playMode?: PlayMode;
    cameraLocked?: boolean;
    pigmentStudy?: boolean;
    absorptionStudy?: boolean;
    contactStudy?: boolean;
    digestionStudy?: boolean;
  } = {},
): Promise<StudioHandle> {
  let playMode: PlayMode = options.playMode ?? 'free';
  const mobileExperience =
    !!options.softbody &&
    window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  let cameraLocked = options.cameraLocked ?? mobileExperience;
  const fixedFrame = new FixedStudioFrame();
  const fixedCamera = () => !!options.softbody && cameraLocked;
  host.dataset.cameraLocked = String(cameraLocked);
  host.dataset.playMode = playMode;
  const resources = new Set<{ dispose(): void }>();
  const keep = <T extends { dispose(): void }>(r: T) => {
    resources.add(r);
    return r;
  };
  const profile =
    new URLSearchParams(window.location.search).get('profile') === '1';
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    trackTimestamp: profile,
  });
  (renderer as unknown as { _getFallback: null })._getFallback = null;
  let closed = false,
    failed = false,
    firstFrame = true;
  const fail = () => {
    if (closed || failed) return;
    failed = true;
    void renderer.setAnimationLoop(null);
    callbacks.onError(
      'WebGPU 渲染已中断。请刷新页面，或使用已开启图形加速的 WebGPU 浏览器。',
    );
  };
  renderer.onDeviceLost = fail;
  try {
    await renderer.init();
    const device = (renderer.backend as unknown as { device: GPUDevice })
      .device;
    const gpuTimingEnabled = (
      renderer.backend as unknown as { trackTimestamp: boolean }
    ).trackTimestamp;
    let gpuPending = false,
      gpuMs: number | null = null,
      frameIndex = 0;
    let gpuResolution: Promise<void> | null = null;
    const gpuSamples: number[] = [];
    let measurementEpoch = 0;
    const resetMeasurement = () => {
      measurementEpoch++;
      gpuSamples.length = 0;
      gpuMs = null;
    };
    const gpuError = (event: GPUUncapturedErrorEvent) => {
      console.error('Studio WebGPU:', event.error.message);
      fail();
    };
    device.addEventListener('uncapturederror', gpuError);
    keep({
      dispose() {
        device.removeEventListener('uncapturederror', gpuError);
      },
    });
    if (
      !(renderer.backend as unknown as { isWebGPUBackend: boolean })
        .isWebGPUBackend
    )
      throw new Error('需要 WebGPU 浏览器才能观看这只凝胶。');
    const gltf = await new GLTFLoader().loadAsync(
      '/models/slime-studio.glb?v=approved-11',
    );
    const parts: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        parts.push(o);
        keep(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          keep(m);
      }
    });
    const body = parts.find((o) => o.name === 'Gel');
    if (!body) throw new Error('角色模型未能完整加载。');
    if (
      options.absorptionStudy ||
      options.contactStudy ||
      options.digestionStudy
    )
      body.geometry = keep(body.geometry.clone());
    if (options.contactStudy || options.softbody || options.digestionStudy)
      body.geometry.setAttribute(
        'absorptionRest',
        new THREE.BufferAttribute(
          Float32Array.from(body.geometry.attributes.position.array),
          3,
        ),
      );
    const bubbleData = JSON.parse(body.userData.bubble_data) as Bubble[];
    const scene = new THREE.Scene();
    const paper = new THREE.Color('#f4f5f5');
    scene.background = paper;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const environment = keep(createStudioEnvironment(renderer));
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.8;
    scene.add(new THREE.HemisphereLight('#fff8ee', '#9e7d78', 0.38));
    const key = new THREE.DirectionalLight('#fff8f1', 2.5);
    key.position.set(-3.5, 5, 4);
    scene.add(key);
    const pigment =
      options.pigmentStudy ||
      options.absorptionStudy ||
      options.contactStudy ||
      options.digestionStudy ||
      options.softbody
        ? new PigmentLayer()
        : null;
    const absorptionField =
      options.absorptionStudy ||
      options.contactStudy ||
      options.softbody ||
      options.digestionStudy
        ? new AbsorptionField(options.softbody ? 2 : 0)
        : undefined;
    const candyOptics =
      options.absorptionStudy ||
      options.contactStudy ||
      options.softbody ||
      options.digestionStudy
        ? keep(new AbsorptionInterior())
        : undefined;
    const contactWidth = uniform(1);
    const contactCenter = uniform(new THREE.Vector2());
    const contactOpacity = uniform(1);
    const contact = positionWorld.xz
      .sub(contactCenter)
      .add(vec2(0.18, 0.04))
      .div(vec2(1.75, 1.35).mul(contactWidth))
      .length()
      .pow(2)
      .mul(-1.45)
      .exp()
      .mul(0.28);
    const contactPatch = positionWorld.xz
      .sub(contactCenter)
      .div(vec2(1.28, 1.16).mul(contactWidth))
      .length()
      .pow(8)
      .mul(-0.8)
      .exp()
      .mul(0.58);
    const floorMaterial = keep(new THREE.MeshBasicNodeMaterial());
    floorMaterial.colorNode = mix(
      color(paper),
      absorptionField
        ? absorptionField.tint(
            vec3(color('#996770')),
            absorptionField.materialPoint(positionWorld),
          )
        : pigment
          ? pigment.tint(vec3(color('#996770')))
          : color('#996770'),
      contact.add(contactPatch).min(0.9).mul(contactOpacity),
    );
    const floor = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(100, 100)),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.008;
    scene.add(floor);
    scene.add(gltf.scene);
    const optics = keep(
      new SlimeOptics(body, scene, mobileExperience ? 0.8 : 1),
    );
    const materialCapture = keep(
      await new THREE.TextureLoader().loadAsync(
        '/materials/slime-gel-matcap.png',
      ),
    );
    materialCapture.colorSpace = THREE.SRGBColorSpace;
    const renderParams = new URLSearchParams(window.location.search);
    const checkEnabled = renderParams.get('rendercheck') === '1';
    // Query override is for local GPU QA; regular visitors need no setting.
    const compatibleCapture =
      prefersLinearGelCapture(navigator) ||
      renderParams.get('gelcapture') === 'linear';
    const linearCapture =
      compatibleCapture || checkEnabled
        ? keep(createLinearCapture(materialCapture.image as HTMLImageElement))
        : undefined;
    host.dataset.gelCapture = compatibleCapture ? 'linear' : 'original';
    const renderCheck = checkEnabled
      ? keep(new GelRenderCheck(host, linearCapture!, compatibleCapture))
      : undefined;
    const gel = keep(
      createConceptGel(
        optics,
        materialCapture,
        environment.texture,
        renderCheck,
        compatibleCapture ? linearCapture : undefined,
      ),
    );
    const dyedGel = pigment
      ? keep(
          createDyedGel(
            optics,
            materialCapture,
            environment.texture,
            pigment,
            absorptionField,
            candyOptics,
            renderCheck,
            compatibleCapture ? linearCapture : undefined,
          ),
        )
      : gel;
    const clay = keep(
      new THREE.MeshStandardMaterial({
        color: '#8b8987',
        roughness: 0.75,
        envMap: environment.texture,
        envMapIntensity: 0.3,
      }),
    );
    const eyes = keep(
      new THREE.MeshPhysicalMaterial({
        // Surface markings must not enter the opaque transmission capture:
        // otherwise their submerged backs appear again as refracted ghost eyes.
        transparent: true,
        depthWrite: false,
        color: '#040405',
        roughness: 0.13,
        clearcoat: 0,
        clearcoatRoughness: 0.06,
        envMap: environment.texture,
        envMapIntensity: 1,
        specularIntensity: 1,
      }),
    );
    const smile = keep(
      new THREE.MeshStandardMaterial({
        color: '#0b0508',
        roughness: 0.65,
        transparent: true,
        depthWrite: false,
      }),
    );
    for (const p of parts) {
      p.material = p === body ? gel : p.name === 'Smile' ? smile : eyes;
      p.frustumCulled = false;
      p.renderOrder = p === body ? 0 : 2;
    }
    const originalBubble = keep(
      createStudioBubble(optics, environment.texture),
    );
    const dyedBubble = pigment
      ? keep(
          createDyedBubble(
            optics,
            environment.texture,
            pigment,
            absorptionField,
          ),
        )
      : originalBubble;
    const bubbles = new THREE.InstancedMesh(
      keep(
        new THREE.SphereGeometry(
          1,
          mobileExperience ? 16 : 32,
          mobileExperience ? 10 : 20,
        ),
      ),
      originalBubble,
      bubbleData.length,
    );
    bubbles.frustumCulled = false;
    optics.interior.add(bubbles);
    const absorption =
      options.absorptionStudy && absorptionField
        ? keep(
            new StudioAbsorption(
              body,
              parts,
              scene,
              optics,
              environment.texture,
              absorptionField,
              candyOptics!,
            ),
          )
        : null;
    if (
      absorption ||
      options.contactStudy ||
      options.softbody ||
      options.digestionStudy
    ) {
      body.material = dyedGel;
      bubbles.material = dyedBubble;
    }
    const dummy = new THREE.Object3D();
    const bubbleOrder = bubbleData.map((data, index) => ({
      data,
      index,
      position: new THREE.Vector3(),
      depth: 0,
    }));
    const bubbleView = new THREE.Vector3();
    const canvas = renderer.domElement;
    const contactStudy = options.contactStudy
      ? keep(
          new StudioContact(
            canvas,
            camera,
            body,
            parts,
            bubbleData,
            scene,
            environment.texture,
            { optics, interior: candyOptics!, field: absorptionField! },
          ),
        )
      : null;
    const digestion = options.digestionStudy
      ? keep(
          new StudioDigestion(
            body,
            scene,
            environment.texture,
            optics,
            candyOptics!,
            absorptionField!,
          ),
        )
      : null;
    const volume =
      options.softbody && !absorption && !contactStudy
        ? new VolumeInteraction(canvas, camera, body, parts, bubbleData)
        : null;
    if (volume || contactStudy) {
      const response = await fetch('/physics/volume.wasm');
      if (!response.ok) throw new Error('软体计算模块加载失败，请刷新重试。');
      await (volume ?? contactStudy)!.solver.accelerate(
        await response.arrayBuffer(),
      );
      // Compile before interaction starts, never on the first candy contact.
      try {
        const skinResponse = await fetch('/physics/contact-skin.wasm');
        if (skinResponse.ok)
          await (
            contactStudy?.shell ?? volume!.enableIntake().shell
          ).skin.accelerate(await skinResponse.arrayBuffer());
      } catch (error) {
        console.warn(
          'Contact acceleration unavailable; using reference solver.',
          error,
        );
      }
    }
    const candies = volume
      ? keep(new StudioCandies(canvas, camera, scene, body))
      : null;
    volume?.setPlayMode(playMode);
    candies?.setPlayMode(playMode);
    volume?.motor.setBreathing(
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    const gameIntake =
      volume && candies
        ? keep(
            new GameIntake(volume, candies, absorptionField!, {
              scene,
              environment: environment.texture,
              optics,
              interior: candyOptics!,
            }),
          )
        : null;
    canvas.tabIndex = 0;
    const playHint = () =>
      playMode === 'tabletop'
        ? `固定桌面。拖动身体揉捏或提起，松手弹跳后落在附近。${cameraLocked ? '镜头固定在中央，可在设置中打开转动视角。' : '空白处单指拖动可环绕观看。'}双指或滚轮缩放。轻点地上的糖叫它来；糖果贴身体两侧后下推压入、上提撤回。`
        : '软体凝胶。拖动身体按压或提起，松手落下；空白处单指拖动转镜头，双指或滚轮缩放。轻点地上的糖叫它来。糖果贴身体两侧后下推压入、上提撤回。空格戳一下，R 复原。';
    canvas.setAttribute(
      'aria-label',
      volume
        ? playHint()
        : contactStudy
          ? '方糖接触样片。点住身体选择位置，上下拖动调节按压，松开回弹；拖动空白旋转视角。也可使用下方的位置按钮和深浅滑块。'
          : '凝胶外观样片。拖动旋转，左右键转动，上下键俯仰，Home 回到参考视角。',
    );
    canvas.setAttribute('role', 'img');
    host.appendChild(canvas);
    // The captured gel light response is already display transformed. WebGPU
    // applies tone mapping to the whole output, not the individual material.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    if (candies && volume) candies.onTap = (id) => volume.inviteCandy(id);
    const defaultPitch = () => (mobileExperience ? 0.18 : 0.12);
    let zoom = 1,
      targetZoom = 1,
      cameraQuiet = 0,
      orbitGesture = false;
    let yaw: number = STUDIO_VIEW_YAW.front,
      pitch = defaultPitch(),
      targetYaw = yaw,
      targetPitch = pitch;
    let motion = false,
      pose: StudioPose = 'rest',
      mode: 'gel' | 'clay' = 'gel',
      time = 0;
    const weights = [0, 0, 0];
    let last = performance.now(),
      frames = 0,
      sampleTime = last;
    let pointer: number | null = null,
      lastX = 0,
      lastY = 0;
    const touches = new TouchOrbit();
    const pointerMoves = new FramePointerInput();
    let qualityScale = 1,
      slowSamples = 0,
      fastSamples = 0,
      lastQualityChange = 0;
    let sampleInterrupted = false;
    const resize = () => {
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (volume)
        renderer.setPixelRatio(
          Math.min(
            devicePixelRatio,
            (mobileExperience ? 1.15 : 1.35) * qualityScale,
            Math.sqrt(1900000 / (r.width * r.height)),
          ),
        );
      renderer.setSize(r.width, r.height);
      const aspect = r.width / r.height;
      if (Math.abs(camera.aspect - aspect) > 0.001) fixedFrame.reset();
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      resetMeasurement();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    const setView = (v: StudioView) => {
      resetMeasurement();
      targetYaw = STUDIO_VIEW_YAW[v];
      targetPitch = 0.12;
      callbacks.onViewChange(v);
    };
    const resetView = () => {
      targetYaw = STUDIO_VIEW_YAW.front;
      targetPitch = defaultPitch();
      targetZoom = 1;
      cameraQuiet = 0;
      fixedFrame.reset();
      callbacks.onViewChange('front');
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerMoves.flush(move);
      if (volume && e.pointerType === 'touch') {
        touches.down(e.pointerId, e.clientX, e.clientY);
        if (touches.size >= 2 || orbitGesture) {
          orbitGesture = true;
          // Promote an existing background drag as well as body/candy input.
          pointer = null;
          cameraQuiet = 2;
          candies?.cancel();
          volume.cancel();
          for (const id of touches.ids) {
            try {
              canvas.setPointerCapture(id);
            } catch {}
          }
          e.preventDefault();
          return;
        }
      }
      if (
        pointer !== null ||
        candies?.held ||
        volume?.held ||
        contactStudy?.held
      )
        return;
      if (contactStudy?.pointerDown(e)) return;
      if (candies?.down(e)) {
        volume?.pointerLeave();
        return;
      }
      if (volume?.pointerDown(e)) {
        targetYaw = yaw;
        targetPitch = pitch;
        targetZoom = zoom;
        return;
      }
      // Empty-space ownership stays with the camera even across the body.
      pointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (touches.has(e.pointerId)) {
        const d = touches.move(e.pointerId, e.clientX, e.clientY);
        if (d && orbitGesture) {
          cameraQuiet = 2;
          targetZoom = THREE.MathUtils.clamp(targetZoom * d.zoom, 0.65, 1.5);
          if (playMode === 'tabletop')
            targetZoom = THREE.MathUtils.clamp(targetZoom, 0.85, 1.35);
        }
        if (
          orbitGesture ||
          (!candies?.held && !volume?.held && pointer !== e.pointerId)
        )
          return;
      }
      if (contactStudy?.pointerMove(e)) return;
      if (candies?.held) {
        candies.move(e);
        return;
      }
      if (volume?.pointerMove(e)) return;
      if (e.pointerId !== pointer) return;
      if (fixedCamera()) {
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      resetMeasurement();
      cameraQuiet = 2;
      callbacks.onViewChange(null);
      targetYaw -= (e.clientX - lastX) * 0.006;
      targetPitch = THREE.MathUtils.clamp(
        targetPitch + (e.clientY - lastY) * 0.003,
        -0.01,
        0.55,
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      // Owner cancellation during second-finger takeover releases capture once.
      // The physical finger is still down and is immediately captured by camera.
      if (orbitGesture && e.type === 'lostpointercapture') return;
      if (e.type === 'pointerup') pointerMoves.flush(move);
      else pointerMoves.clear();
      if (touches.has(e.pointerId)) {
        touches.up(e.pointerId);
        if (orbitGesture) {
          if (canvas.hasPointerCapture(e.pointerId))
            canvas.releasePointerCapture(e.pointerId);
          if (touches.size === 0) orbitGesture = false;
          return;
        }
      }
      if (contactStudy?.pointerUp(e)) return;
      if (candies?.up(e, e.type !== 'pointerup')) return;
      if (volume?.pointerUp(e)) return;
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      if (!volume || volume.held || candies?.held) return;
      e.preventDefault();
      cameraQuiet = 2;
      const pixels =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      targetZoom = THREE.MathUtils.clamp(
        targetZoom *
          Math.exp(THREE.MathUtils.clamp(pixels, -160, 160) * 0.0015),
        0.65,
        1.5,
      );
      if (playMode === 'tabletop')
        targetZoom = THREE.MathUtils.clamp(targetZoom, 0.85, 1.35);
      callbacks.onViewChange(null);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable ||
            ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(
              e.target.tagName,
            )))
      )
        return;
      if (volume && (e.code === 'Space' || e.key.toLowerCase() === 'r')) {
        if (e.code === 'Space') volume.poke();
        else {
          gameIntake?.clear();
          volume.reset();
        }
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') targetYaw += 0.2;
      else if (e.key === 'ArrowRight') targetYaw -= 0.2;
      else if (e.key === 'ArrowUp')
        targetPitch = Math.min(0.55, targetPitch + 0.1);
      else if (e.key === 'ArrowDown')
        targetPitch = Math.max(-0.01, targetPitch - 0.1);
      else if (e.key === 'Home') {
        if (volume) resetView();
        else setView('three-quarter');
      } else return;
      if (e.key !== 'Home') callbacks.onViewChange(null);
      resetMeasurement();
      e.preventDefault();
    };
    const queueMove = (e: PointerEvent) => {
      pointerMoves.push(e);
      if (e.pointerType === 'touch' && e.cancelable) e.preventDefault();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', queueMove, { passive: false });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('keydown', keyboard);
    canvas.addEventListener('wheel', wheel, { passive: false });
    const leave = (e: PointerEvent) => {
      if (!canvas.hasPointerCapture(e.pointerId))
        pointerMoves.drop(e.pointerId);
      volume?.pointerLeave();
    };
    canvas.addEventListener('pointerleave', leave);
    const cancelDrag = () => {
      pointerMoves.clear();
      orbitGesture = true;
      for (const id of touches.ids)
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      touches.clear();
      contactStudy?.cancel();
      candies?.cancel();
      volume?.cancel();
      if (pointer !== null && canvas.hasPointerCapture(pointer))
        canvas.releasePointerCapture(pointer);
      pointer = null;
      orbitGesture = false;
    };
    const visibilityChange = () => {
      if (document.hidden) cancelDrag();
      last = performance.now();
    };
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', visibilityChange);
    const dispose = () => {
      if (closed) return;
      closed = true;
      void renderer.setAnimationLoop(null);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', queueMove);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('keydown', keyboard);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', cancelDrag);
      document.removeEventListener('visibilitychange', visibilityChange);
      canvas.remove();
      const release = () => {
        resources.forEach((r) => r.dispose());
        renderer.dispose();
      };
      // Do not destroy a timestamp readback buffer while mapAsync is pending.
      if (gpuResolution) void gpuResolution.finally(release);
      else release();
    };
    let flightFrame = 0;
    const roomCenter = new THREE.Vector3();
    let roomDistance = 0;
    let lastExpression: ExpressionId | undefined;
    let lastRecovery: RecoveryPhase | undefined;
    let lastCharacter: BehaviorPhase | undefined;
    let lastSocial: SocialBeat | undefined;
    let lastCandyCount = -1;
    let lastFeeding = '';
    let lastAbsorptionNotice = -1;
    let contactNotice = 0;
    const notifyCandyCount = () => {
      const count = candies?.world.candies.length ?? 0;
      if (count !== lastCandyCount) {
        lastCandyCount = count;
        callbacks.onCandyCount?.(count);
      }
    };
    const draw = (now: number) => {
      if (closed || failed) return;
      if (document.hidden) {
        last = now;
        return;
      }
      if (now - last > 250) sampleInterrupted = true;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      pointerMoves.flush(move);
      if (digestion) {
        const state = digestion.update(dt);
        contactNotice += dt;
        if (contactNotice >= 0.08) {
          callbacks.onDigestion?.(state);
          contactNotice = 0;
        }
      }
      if (contactStudy) {
        contactStudy.update(dt);
        contactNotice += dt;
        if (contactNotice >= 0.08) {
          callbacks.onContact?.(contactStudy.stats());
          contactNotice = 0;
        }
      }
      if (absorption) {
        const f = absorption.update(dt);
        if (
          f.time !== lastAbsorptionNotice &&
          (Math.abs(f.time - lastAbsorptionNotice) > 0.08 ||
            !absorption.timeline.playing)
        ) {
          lastAbsorptionNotice = f.time;
          callbacks.onAbsorption?.(f, absorption.timeline.playing);
        }
      }
      if (volume) {
        volume.setCandies(candies?.world.candies ?? []);
        volume.update(dt);
        const characterPhase = volume.characterState()?.phase ?? 'idle';
        if (characterPhase !== lastCharacter) {
          lastCharacter = characterPhase;
          callbacks.onCharacter?.(characterPhase);
        }
        const social = volume.characterState()?.social ?? 'none';
        if (social !== lastSocial) {
          lastSocial = social;
          callbacks.onSocial?.(social);
        }
        const phase = volume.recovery.stats().phase;
        if (phase !== lastRecovery) {
          lastRecovery = phase;
          callbacks.onRecovery?.(phase);
        }
        const id = volume.expression.stats().active;
        if (id !== lastExpression) {
          lastExpression = id;
          callbacks.onExpression?.(id);
        }
      }
      candies?.update(dt);
      gameIntake?.update();
      if (gameIntake) {
        const f = gameIntake.stats(),
          signature = f.stage + f.pigment.base;
        if (signature !== lastFeeding) {
          lastFeeding = signature;
          callbacks.onFeeding?.(f.stage, f.pigment.base);
        }
      }
      notifyCandyCount();
      if (motion) time += dt;
      const targets = [
        motion ? Math.sin(time * 1.8) * 0.5 + 0.5 : weights[0],
        pose === 'squash' ? 1 : 0,
        pose === 'puff' ? 1 : 0,
      ];
      for (let i = 0; i < 3; i++)
        weights[i] =
          volume || contactStudy
            ? 0
            : weights[i] + (targets[i] - weights[i]) * (1 - Math.exp(-dt * 6));
      for (const p of parts)
        if (p.morphTargetInfluences)
          for (let i = 0; i < 3; i++) p.morphTargetInfluences[i] = weights[i];
      contactWidth.value = 1 + weights[1] * 0.16;
      if (volume && body.geometry.boundingBox) {
        const box = body.geometry.boundingBox,
          height = Math.max(0, box.min.y);
        contactCenter.value.set(
          (box.min.x + box.max.x) / 2,
          (box.min.z + box.max.z) / 2,
        );
        contactWidth.value = (box.max.x - box.min.x) / 3.2325 + height * 0.16;
        contactOpacity.value = Math.exp(-height * 1.35);
      }
      if (!volume?.held && !candies?.held) {
        const response = mobileExperience ? 24 : 9;
        yaw += (targetYaw - yaw) * (1 - Math.exp(-dt * response));
        pitch += (targetPitch - pitch) * (1 - Math.exp(-dt * response));
        zoom +=
          (targetZoom - zoom) *
          (1 - Math.exp(-dt * (mobileExperience ? 24 : 12)));
      }
      cameraQuiet = Math.max(0, cameraQuiet - dt);
      // Follow jump height gently in either mode. Freeze the
      // frame while held so moving the camera cannot feed back into dragging.
      if (
        volume &&
        !fixedCamera() &&
        !volume.held &&
        !candies?.held &&
        pointer === null &&
        !orbitGesture
      ) {
        const elevation = Math.max(0, body.geometry.boundingBox?.min.y ?? 0);
        flightFrame +=
          (elevation - flightFrame) *
          (1 - Math.exp(-dt * (elevation > flightFrame ? 14 : 5)));
        if (playMode === 'free' && cameraQuiet === 0) {
          const box = body.geometry.boundingBox!;
          const cx = (box.min.x + box.max.x) / 2,
            cz = (box.min.z + box.max.z) / 2;
          // Keep both the meeting point and a thrown character visible. The lens,
          // lighting and approved resting frame stay the same; only room framing
          // eases out during travel, then settles back as it returns.
          const radius = Math.hypot(cx, cz);
          const tracking = radius > 0.65 ? 0.42 * (1 - 0.65 / radius) : 0;
          roomCenter.x +=
            (cx * tracking - roomCenter.x) * (1 - Math.exp(-dt * 4));
          roomCenter.z +=
            (cz * tracking - roomCenter.z) * (1 - Math.exp(-dt * 4));
          const extra =
            (Math.max(0, radius - 0.65) * (0.7 / Math.tan(Math.PI / 12))) /
            Math.min(1, camera.aspect);
          roomDistance +=
            (Math.min(25, extra) - roomDistance) *
            (1 - Math.exp(-dt * (extra > roomDistance ? 9 : 2)));
        }
      }
      if (playMode === 'tabletop' || fixedCamera()) {
        roomCenter.set(0, 0, 0);
        roomDistance = 0;
      }
      const targetY = fixedCamera()
        ? MOBILE_TARGET_Y
        : STUDIO_TARGET_Y + flightFrame * 0.65;
      const distance =
        fixedCamera() && body.geometry.boundingBox
          ? fixedFrame.update(
              dt,
              camera.aspect,
              yaw,
              pitch,
              zoom,
              body.geometry.boundingBox,
              !!volume?.held || !!candies?.held,
            )
          : studioCameraDistance(camera.aspect) *
              (digestion ? 0.73 : absorption || contactStudy ? 0.82 : zoom) +
            // Full-height tabletop hops must also fit at the closest zoom,
            // including the saved maximum jump setting in landscape.
            flightFrame * (playMode === 'free' ? 0.8 : 1.2) +
            roomDistance;
      camera.position.set(
        roomCenter.x + Math.sin(yaw) * Math.cos(pitch) * distance,
        targetY + Math.sin(pitch) * distance,
        roomCenter.z + Math.cos(yaw) * Math.cos(pitch) * distance,
      );
      camera.lookAt(roomCenter.x, targetY, roomCenter.z);
      camera.updateMatrixWorld();
      body.updateWorldMatrix(true, false);
      for (const entry of bubbleOrder) {
        const b = entry.data;
        entry.position.fromArray(b.p);
        if (volume) volume.bubblePosition(entry.index, entry.position);
        else if (contactStudy)
          contactStudy.bubblePosition(entry.index, entry.position);
        else if (absorption) absorption.bubblePosition(entry.position);
        else
          for (let k = 0; k < 3; k++)
            for (let j = 0; j < 3; j++)
              entry.position.setComponent(
                j,
                entry.position.getComponent(j) +
                  (b.poses[k][j] - b.p[j]) * weights[k],
              );
        entry.depth = bubbleView
          .copy(entry.position)
          .applyMatrix4(body.matrixWorld)
          .applyMatrix4(camera.matrixWorldInverse).z;
      }
      // Instanced transparent meshes are not sorted by Three. Draw air bubbles
      // back to front so overlapping rims retain their proper optical order.
      bubbleOrder.sort((a, b) => a.depth - b.depth);
      bubbleOrder.forEach((entry, i) => {
        dummy.position.copy(entry.position);
        dummy.scale.setScalar(entry.data.r);
        dummy.updateMatrix();
        bubbles.setMatrixAt(i, dummy.matrix);
      });
      bubbles.instanceMatrix.needsUpdate = true;
      try {
        if (mode === 'gel') {
          optics.render(renderer, camera);
          candyOptics?.render(renderer, camera, body);
        }
        renderCheck?.apply(body);
        renderer.render(scene, camera);
      } catch {
        fail();
        return;
      }
      if (firstFrame) {
        firstFrame = false;
        callbacks.onReady();
      }
      frames++;
      frameIndex++;
      if (gpuTimingEnabled && !gpuPending && frameIndex % 15 === 0) {
        gpuPending = true;
        const epoch = measurementEpoch;
        gpuResolution = renderer
          .resolveTimestampsAsync()
          .then((duration) => {
            // Three 0.183 retains every resolved pass UID. The default inspector
            // does not need this history; bound it during opt-in QA profiling.
            (
              renderer.backend as unknown as {
                timestampQueryPool: {
                  render?: { timestamps: Map<string, number> };
                };
              }
            ).timestampQueryPool.render?.timestamps.clear();
            if (
              closed ||
              epoch !== measurementEpoch ||
              duration === undefined ||
              !Number.isFinite(duration)
            )
              return;
            gpuMs = duration;
            gpuSamples.push(duration);
            if (gpuSamples.length > 120) gpuSamples.shift();
          })
          .catch(() => {})
          .finally(() => {
            gpuPending = false;
            gpuResolution = null;
          });
      }
      if (now - sampleTime > 1000) {
        const fps = Math.round((frames * 1000) / (now - sampleTime));
        // Change resolution only after sustained pressure and between gestures.
        // Background throttling and long pauses are not hardware measurements.
        if (mobileExperience && !sampleInterrupted) {
          slowSamples = fps < 48 ? slowSamples + 1 : 0;
          fastSamples = fps >= 58 ? fastSamples + 1 : 0;
          if (
            !volume?.held &&
            !candies?.held &&
            touches.size === 0 &&
            pointer === null &&
            now - lastQualityChange > 4000
          ) {
            const next =
              slowSamples >= 2
                ? Math.max(0.7, qualityScale - 0.1)
                : fastSamples >= 8
                  ? Math.min(1, qualityScale + 0.1)
                  : qualityScale;
            if (Math.abs(next - qualityScale) > 0.01) {
              qualityScale = next;
              lastQualityChange = now;
              slowSamples = fastSamples = 0;
              resize();
            }
          }
        }
        sampleInterrupted = false;
        callbacks.onStats(fps);
        host.dataset.studio = JSON.stringify({
          backend: 'WebGPU',
          fps,
          mode,
          pigment: pigment?.state ?? null,
          absorption: absorption
            ? {
                ...absorption.timeline.frame,
                playing: absorption.timeline.playing,
                speed: absorption.timeline.speed,
              }
            : null,
          pose,
          motion,
          weights,
          yaw,
          pitch,
          zoom,
          cameraLocked,
          cameraTarget: [roomCenter.x, targetY, roomCenter.z],
          cameraDistance: distance,
          bodyBounds: body.geometry.boundingBox,
          qualityScale,
          pixelRatio: renderer.getPixelRatio(),
          opticsScale: mobileExperience ? 0.8 : 1,
          canvas: [canvas.width, canvas.height],
          bubbles: bubbleData.length,
          softbody: volume?.stats() ?? null,
          contactStudy: contactStudy?.stats() ?? null,
          gameIntake: gameIntake?.stats() ?? null,
          digestion: digestion?.stats() ?? null,
          candies: candies?.stats() ?? null,
          gpu: {
            lastMs: gpuMs,
            p95Ms: gpuSamples.length
              ? [...gpuSamples].sort((a, b) => a - b)[
                  Math.floor((gpuSamples.length - 1) * 0.95)
                ]
              : null,
            samples: gpuSamples.length,
          },
        });
        sampleTime = now;
        frames = 0;
      }
    };
    void renderer.setAnimationLoop(draw);
    return {
      setContact(v) {
        contactStudy?.configure(v);
        if (contactStudy && v.location) {
          targetYaw = v.location === 'side' ? -1.05 : -0.5;
          targetPitch = v.location === 'crown' ? 0.5 : 0.12;
          callbacks.onViewChange(null);
          resetMeasurement();
        }
        if (contactStudy) callbacks.onContact?.(contactStudy.stats());
      },
      setDigestion(v) {
        digestion?.configure(v);
        if (digestion) callbacks.onDigestion?.(digestion.stats());
      },
      setAbsorption(v) {
        if (!absorption) return;
        absorption.timeline.configure(v);
        const f = absorption.update(0);
        callbacks.onAbsorption?.(f, absorption.timeline.playing);
        resetMeasurement();
      },
      spawnCandy(kind) {
        if (
          volume?.held ||
          pointer !== null ||
          candies?.held ||
          orbitGesture ||
          touches.size > 0
        )
          return false;
        const ok = candies?.spawn(kind) ?? false;
        notifyCandyCount();
        return ok;
      },
      beginCandy(kind, event, owner) {
        if (
          volume?.held ||
          pointer !== null ||
          candies?.held ||
          orbitGesture ||
          touches.size > 0
        )
          return false;
        volume?.pointerLeave();
        const ok = candies?.beginTray(kind, event, owner) ?? false;
        if (ok && event.pointerType === 'touch')
          touches.down(event.pointerId, event.clientX, event.clientY);
        notifyCandyCount();
        return ok;
      },
      moveCandy(event) {
        queueMove(event);
      },
      releaseCandy(event, cancelled) {
        if (orbitGesture && event.type === 'lostpointercapture') return;
        if (cancelled) pointerMoves.clear();
        else pointerMoves.flush(move);
        if (orbitGesture) {
          up(event);
          return;
        }
        touches.up(event.pointerId);
        candies?.up(event, cancelled);
      },
      clearCandies() {
        candies?.clear();
        notifyCandyCount();
      },
      setTuning(values) {
        volume?.setTuning(values);
      },
      setExpression(values) {
        volume?.setExpression(values);
      },
      blink() {
        volume?.expression.blink();
      },
      react(event, amount) {
        if (event === 'stroke') volume?.stroke(Math.min(0.6, amount ?? 0.6));
        else volume?.expression.notify(event, amount);
      },
      poke() {
        volume?.poke();
      },
      drop() {
        volume?.drop();
      },
      resetBody() {
        gameIntake?.clear();
        volume?.reset();
      },
      setPlayMode(next) {
        if (next === playMode) return;
        cancelDrag();
        gameIntake?.clear();
        candies?.clear();
        volume?.reset();
        playMode = next;
        host.dataset.playMode = next;
        if (volume) canvas.setAttribute('aria-label', playHint());
        volume?.setPlayMode(next);
        candies?.setPlayMode(next);
        resetView();
        notifyCandyCount();
      },
      setCameraLocked(locked) {
        cancelDrag();
        cameraLocked = locked;
        host.dataset.cameraLocked = String(locked);
        resetView();
        if (volume) canvas.setAttribute('aria-label', playHint());
      },
      tip() {
        volume?.tip();
      },
      setRecoveryEnabled(enabled) {
        volume?.setRecoveryEnabled(enabled);
      },
      setBreathing(enabled) {
        volume?.motor.setBreathing(enabled);
      },
      setView,
      resetView,
      setPigment(id, amount) {
        if (!pigment) return;
        pigment.configure(id, amount);
        if (mode === 'gel')
          body.material =
            absorption ||
            contactStudy ||
            digestion ||
            gameIntake ||
            pigment.amount.value > 0
              ? dyedGel
              : gel;
        bubbles.material =
          absorption ||
          contactStudy ||
          digestion ||
          gameIntake ||
          pigment.amount.value > 0
            ? dyedBubble
            : originalBubble;
        resetMeasurement();
      },
      selectColor(id, strength, hue) {
        gameIntake?.selectColor(id, strength, hue);
        callbacks.onFeeding?.(gameIntake?.stats().stage ?? 'idle', id);
      },
      saveColor() {
        return gameIntake?.saveColor();
      },
      restoreColor(value) {
        gameIntake?.restoreColor(value);
        if (gameIntake)
          callbacks.onFeeding?.(
            gameIntake.stats().stage,
            gameIntake.stats().pigment.base,
          );
      },
      setCandyPigment(id) {
        candies?.setPigment(id);
      },
      colorAppearance() {
        return (
          absorptionField?.appearance ?? { id: 'rose', strength: 100, hue: 0 }
        );
      },
      alignReference(v, p) {
        // A paused breath can retain a nonzero shape. Reset every shared morph
        // so the physical reference and the live asset use the same geometry.
        motion = false;
        time = 0;
        pose = p;
        weights[0] = 0;
        weights[1] = p === 'squash' ? 1 : 0;
        weights[2] = 0;
        mode = 'gel';
        body.material =
          absorption ||
          contactStudy ||
          digestion ||
          gameIntake ||
          (pigment && pigment.amount.value > 0)
            ? dyedGel
            : gel;
        setView(v);
        yaw = targetYaw;
        pitch = targetPitch;
      },
      setMaterial(v) {
        resetMeasurement();
        mode = v;
        body.material =
          v === 'gel'
            ? absorption ||
              contactStudy ||
              digestion ||
              gameIntake ||
              (pigment && pigment.amount.value > 0)
              ? dyedGel
              : gel
            : clay;
      },
      setMotion(v) {
        resetMeasurement();
        motion = v;
      },
      setPose(v) {
        resetMeasurement();
        pose = v;
      },
      dispose,
    };
  } catch (error) {
    closed = true;
    void renderer.setAnimationLoop(null);
    resources.forEach((r) => r.dispose());
    renderer.dispose();
    throw error;
  }
}
