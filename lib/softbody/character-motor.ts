import { BodyPosture, type PostureSample } from './posture.ts';
import { SOCIAL_SECONDS } from './social-response.ts';
import { BodyGesture } from './body-gesture.ts';
import { SelfRighting, type RecoveryEvent } from './recovery.ts';
import { GaitMotor } from './gait.ts';
import { ACTIONS } from './action-presets.ts';
import { curiosityMotion } from './curiosity.ts';
import { TurnHop } from './turn-hop.ts';
import { CandyHop } from './candy-hop.ts';
import type { FeedingPerformance } from './feeding-reaction.ts';
import type { VolumeSoftBody } from './solver.ts';
import type {
  CharacterObservation,
  CharacterIntent,
} from './behavior-types.ts';

/** Only this coordinator drives the character; input always takes ownership. */
export class CharacterMotor {
  readonly recovery: SelfRighting;
  private readonly solver: VolumeSoftBody;
  private readonly sensor: BodyPosture;
  private readonly gesture: BodyGesture;
  readonly gait: GaitMotor;
  readonly turnHop: TurnHop;
  readonly candyHop: CandyHop;
  private breathing = false;
  private breathTime = 0;
  setBreathing(enabled: boolean) {
    this.breathing = enabled;
  }
  breathStats() {
    return { enabled: this.breathing, phase: this.breathTime };
  }
  private body = 'quiet';
  private age = 0;
  private angular = [0, 0, 0];
  private axis = [0, 0, 1];
  constructor(
    s: VolumeSoftBody,
    notify: (event: RecoveryEvent, strength?: number) => void = () => {},
  ) {
    this.solver = s;
    this.sensor = new BodyPosture(s.rest, s.mass);
    this.gesture = new BodyGesture(s);
    this.gait = new GaitMotor(s);
    this.turnHop = new TurnHop(s);
    this.candyHop = new CandyHop(s);
    this.recovery = new SelfRighting(s, notify);
  }
  interrupt() {
    this.recovery.interrupt();
    this.gait.interrupt();
    this.turnHop.interrupt();
    this.candyHop.interrupt();
    this.gesture.reset();
    this.body = 'quiet';
    this.age = 0;
  }
  step(
    o: CharacterObservation,
    intent: CharacterIntent,
    dt: number,
    meal?: FeedingPerformance,
  ) {
    this.breathTime = (this.breathTime + dt) % 4.2;
    if (o.held) {
      this.interrupt();
      return;
    }
    const pose = this.sensor.sample(this.solver.x, this.solver.velocity);
    const recovering = this.recovery.stats().phase;
    if (recovering === 'celebrate' && intent.destination) {
      this.recovery.interrupt();
    } else if (
      recovering !== 'idle' ||
      o.up[1] < 0.82 ||
      intent.body === 'recover'
    ) {
      this.gait.interrupt();
      this.turnHop.interrupt();
      this.candyHop.interrupt();
      this.gesture.reset();
      this.recovery.step(dt, false);
      return;
    }
    if (this.body !== intent.body) {
      this.body = intent.body;
      this.age = 0;
    }
    this.age += dt;
    if (intent.phase === 'collecting' && intent.candy && !o.absorbing) {
      this.gait.interrupt();
      this.turnHop.interrupt();
      this.gesture.reset();
      this.candyHop.step(pose, o.grounded, intent.candy, o.gravity ?? 5, dt);
      return;
    }
    this.candyHop.interrupt();
    if (meal?.active && intent.phase === 'absorbing') {
      this.turnHop.interrupt();
      this.gait.step(pose, o.grounded, pose.forward, 0, dt);
      if (o.grounded) {
        this.axis[0] = meal.lateral ? pose.forward[0] : pose.forward[2];
        this.axis[1] = 0;
        this.axis[2] = meal.lateral ? pose.forward[2] : -pose.forward[0];
        const interior = ['inside', 'dissolving', 'settling', 'done'].includes(
          meal.stage,
        );
        const breath =
          this.breathing && interior
            ? Math.sin((this.breathTime * Math.PI * 2) / 4.2) * 0.008
            : 0;
        this.gesture.drive(
          pose,
          this.axis,
          meal.stretch + breath,
          meal.bend,
          meal.crown + breath * 0.45,
          dt,
        );
      }
      return;
    }
    const curiosity =
      intent.candy?.stage === 'inspecting' && intent.body === 'curious'
        ? curiosityMotion(intent.candy.age)
        : null;
    const social =
      (intent.phase === 'arrived' || intent.phase === 'idle') &&
      intent.social &&
      intent.social !== 'none';
    if (intent.body === 'quiet' && !social) {
      this.gait.interrupt();
      if (o.grounded && intent.mood > 0) {
        this.gesture.drive(
          pose,
          this.axis,
          ACTIONS.puffStretch * intent.mood,
          0,
          ACTIONS.puffReach * intent.mood,
          dt,
        );
      } else if (this.breathing && o.grounded && !o.absorbing) {
        const wave = Math.sin((this.breathTime * Math.PI * 2) / 4.2);
        this.gesture.drive(
          pose,
          this.axis,
          0.014 * wave,
          0,
          0.009 * Math.sin(((this.breathTime - 0.18) * Math.PI * 2) / 4.2),
          dt,
        );
      } else this.gesture.reset();
      return;
    }
    if (intent.phase === 'orient') {
      this.gait.interrupt();
      if (this.turnHop.step(pose, o.grounded, intent.facing, dt)) return;
    } else this.turnHop.interrupt();
    // Upright balance and yaw are physical torque, not an object rotation.
    if (o.grounded) {
      const f = pose.forward,
        t = intent.facing;
      const scan = curiosity?.yaw ?? 0;
      const tx = t[0] * Math.cos(scan) + t[2] * Math.sin(scan);
      const tz = t[2] * Math.cos(scan) - t[0] * Math.sin(scan);
      const heading = Math.atan2(f[2] * tx - f[0] * tz, f[0] * tx + f[2] * tz);
      const roll = curiosity?.roll ?? 0;
      const ux = -tz * Math.sin(roll),
        uy = Math.cos(roll),
        uz = tx * Math.sin(roll);
      const balance = 9;
      this.angular[0] =
        (pose.up[1] * uz - pose.up[2] * uy) * balance - 4 * pose.omega[0];
      this.angular[1] =
        Math.max(-5, Math.min(5, heading * 8)) - 4 * pose.omega[1];
      this.angular[2] =
        (pose.up[0] * uy - pose.up[1] * ux) * balance - 4 * pose.omega[2];
      this.solver.actuate(this.angular, pose.up, 0, dt);
    }
    if (intent.body === 'travel') {
      this.gesture.reset();
      const d = intent.destination;
      this.gait.step(
        pose,
        o.grounded,
        d ? [d[0] - o.center[0], 0, d[2] - o.center[2]] : intent.facing,
        intent.desiredSpeed,
        dt,
        intent.gait,
        intent.mood,
        intent.joy,
      );
      return;
    }
    this.gait.step(pose, o.grounded, intent.facing, 0, dt);
    if (!o.grounded) return;
    if (social) {
      this.socialMotion(pose, o, intent, dt);
      return;
    }
    if (curiosity) {
      this.axis[0] = intent.facing[0];
      this.axis[1] = 0;
      this.axis[2] = intent.facing[2];
      this.gesture.drive(
        pose,
        this.axis,
        curiosity.stretch,
        curiosity.bend,
        curiosity.crown,
        dt,
      );
      return;
    }
    const mood = intent.mood;
    if (intent.body === 'puff' || intent.body === 'complain') {
      const swell = 1 - Math.exp(-this.age * 3);
      this.gesture.drive(
        pose,
        this.axis,
        ACTIONS.puffStretch * mood * swell,
        0,
        ACTIONS.puffReach * mood * swell,
        dt,
      );
    } else if (intent.body === 'brake')
      this.gesture.drive(
        pose,
        this.axis,
        -0.035 * Math.exp(-this.age * 3),
        0,
        0,
        dt,
      );
    else {
      const pulse = Math.sin(Math.PI * Math.min(1, this.age / 2.8)) ** 2;
      const stretch =
        intent.body === 'stretch'
          ? 0.12
          : intent.body === 'rest'
            ? -0.09
            : 0.018;
      const bend =
        intent.body === 'curious'
          ? 0.065
          : intent.body === 'shift'
            ? Math.sin(this.age * 2.7) * 0.045
            : 0;
      this.gesture.drive(
        pose,
        this.axis,
        stretch * pulse,
        bend * pulse,
        intent.body === 'curious' ? 0.06 * pulse : 0,
        dt,
      );
    }
  }
  private socialMotion(
    pose: PostureSample,
    o: CharacterObservation,
    intent: CharacterIntent,
    dt: number,
  ) {
    const beat = intent.social;
    if (beat === 'none') return;
    const u = Math.min(1, intent.socialAge / SOCIAL_SECONDS[beat]);
    const ease = u * u * (3 - 2 * u);
    const puff = ACTIONS.puffStretch * intent.mood;
    let stretch = puff,
      crown = ACTIONS.puffReach * intent.mood,
      bend = 0;
    this.axis[0] = intent.facing[2];
    this.axis[2] = -intent.facing[0];
    if (beat === 'look') {
      stretch = puff * 0.55;
      crown *= 0.55;
      bend = -0.012 * Math.sin(Math.PI * u);
    } else if (beat === 'inflate') {
      stretch = puff * (0.55 + 0.45 * ease);
      crown *= 0.55 + 0.45 * ease;
    } else if (beat === 'stamp') {
      // One planted downward strain. The floor supplies the opposing force.
      const press = Math.sin(Math.PI * u) ** 2;
      stretch -= 0.075 * press;
      crown -= 0.025 * press;
    } else if (beat === 'wait') {
      const breath = Math.sin(intent.socialAge * 2.6) * 0.006;
      stretch += breath;
      crown += breath * 0.4;
    } else if (beat === 'soften') {
      stretch -= 0.025 * Math.sin(Math.PI * u);
      crown += 0.012 * Math.sin(Math.PI * u);
      bend = 0.015 * ease;
    } else if (beat === 'nuzzle') {
      const pulse = Math.sin(Math.PI * u) ** 2;
      stretch = -0.025 * pulse;
      bend = 0.065 * pulse;
      crown = 0.035 * pulse;
      // A small supported approach; bounded acceleration, never position writes.
      // Gait braking above and floor friction prevent continued drifting.
      const speed = 0.32 * pulse;
      const gain = 1 - Math.exp(-18 * dt);
      this.solver.kick(
        Math.max(
          -0.025,
          Math.min(0.025, (intent.facing[0] * speed - o.velocity[0]) * gain),
        ),
        0,
        Math.max(
          -0.025,
          Math.min(0.025, (intent.facing[2] * speed - o.velocity[2]) * gain),
        ),
      );
    } else if (beat === 'content') {
      // Two small buoyant pulses, then settle; the softer crown trails naturally.
      const pulse = Math.sin(u * Math.PI * 2) * Math.sin(Math.PI * u);
      const joy = 0.6 + 0.4 * (intent.joy ?? 0);
      stretch = 0.03 * pulse * joy;
      crown = 0.055 * pulse * joy;
      bend = 0.016 * Math.sin(Math.PI * u);
    }
    this.gesture.drive(pose, this.axis, stretch, bend, crown, dt);
  }
}
