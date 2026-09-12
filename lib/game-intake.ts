import * as THREE from 'three/webgpu';
import type { VolumeInteraction } from './softbody/interaction.ts';
import type { StudioCandies } from './studio-candies.ts';
import type { AbsorptionField } from './absorption-field.ts';
import type { AbsorptionInterior } from './absorption-interior.ts';
import type { SlimeOptics } from './slime-optics.ts';
import { ContactCandy } from './contact-candy.ts';
import type { BodyIntake } from './softbody/body-intake.ts';
import {
  BASE_CANDY_RADIUS,
  roundCandy,
  candyBevel,
  type CandyBody,
  type CandyCollider,
} from './candy-physics.ts';
import type { PigmentId } from './studio-pigment.ts';
import type { MaterialAnchor } from './softbody/material-anchor.ts';

/** One real free candy owns the pressure, core and dye until it is absorbed. */
export class GameIntake {
  readonly mechanics: BodyIntake;
  private visual: ContactCandy | null = null;
  private prepared = new Map<
    number,
    {
      visual: ContactCandy;
      source: THREE.Mesh;
      material: THREE.Material | THREE.Material[];
      renderOrder: number;
    }
  >();
  private id: number | null = null;
  private completed = 0;
  private colorOverride = false;
  private beforeMeal: unknown = null;
  private dyeStarted = false;
  private nextPigment: PigmentId = 'mint';
  private nextSource = new THREE.Vector3();
  selectColor(id: PigmentId, strength = 100, hue = 0) {
    this.colorOverride = true;
    this.field.select(id, strength, hue);
  }
  saveColor() {
    this.colorOverride = true;
    return this.field.freeze();
  }
  restoreColor(value: unknown) {
    this.colorOverride = true;
    this.field.restore(value);
  }
  private restFrame = new THREE.Matrix4();
  private dyeAnchor: MaterialAnchor;
  private currentFrame = new THREE.Matrix4();
  private unit = new THREE.Vector3(1, 1, 1);
  constructor(
    private volume: VolumeInteraction,
    private candies: StudioCandies,
    private field: AbsorptionField,
    private rendering?: {
      scene: THREE.Scene;
      environment: THREE.Texture;
      optics: SlimeOptics;
      interior: AbsorptionInterior;
    },
  ) {
    this.mechanics = volume.enableIntake();
    this.dyeAnchor = volume.materialAnchor(
      new THREE.Vector3(0, 1, 1),
      new THREE.Vector3(0, 0, 1),
    );
    const baseFrame = this.dyeAnchor.sample(volume.solver.rest);
    this.restFrame.compose(baseFrame.point, baseFrame.rotation, this.unit);
    this.field.select('rose');
    candies.onMeshCreated = (c, source) => this.prepareVisual(c, source);
    candies.onMeshRemoved = (id) => this.removeVisual(id);
    const capture =
      (held: boolean): NonNullable<CandyCollider['capture']> =>
      (c, point, normal) => {
        if (volume.held || this.mechanics.active) return false;
        const n = new THREE.Vector3().copy(normal);
        const p = new THREE.Vector3().copy(point);
        if (
          !(held
            ? this.mechanics.beginHeld(c, p, n)
            : this.mechanics.begin(c, p, n))
        )
          return false;
        this.id = c.id;
        this.colorOverride = false;
        this.beforeMeal = this.field.freeze();
        this.dyeStarted = false;
        this.nextPigment = c.pigment ?? (c.kind === 'gummy' ? 'mint' : 'honey');
        const a = this.mechanics.anchor!,
          rest = a.sample(volume.solver.rest);
        this.dyeAnchor = a;
        this.restFrame.compose(rest.point, rest.rotation, this.unit);
        this.nextSource
          .copy(a.restPoint)
          .addScaledVector(rest.normal, -c.radius * 1.4);
        const source = candies.mesh(c.id);
        if (rendering && source) {
          this.visual = this.prepareVisual(c, source);
          this.visual?.setActive(true);
        }
        volume.expression.blink();
        return true;
      };
    candies.onContact = capture(false);
    candies.onHandContact = capture(true);
    candies.onHandContactAllowed = (hit) =>
      this.mechanics.allowsHeldContact(hit);
    candies.onHandPressure = (depth) => this.mechanics.setPressure(depth);
    candies.onHandRelease = (cancelled) => {
      this.mechanics.releaseHeld(cancelled);
    };
    candies.onClear = () => this.clear();
  }
  private prepareVisual(c: CandyBody, source: THREE.Mesh) {
    if (!this.rendering) return null;
    const existing = this.prepared.get(c.id);
    if (existing) return existing.visual;
    const { scene, environment, optics, interior } = this.rendering;
    const visual = new ContactCandy(scene, environment, optics, interior, {
      geometry: source.geometry,
      half: c.radius,
      hex: c.hex,
      round: roundCandy(c.kind),
      rigid: c.kind !== 'gummy',
      bevel: c.kind === 'cube' ? candyBevel(c.kind, c.radius) : undefined,
      scale: c.radius / BASE_CANDY_RADIUS,
      material: source.material as THREE.MeshPhysicalNodeMaterial,
    });
    this.prepared.set(c.id, {
      visual,
      source,
      material: source.material,
      renderOrder: source.renderOrder,
    });
    // The free mesh warms the exact exterior shader used during absorption.
    // Contact changes only uniforms and ownership, not material or topology.
    source.material = visual.exterior.material;
    source.renderOrder = visual.exterior.renderOrder;
    visual.exterior.position.setFromMatrixPosition(source.matrix);
    visual.exterior.quaternion.copy(source.quaternion);
    visual.update(0, c.compression, c.compressionAxis);
    visual.setActive(false);
    return visual;
  }
  private removeVisual(id: number) {
    const entry = this.prepared.get(id);
    if (!entry) return;
    entry.source.material = entry.material;
    entry.source.renderOrder = entry.renderOrder;
    if (this.visual === entry.visual) this.visual = null;
    entry.visual.dispose();
    this.prepared.delete(id);
  }
  update() {
    const material = this.dyeAnchor.sample(this.volume.solver.x);
    this.currentFrame
      .compose(material.point, material.rotation, this.unit)
      .invert();
    this.field.worldToRest.value
      .copy(this.restFrame)
      .multiply(this.currentFrame);
    if (this.id === null) return;
    const c = this.mechanics.candy,
      a = this.mechanics.anchor,
      f = this.mechanics.frame();
    if (!c || !a || f.stage === 'idle') {
      this.clear();
      return;
    }
    if (this.visual) {
      this.visual.exterior.position.set(c.x, c.y, c.z);
      this.visual.exterior.rotation.set(c.rx, c.ry, c.rz);
      this.visual.update(f.dissolve, c.compression, c.compressionAxis);
    }
    if (!this.colorOverride && f.dissolve > 0) {
      if (!this.dyeStarted) {
        this.field.beginDye(this.nextPigment, this.nextSource);
        this.dyeStarted = true;
      }
      this.field.updateDigestion(f);
    }
    if (f.stage === 'done') {
      this.candies.remove(this.id);
      if (!this.colorOverride) this.field.commit();
      this.completed++;
      this.visual = null;
      this.id = null;
      this.beforeMeal = null;
    }
  }
  clear() {
    this.mechanics.reset();
    this.visual?.setActive(false);
    this.visual?.update(0);
    this.visual = null;
    this.id = null;
    if (!this.colorOverride && this.beforeMeal)
      this.field.restore(this.beforeMeal);
    this.beforeMeal = null;
  }
  stats() {
    return {
      ...this.mechanics.frame(),
      completed: this.completed,
      pigment: this.field.state,
    };
  }
  dispose() {
    this.clear();
    for (const id of this.prepared.keys()) this.removeVisual(id);
    this.candies.onContact = undefined;
    this.candies.onHandContact = undefined;
    this.candies.onHandContactAllowed = undefined;
    this.candies.onHandPressure = undefined;
    this.candies.onHandRelease = undefined;
    this.candies.onClear = undefined;
    this.candies.onMeshCreated = undefined;
    this.candies.onMeshRemoved = undefined;
  }
}
