import * as THREE from 'three/webgpu';
import { ContactCandy } from './contact-candy.ts';
import { ContactIntake } from './contact-intake.ts';
import type { SlimeOptics } from './slime-optics';
import type { AbsorptionInterior } from './absorption-interior';
import type { AbsorptionField } from './absorption-field';
import { createCage, type Binding } from './softbody/cage.ts';
import { VolumeSoftBody } from './softbody/solver.ts';
import { EmbeddedSurface, sampleBinding } from './softbody/surface.ts';
import { ContactShell } from './softbody/contact-shell.ts';
import { ExpressionRig, type ExpressionId } from './softbody/expression.ts';

const CONTACT_STEP = 1 / 120;

export type ContactLocation = 'front' | 'side' | 'crown' | 'custom';
export type ContactCommand = {
  intake?: 'start' | 'pause' | 'resume' | 'reset' | 'step';
  location?: Exclude<ContactLocation, 'custom'>;
  depth?: number;
  angle?: number;
};
export type ContactSnapshot = {
  location: ContactLocation;
  depth: number;
  angle: number;
  face: ExpressionId;
  phase: string;
  indent: number;
  contacts: number;
  reaction: number;
  physicsMs: number;
  intake: ReturnType<ContactIntake['frame']> & { paused: boolean };
};

export class StudioContact {
  readonly solver: VolumeSoftBody;
  readonly shell: ContactShell;
  readonly expression: ExpressionRig;
  private surface: EmbeddedSurface;
  private body: THREE.Mesh;
  private camera: THREE.Camera;
  private canvas: HTMLCanvasElement;
  private candy: THREE.Mesh;
  private candyVisual: ContactCandy;
  private intake = new ContactIntake({ cohesive: true });
  private paused = false;
  private pauseAtTransition = false;
  private field?: AbsorptionField;
  private reference: THREE.Mesh;
  private bubbles: Binding[];
  private resources: { dispose(): void }[] = [];
  private anchor = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private orientation = new THREE.Quaternion();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private cursor: number | null = null;
  private startY = 0;
  private startDepth = 0;
  private accumulator = 0;
  private pressureAge = 0;
  private reliefAge = Infinity;
  private wasContact = false;
  private contactMemory = 0;
  private roll = 0;
  private location: ContactLocation = 'front';
  private depth = 0;
  private angle = 0;
  private physicsMs = 0;
  private face: ExpressionId = 'curious';
  private configuredFace: ExpressionId = 'curious';
  private phase = '等你轻轻碰一下';
  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    body: THREE.Mesh,
    parts: THREE.Mesh[],
    bubbles: { p: number[] }[],
    scene: THREE.Scene,
    environment: THREE.Texture,
    render?: {
      optics: SlimeOptics;
      interior: AbsorptionInterior;
      field: AbsorptionField;
    },
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.body = body;
    const position = body.geometry.attributes.position.array;
    const cage = createCage(
      JSON.parse(body.userData.optical_profile),
      position,
    );
    this.solver = new VolumeSoftBody(cage, {
      gravity: 0,
      shear: 240,
      bulk: 12000,
      damping: 12,
    });
    this.shell = new ContactShell(
      cage,
      position,
      body.geometry.attributes.normal.array,
      body.geometry.index!.array,
    );
    this.surface = new EmbeddedSurface(body.geometry, cage);
    this.expression = new ExpressionRig(body.geometry, parts);
    this.expression.configure({
      responsive: false,
      expression: 'curious',
      intensity: 100,
      speed: 85,
    });
    this.bubbles = bubbles.map((b) => cage.bind(b.p));
    const referenceGeometry = body.geometry.clone(),
      referenceMaterial = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
      });
    this.reference = new THREE.Mesh(referenceGeometry, referenceMaterial);
    this.reference.updateMatrixWorld();
    this.candyVisual = new ContactCandy(
      scene,
      environment,
      render?.optics,
      render?.interior,
    );
    this.candy = this.candyVisual.exterior;
    this.field = render?.field;
    this.resources.push(referenceGeometry, referenceMaterial, this.candyVisual);
    this.select('front');
  }
  get held() {
    return this.cursor !== null;
  }
  configure(command: ContactCommand) {
    if (command.intake === 'pause') this.paused = true;
    if (command.intake === 'resume') this.paused = false;
    if (command.intake === 'resume') this.pauseAtTransition = false;
    if (command.intake === 'step') {
      this.paused = false;
      this.pauseAtTransition = true;
    }
    if (command.intake === 'reset') {
      this.cancel();
      this.anchorAt(this.anchor.clone(), this.normal.clone());
    }
    if (
      command.location &&
      ['idle', 'done'].includes(this.intake.frame().stage)
    )
      this.select(command.location);
    if (this.intake.frame().stage === 'idle') {
      if (command.depth !== undefined && Number.isFinite(command.depth))
        this.depth = THREE.MathUtils.clamp(command.depth, 0, 100);
      if (command.angle !== undefined && Number.isFinite(command.angle))
        this.angle = THREE.MathUtils.clamp(command.angle, 0, 90);
    }
    if (
      (command.intake === 'start' || command.intake === 'step') &&
      ['idle', 'done'].includes(this.intake.frame().stage)
    ) {
      this.cancel();
      if (this.intake.frame().stage === 'done')
        this.anchorAt(this.anchor.clone(), this.normal.clone());
      const offset = new THREE.Vector3()
        .fromArray(this.shell.candy.position)
        .sub(this.anchor)
        .dot(this.normal);
      this.intake.start(offset);
      this.paused = false;
    }
    if (command.intake === 'step') {
      // Inspection advances the same fixed-step solve, independent of whether
      // the browser schedules this tab in the foreground. No pose is teleported.
      for (let i = 0; i < 60 && !this.paused; i++) this.update(1 / 60);
      this.paused = true;
    }
  }
  private anchorAt(point: THREE.Vector3, normal: THREE.Vector3) {
    this.pauseAtTransition = false;
    this.intake.reset();
    this.paused = false;
    this.shell.permeability = 0;
    this.depth = 0;
    this.anchor.copy(point);
    this.normal.copy(normal).normalize();
    this.shell.setRegion(this.anchor.toArray());
    this.shell.rim.bind(
      this.reference.geometry.attributes.position.array,
      this.anchor.toArray(),
      this.normal.toArray(),
      this.shell.candy.half,
    );
    this.shell.rim.point.set(this.anchor.toArray());
    this.shell.skin.bind(this.shell.rim.movable);
    this.shell.rim.normal.set(this.normal.toArray());
    this.orientation.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.normal,
    );
    this.shell.candy.position.set(
      this.anchor.clone().addScaledVector(this.normal, 0.3).toArray(),
    );
    this.shell.candy.target.set(this.shell.candy.position);
    this.shell.candy.velocity.fill(0);
    this.reliefAge = Infinity;
    this.pressureAge = 0;
    this.wasContact = false;
    this.contactMemory = 0;
  }
  private select(location: Exclude<ContactLocation, 'custom'>) {
    const origins = {
      front: [-0.6, 1.2, 5],
      side: [-5, 1.2, 0],
      crown: [0, 5, 0],
    };
    const directions = {
      front: [0, 0, -1],
      side: [1, 0, 0],
      crown: [0, -1, 0],
    };
    this.ray.set(
      new THREE.Vector3(...origins[location]),
      new THREE.Vector3(...directions[location]),
    );
    const hit = this.ray.intersectObject(this.reference)[0];
    if (hit) {
      this.location = location;
      this.anchorAt(hit.point, hit.normal!);
    }
  }
  pointerDown(e: PointerEvent) {
    if (this.intake.frame().stage !== 'idle') return false;
    if (e.button !== 0 || this.held) return false;
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      1 - ((e.clientY - r.top) / r.height) * 2,
    );
    this.ray.setFromCamera(this.ndc, this.camera);
    const candyHit = this.ray.intersectObject(this.candy)[0];
    const hit = this.ray.intersectObject(this.body)[0];
    if (!hit && !candyHit) return false;
    if (hit && (!candyHit || hit.distance < candyHit.distance)) {
      this.location = 'custom';
      // Pick the visible deformed triangle, then map its barycentric location
      // to the rest surface used by this supported-pose contact coordinate.
      const ids = [hit.face!.a, hit.face!.b, hit.face!.c];
      const surface = this.body.geometry.attributes.position;
      const triangle = new THREE.Triangle(
        ...(ids.map((id) =>
          new THREE.Vector3().fromBufferAttribute(surface, id),
        ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
      );
      const bary = triangle.getBarycoord(
        this.body.worldToLocal(hit.point.clone()),
        new THREE.Vector3(),
      )!;
      const rest = this.reference.geometry.attributes.position;
      const normals = this.reference.geometry.attributes.normal;
      const point = new THREE.Vector3(),
        normal = new THREE.Vector3();
      ids.forEach((id, k) => {
        point.addScaledVector(
          new THREE.Vector3().fromBufferAttribute(rest, id),
          bary.getComponent(k),
        );
        normal.addScaledVector(
          new THREE.Vector3().fromBufferAttribute(normals, id),
          bary.getComponent(k),
        );
      });
      this.anchorAt(point, normal);
    }
    this.cursor = e.pointerId;
    this.startY = e.clientY;
    this.startDepth = Math.max(this.depth, 65);
    this.depth = this.startDepth;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return true;
  }
  pointerMove(e: PointerEvent) {
    if (e.pointerId !== this.cursor) return false;
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      this.cancel();
      return true;
    }
    this.depth = THREE.MathUtils.clamp(
      this.startDepth + (e.clientY - this.startY) * 0.55,
      0,
      100,
    );
    e.preventDefault();
    return true;
  }
  pointerUp(e: PointerEvent) {
    if (e.pointerId !== this.cursor) return false;
    this.cancel();
    return true;
  }
  cancel() {
    const id = this.cursor;
    this.cursor = null;
    if (this.intake.frame().stage === 'idle') this.depth = 0;
    if (id !== null && this.canvas.hasPointerCapture(id))
      this.canvas.releasePointerCapture(id);
  }
  update(elapsed: number) {
    if (this.paused) return;
    const dt = Math.max(
      0,
      Math.min(0.05, Number.isFinite(elapsed) ? elapsed : 0),
    );
    this.roll +=
      ((this.angle * Math.PI) / 180 - this.roll) * (1 - Math.exp(-dt * 10));
    this.candy.quaternion
      .copy(this.orientation)
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          this.roll,
        ),
      );
    this.shell.candy.rotation.set(this.candy.quaternion.toArray());
    const previousIntake = this.intake.frame();
    const intakeActive = previousIntake.stage !== 'idle';
    const burial =
      -new THREE.Vector3()
        .fromArray(this.shell.candy.position)
        .sub(this.anchor)
        .dot(this.normal) - this.shell.candy.half;
    const flow = this.intake.update(dt, {
      contact: this.shell.contacting,
      burial,
      indent: this.shell.stats().maxIndent,
      coverage: this.shell.rim.coverage,
    });
    this.shell.rim.amount = flow.wrap;
    if (this.pauseAtTransition && flow.stage !== previousIntake.stage) {
      this.paused = true;
      this.pauseAtTransition = false;
    }
    this.shell.permeability = flow.permeability;
    this.shell.rim.release = flow.permeability;
    if (intakeActive)
      this.depth = THREE.MathUtils.clamp(
        ((0.3 - flow.offset) / 0.35) * 100,
        0,
        100,
      );
    this.shell.candy.target.set(
      this.anchor
        .clone()
        .addScaledVector(
          this.normal,
          intakeActive ? flow.offset : 0.3 - (this.depth / 100) * 0.35,
        )
        .toArray(),
    );
    this.accumulator = Math.min(0.05, this.accumulator + dt);
    const before = performance.now();
    let measuredContact = false;
    while (this.accumulator >= CONTACT_STEP) {
      this.shell.beginStep(CONTACT_STEP, this.solver);
      this.solver.step(CONTACT_STEP, (step, it) =>
        this.shell.project(step, this.solver, it),
      );
      this.shell.endStep(CONTACT_STEP, this.solver);
      measuredContact ||= this.shell.contacting;
      this.accumulator -= CONTACT_STEP;
    }
    this.physicsMs = performance.now() - before;
    this.surface.update(this.solver.x, this.solver.nodalTransforms());
    this.shell.apply(
      this.body.geometry.attributes.position.array as Float32Array,
    );
    // Every optical boundary reads this same deformed geometry.
    const s = this.shell.stats();
    if (
      s.maxIndent > 0.00001 ||
      s.maxOutward > 0.00001 ||
      s.rimOffset > 0.00001
    )
      this.body.geometry.computeVertexNormals();
    this.body.geometry.attributes.position.needsUpdate = true;
    this.body.geometry.computeBoundingBox();
    this.body.geometry.computeBoundingSphere();
    this.candy.position.fromArray(this.shell.candy.position);
    this.candyVisual.update(flow.dissolve);
    if (this.field) {
      this.field.source.value.copy(this.candy.position);
      this.field.updateDigestion(flow);
    }
    this.contactMemory = measuredContact
      ? 0.08
      : Math.max(0, this.contactMemory - dt);
    const contact =
      this.contactMemory > 0 && s.localIndent > 0.015 && this.depth > 20;
    if (contact && !this.wasContact) {
      this.pressureAge = 0;
      this.expression.blink();
    }
    if (!contact && this.wasContact) this.reliefAge = 0;
    this.pressureAge = contact ? this.pressureAge + dt : 0;
    this.reliefAge += dt;
    this.wasContact = contact;
    this.face = contact
      ? this.pressureAge < 0.2
        ? 'surprised'
        : s.localIndent > 0.105
          ? 'effort'
          : 'shy'
      : this.reliefAge < 1.5
        ? 'soothed'
        : 'curious';
    this.phase = contact
      ? s.localIndent > 0.105
        ? '呜，挤扁一点点'
        : '嗯？碰到我啦'
      : this.reliefAge < 1.5
        ? '呼，慢慢弹回来'
        : '等你轻轻碰一下';
    if (intakeActive) {
      const response = {
        pressing: ['surprised', '嗯？是小糖果'],
        wrapping: ['effort', '先软软地包住它'],
        entering: ['effort', '轻轻地，让它进来'],
        sealing: ['shy', '软软地合拢'],
        inside: ['content', '在身体里面啦'],
        dissolving: ['happy', '甜味慢慢化开'],
        settling: ['soothed', '变成我的一部分'],
        done: ['happy', '又变甜了一点'],
      } as const;
      const r = response[flow.stage as keyof typeof response];
      if (r) {
        this.face = r[0];
        this.phase = r[1];
      }
    }
    this.expression.configure({
      ...(this.face !== this.configuredFace ? { expression: this.face } : {}),
      intensity: contact ? 100 : 85,
    });
    this.configuredFace = this.face;
    this.expression.look(
      this.normal.x * 0.8 + this.anchor.x * 0.35,
      this.location === 'crown' ? 0.8 : 0.15,
    );
    this.expression.update(dt);
  }
  bubblePosition(index: number, out: THREE.Vector3) {
    sampleBinding(this.bubbles[index], this.solver.x, out);
  }
  stats(): ContactSnapshot {
    const s = this.shell.stats();
    return {
      location: this.location,
      depth: this.depth,
      angle: this.angle,
      face: this.face,
      phase: this.phase,
      indent: s.maxIndent,
      contacts: s.contacts,
      reaction: s.reaction,
      physicsMs: this.physicsMs,
      intake: { ...this.intake.frame(), paused: this.paused },
    };
  }
  dispose() {
    this.cancel();
    this.candy.removeFromParent();
    this.resources.forEach((r) => r.dispose());
  }
}
