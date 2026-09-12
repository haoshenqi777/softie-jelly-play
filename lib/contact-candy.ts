import * as THREE from 'three/webgpu';
import { candyCompressionMatrix } from './candy-deformation.ts';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  color,
  float,
  mix,
  normalView,
  positionLocal,
  positionView,
  uniform,
  vec3,
} from 'three/tsl';
import type { SlimeOptics } from './slime-optics';
import type { AbsorptionInterior } from './absorption-interior';
import { erodedCandyPoint } from './contact-intake.ts';
import { internalCandyColor } from './hard-candy-material.ts';

/** Exterior and refracted interior are two depth masks of the same 3D core. */
export class ContactCandy {
  readonly exterior: THREE.Mesh;
  private interior: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry;
  private rest: Float32Array;
  private normals: Float32Array;
  private materials: THREE.Material[] = [];
  private lastDissolve = -1;
  private enabled = uniform(1);
  private erosion = uniform(0);
  private compressionMatrix = new THREE.Matrix4();
  constructor(
    scene: THREE.Scene,
    environment: THREE.Texture,
    optics?: SlimeOptics,
    private capture?: AbsorptionInterior,
    private shape?: {
      geometry: THREE.BufferGeometry;
      half: number;
      hex: string;
      round?: boolean;
      rigid?: boolean;
      bevel?: number;
      scale?: number;
      material?: THREE.MeshPhysicalNodeMaterial;
    },
  ) {
    const raw =
      shape?.geometry.clone() ??
      new RoundedBoxGeometry(0.36, 0.36, 0.36, 5, 0.045);
    if (shape?.scale) raw.scale(shape.scale, shape.scale, shape.scale);
    if (shape) {
      // Keep the source topology and normals at handoff, including UV seams.
      this.geometry = raw;
    } else {
      raw.deleteAttribute('uv');
      this.geometry = mergeVertices(raw, 0.0001);
      raw.dispose();
    }
    this.rest = Float32Array.from(this.geometry.attributes.position.array);
    this.normals = Float32Array.from(this.geometry.attributes.normal.array);
    const sugar = positionLocal
      .dot(vec3(13.1, 37.7, 19.4))
      .mul(155)
      .sin()
      .mul(438.13)
      .fract()
      .smoothstep(0.97, 1);
    const outer =
      shape?.material?.clone() ??
      new THREE.MeshPhysicalNodeMaterial({
        color: shape?.hex ?? '#afce83',
        roughness: 0.26,
        clearcoat: 0.55,
        clearcoatRoughness: 0.13,
        envMap: environment,
        envMapIntensity: 0.8,
        transparent: true,
        depthWrite: false,
      });
    if (shape?.material) {
      // NodeMaterial.copy retains node graphs, but this Three.js version does
      // not copy the physical scalar properties inherited via setDefaultValues.
      const source = shape.material;
      outer.setValues({
        color: source.color.clone(),
        roughness: source.roughness,
        metalness: source.metalness,
        transmission: source.transmission,
        thickness: source.thickness,
        ior: source.ior,
        attenuationColor: source.attenuationColor.clone(),
        attenuationDistance: source.attenuationDistance,
        clearcoat: source.clearcoat,
        clearcoatRoughness: source.clearcoatRoughness,
        envMap: source.envMap,
        envMapIntensity: source.envMapIntensity,
      });
    }
    if (!shape?.material)
      outer.colorNode = mix(
        color(shape?.hex ?? '#afce83'),
        color('#e4edc8'),
        sugar.mul(0.28),
      );
    this.exterior = new THREE.Mesh(this.geometry, outer);
    this.exterior.name = 'ContactStudy.Candy';
    this.exterior.renderOrder = 1;
    this.exterior.frustumCulled = false;
    scene.add(this.exterior);
    this.materials.push(outer);
    if (optics && capture) {
      const depth = positionView.z.negate(),
        inBody = optics.front
          .greaterThan(0.001)
          .and(depth.greaterThanEqual(optics.front))
          .and(depth.lessThanEqual(optics.back));
      const active = this.enabled.greaterThan(0.5);
      outer.maskNode = active.not().or(inBody.not());
      const burial = depth.sub(optics.front).max(0);
      const inner = new THREE.MeshPhysicalNodeMaterial({
        roughness: 0.28,
        // Sugar surrounded by gel has a much weaker index contrast than
        // sugar surrounded by air; an air clearcoat makes it look pasted on.
        ior: shape?.material ? shape.material.ior / 1.34 : 1.12,
        clearcoat: 0,
        clearcoatRoughness: 0.16,
        envMap: environment,
        envMapIntensity: shape?.material?.envMap
          ? shape.material.envMapIntensity
          : scene.environmentIntensity,
        transparent: false,
        depthWrite: true,
      });
      inner.colorNode = mix(
        color(shape?.hex ?? '#a8cc90'),
        color('#e1ecc4'),
        sugar.mul(0.2),
      ).mul(
        vec3(
          burial.mul(-0.22).exp(),
          burial.mul(-0.36).exp(),
          burial.mul(-0.29).exp(),
        ),
      );
      if (shape?.material?.normalNode) {
        // Wet grains soften only as real erosion progresses, not on contact.
        const dissolved = this.erosion.smoothstep(0.55, 1);
        inner.normalNode = mix(
          vec3(outer.normalNode!),
          normalView,
          dissolved.mul(0.65),
        );
        inner.roughnessNode = mix(float(outer.roughnessNode!), 0.28, dissolved);
        inner.colorNode = internalCandyColor(outer).mul(
          vec3(
            burial.mul(-0.22).exp(),
            burial.mul(-0.36).exp(),
            burial.mul(-0.29).exp(),
          ),
        );
      }
      // Keep the actual core opaque. Overlying gel attenuates light in the
      // body composite; fading this capture too erased its surface texture.
      inner.maskNode = active.and(inBody);
      this.interior = new THREE.Mesh(this.geometry, inner);
      this.interior.name = 'ContactStudy.InternalCandy';
      this.interior.frustumCulled = false;
      capture.root.add(this.interior);
      this.materials.push(inner);
    }
  }
  setActive(active: boolean) {
    this.enabled.value = active ? 1 : 0;
    this.exterior.visible = active && this.lastDissolve < 0.9999;
  }
  update(dissolve: number, compression = 0, axis?: ArrayLike<number>) {
    this.erosion.value = dissolve;
    if (dissolve !== this.lastDissolve) {
      const p = this.geometry.attributes.position as THREE.BufferAttribute;
      if (dissolve === 0) {
        (p.array as Float32Array).set(this.rest);
        (this.geometry.attributes.normal.array as Float32Array).set(
          this.normals,
        );
        this.geometry.attributes.normal.needsUpdate = true;
      } else {
        const scale = (this.shape?.half ?? 0.18) / 0.18;
        for (let i = 0; i < p.count; i++) {
          const rest: [number, number, number] = [
            this.rest[i * 3],
            this.rest[i * 3 + 1],
            this.rest[i * 3 + 2],
          ];
          const xyz = this.shape?.round
            ? rest.map((v) => v * (1 - dissolve))
            : erodedCandyPoint(
                rest.map((v) => v / scale) as [number, number, number],
                dissolve,
                this.shape?.bevel !== undefined
                  ? this.shape.bevel / scale
                  : 0.045,
              ).map((v) => v * scale);
          p.setXYZ(i, xyz[0], xyz[1], xyz[2]);
        }
        if (dissolve < 1) this.geometry.computeVertexNormals();
      }
      p.needsUpdate = true;
      this.geometry.computeBoundingSphere();
      this.lastDissolve = dissolve;
    }
    this.exterior.visible = this.enabled.value > 0.5 && dissolve < 0.9999;
    if (this.shape) {
      this.exterior.matrixAutoUpdate = false;
      this.exterior.updateMatrix();
      candyCompressionMatrix(
        this.compressionMatrix,
        this.shape.round || this.shape.rigid ? 0 : compression,
        axis,
      );
      this.exterior.matrix.premultiply(this.compressionMatrix);
      const p = this.exterior.position;
      this.exterior.matrix.setPosition(p.x, p.y, p.z);
      this.exterior.matrixWorldNeedsUpdate = true;
    }
    if (this.interior) {
      this.interior.position.copy(this.exterior.position);
      this.interior.quaternion.copy(this.exterior.quaternion);
      if (this.shape) {
        this.interior.matrixAutoUpdate = false;
        this.interior.matrix.copy(this.exterior.matrix);
        this.interior.matrixWorldNeedsUpdate = true;
      }
      // An inactive core is discarded by a uniform, so its pipeline is warmed
      // on the first free-candy frame instead of the first contact frame.
      this.interior.visible = dissolve < 0.9999;
    }
    if (this.capture) {
      if (this.shape)
        this.capture.center.setFromMatrixPosition(this.exterior.matrix);
      else this.capture.center.copy(this.exterior.position);
    }
  }
  dispose() {
    this.exterior.removeFromParent();
    this.interior?.removeFromParent();
    this.geometry.dispose();
    this.materials.forEach((m) => m.dispose());
  }
}
