import * as THREE from 'three/webgpu';
import { FaceChart, type FaceBinding } from './face-chart.ts';
import { NEUTRAL_FACE, sampleFace, type FacePose } from './expression-poses.ts';
import {
  EXPRESSIONS,
  DEFAULT_EXPRESSION,
  normalizeExpression,
  type ExpressionId,
  type ExpressionSettings,
} from './expression-settings.ts';
import { EmotionDirector, type EmotionEvent } from './emotion.ts';
import type { CharacterIntent } from './behavior-types.ts';
import { curiosityMotion } from './curiosity.ts';
import type { IntakeStage } from '../contact-intake.ts';
import type { FeedingPerformance } from './feeding-reaction.ts';
export { EXPRESSIONS } from './expression-settings.ts';
export type {
  ExpressionSettings,
  ExpressionId,
} from './expression-settings.ts';

type Part = {
  geometry: THREE.BufferGeometry;
  rest: Float32Array;
  depth: Float32Array;
  depthMid: number;
  depthHalf: number;
  cx: number;
  cy: number;
  half: number;
  halfHeight: number;
  side: number;
  mouth: boolean;
  centers: number[][];
  radial: Float32Array;
  bindings: FaceBinding[];
};
const keys = Object.keys(NEUTRAL_FACE) as (keyof FacePose)[];
const smooth = THREE.MathUtils.smootherstep;
export class ExpressionRig {
  private body: THREE.BufferGeometry;
  private bodyVersion = -1;
  private chart: FaceChart;
  private parts: Part[];
  private settings = { ...DEFAULT_EXPRESSION };
  private pose = { ...NEUTRAL_FACE };
  private age = 0;
  private phaseAge = 0;
  private lastId: ExpressionId = 'neutral';
  private blinkAge = Infinity;
  private nextBlink = 3.1;
  private blinkCount = 0;
  private gazeTarget = [0, 0];
  private gazeNow = [0, 0];
  private previousSignature = '';
  private director = new EmotionDirector();
  private interactionFace = false;
  private gentleInteraction = false;
  private character: CharacterIntent | null = null;
  private feeding: IntakeStage | null = null;
  private hopPhase = 'idle';
  setHopContext(phase: string) {
    this.hopPhase = phase;
  }
  private meal: FeedingPerformance | null = null;
  setMealContext(meal: FeedingPerformance | null) {
    this.meal = meal;
    if (meal?.active && this.settings.responsive) this.director.attend();
  }
  private mealFace(): ExpressionId | null {
    if (
      !this.meal?.active ||
      this.director.recovering ||
      (this.character &&
        [
          'held',
          'airborne',
          'landing',
          'righting',
          'orient',
          'returning',
        ].includes(this.character.phase))
    )
      return null;
    const reaction = this.director.frame().id;
    if (
      reaction === 'effort' ||
      (this.interactionFace &&
        !this.gentleInteraction &&
        reaction !== 'neutral')
    )
      return null;
    return this.meal.face;
  }
  get acceptsMealGaze() {
    return this.acceptsCharacterGaze && this.mealFace() !== null;
  }
  setFeedingContext(stage: IntakeStage | null) {
    this.feeding = stage;
  }
  setCharacterContext(intent: CharacterIntent | null) {
    this.character = intent;
  }
  private characterFace(): ExpressionId | null {
    const c = this.character;
    if (!c) return null;
    const reaction = this.director.frame().id;
    // Immediate input and physical effort overlay the durable mood. Recovery's
    // relief/pride timeline must not replace irritation that is still present.
    if (
      reaction === 'effort' ||
      (this.interactionFace &&
        !this.gentleInteraction &&
        reaction !== 'neutral')
    )
      return null;
    if (c.phase === 'airborne' && c.mood > 0.05) return 'surprised';
    if (this.feeding && this.director.recovering) return null;
    if (
      !['held', 'airborne', 'landing', 'righting'].includes(c.phase) &&
      this.feeding
    ) {
      if (this.feeding === 'pressing') return 'surprised';
      if (this.feeding === 'wrapping') return 'effort';
      if (this.feeding === 'entering') return 'effort';
      if (this.feeding === 'sealing') return 'shy';
      if (this.feeding === 'inside') return 'content';
      if (this.feeding === 'dissolving') return 'happy';
      return 'soothed';
    }
    if (c.social === 'look') return 'sad';
    if (c.social === 'soften') return 'soothed';
    if (c.social === 'nuzzle') return 'content';
    if (c.social === 'content') return c.socialAge < 1.1 ? 'happy' : 'content';
    if (c.mood > 0) return 'angry';
    if (c.phase === 'held') return null;
    if (c.candy) {
      if (c.phase === 'collecting') {
        if (this.hopPhase === 'gather') return 'effort';
        if (this.hopPhase === 'flight') return 'happy';
        if (this.hopPhase === 'land') return 'content';
      }
      return c.phase === 'noticing' ? 'peek' : 'curious';
    }
    if (c.body === 'curious') return 'peek';
    if (c.body === 'rest') return 'sleepy';
    if (c.body === 'stretch') return 'content';
    return null;
  }

  constructor(body: THREE.BufferGeometry, meshes: THREE.Mesh[]) {
    this.body = body;
    this.chart = new FaceChart(body);
    this.parts = meshes
      .filter((m) => m.name.startsWith('Eye') || m.name === 'Smile')
      .map((m) => {
        const g = m.geometry;
        g.morphAttributes = {};
        g.computeBoundingBox();
        const box = g.boundingBox!;
        const rest = Float32Array.from(g.getAttribute('position').array);
        const depth = new Float32Array(rest.length / 3);
        for (let i = 0; i < depth.length; i++)
          depth[i] =
            rest[i * 3 + 2] - this.chart.bind(rest[i * 3], rest[i * 3 + 1]).z;
        const centers: number[][] = [];
        const radial = new Float32Array(depth.length);
        if (m.name === 'Smile') {
          if (depth.length !== 410)
            throw new Error('Approved mouth topology changed');
          for (let r = 0; r < 41; r++) {
            const c = [0, 0, 0];
            for (let v = 0; v < 10; v++)
              for (let k = 0; k < 3; k++)
                c[k] += rest[(r * 10 + v) * 3 + k] / 10;
            centers.push(c);
          }
          for (let i = 0; i < depth.length; i++) {
            const r = Math.floor(i / 10),
              c = centers[r];
            const a = centers[Math.max(0, r - 1)],
              b = centers[Math.min(40, r + 1)];
            const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
            radial[i] =
              (rest[i * 3] - c[0]) * -Math.sin(angle) +
              (rest[i * 3 + 1] - c[1]) * Math.cos(angle);
          }
        }
        (g.getAttribute('position') as THREE.BufferAttribute).setUsage(
          THREE.DynamicDrawUsage,
        );
        const lo = Math.min(...depth),
          hi = Math.max(...depth);
        return {
          geometry: g,
          rest,
          depth,
          radial,
          depthMid: (lo + hi) / 2,
          depthHalf: (hi - lo) / 2,
          cx: (box.min.x + box.max.x) / 2,
          cy: (box.min.y + box.max.y) / 2,
          half: (box.max.x - box.min.x) / 2,
          halfHeight: (box.max.y - box.min.y) / 2,
          side: box.max.x < 0 ? -1 : 1,
          mouth: m.name === 'Smile',
          centers,
          bindings: [],
        };
      });
    this.update(0);
  }
  configure(values: Partial<ExpressionSettings>) {
    const next = normalizeExpression(values, this.settings);
    if (next.responsive && !this.settings.responsive) {
      this.director.reset();
      this.interactionFace = false;
    }
    if (values.expression || values.sequence === true) this.phaseAge = 0;
    if (values.sequence === true) this.age = 0;
    this.settings = next;
  }
  get acceptsCharacterGaze() {
    return (
      this.settings.responsive && !this.settings.sequence && this.settings.gaze
    );
  }
  notify(event: EmotionEvent, amount?: number) {
    if (!this.settings.responsive) return;
    this.director.notify(event, amount);
    if (event === 'touch' || event === 'stroke') this.gentleInteraction = true;
    else if (
      ['poke', 'stretch', 'food', 'withdraw', 'fed', 'sleep'].includes(event)
    )
      this.gentleInteraction = false;
    if (
      [
        'touch',
        'poke',
        'stroke',
        'stretch',
        'food',
        'withdraw',
        'fed',
        'sleep',
      ].includes(event)
    )
      this.interactionFace = this.director.frame().id !== 'neutral';
    else if (
      event === 'stumble' ||
      event === 'righting' ||
      event === 'recovered'
    )
      this.interactionFace = false;
  }
  reset() {
    this.meal = null;
    this.director.reset();
    this.interactionFace = false;
    this.gentleInteraction = false;
    this.look(0, 0);
  }
  blink() {
    if (this.blinkAge >= 0.28) this.blinkAge = 0;
  }
  look(x: number, y: number) {
    if (Number.isFinite(x) && Number.isFinite(y))
      this.gazeTarget = [
        THREE.MathUtils.clamp(x, -1, 1),
        THREE.MathUtils.clamp(y, -1, 1),
      ];
  }
  stats() {
    return {
      ...this.settings,
      active: this.active(),
      blink: this.blinkAge < 0.28,
      phaseAge: this.phaseAge,
      emotion: this.director.frame(),
    };
  }
  private active(): ExpressionId {
    return this.settings.sequence
      ? EXPRESSIONS[Math.floor(this.age / 3.2) % EXPRESSIONS.length].id
      : this.settings.responsive
        ? (this.mealFace() ?? this.characterFace() ?? this.director.frame().id)
        : this.settings.expression;
  }
  update(elapsed: number) {
    const dt = Number.isFinite(elapsed)
      ? Math.max(0, Math.min(0.1, elapsed))
      : 0;
    this.age += dt;
    if (this.settings.responsive) this.director.update(dt);
    if (this.director.frame().id === 'neutral') this.interactionFace = false;
    const id = this.active();
    if (id !== this.lastId) {
      this.phaseAge = 0;
      this.lastId = id;
    }
    this.phaseAge += dt;
    this.blinkAge += dt;
    this.nextBlink -= dt;
    if (this.settings.autoBlink && this.nextBlink <= 0) {
      this.blink();
      this.nextBlink = 2.7 + ((++this.blinkCount * 1.618) % 1) * 2;
    }
    const target = sampleFace(id, this.phaseAge, this.settings.microMotion);
    const mealFace =
      this.settings.responsive && !this.settings.sequence
        ? this.mealFace()
        : null;
    if (mealFace && this.meal) Object.assign(target, this.meal.pose);
    if (
      this.settings.responsive &&
      !this.settings.sequence &&
      id === 'curious' &&
      this.character?.candy?.stage === 'inspecting'
    ) {
      const scan = curiosityMotion(this.character.candy.age);
      target.lookX = 0;
      target.lookY = -0.15;
      target.lidL = scan.gazeX < 0 ? 1 - scan.lid : 1;
      target.lidR = scan.gazeX > 0 ? 1 - scan.lid : 1;
      target.mouthOpen = 0.35 + Math.abs(scan.gazeX) * 0.12;
      target.mouthSkew = scan.gazeX * 0.004;
    }
    const characterFace = this.characterFace();
    const characterStrength =
      characterFace === 'angry'
        ? THREE.MathUtils.smoothstep(this.character?.mood ?? 0, 0, 0.6)
        : Math.max(0.65, this.character?.mood ?? 0, this.character?.joy ?? 0);
    const strength =
      (this.settings.intensity / 100) *
      (this.settings.responsive
        ? mealFace
          ? this.meal!.strength
          : characterFace
            ? characterStrength
            : this.director.frame().strength
        : 1);
    const rate = 3 + this.settings.speed * 0.14;
    for (const key of keys) {
      // Retain current channels on interruption, with slight eye/mouth overlap.
      const delay = key.startsWith('mouth')
        ? id === 'surprised'
          ? 0.025
          : 0.1
        : key.endsWith('R') && ['giggle', 'waking', 'soothed'].includes(id)
          ? 0.065
          : 0;
      const blend = this.phaseAge < delay ? 0 : 1 - Math.exp(-dt * rate);
      const value =
        NEUTRAL_FACE[key] + (target[key] - NEUTRAL_FACE[key]) * strength;
      this.pose[key] += (value - this.pose[key]) * blend;
      if (Math.abs(value - this.pose[key]) < 1e-5) this.pose[key] = value;
    }
    for (let k = 0; k < 2; k++) {
      const targetGaze = this.settings.gaze ? this.gazeTarget[k] : 0;
      this.gazeNow[k] +=
        (targetGaze - this.gazeNow[k]) * (1 - Math.exp(-dt * 9));
      if (Math.abs(this.gazeNow[k] - targetGaze) < 1e-5)
        this.gazeNow[k] = targetGaze;
    }
    const blink =
      this.blinkAge < 0.28
        ? Math.sin((Math.PI * this.blinkAge) / 0.28) ** 2
        : 0;
    const signature = [...Object.values(this.pose), ...this.gazeNow, blink]
      .map((n) => n.toFixed(5))
      .join(',');
    const changed = signature !== this.previousSignature;
    if (changed) {
      this.previousSignature = signature;
      for (const part of this.parts) {
        part.bindings = [];
        if (part.mouth) this.bindMouth(part);
        else this.bindEye(part, blink);
      }
    }
    const version = (
      this.body.getAttribute('position') as THREE.BufferAttribute
    ).version;
    if (changed || version !== this.bodyVersion) {
      for (const p of this.parts) this.chart.apply(p.bindings, p.geometry);
      this.bodyVersion = version;
    }
  }
  private bindEye(p: Part, blink: number) {
    const suffix = p.side < 0 ? 'L' : 'R';
    const value = (name: string) =>
      this.pose[(name + suffix) as keyof FacePose];
    const close = 1 - (1 - value('close')) * (1 - blink);
    const gx = this.gazeNow[0] * 0.032 + this.pose.lookX * 0.04;
    const gy = this.gazeNow[1] * 0.022 + this.pose.lookY * 0.025;
    for (let i = 0; i < p.depth.length; i++) {
      const dx = p.rest[i * 3] - p.cx,
        dy = p.rest[i * 3 + 1] - p.cy;
      const u = THREE.MathUtils.clamp(dx / p.half, -1, 1),
        v = dy / p.halfHeight;
      const radius = Math.sqrt(Math.max(0, 1 - u * u));
      const ceiling = Math.max(
        -radius + 0.001,
        Math.min(
          radius,
          value('lid') + value('slope') * u + value('lidCurve') * (1 - u * u),
        ),
      );
      const floor = Math.min(
        ceiling - 0.001,
        Math.max(-radius, value('lower')),
      );
      // Move lids independently; the untouched edge stays a rounded bean.
      let openY = dy;
      if (radius > 0.0001 && (ceiling < radius || floor > -radius))
        openY =
          p.halfHeight *
          (floor + ((v + radius) / (2 * radius)) * (ceiling - floor));
      const denom = Math.max(0.27, radius);
      let curveX = p.cx + dx * value('width');
      let curveY = p.cy + value('arc') * (1 - u * u) + (0.016 * v) / denom;
      let curveDepth =
        0.014 +
        (0.014 * (p.depth[i] - p.depthMid)) /
          Math.max(0.001, p.depthHalf) /
          denom;
      if (this.pose.pinch > 0) {
        const q = Math.sqrt(Math.max(0, 1 - v * v)),
          d = Math.max(0.27, q);
        const pinchX =
          p.cx -
          p.side * (0.018 + 0.078 * (1 - Math.sqrt(v * v + 0.035 * 0.035))) +
          (0.016 * u) / d;
        const pinchY = p.cy + v * 0.072;
        curveX += (pinchX - curveX) * this.pose.pinch;
        curveY += (pinchY - curveY) * this.pose.pinch;
        curveDepth +=
          (0.014 +
            (0.014 * (p.depth[i] - p.depthMid)) /
              Math.max(0.001, p.depthHalf) /
              d -
            curveDepth) *
          this.pose.pinch;
      }
      const px =
        p.cx + dx * value('width') * (1 - close) + (curveX - p.cx) * close + gx;
      const py =
        (p.cy + openY * value('height')) * (1 - close) +
        curveY * close +
        value('lift') +
        gy;
      const depth = p.depth[i] * (1 - close) + curveDepth * close;
      p.bindings.push(this.chart.bind(px, py, depth));
    }
  }
  private bindMouth(p: Part) {
    const pose = this.pose,
      open = smooth(pose.mouthOpen, 0, 0.25);
    const gx = this.gazeNow[0] * 0.008 + pose.lookX * 0.006;
    const centers = p.centers.map((base, r) => {
      const t = r / 40,
        angle = t * Math.PI * 2,
        u = 2 * t - 1;
      const rx =
        (0.028 + pose.mouthOpen * 0.009) * pose.mouthRound +
        0.064 * (1 - pose.mouthRound);
      const ry = 0.028 + pose.mouthOpen * 0.024;
      const co = Math.cos(angle);
      return [
        base[0] * pose.mouthWidth * (1 - open) - Math.sin(angle) * rx * open,
        (p.cy +
          (base[1] - p.cy) * pose.mouthSmile +
          pose.mouthSkew * u +
          pose.mouthWave * Math.sin(t * Math.PI * 4)) *
          (1 - open) +
          (p.cy + ry * co * (co > 0 ? 0.18 + 0.82 * pose.mouthRound : 1)) *
            open,
      ];
    });
    for (let i = 0; i < p.depth.length; i++) {
      const r = Math.floor(i / 10),
        c = centers[r],
        a = centers[Math.max(0, r - 1)],
        b = centers[Math.min(40, r + 1)];
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let x = c[0] - Math.sin(angle) * p.radial[i] + gx;
      let y = c[1] + Math.cos(angle) * p.radial[i];
      if (
        open === 0 &&
        pose.mouthSmile === 1 &&
        pose.mouthWidth === 1 &&
        pose.mouthSkew === 0 &&
        pose.mouthWave === 0
      ) {
        x = p.rest[i * 3] + gx;
        y = p.rest[i * 3 + 1];
      }
      p.bindings.push(this.chart.bind(x, y, p.depth[i]));
    }
  }
}
