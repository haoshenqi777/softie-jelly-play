import * as THREE from 'three/webgpu';
import type { PlayMode } from '../play-mode.ts';
import { TabletopMotion, tabletopDrag } from './tabletop.ts';
import { PLAY_AUTONOMOUS_FEEDING } from '../play-limits.ts';
import { createCage, type Binding } from './cage.ts';
import { VolumeSoftBody } from './solver.ts';
import { BodyIntake } from './body-intake.ts';
import { MaterialAnchor } from './material-anchor.ts';
import { SelfRighting } from './recovery.ts';
import { CharacterBehavior } from './behavior.ts';
import type { CandyObservation } from './candy-interest.ts';
import { curiosityMotion } from './curiosity.ts';
import { CharacterMotor } from './character-motor.ts';
import { FeedingReaction } from './feeding-reaction.ts';
import { BodyPosture } from './posture.ts';
import { MotionPerception } from './perception.ts';
import {
  rendezvous,
  cameraDirectionMoving,
  cameraFacing,
} from './rendezvous.ts';
import type {
  CharacterObservation,
  CharacterIntent,
  V3,
} from './behavior-types.ts';
import { FloorSurface } from './floor-surface.ts';
import { EmbeddedSurface, sampleBinding } from './surface.ts';
import { ExpressionRig, type ExpressionSettings } from './expression.ts';
import {
  DEFAULT_FEEL,
  normalizeFeel,
  physicalFeel,
  type FeelTuning,
} from './tuning.ts';

export class VolumeInteraction {
  readonly solver: VolumeSoftBody;
  private playMode: PlayMode = 'free';
  private readonly tabletop: TabletopMotion;
  setPlayMode(mode: PlayMode) {
    this.playMode = mode;
  }
  intake: BodyIntake | null = null;
  enableIntake() {
    return (this.intake ??= new BodyIntake(this.cage, this.solver, this.body));
  }
  private cage: ReturnType<typeof createCage>;
  materialAnchor(point: THREE.Vector3, normal: THREE.Vector3) {
    return new MaterialAnchor(this.cage, point, normal);
  }
  private surface: EmbeddedSurface;
  private floorSurface: FloorSurface;
  readonly expression: ExpressionRig;
  readonly recovery: SelfRighting;
  readonly behavior = new CharacterBehavior(520);
  readonly motor: CharacterMotor;
  readonly meal = new FeedingReaction();
  private readonly perception = new MotionPerception();
  private readonly posture: BodyPosture;
  private autonomy = true;
  private characterTime = 0;
  private characterIntent: CharacterIntent | null = null;
  private candies: readonly CandyObservation[] = [];
  private lookingAtCandy = false;
  setCandies(candies: readonly CandyObservation[]) {
    this.candies = candies;
  }
  inviteCandy(id: number) {
    const c = this.candies.find((c) => c.id === id);
    if (!this.autonomy || !c || c.mode !== 'free' || c.y > c.radius + 0.09)
      return;
    this.behavior.inviteCandy(id);
    this.solver.wake();
  }
  private traceKey = '';
  private readonly characterTrace: {
    time: number;
    phase: string;
    body: string;
    gait: string;
    steps: number;
    mood: number;
    social: string;
    joy: number;
    comfort: number;
    face: string;
    center: number[];
  }[] = [];
  private viewDirection: V3 = [0, 0, 1];
  private cameraMoving = false;
  private fallPeak = 0;
  private wasGrounded = true;
  private bubbleBindings: Binding[];
  private body: THREE.Mesh;
  private camera: THREE.Camera;
  private canvas: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private cursor = new THREE.Vector2();
  private plane = new THREE.Plane();
  private anchorOffset = new THREE.Vector3();
  private grabOrigin = new THREE.Vector3();
  private liftAtGrab = 0;
  private target = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private pointer: number | null = null;
  private pressTime = 0;
  private nudgeCooldown = 0;
  private physicsMs = 0;
  private surfaceMs = 0;
  private expressionMs = 0;
  private gestureStarted = 0;
  private gestureLast = 0;
  private gesturePoint = new THREE.Vector2();
  private gestureTravel = 0;
  private gestureStretched = false;
  private hoverLast = -Infinity;
  private hoverPoint = new THREE.Vector2();
  private hoverHit = false;
  private airborne = false;
  private landingSpeed = 0;
  private activeCosts: number[] = [];
  private physicsCosts: number[] = [];
  private maxHeight = 0;
  private minFloor = Infinity;
  private grabs = 0;
  private tuning: FeelTuning = { ...DEFAULT_FEEL };
  private feel = physicalFeel(DEFAULT_FEEL);
  setTuning(values: Partial<FeelTuning>) {
    this.tuning = normalizeFeel(values, this.tuning);
    this.feel = physicalFeel(this.tuning);
    this.solver.setMaterial(
      this.feel.shear,
      this.feel.damping,
      this.feel.crownSoftness,
      this.feel.crownSpan,
    );
    this.solver.setDynamics(this.feel);
  }
  private start = new THREE.Vector2();
  get held(): boolean {
    return this.pointer !== null;
  }
  characterState() {
    return this.characterIntent;
  }
  constructor(
    canvas: HTMLCanvasElement,
    camera: THREE.Camera,
    body: THREE.Mesh,
    parts: THREE.Mesh[],
    bubbles: { p: number[] }[],
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.body = body;
    const profile = JSON.parse(body.userData.optical_profile) as number[][];
    this.cage = createCage(
      profile,
      body.geometry.getAttribute('position').array,
    );
    this.solver = new VolumeSoftBody(this.cage);
    this.tabletop = new TabletopMotion(this.solver);
    this.floorSurface = new FloorSurface(
      this.cage,
      body.geometry.getAttribute('position').array,
    );
    this.expression = new ExpressionRig(body.geometry, parts);
    this.motor = new CharacterMotor(this.solver, (event, strength) =>
      this.expression.notify(event, strength),
    );
    this.recovery = this.motor.recovery;
    this.posture = new BodyPosture(this.solver.rest, this.solver.mass);
    this.surface = new EmbeddedSurface(body.geometry, this.cage);
    this.bubbleBindings = bubbles.map((b) => this.cage.bind(b.p));
  }
  private ray(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.cursor.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((e.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(this.cursor, this.camera);
    this.expression.look(this.cursor.x, this.cursor.y);
  }
  setExpression(values: Partial<ExpressionSettings>) {
    this.expression.configure(values);
  }
  setRecoveryEnabled(enabled: boolean) {
    this.autonomy = enabled;
    this.motor.interrupt();
    this.behavior.reset();
    this.characterIntent = null;
    this.expression.setCharacterContext(null);
    this.recovery.setEnabled(enabled);
  }
  private pointerEvent(kind: 'down' | 'up' | 'cancel') {
    this.perception.observePointer(kind, this.characterTime);
    for (const event of this.perception.sample(this.solver, 0))
      this.behavior.observe(event);
  }
  tip() {
    if (
      this.held ||
      this.nudgeCooldown > 0 ||
      (this.body.geometry.boundingBox?.min.y ?? 0) > 0.08
    )
      return;
    this.clearPointer();
    this.pressTime = 0;
    this.solver.release();
    this.recovery.interrupt();
    this.solver.nudge();
    this.expression.notify('touch');
    this.nudgeCooldown = 1.5;
  }
  private nearest(point: THREE.Vector3) {
    const x = this.solver.x;
    let closest = 0,
      distance = Infinity;
    for (let i = 0; i < x.length; i += 3) {
      const d =
        (x[i] - point.x) ** 2 +
        (x[i + 1] - point.y) ** 2 +
        (x[i + 2] - point.z) ** 2;
      if (d < distance) {
        distance = d;
        closest = i / 3;
      }
    }
    return closest;
  }
  pointerDown(e: PointerEvent) {
    this.hoverHit = false;
    if (e.button !== 0 || this.pointer !== null) return false;
    this.ray(e);
    const hit = this.raycaster.intersectObject(this.body, false)[0];
    if (!hit) return false;
    this.meal.interrupt();
    this.pressTime = 0;
    this.pointer = e.pointerId;
    this.pointerEvent('down');
    this.motor.interrupt();
    this.recovery.interrupt();
    this.grabs++;
    this.start.set(e.clientX, e.clientY);
    this.gesturePoint.copy(this.start);
    this.gestureStarted = this.gestureLast = e.timeStamp ?? performance.now();
    this.gestureTravel = 0;
    this.gestureStretched = false;
    this.expression.notify('touch');
    this.camera.getWorldDirection(this.normal);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, hit.point);
    const point = this.body.worldToLocal(hit.point.clone()),
      id = this.nearest(point);
    this.target.fromArray(this.solver.x, id * 3);
    this.grabOrigin.copy(this.target);
    this.liftAtGrab = this.tabletop.sample().center[1] - this.tabletop.home[1];
    this.anchorOffset.copy(this.target).sub(point);
    this.solver.grab(id, this.target.toArray(), this.feel.gripRadius);
    this.target.y -= this.feel.pressDepth * (0.15 / 0.42);
    this.solver.moveGrab(this.target.toArray());
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return true;
  }
  pointerMove(e: PointerEvent) {
    this.ray(e);
    if (e.pointerId !== this.pointer) {
      this.hoverStroke(e);
      return false;
    }
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      this.cancel();
      return true;
    }
    if (this.raycaster.ray.intersectPlane(this.plane, this.target)) {
      this.body.worldToLocal(this.target);
      this.target.add(this.anchorOffset);
      const travel = Math.hypot(
        e.clientX - this.start.x,
        e.clientY - this.start.y,
      );
      const now = e.timeStamp ?? performance.now();
      const dt = Math.max(0, Math.min(0.12, (now - this.gestureLast) / 1000));
      const movement = Math.hypot(
        e.clientX - this.gesturePoint.x,
        e.clientY - this.gesturePoint.y,
      );
      const rect = this.canvas.getBoundingClientRect();
      const span = Math.max(1, Math.min(rect.width, rect.height));
      const speed = movement / Math.max(0.0001, dt) / span;
      this.gestureTravel = Math.max(this.gestureTravel, travel);
      if (travel > span * 0.13) {
        this.gestureStretched = true;
        this.expression.notify('stretch', Math.min(1, travel / (span * 0.45)));
      } else {
        if (this.gestureStretched && travel < span * 0.09) {
          this.gestureStretched = false;
          this.expression.notify('release');
        }
        if (
          !this.gestureStretched &&
          dt > 0 &&
          speed > 0.005 &&
          speed < 0.55 &&
          (this.body.geometry.boundingBox?.min.y ?? 0) < 0.05
        ) {
          this.stroke(dt);
        }
      }
      this.gestureLast = now;
      this.gesturePoint.set(e.clientX, e.clientY);
      this.target.y -=
        this.feel.pressDepth * (0.15 / 0.42) * Math.exp(-travel / 25);
      // The safe drag span follows the grabbed surface. A character walking
      // elsewhere in the room must never be yanked into the old origin box.
      this.target.x = THREE.MathUtils.clamp(
        this.target.x,
        this.grabOrigin.x - 2,
        this.grabOrigin.x + 2,
      );
      this.target.y = THREE.MathUtils.clamp(
        this.target.y,
        0.1,
        Math.max(3.25, this.grabOrigin.y + 2),
      );
      this.target.z = THREE.MathUtils.clamp(
        this.target.z,
        this.grabOrigin.z - 1.8,
        this.grabOrigin.z + 1.8,
      );
      if (this.playMode === 'tabletop')
        this.target.fromArray(
          tabletopDrag(
            this.target.toArray(),
            this.grabOrigin.toArray(),
            this.liftAtGrab,
          ),
        );
      this.solver.moveGrab(this.target.toArray());
    }
    e.preventDefault();
    return true;
  }
  stroke(dt: number) {
    if (dt > 0 && Number.isFinite(dt)) this.meal.interrupt();
    this.expression.notify('stroke', dt);
    this.behavior.observe({
      kind: 'stroke',
      time: this.characterTime,
      seconds: dt,
    });
  }
  private hoverStroke(e: PointerEvent) {
    if (
      this.pointer !== null ||
      e.pointerType !== 'mouse' ||
      e.buttons !== 0 ||
      this.cameraMoving
    ) {
      this.hoverHit = false;
      return;
    }
    const now = e.timeStamp;
    const dt = (now - this.hoverLast) / 1000;
    // Limit expensive mesh picking, retaining total movement between samples.
    if (dt > 0 && dt < 1 / 120) return;
    const rect = this.canvas.getBoundingClientRect();
    const speed =
      Math.hypot(e.clientX - this.hoverPoint.x, e.clientY - this.hoverPoint.y) /
      Math.max(0.0001, dt) /
      Math.max(1, Math.min(rect.width, rect.height));
    const contact =
      (this.body.geometry.boundingBox?.min.y ?? 0) < 0.05 &&
      this.raycaster.intersectObject(this.body, false).length > 0;
    if (
      contact &&
      this.hoverHit &&
      dt > 0 &&
      dt <= 0.12 &&
      speed > 0.005 &&
      speed < 0.55
    )
      this.stroke(dt);
    this.hoverHit = contact;
    this.hoverLast = now;
    this.hoverPoint.set(e.clientX, e.clientY);
  }
  pointerLeave() {
    this.hoverHit = false;
    this.hoverLast = -Infinity;
    this.expression.look(0, 0);
  }
  pointerUp(e: PointerEvent) {
    if (e.pointerId !== this.pointer) return false;
    if (e.type && e.type !== 'pointerup') {
      this.cancel();
      return true;
    }
    this.pointer = null;
    this.pointerEvent('up');
    this.solver.release();
    if (this.playMode === 'tabletop') this.tabletop.release();
    this.expression.notify('release');
    if (
      (e.timeStamp ?? performance.now()) - this.gestureStarted < 260 &&
      this.gestureTravel < 12
    )
      this.expression.notify('poke');
    this.canvas.style.cursor = 'grab';
    if (this.canvas.hasPointerCapture(e.pointerId))
      this.canvas.releasePointerCapture(e.pointerId);
    return true;
  }
  poke() {
    this.recovery.interrupt();
    this.clearPointer();
    this.expression.notify('poke');
    this.solver.release();
    const x = this.solver.x;
    let id = 0,
      score = -Infinity;
    for (let i = 0; i < x.length; i += 3) {
      const s = x[i + 1] - 0.22 * (x[i] ** 2 + x[i + 2] ** 2);
      if (s > score) {
        score = s;
        id = i / 3;
      }
    }
    this.target.fromArray(x, id * 3);
    this.solver.grab(
      id,
      this.target.toArray(),
      this.feel.gripRadius * (0.62 / 0.58),
    );
    this.target.y -= this.feel.pressDepth;
    this.solver.moveGrab(this.target.toArray());
    this.pressTime = 0.28;
  }
  drop() {
    this.recovery.interrupt();
    this.clearPointer();
    this.pressTime = 0;
    this.solver.release();
    // One launch per landing; repeated clicks must not build unlimited altitude.
    if ((this.body.geometry.boundingBox?.min.y ?? 0) > 0.08) return;
    let upward = 0;
    for (let i = 1; i < this.solver.velocity.length; i += 3)
      upward += this.solver.velocity[i] / this.solver.nodeCount;
    if (upward > 1) return;
    // Compensate linear air drag so the same height remains comparable at
    // different gravity. Solve h(v) for dv/dt = -g - 0.35v by bisection.
    const g = this.feel.gravity,
      drag = 0.35;
    let low = 0,
      high = 12;
    for (let i = 0; i < 24; i++) {
      const v = (low + high) / 2;
      const height =
        v / drag - (g / (drag * drag)) * Math.log1p((drag * v) / g);
      if (height < this.feel.jumpHeight) low = v;
      else high = v;
    }
    // This is an intentional launch, not leftover energy from the last hand release.
    this.tabletop.reset();
    this.solver.kick(0, (low + high) / 2, 0);
  }
  reset() {
    this.tabletop.reset();
    this.meal.reset();
    this.intake?.reset();
    this.clearPointer();
    this.pressTime = 0;
    this.nudgeCooldown = 0;
    this.recovery.reset();
    this.motor.interrupt();
    this.behavior.reset();
    this.perception.reset();
    this.characterTrace.length = 0;
    this.traceKey = '';
    this.characterIntent = null;
    this.expression.setCharacterContext(null);
    this.fallPeak = 0;
    this.wasGrounded = true;
    this.activeCosts.length = this.physicsCosts.length = 0;
    this.maxHeight = 0;
    this.minFloor = Infinity;
    this.grabs = 0;
    this.airborne = false;
    this.landingSpeed = 0;
    this.expression.reset();
    this.solver.reset();
    this.rebuild();
  }
  private clearPointer() {
    this.meal.interrupt();
    this.hoverHit = false;
    this.hoverLast = -Infinity;
    const pointer = this.pointer;
    if (pointer !== null) this.pointerEvent('cancel');
    else this.behavior.observe({ kind: 'cancel', time: this.characterTime });
    // Buttons, keyboard impulses and focus loss own the body too. They must
    // discard the old social performance even without a captured pointer.
    this.motor.interrupt();
    this.pointer = null;
    this.expression.notify('release');
    if (pointer !== null && this.canvas.hasPointerCapture(pointer))
      this.canvas.releasePointerCapture(pointer);
    this.canvas.style.cursor = 'grab';
  }
  cancel() {
    const ownedBody = this.held || this.pressTime > 0;
    this.motor.interrupt();
    this.recovery.interrupt();
    this.clearPointer();
    this.pressTime = 0;
    this.solver.release();
    if (ownedBody && this.playMode === 'tabletop') this.tabletop.release();
  }
  private rebuild() {
    const before = performance.now();
    this.surface.update(this.solver.x, this.solver.nodalTransforms());
    this.intake?.applySurface();
    this.surfaceMs = performance.now() - before;
  }
  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const destination = rendezvous(
      this.camera.position.toArray() as V3,
      [0, 0, 0],
      3.2325,
      this.viewDirection,
    );
    if (this.playMode === 'tabletop') destination.point = [0, 0, 0];
    this.cameraMoving = cameraDirectionMoving(
      this.viewDirection,
      destination.direction,
      dt,
    );
    this.viewDirection = destination.direction;
    this.nudgeCooldown = Math.max(
      0,
      this.nudgeCooldown - Math.max(0, Math.min(0.1, dt)),
    );
    if (this.pressTime > 0) {
      this.pressTime -= dt;
      if (this.pressTime <= 0) this.solver.release();
    }
    const asleep = this.solver.sleeping;
    let downward = 0;
    for (let i = 1; i < this.solver.velocity.length; i += 3)
      downward -= this.solver.velocity[i] / this.solver.nodeCount;
    const before = performance.now();
    this.intake?.prepare();
    this.solver.advance(
      dt,
      (step) => {
        if (!this.solver.sleeping)
          this.solver.setFloorLevel(this.floorSurface.level(this.solver.x));
        this.characterTime += step;
        const meal = this.meal.step(
          step,
          this.intake?.reactionFrame() ?? null,
          this.intake?.anchor?.restPoint,
        );
        if (this.autonomy) {
          const p = this.posture.sample(this.solver.x, this.solver.velocity);
          const velocity: V3 = [0, 0, 0];
          let total = 0;
          for (let i = 0; i < this.solver.nodeCount; i++) {
            const m = this.solver.mass[i];
            total += m;
            for (let k = 0; k < 3; k++)
              velocity[k] += this.solver.velocity[i * 3 + k] * m;
          }
          for (let k = 0; k < 3; k++) velocity[k] /= total;
          const grounded =
            p.minY - this.solver.floorLevel < 0.025 && p.verticalSpeed < 0.5;
          if (!grounded)
            this.fallPeak = Math.max(this.fallPeak, -p.verticalSpeed);
          const impact = grounded && !this.wasGrounded ? this.fallPeak : 0;
          if (grounded) this.fallPeak = 0;
          this.wasGrounded = grounded;
          const observation: CharacterObservation = {
            time: this.characterTime,
            center: p.center as V3,
            velocity,
            up: p.up as V3,
            forward: p.forward as V3,
            grounded,
            held: this.held || this.pressTime > 0,
            stable: grounded && p.up[1] > 0.96 && Math.hypot(...p.omega) < 0.6,
            width: 3.2325,
            height: 2.35,
            impactSpeed: impact,
            rendezvous: destination.point,
            viewerDirection: cameraFacing(
              this.camera.position.toArray() as V3,
              p.center as V3,
              destination.direction,
            ),
            cameraMoving: this.cameraMoving,
            candies: PLAY_AUTONOMOUS_FEEDING ? this.candies : [],
            canAbsorb: this.intake !== null && !this.intake.active,
            absorbing: (this.intake?.active ?? false) || meal.active,
            turning: this.motor.turnHop.active,
            gravity: this.feel.gravity,
          };
          this.characterIntent = this.behavior.step(observation, step);
          this.motor.step(observation, this.characterIntent, step, meal);
        }
        if (this.playMode === 'tabletop')
          this.tabletop.step(
            step,
            this.held || this.pressTime > 0,
            (this.intake?.active ?? false) ||
              meal.active ||
              this.characterIntent?.phase === 'collecting',
          );
      },
      this.intake ?? undefined,
    );
    this.physicsMs = performance.now() - before;
    if (!asleep || !this.solver.sleeping) {
      this.rebuild();
      this.activeCosts.push(this.physicsMs + this.surfaceMs);
      this.physicsCosts.push(this.physicsMs);
      if (this.activeCosts.length > 360) {
        this.activeCosts.shift();
        this.physicsCosts.shift();
      }
      const bounds = this.body.geometry.boundingBox!;
      this.maxHeight = Math.max(this.maxHeight, bounds.max.y);
      this.minFloor = Math.min(this.minFloor, bounds.min.y);
      if (bounds.min.y > 0.05) this.airborne = true;
      if (this.airborne) {
        this.landingSpeed = Math.max(this.landingSpeed, downward);
        if (!this.held && bounds.min.y <= 0.025) {
          this.expression.notify('land', this.landingSpeed);
          this.airborne = false;
          this.landingSpeed = 0;
        }
      }
    } else this.surfaceMs = 0;
    const faceBefore = performance.now();
    this.expression.setMealContext(
      this.held || this.pressTime > 0 ? null : this.meal.frame(),
    );
    this.expression.setCharacterContext(
      this.autonomy ? this.characterIntent : null,
    );
    this.expression.setHopContext(this.motor.candyHop.currentPhase);
    const meal = this.meal.frame();
    if (meal.active && !this.held && this.expression.acceptsMealGaze) {
      this.expression.look(
        meal.track ? meal.gazeX : 0,
        meal.track ? meal.gazeY : 0,
      );
      this.lookingAtCandy = true;
    } else if (
      this.characterIntent?.candy &&
      !this.held &&
      this.expression.acceptsCharacterGaze
    ) {
      const p = this.posture.sample(this.solver.x, this.solver.velocity);
      const food = this.characterIntent.candy.point;
      const dx = food[0] - p.center[0],
        dz = food[2] - p.center[2],
        distance = Math.hypot(dx, dz) || 1;
      const target = [dx / distance, 0, dz / distance];
      const scan = curiosityMotion(
        this.characterIntent.candy.age,
        this.characterIntent.candy.stage,
      );
      const checkingViewer =
        this.characterIntent.candy.invited &&
        this.characterIntent.candy.stage === 'inspecting' &&
        this.characterIntent.candy.age < 0.25;
      // The eyes notice first; as the body physically turns, this local offset
      // relaxes to centre. Ground candy keeps a small downward glance.
      this.expression.look(
        checkingViewer
          ? 0
          : this.characterIntent.candy.stage === 'inspecting'
            ? scan.gazeX
            : (p.forward[2] * target[0] - p.forward[0] * target[2]) * 0.8,
        checkingViewer ? 0 : scan.gazeY,
      );
      this.lookingAtCandy = true;
    } else if (this.lookingAtCandy) {
      this.expression.look(0, 0);
      this.lookingAtCandy = false;
    }
    this.expression.update(dt);
    this.expressionMs = performance.now() - faceBefore;
    if (this.characterIntent) {
      const c = this.characterIntent,
        g = this.motor.gait.stats(),
        face = this.expression.stats().active;
      const key = [c.phase, c.body, g.phase, c.social, face].join(':');
      if (key !== this.traceKey) {
        this.traceKey = key;
        const box = this.body.geometry.boundingBox!;
        this.characterTrace.push({
          time: this.characterTime,
          phase: c.phase,
          body: c.body,
          gait: g.phase,
          steps: g.steps,
          mood: c.mood,
          social: c.social,
          joy: c.joy,
          comfort: c.comfort,
          face,
          center: [
            (box.min.x + box.max.x) / 2,
            (box.min.y + box.max.y) / 2,
            (box.min.z + box.max.z) / 2,
          ],
        });
        if (this.characterTrace.length > 128) this.characterTrace.shift();
      }
    }
  }
  bubblePosition(index: number, out: THREE.Vector3) {
    return sampleBinding(this.bubbleBindings[index], this.solver.x, out);
  }
  stats() {
    const percentile = (values: number[]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    };
    return {
      ...this.solver.stats(),
      expression: this.expression.stats(),
      intake: this.intake?.frame() ?? null,
      meal: this.meal.frame(),
      recovery: this.recovery.stats(),
      character: this.characterIntent ? { ...this.characterIntent } : null,
      gait: this.motor.gait.stats(),
      turnHop: this.motor.turnHop.stats(),
      candyHop: this.motor.candyHop.stats(),
      breath: this.motor.breathStats(),
      characterTrace: this.characterTrace.slice(),
      sleeping: this.solver.sleeping,
      nodes: this.solver.nodeCount,
      tetrahedra: this.cage.tets.length / 4,
      physicsMs: this.physicsMs,
      surfaceMs: this.surfaceMs,
      expressionMs: this.expressionMs,
      grabbed: this.pointer !== null,
      stiffness: this.tuning.stiffness,
      damping: this.tuning.damping,
      tuning: { ...this.tuning },
      playMode: this.playMode,
      physicalTuning: { ...this.feel },
      grabs: this.grabs,
      maxHeight: this.maxHeight,
      minFloor: this.minFloor,
      activeCpuP95: percentile(this.activeCosts),
      physicsP95: percentile(this.physicsCosts),
      activeSamples: this.activeCosts.length,
    };
  }
}
