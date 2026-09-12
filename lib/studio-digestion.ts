import * as THREE from 'three/webgpu';
import { CandyRenderer } from './candy-renderer.ts';
import { CandyWorld, candyBevel, BASE_CANDY_RADIUS } from './candy-physics.ts';
import { ContactCandy } from './contact-candy.ts';
import {
  DIGESTION,
  digestionAt,
  type DigestionShape,
} from './candy-digestion.ts';
import { PLAY_PIGMENTS, type PigmentId } from './studio-pigment.ts';
import type { AbsorptionField } from './absorption-field.ts';
import type { AbsorptionInterior } from './absorption-interior.ts';
import type { SlimeOptics } from './slime-optics.ts';

export type DigestionCommand = {
  time?: number;
  playing?: boolean;
  speed?: number;
  kind?: 'cube' | 'round';
  pigment?: PigmentId;
};
export type DigestionSnapshot = ReturnType<typeof digestionAt> & {
  playing: boolean;
  speed: number;
  kind: 'cube' | 'round';
  pigment: PigmentId;
};

/** Inspection only: seek the exact product core and dye through internal
 * digestion, without having to replay contact physics for every comparison. */
export class StudioDigestion {
  private time = 0;
  private playing = false;
  private speed = 1;
  private kind: 'cube' | 'round' = 'cube';
  private pigment: PigmentId = 'sky';
  private shape: DigestionShape = { bevel: 0.045 };
  private renderer: CandyRenderer;
  private world = new CandyWorld();
  private visual: ContactCandy | null = null;
  private center = new THREE.Vector3(-0.5, 1, 0.8);
  constructor(
    private body: THREE.Mesh,
    private scene: THREE.Scene,
    private environment: THREE.Texture,
    private optics: SlimeOptics,
    private interior: AbsorptionInterior,
    private field: AbsorptionField,
  ) {
    this.renderer = new CandyRenderer(new THREE.Scene());
    this.rebuild();
  }
  private rebuild() {
    this.visual?.dispose();
    this.world.reset();
    this.renderer.update([]);
    const hex = PLAY_PIGMENTS.find((p) => p.id === this.pigment)!.swatch;
    const candy = this.world.spawn(
      hex,
      this.kind,
      { x: 0, y: 1, z: 0 },
      undefined,
      0.18,
    );
    candy.rx = candy.ry = candy.rz = 0;
    this.renderer.update(this.world.candies);
    const source = this.renderer.mesh(candy.id)!;
    const bevel = candyBevel(candy.kind, candy.radius);
    this.shape = this.kind === 'round' ? 'round' : { bevel };
    this.visual = new ContactCandy(
      this.scene,
      this.environment,
      this.optics,
      this.interior,
      {
        geometry: source.geometry,
        half: candy.radius,
        hex,
        round: this.kind === 'round',
        rigid: true,
        bevel,
        scale: candy.radius / BASE_CANDY_RADIUS,
        material: source.material as THREE.MeshPhysicalNodeMaterial,
      },
    );
    this.body.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(
      new THREE.Vector3(-0.55, 1.05, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(this.body)[0];
    if (hit)
      this.center.copy(hit.point).addScaledVector(hit.normal!, -0.18 - 0.08);
    this.visual.exterior.position.copy(this.center);
    this.field.select('rose');
    this.field.beginDye(this.pigment, this.center);
    this.apply();
  }
  configure(v: DigestionCommand) {
    let rebuild = false;
    if (v.kind && v.kind !== this.kind) {
      this.kind = v.kind;
      rebuild = true;
    }
    if (
      v.pigment &&
      PLAY_PIGMENTS.some((p) => p.id === v.pigment) &&
      v.pigment !== this.pigment
    ) {
      this.pigment = v.pigment;
      rebuild = true;
    }
    if (v.time !== undefined && Number.isFinite(v.time))
      this.time = THREE.MathUtils.clamp(v.time, 0, DIGESTION.total);
    if (v.playing !== undefined) this.playing = v.playing;
    if (v.speed !== undefined && Number.isFinite(v.speed))
      this.speed = THREE.MathUtils.clamp(v.speed, 0.1, 1);
    if (rebuild) this.rebuild();
    else this.apply();
  }
  private apply() {
    const f = digestionAt(this.time, this.shape);
    this.visual!.exterior.position.copy(this.center);
    this.visual!.update(f.dissolve);
    this.field.updateDigestion(f);
    return this.stats();
  }
  update(dt: number) {
    if (this.playing) {
      this.time = Math.min(
        DIGESTION.total,
        this.time + Math.max(0, Math.min(0.05, dt)) * this.speed,
      );
      if (this.time >= DIGESTION.total) this.playing = false;
    }
    return this.apply();
  }
  stats(): DigestionSnapshot {
    return {
      ...digestionAt(this.time, this.shape),
      playing: this.playing,
      speed: this.speed,
      kind: this.kind,
      pigment: this.pigment,
    };
  }
  dispose() {
    this.visual?.dispose();
    this.renderer.dispose();
  }
}
