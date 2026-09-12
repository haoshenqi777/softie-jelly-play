import type {
  BehaviorPhase,
  CharacterEvent,
  CharacterIntent,
  CharacterObservation,
  V3,
} from './behavior-types.ts';
import { SocialResponse } from './social-response.ts';
import { CandyInterest, type CandyAttention } from './candy-interest.ts';

type IdleAction = 'curious' | 'shift' | 'stretch' | 'rest';
type Release = Extract<CharacterEvent, { kind: 'release' }>;
const IDLE_ACTIONS: readonly IdleAction[] = [
  'curious',
  'shift',
  'stretch',
  'rest',
];
const IDLE_SECONDS: Record<IdleAction, number> = {
  curious: 2.2,
  shift: 1.6,
  stretch: 3,
  rest: 3.5,
};
const clamp = (n: number, low = 0, high = 1) =>
  Math.max(low, Math.min(high, n));
const horizontalSpeed = (v: V3) => Math.hypot(v[0], v[2]);

/** Owns durable purpose and mood. It only requests motion; the motor and the
 * measured contact/posture decide what the body can actually do. Results and
 * their vectors are reused, so trace recorders must copy a frame they retain. */
export class CharacterBehavior {
  private readonly seed: number;
  private randomState = 1;
  private phase: BehaviorPhase = 'idle';
  private phaseAge = 0;
  private mood = 0;
  private social = new SocialResponse();
  private readonly candyInterest = new CandyInterest();
  private candy: CandyAttention | null = null;
  private wantsReturn = false;
  private hasTarget = false;
  private hasViewer = false;
  private readonly target: V3 = [0, 0, 0];
  private readonly viewer: V3 = [0, 0, 1];
  private readonly viewerRay: V3 = [0, 0, 1];
  private readonly intent: CharacterIntent = {
    phase: 'idle',
    candy: null,
    destination: null,
    facing: [0, 0, 1],
    mood: 0,
    social: 'none',
    socialAge: 0,
    comfort: 0,
    joy: 0,
    gait: 'scoot',
    desiredSpeed: 0,
    body: 'quiet',
  };
  private eventHeld = false;
  private grabProvenance = false;
  private release: Release | null = null;
  private cancelNext = false;
  private impactPending = false;
  private cameraQuiet = 0;
  private targetClock = 0;
  private wasGrounded = true;
  private unsupported = 0;
  private settled = 0;
  private arrivalSettled = 0;
  private stallAge = 0;
  private bestDistance = Infinity;
  private failures = 0;
  private idleQuiet = 0;
  private attentionAge = 0;
  private idleWait = 8;
  private idleAction: IdleAction | null = null;
  private idleAge = 0;
  private lastIdle: IdleAction | null = null;

  constructor(seed: number) {
    this.seed = Number.isFinite(seed) ? seed >>> 0 : 1;
    this.reset();
  }
  inviteCandy(id: number) {
    this.candyInterest.invite(id);
    this.stopIdle();
  }

  reset(): void {
    this.randomState = this.seed || 1;
    this.phase = 'idle';
    this.phaseAge = this.mood = 0;
    this.social.interrupt(true);
    this.candyInterest.reset();
    this.candy = this.intent.candy = null;
    this.wantsReturn =
      this.hasTarget =
      this.hasViewer =
      this.eventHeld =
      this.grabProvenance =
        false;
    this.release = null;
    this.cancelNext = this.impactPending = false;
    this.target[0] = this.target[1] = this.target[2] = 0;
    this.viewer[0] = this.viewer[1] = 0;
    this.viewer[2] = 1;
    this.viewerRay[0] = this.viewerRay[1] = 0;
    this.viewerRay[2] = 1;
    this.cameraQuiet = this.targetClock = this.unsupported = this.settled = 0;
    this.wasGrounded = true;
    this.arrivalSettled = this.stallAge = this.failures = 0;
    this.bestDistance = Infinity;
    this.attentionAge = 0;
    this.lastIdle = null;
    this.stopIdle();
    this.intent.phase = 'idle';
    this.intent.destination = null;
    this.intent.facing[0] = this.intent.facing[1] = 0;
    this.intent.facing[2] = 1;
    this.intent.mood = this.intent.desiredSpeed = 0;
    this.intent.gait = 'scoot';
    this.intent.body = 'quiet';
    this.intent.social = 'none';
    this.intent.socialAge = this.intent.comfort = this.intent.joy = 0;
  }

  observe(event: CharacterEvent): void {
    if (event.kind === 'reset') {
      this.reset();
      return;
    }
    this.attentionAge = 0;
    this.stopIdle();
    if (event.kind === 'grab') {
      this.candyInterest.reset(0.7);
      this.candy = null;
      this.social.interrupt();
      this.eventHeld = this.grabProvenance = true;
      this.cancelNext = false;
      this.release = null;
      this.impactPending = false;
      this.enter('held');
    } else if (event.kind === 'cancel') {
      this.candyInterest.reset(0.7);
      this.candy = null;
      this.social.interrupt();
      this.eventHeld = this.grabProvenance = false;
      this.release = null;
      this.impactPending = false;
      this.cancelNext = true;
      this.enter('idle');
    } else if (event.kind === 'release') {
      // The physical distance/speed checks happen against the next observation's
      // body width. Consuming provenance also rejects duplicate pointer-up.
      if (this.grabProvenance)
        this.release = {
          kind: 'release',
          time: event.time,
          valid: event.valid,
          carriedDistance: event.carriedDistance,
          velocity: [...event.velocity],
        };
      this.eventHeld = this.grabProvenance = false;
    } else if (event.kind === 'stroke' && Number.isFinite(event.seconds)) {
      this.mood = Math.max(
        0,
        this.mood - this.social.stroke(event.seconds, this.mood),
      );
    }
  }

  step(observation: CharacterObservation, dt: number): CharacterIntent {
    if (!Number.isFinite(dt) || dt <= 0) return this.intent;
    // A suspended tab does not count as seconds of observed ground contact.
    dt = Math.min(dt, 0.1);
    const width =
      Number.isFinite(observation.width) && observation.width > 0
        ? observation.width
        : 1;
    const speed = horizontalSpeed(observation.velocity);
    const upright = observation.up[1] > 0.82;
    const steady = observation.grounded && observation.stable && upright;
    const landedNow = observation.grounded && !this.wasGrounded;
    this.wasGrounded = observation.grounded;
    this.phaseAge += dt;
    this.attentionAge += dt;
    this.unsupported = observation.grounded ? 0 : this.unsupported + dt;
    this.settled = steady ? this.settled + dt : 0;
    this.cameraQuiet = observation.cameraMoving ? 0 : this.cameraQuiet + dt;
    this.targetClock += dt;
    this.mood = Math.max(
      0,
      this.mood -
        dt * (this.wantsReturn || this.phase === 'held' ? 0.012 : 0.026),
    );
    this.social.step(
      dt,
      this.mood,
      (this.phase === 'arrived' || this.phase === 'idle') &&
        observation.grounded &&
        upright,
      this.eventHeld || observation.held,
    );

    this.updateViewer(observation.viewerDirection, dt);
    this.updateTarget(observation, width, landedNow);
    const distance = Math.hypot(
      this.target[0] - observation.center[0],
      this.target[2] - observation.center[2],
    );
    if (
      !this.eventHeld &&
      !observation.held &&
      !this.candyInterest.active &&
      distance > width * 0.5
    )
      this.wantsReturn = true;

    if (this.release) {
      const release = this.release;
      this.release = null;
      const releaseSpeed = horizontalSpeed(release.velocity);
      const thrown =
        release.valid &&
        Number.isFinite(releaseSpeed) &&
        Number.isFinite(release.carriedDistance) &&
        release.carriedDistance > width * 0.035 &&
        releaseSpeed > width * 0.45;
      if (thrown) {
        this.social.interrupt(true);
        this.mood = clamp(
          this.mood +
            0.35 +
            Math.min(0.35, (releaseSpeed / width - 0.45) * 0.2),
        );
      }
      this.impactPending = thrown;
      this.failures = 0;
      this.bestDistance = Infinity;
      this.stallAge = this.unsupported = 0;
      this.enter(observation.grounded ? 'landing' : 'airborne');
    }

    if (this.cancelNext) {
      this.cancelNext = false;
      this.enter(observation.grounded ? 'idle' : 'airborne');
      return this.frame('quiet', 0);
    }
    if (this.eventHeld || observation.held) {
      this.grabProvenance = true;
      this.attentionAge = 0;
      this.enter('held');
      return this.frame('quiet', 0);
    }

    // A captured treat owns attention. Pause locomotion without manufacturing a
    // stalled return; player input above and self-righting below retain priority.
    if (observation.absorbing && upright) {
      this.candyInterest.reset(0.4);
      this.candy = null;
      this.enter('absorbing');
      return this.frame('brake', 0);
    }
    if (this.phase === 'absorbing')
      this.enter(observation.grounded ? 'idle' : 'airborne');
    // A returning low step has its own contact-conditioned motor. Brief flight
    // keeps that phase intact; a user release above always cancels this exception.
    const gaitFlight =
      (this.phase === 'orient' &&
        observation.turning &&
        this.unsupported < 1.8 &&
        observation.up[1] > 0.82) ||
      ((this.phase === 'returning' ||
        this.phase === 'seeking' ||
        this.phase === 'collecting') &&
        this.unsupported < (this.phase === 'collecting' ? 2.3 : 0.85) &&
        observation.up[1] > 0.35 &&
        observation.velocity[1] > -width * 1.5);
    // A soft landing or a puff can briefly unload the contact patch. Retain
    // its performance through that tiny recoil, not through a real fall.
    const gestureRecoil =
      (this.phase === 'arrived' ||
        this.phase === 'orient' ||
        this.phase === 'noticing' ||
        this.phase === 'inspecting' ||
        (this.phase === 'idle' && this.social.frame().beat !== 'none')) &&
      this.unsupported < 0.18 &&
      observation.up[1] > 0.9 &&
      Math.abs(observation.velocity[1]) < width * 0.35;
    if (!observation.grounded && !gaitFlight && !gestureRecoil) {
      this.candyInterest.reset(0.4);
      this.candy = null;
      this.enter('airborne');
      return this.frame('quiet', 0);
    }
    if (this.phase === 'airborne' || this.phase === 'held')
      this.enter('landing');

    if (
      observation.grounded &&
      this.impactPending &&
      (landedNow || this.phase === 'landing')
    ) {
      if (
        Number.isFinite(observation.impactSpeed) &&
        observation.impactSpeed > 0
      ) {
        this.mood = clamp(
          this.mood + Math.min(0.25, (observation.impactSpeed / width) * 0.1),
        );
        this.impactPending = false;
      } else if (this.phaseAge >= 0.4) this.impactPending = false;
    }

    if (this.phase === 'landing') {
      if (
        this.phaseAge >= 0.22 &&
        speed < width * 0.6 &&
        Math.abs(observation.velocity[1]) < width * 0.35
      ) {
        if (!upright) this.enter('righting');
        else if (this.settled >= 0.12)
          this.enter(this.wantsReturn || this.mood > 0.1 ? 'orient' : 'idle');
      }
    } else if (this.phase === 'righting') {
      if (this.settled >= 0.18 && speed < width * 0.2)
        this.enter(this.wantsReturn || this.mood > 0.1 ? 'orient' : 'idle');
    } else if (!upright && observation.grounded) {
      this.enter('righting');
    } else if (this.phase === 'idle') {
      if (this.wantsReturn) this.enter('orient');
    } else if (this.phase === 'orient') {
      const ready = steady && speed < width * 0.2 && !observation.turning;
      const heading = this.directionDot(observation.forward, this.viewer);
      const cameraHeading = this.directionDot(
        observation.forward,
        this.viewerRay,
      );
      if (
        ready &&
        this.phaseAge >= 0.3 &&
        heading > 0.97 &&
        cameraHeading > 0.97
      ) {
        this.bestDistance = distance;
        this.stallAge = 0;
        this.enter(this.wantsReturn ? 'returning' : 'arrived');
      }
    } else if (this.phase === 'returning') {
      const close = distance <= width * 0.12;
      const facingViewer =
        this.directionDot(observation.forward, this.viewer) > 0.95;
      this.arrivalSettled =
        close && steady && speed < width * 0.05 && facingViewer
          ? this.arrivalSettled + dt
          : 0;
      if (this.arrivalSettled >= 0.15) {
        this.wantsReturn = false;
        this.enter('arrived');
      } else if (!close) {
        if (distance < this.bestDistance - width * 0.025) {
          this.bestDistance = distance;
          this.stallAge = 0;
        } else this.stallAge += dt;
        if (this.stallAge >= 1.5) {
          this.failures++;
          this.enter('orient');
        }
      }
    } else if (this.phase === 'arrived') {
      if (this.wantsReturn) this.enter('orient');
      else if (
        this.social.frame().beat === 'none' &&
        this.phaseAge >= 1.6 &&
        steady &&
        speed < width * 0.05
      )
        this.enter('idle');
    }

    const foodPhase =
      this.phase === 'noticing' ||
      this.phase === 'seeking' ||
      this.phase === 'inspecting' ||
      this.phase === 'collecting';
    const canNotice =
      (this.phase === 'idle' ||
        foodPhase ||
        (this.phase === 'arrived' && this.candyInterest.invited)) &&
      !this.wantsReturn &&
      (this.mood < 0.12 || this.candyInterest.invited) &&
      (this.social.frame().beat === 'none' || this.candyInterest.invited) &&
      upright;
    if (canNotice) {
      this.candy = this.candyInterest.step(
        observation.candies ?? [],
        observation,
        dt,
      );
      if (this.candy) {
        this.enter(this.candy.stage);
        return this.frame(
          this.candy.speed > 0
            ? 'travel'
            : this.candy.stage === 'seeking'
              ? 'brake'
              : 'curious',
          this.candy.speed,
        );
      }
      if (foodPhase) this.enter('idle');
    } else if (this.candyInterest.active) {
      this.candyInterest.reset(0.4);
      this.candy = null;
    }

    let body: CharacterIntent['body'] = 'quiet';
    let desiredSpeed = 0;
    if (this.phase === 'righting') body = 'recover';
    else if (this.phase === 'landing') body = 'brake';
    else if (this.phase === 'orient')
      body = speed > width * 0.15 ? 'brake' : 'puff';
    else if (this.phase === 'returning') {
      if (distance <= width * 0.12) body = 'brake';
      else {
        body = 'travel';
        // Cover ground confidently; the final approach remains distance-limited.
        const far = clamp((distance / width - 0.45) / 1.55);
        const cruise = width * (0.32 + 0.24 * far * far * (3 - 2 * far));
        desiredSpeed = Math.min(
          cruise,
          Math.max(0, (distance - width * 0.075) * 1.15),
        );
      }
    } else if (this.phase === 'arrived')
      body = this.mood > 0.1 ? 'complain' : 'quiet';
    else if (this.phase === 'idle' && this.social.frame().beat !== 'none')
      body = 'quiet';
    else if (this.phase === 'idle' && steady && speed < width * 0.05)
      body = this.stepIdle(dt);
    else if (this.idleAction) this.stopIdle();
    return this.frame(body, desiredSpeed);
  }

  private enter(phase: BehaviorPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    if (phase === 'arrived') this.social.arrive(this.mood);
    if (phase === 'righting') this.social.interrupt();
    this.phaseAge = this.arrivalSettled = 0;
    if (phase !== 'idle') this.stopIdle();
  }

  private frame(
    body: CharacterIntent['body'],
    desiredSpeed: number,
  ): CharacterIntent {
    this.intent.phase = this.phase;
    this.intent.candy = this.candy;
    this.intent.destination =
      this.candy?.destination ??
      (this.wantsReturn || this.phase === 'arrived' ? this.target : null);
    this.intent.mood = this.mood;
    const social = this.social.frame();
    this.intent.social = social.beat;
    this.intent.socialAge = social.age;
    this.intent.comfort = social.comfort;
    this.intent.joy = social.joy;
    this.intent.gait =
      (this.phase === 'collecting' && !this.candy?.nearby) || this.failures >= 2
        ? 'hop'
        : 'scoot';
    this.intent.body = body;
    this.intent.desiredSpeed = desiredSpeed;
    // Gaze and travel are independent: it can bounce sideways toward home
    // while keeping its face turned toward the person behind the camera.
    this.intent.facing[0] = this.candy?.facing[0] ?? this.viewer[0];
    this.intent.facing[1] = 0;
    this.intent.facing[2] = this.candy?.facing[2] ?? this.viewer[2];
    return this.intent;
  }

  private directionDot(a: V3, b: V3): number {
    const n = horizontalSpeed(a);
    return n > 1e-6 ? (a[0] * b[0] + a[2] * b[2]) / n : 0;
  }

  private updateViewer(direction: V3, dt: number): void {
    const n = horizontalSpeed(direction);
    if (Number.isFinite(n) && n > 1e-5) {
      this.viewerRay[0] = direction[0] / n;
      this.viewerRay[2] = direction[2] / n;
      if (!this.hasViewer) {
        this.viewer[0] = this.viewerRay[0];
        this.viewer[2] = this.viewerRay[2];
        this.hasViewer = true;
      }
    }
    // Camera framing and the body's own travel change this ray continuously.
    // Follow it independently of the ground destination, taking the shortest
    // yaw arc across +/-pi. Invalid vertical views retain the last valid ray.
    const delta = Math.atan2(
      this.viewer[2] * this.viewerRay[0] - this.viewer[0] * this.viewerRay[2],
      this.viewer[0] * this.viewerRay[0] + this.viewer[2] * this.viewerRay[2],
    );
    if (Math.abs(delta) < 1e-8) {
      this.viewer[0] = this.viewerRay[0];
      this.viewer[2] = this.viewerRay[2];
      return;
    }
    const turn = clamp(delta * (1 - Math.exp(-8 * dt)), -3 * dt, 3 * dt);
    const angle = Math.atan2(this.viewer[0], this.viewer[2]) + turn;
    this.viewer[0] = Math.sin(angle);
    this.viewer[2] = Math.cos(angle);
  }

  private updateTarget(
    observation: CharacterObservation,
    width: number,
    landedNow: boolean,
  ): void {
    const initialize = !this.hasTarget;
    // Ground contact is a real step boundary. The clock also handles a fully
    // supported scoot; camera updates never alter a destination in mid-flight.
    const boundary =
      this.phase !== 'returning' ||
      (observation.grounded && (landedNow || this.targetClock >= 0.7));
    if (!initialize && (this.cameraQuiet < 0.3 || !boundary)) return;
    if (!initialize && this.phase !== 'returning' && this.targetClock < 0.7)
      return;
    const point = observation.rendezvous;
    if (point.every(Number.isFinite)) {
      if (initialize) {
        this.target[0] = point[0];
        this.target[1] = point[1];
        this.target[2] = point[2];
      } else {
        const dx = point[0] - this.target[0],
          dz = point[2] - this.target[2];
        const length = Math.hypot(dx, dz);
        const fraction = length > 0 ? Math.min(1, (width * 0.06) / length) : 0;
        this.target[0] += dx * fraction;
        this.target[2] += dz * fraction;
        // A camera orbit cannot change the ground plane's height.
      }
      this.hasTarget = true;
    }
    this.targetClock = 0;
  }

  private random(): number {
    this.randomState =
      (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  private stopIdle(): void {
    this.idleAction = null;
    this.idleAge = this.idleQuiet = 0;
    this.idleWait = 8 + this.random() * 7;
  }

  private stepIdle(dt: number): CharacterIntent['body'] {
    if (this.idleAction) {
      this.idleAge += dt;
      if (this.idleAge >= IDLE_SECONDS[this.idleAction]) this.stopIdle();
      return this.idleAction ?? 'quiet';
    }
    this.idleQuiet += dt;
    if (this.idleQuiet < this.idleWait) return 'quiet';
    let total = 0;
    const weights = IDLE_ACTIONS.map((action) => {
      const weight =
        action === this.lastIdle
          ? 0
          : this.mood > 0.25
            ? action === 'shift' || action === 'rest'
              ? 1
              : 0
            : action === 'rest' && this.attentionAge > 30
              ? 3
              : 1;
      total += weight;
      return weight;
    });
    let pick = this.random() * total;
    for (let i = 0; i < IDLE_ACTIONS.length; i++) {
      pick -= weights[i];
      if (pick < 0) {
        this.idleAction = IDLE_ACTIONS[i];
        break;
      }
    }
    this.lastIdle = this.idleAction;
    this.idleAge = 0;
    return this.idleAction ?? 'quiet';
  }
}
