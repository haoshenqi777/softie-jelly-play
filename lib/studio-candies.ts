import * as THREE from 'three/webgpu';
import {
  CandyWorld,
  candySupport,
  type CandyKind,
  type CandyCollider,
  type CandyBody,
} from './candy-physics.ts';
import { CandyRenderer } from './candy-renderer.ts';
import { CandyContact } from './candy-contact.ts';
import { PIGMENTS, validPigment, type PigmentId } from './studio-pigment.ts';
import { PLAY_CANDY_LIMIT } from './play-limits.ts';
import type { PlayMode } from './play-mode.ts';

export class StudioCandies {
  private playMode: PlayMode = 'free';
  setPlayMode(mode: PlayMode) {
    this.playMode = mode;
    const reach = mode === 'tabletop' ? 2.35 : 6;
    Object.assign(this.world.bounds, { x: reach, zMin: -reach, zMax: reach });
  }
  private selectedPigment: PigmentId | null = null;
  setPigment(id: PigmentId) {
    this.selectedPigment = validPigment(id);
  }
  readonly world = new CandyWorld();
  onContact?: CandyCollider['capture'];
  onHandContact?: CandyCollider['capture'];
  onHandContactAllowed?: (hit: THREE.Intersection) => boolean;
  onHandPressure?: (depth: number) => void;
  onHandRelease?: (cancelled: boolean) => void;
  onClear?: () => void;
  onTap?: (id: number) => void;
  onMeshCreated?: (candy: CandyBody, mesh: THREE.Mesh) => void;
  onMeshRemoved?: (id: number) => void;
  mesh(id: number) {
    return this.renderer.mesh(id);
  }
  remove(id: number) {
    if (this.pending?.id === id) this.cancel();
    this.world.remove(id);
    this.renderer.update(this.world.candies);
  }
  private canvas: HTMLCanvasElement;
  private camera: THREE.Camera;
  private renderer: CandyRenderer;
  private shell: CandyContact;
  private body: THREE.Mesh;
  private handStartY = 0;
  private handY = 0;
  private handCandidate = false;
  private handApproach = new THREE.Vector3();
  private pointer: number | null = null;
  private pending: {
    id: number;
    x: number;
    y: number;
    time: number;
    threshold: number;
  } | null = null;
  private cueAge = 1;
  private dropCount = 0;
  private readonly cue = new THREE.Mesh(
    new THREE.RingGeometry(0.23, 0.26, 48),
    new THREE.MeshBasicNodeMaterial({
      color: 0xbc8b91,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  private capture: HTMLElement | null = null;
  private lastMove = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane();
  private point = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private center = new THREE.Vector3();
  private ndc = new THREE.Vector2();
  private disposed = false;
  private onLost = () => this.cancel();
  private onCaptureLost = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.cancel();
  };
  private onVisibility = () => {
    if (document.hidden) this.cancel();
  };
  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    scene: THREE.Scene,
    body: THREE.Mesh,
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.body = body;
    this.cue.rotation.x = -Math.PI / 2;
    this.cue.visible = false;
    scene.add(this.cue);
    this.renderer = new CandyRenderer(scene);
    this.renderer.onCreate = (candy, mesh) => this.onMeshCreated?.(candy, mesh);
    this.renderer.onRemove = (id) => this.onMeshRemoved?.(id);

    this.world.bounds = { x: 6, zMin: -6, zMax: 6 };
    this.shell = new CandyContact(body, this.world.bounds);
    if (typeof window !== 'undefined')
      window.addEventListener('blur', this.onLost);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.onVisibility);
  }
  get held() {
    return this.pointer !== null;
  }
  private dropPosition() {
    this.shell.update();
    this.shell.bounds.getCenter(this.center);
    // Camera-side diagonal provides a clear reachable floor location outside skin.
    this.camera.getWorldPosition(this.point).sub(this.center);
    this.point.y = 0;
    if (this.point.lengthSq() < 0.001) this.point.set(0, 0, 1);
    this.point.normalize();
    const size = this.shell.bounds.getSize(this.normal);
    const radius =
      this.playMode === 'tabletop'
        ? 2
        : Math.hypot(size.x, size.z) * 0.5 + 0.38;
    const angle = [-0.38, 0.38, 0][this.dropCount++ % 3];
    const front = radius * Math.cos(angle);
    const side = radius * Math.sin(angle);
    return {
      x: this.center.x + this.point.x * front + this.point.z * side,
      y: this.playMode === 'tabletop' ? 0.65 : 0.95,
      z: this.center.z + this.point.z * front - this.point.x * side,
    };
  }
  spawn(kind: CandyKind) {
    if (this.disposed || this.world.candies.length >= PLAY_CANDY_LIMIT)
      return false;
    const pigment =
      this.selectedPigment ??
      (kind === 'cube'
        ? 'peach'
        : kind === 'round'
          ? 'sky'
          : kind === 'gummy'
            ? 'mint'
            : 'honey');
    const candy = this.world.spawn(
      PIGMENTS.find((p) => p.id === pigment)!.swatch,
      kind,
      this.dropPosition(),
      undefined,
      0.18,
    );
    candy.pigment = pigment;
    this.renderer.update(this.world.candies);
    return true;
  }
  private ray(event: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((event.clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      1 - ((event.clientY - r.top) / Math.max(1, r.height)) * 2,
    );
    this.camera.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }
  private own(id: number, event: PointerEvent, owner?: HTMLElement) {
    const candidate = owner ?? (event.currentTarget as HTMLElement | null);
    const target =
      candidate && typeof candidate.setPointerCapture === 'function'
        ? candidate
        : this.canvas;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      return false;
    }
    if (!this.world.grab(id)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {}
      return false;
    }
    this.pointer = event.pointerId;
    this.handCandidate = false;
    this.capture = target;
    this.lastMove = event.timeStamp;
    target.addEventListener('lostpointercapture', this.onCaptureLost);
    const candy = this.world.get(id)!;
    this.camera.getWorldDirection(this.normal);
    this.plane.setFromNormalAndCoplanarPoint(
      this.normal,
      this.point.set(candy.x, Math.max(0.55, candy.y), candy.z),
    );
    return true;
  }
  beginTray(kind: CandyKind, event: PointerEvent, owner?: HTMLElement) {
    const primaryGesture =
      event.button === 0 || (event.button === -1 && event.buttons === 1);
    if (this.held || !primaryGesture || !this.spawn(kind)) return false;
    const candy = this.world.candies[this.world.candies.length - 1];
    if (!this.own(candy.id, event, owner)) {
      this.world.remove(candy.id);
      this.renderer.update(this.world.candies);
      return false;
    }
    this.move(event);
    return true;
  }
  down(event: PointerEvent) {
    if (this.disposed || this.held || event.button !== 0) return false;
    this.ray(event);
    this.shell.update();
    this.renderer.update(this.world.candies);
    const r = this.canvas.getBoundingClientRect(),
      tolerance = event.pointerType === 'touch' ? 25 : 15;
    let selected: number | null = null,
      best = Infinity;
    for (const candy of this.world.candies) {
      if (candy.mode !== 'free' || candy.contactHeld) continue;
      this.point.set(candy.x, candy.y, candy.z);
      const distance = this.point.distanceTo(this.raycaster.ray.origin);
      this.point.project(this.camera);
      if (this.point.z < -1 || this.point.z > 1) continue;
      const pixels = Math.hypot(
        (this.point.x - this.ndc.x) * r.width * 0.5,
        (this.point.y - this.ndc.y) * r.height * 0.5,
      );
      const mesh = this.renderer.mesh(candy.id)!;
      mesh.updateWorldMatrix(true, false);
      const direct = this.raycaster.intersectObject(mesh, false).length > 0;
      if (!direct && pixels > tolerance) continue;
      // Check ray toward candy, including fallback picks beside its tiny mesh.
      this.point.set(candy.x, candy.y, candy.z);
      const ray = new THREE.Ray(
        this.raycaster.ray.origin.clone(),
        this.point.clone().sub(this.raycaster.ray.origin).normalize(),
      );
      if (this.shell.occludes(ray, distance - candy.radius)) continue;
      const score = direct ? distance * 0.001 : pixels + 1;
      if (score < best) {
        best = score;
        selected = candy.id;
      }
    }
    if (selected === null) return false;
    const c = this.world.get(selected)!;
    if (c.y > c.radius + 0.09) return this.own(selected, event);
    // Reserve input, but do not lift the candy until a real drag is intended.
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      return false;
    }
    this.pointer = event.pointerId;
    this.capture = this.canvas;
    this.canvas.addEventListener('lostpointercapture', this.onCaptureLost);
    this.pending = {
      id: selected,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      threshold: event.pointerType === 'touch' ? 8 : 5,
    };
    c.pointerPending = true;
    return true;
  }
  move(event: PointerEvent) {
    if (this.pointer !== event.pointerId) return false;
    if (this.pending) {
      const p = this.pending;
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < p.threshold)
        return true;
      const c = this.world.get(p.id);
      if (c) c.pointerPending = false;
      this.pending = null;
      if (!this.own(p.id, event, this.canvas)) {
        this.finish(true);
        return true;
      }
    }
    this.handY = event.clientY;
    const candy = this.world.get(this.world.heldId);
    if (candy?.contactHeld) {
      this.onHandPressure?.((event.clientY - this.handStartY) * 0.85);
      this.lastMove = event.timeStamp;
      return true;
    }
    this.ray(event);
    if (this.raycaster.ray.intersectPlane(this.plane, this.point)) {
      this.point.y = Math.max(
        0.15,
        Math.min(this.playMode === 'tabletop' ? 3 : 5, this.point.y),
      );
      this.world.moveHeld(
        this.point,
        Math.max(0.008, (event.timeStamp - this.lastMove) / 1000),
      );
      this.lastMove = event.timeStamp;
    }
    // Surface approach runs once in update with elapsed time. Pointer frequency
    // must not multiply mesh raycasts or accelerate the attachment spring.
    return true;
  }
  private approachHand(dt: number) {
    const candy = this.world.get(this.world.heldId);
    if (!candy || candy.contactHeld || !this.onHandContact) return;
    this.body.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObject(this.body, false)[0];
    if (!hit?.face || this.onHandContactAllowed?.(hit) === false) {
      this.handCandidate = false;
      return;
    }
    if (!this.handCandidate) {
      this.handCandidate = true;
      this.handApproach.set(candy.x, candy.y, candy.z);
    }
    const normal = hit.face.normal
      .clone()
      .transformDirection(this.body.matrixWorld);
    const support = candySupport(candy, normal);
    const target = hit.point.clone().addScaledVector(normal, support * 0.9);
    this.handApproach.lerp(target, 1 - Math.exp(-Math.max(0.001, dt) * 12));
    this.world.moveHeld(this.handApproach, Math.max(0.008, dt));
    if (
      hit.point.distanceTo(new THREE.Vector3(candy.x, candy.y, candy.z)) <=
        support + 0.06 &&
      this.onHandContact(candy, hit.point, normal)
    ) {
      this.handStartY = this.handY;
      this.onHandPressure?.(0);
    }
  }
  up(event: PointerEvent, cancelled = false) {
    if (this.pointer !== event.pointerId) return false;
    if (this.pending) {
      const p = this.pending,
        c = this.world.get(p.id);
      const tap =
        !cancelled &&
        event.timeStamp - p.time < 400 &&
        Math.hypot(event.clientX - p.x, event.clientY - p.y) < p.threshold &&
        c?.mode === 'free' &&
        c.y <= c.radius + 0.09;
      this.finish(true);
      if (tap && c) {
        this.cue.position.set(c.x, 0.009, c.z);
        this.cueAge = 0;
        this.cue.visible = true;
        this.onTap?.(c.id);
      }
      return true;
    }
    this.finish(cancelled, event.timeStamp - this.lastMove > 140);
    return true;
  }
  private finish(cancelled: boolean, stale = false) {
    if (this.pending) {
      const c = this.world.get(this.pending.id);
      if (c) c.pointerPending = false;
      this.pending = null;
    }
    const id = this.pointer,
      target = this.capture,
      candy = this.world.get(this.world.heldId);
    this.pointer = null;
    this.handCandidate = false;
    this.capture = null;
    target?.removeEventListener('lostpointercapture', this.onCaptureLost);
    const contact = candy?.contactHeld;
    if (contact) this.onHandRelease?.(cancelled);
    this.world.release();
    if (this.playMode === 'tabletop' && candy && candy.mode === 'free') {
      const gain = Math.min(1, 1.25 / (Math.hypot(candy.vx, candy.vz) || 1));
      candy.vx *= gain;
      candy.vz *= gain;
      candy.vy = Math.max(-2, Math.min(1.5, candy.vy));
    }
    if ((cancelled || stale || contact) && candy && candy.mode !== 'merging')
      candy.vx = candy.vy = candy.vz = candy.wx = candy.wy = candy.wz = 0;
    if (target && id !== null) {
      try {
        if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
      } catch {}
    }
  }
  cancel() {
    if (this.held) this.finish(true);
  }
  clear() {
    this.cancel();
    this.onClear?.();
    this.world.reset();
    this.renderer.update(this.world.candies);
  }
  update(dt: number) {
    if (this.cue.visible) {
      this.cueAge += dt;
      this.cue.scale.setScalar(1 + this.cueAge * 1.3);
      this.cue.material.opacity = 0.45 * Math.max(0, 1 - this.cueAge / 0.8);
      this.cue.visible = this.cueAge < 0.8;
    }
    if (this.disposed || this.world.candies.length === 0) return;
    this.shell.update();
    this.approachHand(dt);
    this.world.advance(dt, {
      x: 0,
      y: 0,
      z: 0,
      mouth: { x: 0, y: 0, z: 0 },
      edibleId: null,
      capture: this.onContact,
      contact: this.shell.contact,
    });
    this.renderer.update(this.world.candies);
  }
  stats() {
    return {
      count: this.world.candies.length,
      heldId: this.world.heldId,
      candies: this.world.candies.map(
        ({ id, x, y, z, vx, vy, vz, radius, mode }) => ({
          id,
          x,
          y,
          z,
          vx,
          vy,
          vz,
          radius,
          mode,
        }),
      ),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.renderer.dispose();
    this.cue.removeFromParent();
    this.cue.geometry.dispose();
    this.cue.material.dispose();
    this.disposed = true;
    if (typeof window !== 'undefined')
      window.removeEventListener('blur', this.onLost);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
