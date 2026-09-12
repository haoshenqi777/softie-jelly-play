import { digestionAt, type DigestionShape } from './candy-digestion.ts';
export type IntakeStage =
  | 'idle'
  | 'pressing'
  | 'wrapping'
  | 'entering'
  | 'sealing'
  | 'inside'
  | 'dissolving'
  | 'settling'
  | 'done';
export type IntakeObservation = {
  contact: boolean;
  burial: number;
  indent: number;
  coverage?: number;
  supported?: boolean;
};
const clamp = (v: number, lo = 0, hi = 1) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Viscous-interface study: measured contact and burial gate each transition.
 * This models penetrable gel, not a cloth membrane or topology-changing fluid. */
export class ContactIntake {
  constructor(
    private options: { wettingOnIndent?: boolean; cohesive?: boolean } = {},
  ) {}
  private stage: IntakeStage = 'idle';
  private age = 0;
  private contactAge = 0;
  private supportedWetAge = 0;
  private offset = 0.3;
  private permeability = 0;
  private dissolve = 0;
  private diffusionAge = 0;
  private digestionAge = 0;
  private released = 0;
  private digestionShape: DigestionShape = { bevel: 0.045 };
  setDigestionShape(shape: DigestionShape) {
    this.digestionShape = shape;
  }
  private wrap = 0;
  start(offset = 0.3) {
    this.reset();
    this.offset = clamp(offset, -0.05, 0.4);
    this.stage = 'pressing';
  }
  releaseContact(offset: number, wrap = 0) {
    this.reset();
    this.offset = clamp(offset, -0.34, 0.3);
    this.wrap = clamp(wrap);
    this.stage = this.options.cohesive ? 'wrapping' : 'entering';
  }
  reset() {
    this.stage = 'idle';
    this.age =
      this.contactAge =
      this.supportedWetAge =
      this.permeability =
      this.dissolve =
      this.diffusionAge =
      this.digestionAge =
      this.released =
        0;
    this.offset = 0.3;
    this.wrap = 0;
  }
  private enter(stage: IntakeStage) {
    this.stage = stage;
    this.age = 0;
  }
  update(elapsed: number, observed: IntakeObservation) {
    const dt = clamp(elapsed, 0, 0.05);
    if (this.stage === 'idle' || this.stage === 'done') return this.frame();
    this.age += dt;
    if (
      this.options.cohesive &&
      ['pressing', 'wrapping', 'entering', 'sealing'].includes(this.stage)
    ) {
      if (this.stage === 'pressing') {
        this.offset += (0.075 - this.offset) * (1 - Math.exp(-dt * 3));
        this.contactAge =
          observed.contact && observed.indent > 0.012
            ? this.contactAge + dt
            : 0;
        if (this.contactAge >= 0.48) this.enter('wrapping');
      } else if (this.stage === 'wrapping') {
        this.offset +=
          (Math.min(0.045, this.offset) - this.offset) *
          (1 - Math.exp(-dt * 2));
        this.wrap = Math.min(1, this.wrap + dt / 1.05);
        // The table blocks the lower part of a collar. Requiring ten of all
        // twelve sectors there deadlocks a real eight-sector wet contact.
        // A sustained loaded majority can wet inward; full burial and skin
        // healing still gate enclosure and digestion in the following stages.
        this.supportedWetAge =
          observed.supported &&
          observed.contact &&
          observed.indent > 0.04 &&
          (observed.coverage ?? 0) >= 2 / 3 - 1e-6 &&
          this.wrap >= 0.98
            ? this.supportedWetAge + dt
            : 0;
        if (
          observed.burial > 0.075 &&
          observed.indent < 0.026 &&
          this.age > 0.9
        )
          this.enter('entering');
        if (
          this.age >= 0.9 &&
          ((observed.coverage ?? 0) >= 0.78 || this.supportedWetAge >= 0.55)
        )
          this.enter('entering');
      } else {
        this.wrap = 1;
        this.offset = Math.max(-0.43, this.offset - dt * 0.065);
        this.permeability = Math.min(1, this.permeability + dt * 0.65);
        if (this.stage === 'entering' && observed.burial > 0.012)
          this.enter('sealing');
        if (
          this.stage === 'sealing' &&
          this.permeability >= 1 &&
          observed.burial > 0.075 &&
          observed.indent < 0.026
        )
          this.enter('inside');
      }
      return this.frame();
    }
    if (this.stage === 'pressing') {
      this.offset += (-0.018 - this.offset) * (1 - Math.exp(-dt * 4));
      this.contactAge = observed.contact ? this.contactAge + dt : 0;
      if (this.contactAge > 0.34) this.enter('entering');
    } else if (this.stage === 'entering' || this.stage === 'sealing') {
      this.offset = Math.max(-0.34, this.offset - dt * 0.115);
      // Once the front face is inside, wetting may propagate around it even
      // while dense crown nodes still resist further translation. Requiring
      // additional burial here creates a force/permeability deadlock.
      // In the free-body game, a floor-supported corner can prevent the back
      // face from clearing the original tangent plane. Let measured pressure
      // wet that partly embedded contact; full burial still gates closure.
      const wetted =
        observed.burial > 0.006 ||
        (this.options.wettingOnIndent &&
          observed.contact &&
          observed.indent > 0.08 &&
          observed.burial > -0.12);
      if (wetted)
        this.permeability = Math.min(
          1,
          Math.max(this.permeability, smooth(0.006, 0.075, observed.burial)) +
            dt * 2.6,
        );
      if (this.stage === 'entering' && wetted) this.enter('sealing');
      if (
        this.permeability > 0.999 &&
        observed.indent < 0.026 &&
        observed.burial > 0.075
      )
        this.enter('inside');
    } else {
      this.offset += (-0.43 - this.offset) * (1 - Math.exp(-dt * 2));
      this.permeability = 1;
      this.digestionAge += dt;
      const digestion = digestionAt(this.digestionAge, this.digestionShape);
      this.dissolve = digestion.dissolve;
      this.released = digestion.released;
      this.diffusionAge = digestion.diffusionAge;
      if (this.stage !== digestion.stage) this.enter(digestion.stage);
    }
    return this.frame();
  }
  frame() {
    return {
      stage: this.stage,
      wrap: this.wrap,
      offset: this.offset,
      permeability: this.permeability,
      dissolve: this.dissolve,
      diffusionAge: this.diffusionAge,
      released: this.released,
    };
  }
}

/** Receding rounded-box iso-surface along stable material directions. The
 * corners round into a residual core; no billboard or whole-mesh alpha fade. */
export function erodedCandyPoint(
  p: readonly number[],
  amount: number,
  startRadius = 0.045,
): [number, number, number] {
  const u = clamp(amount);
  if (u === 0) return [p[0], p[1], p[2]];
  if (u === 1) return [0, 0, 0];
  const length = Math.hypot(...p);
  if (length < 1e-9) return [0, 0, 0];
  const nx = p[0] / length,
    ny = p[1] / length,
    nz = p[2] / length,
    half = 0.18 * (1 - u),
    radius = Math.min(half, startRadius + 0.11 * u),
    core = half - radius;
  let lo = 0,
    hi = 0.32;
  for (let i = 0; i < 16; i++) {
    const r = (lo + hi) / 2;
    const qx = Math.abs(nx * r) - core,
      qy = Math.abs(ny * r) - core,
      qz = Math.abs(nz * r) - core;
    const ox = Math.max(0, qx),
      oy = Math.max(0, qy),
      oz = Math.max(0, qz);
    const sdf =
      Math.sqrt(ox * ox + oy * oy + oz * oz) +
      Math.min(0, Math.max(qx, qy, qz)) -
      radius;
    if (sdf > 0) hi = r;
    else lo = r;
  }
  const uneven =
    1 - u * 0.025 * (0.5 + 0.5 * Math.sin(nx * 5 + ny * 3) * Math.cos(nz * 4));
  const r = Math.min(length * (1 - u), lo) * uneven;
  return [nx * r, ny * r, nz * r];
}
