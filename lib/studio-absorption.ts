import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  color,
  mix,
  positionLocal,
  positionView,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import type { SlimeOptics } from './slime-optics';
import { AbsorptionField } from './absorption-field.ts';
import type { AbsorptionInterior } from './absorption-interior';
import {
  AbsorptionTimeline,
  deformAbsorptionPoint,
  type Point3,
} from './absorption-motion.ts';

/** Single-candy lookdev adapter. Geometry and candy poses are sampled from rest
 * on every seek, so review is deterministic in either playback direction. */
export class StudioAbsorption {
  readonly timeline = new AbsorptionTimeline();
  readonly field: AbsorptionField;
  private skins: {
    mesh: THREE.Mesh;
    rest: Float32Array;
    normals: Float32Array;
  }[];
  private candyGeometry = (() => {
    const raw = new RoundedBoxGeometry(0.3, 0.3, 0.3, 5, 0.06);
    raw.deleteAttribute('uv');
    const welded = mergeVertices(raw, 0.0001);
    raw.dispose();
    return welded;
  })();
  private candyNormals = new Float32Array(
    this.candyGeometry.attributes.normal.array,
  );
  private candyRest: Float32Array;
  private exterior: THREE.Mesh;
  private interior: THREE.Mesh;
  private shadow: THREE.Mesh;
  private opacity = uniform(1);
  private shadowAlpha = uniform(1);
  private resources: { dispose(): void }[] = [];
  private lastTime = -1;
  private q: Point3 = [0, 0, 0];
  private candyOptics: AbsorptionInterior;

  constructor(
    body: THREE.Mesh,
    parts: THREE.Mesh[],
    scene: THREE.Scene,
    optics: SlimeOptics,
    environment: THREE.Texture,
    field: AbsorptionField,
    candyOptics: AbsorptionInterior,
  ) {
    this.field = field;
    this.candyOptics = candyOptics;
    this.skins = parts.map((mesh) => {
      // Body geometry is cloned before SlimeOptics binds its front/back mesh.
      if (mesh !== body) {
        mesh.geometry = mesh.geometry.clone();
        this.resources.push(mesh.geometry);
      }
      const rest = new Float32Array(mesh.geometry.attributes.position.array);
      const normals = new Float32Array(mesh.geometry.attributes.normal.array);
      if (mesh === body)
        mesh.geometry.setAttribute(
          'absorptionRest',
          new THREE.BufferAttribute(rest, 3),
        );
      (mesh.geometry.attributes.position as THREE.BufferAttribute).setUsage(
        THREE.DynamicDrawUsage,
      );
      return { mesh, rest, normals };
    });
    this.candyRest = new Float32Array(
      this.candyGeometry.attributes.position.array,
    );
    (this.candyGeometry.attributes.position as THREE.BufferAttribute).setUsage(
      THREE.DynamicDrawUsage,
    );
    const sugar = positionLocal
      .dot(vec3(12.13, 37.71, 19.43))
      .mul(155)
      .sin()
      .mul(438.13)
      .fract()
      .smoothstep(0.94, 1);
    const outer = new THREE.MeshPhysicalNodeMaterial({
      color: '#a6d38b',
      roughness: 0.23,
      metalness: 0,
      clearcoat: 0.65,
      clearcoatRoughness: 0.13,
      transparent: true,
      depthWrite: false,
      envMap: environment,
      envMapIntensity: 0.85,
    });
    outer.colorNode = mix(color('#97c67e'), color('#e7efc9'), sugar.mul(0.52));
    outer.opacityNode = this.opacity;
    const depth = positionView.z.negate();
    const inBody = optics.front
      .greaterThan(0.001)
      .and(depth.greaterThanEqual(optics.front))
      .and(depth.lessThanEqual(optics.back));
    outer.maskNode = inBody.not();
    const inner = new THREE.MeshPhysicalNodeMaterial({
      transparent: true,
      depthWrite: true,
      roughness: 0.25,
      clearcoat: 0.35,
      clearcoatRoughness: 0.16,
      envMap: environment,
      envMapIntensity: 0.65,
    });
    const burial = depth.sub(optics.front).max(0);
    inner.colorNode = mix(
      color('#a1c992'),
      color('#e3eccb'),
      sugar.mul(0.25),
    ).mul(
      vec3(
        burial.mul(-0.23).exp(),
        burial.mul(-0.37).exp(),
        burial.mul(-0.3).exp(),
      ),
    );
    inner.opacityNode = burial.mul(-0.65).exp().mul(this.opacity).mul(0.88);
    inner.maskNode = inBody;
    this.exterior = new THREE.Mesh(this.candyGeometry, outer);
    this.interior = new THREE.Mesh(this.candyGeometry, inner);
    this.exterior.name = 'MintCandy.Exterior';
    this.interior.name = 'MintCandy.Interior';
    this.exterior.renderOrder = 1;
    this.interior.renderOrder = -1;
    scene.add(this.exterior);
    candyOptics.root.add(this.interior);
    const shadowMat = new THREE.MeshBasicNodeMaterial({
      color: '#8e9a7b',
      transparent: true,
      depthWrite: false,
    });
    shadowMat.opacityNode = uv()
      .sub(0.5)
      .length()
      .mul(2)
      .smoothstep(0.15, 1)
      .oneMinus()
      .pow(2)
      .mul(0.24)
      .mul(this.shadowAlpha);
    const shadowGeo = new THREE.PlaneGeometry(0.85, 0.72);
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -0.004;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);
    this.resources.push(this.candyGeometry, outer, inner, shadowMat, shadowGeo);
    this.update(0);
  }
  update(dt: number) {
    const f = this.timeline.update(dt);
    if (this.lastTime === f.time) return f;
    this.lastTime = f.time;
    this.field.update(f);
    this.candyOptics.center.fromArray(f.candy);
    for (const skin of this.skins) {
      const g = skin.mesh.geometry;
      const a = g.attributes.position as THREE.BufferAttribute;
      if (f.wrap === 0 && f.settle === 0) {
        (a.array as Float32Array).set(skin.rest);
        (g.attributes.normal.array as Float32Array).set(skin.normals);
        g.attributes.normal.needsUpdate = true;
      } else {
        for (let i = 0; i < a.count; i++) {
          this.q[0] = skin.rest[i * 3];
          this.q[1] = skin.rest[i * 3 + 1];
          this.q[2] = skin.rest[i * 3 + 2];
          deformAbsorptionPoint(this.q, f, this.q);
          a.setXYZ(i, ...this.q);
        }
        g.computeVertexNormals();
      }
      a.needsUpdate = true;
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    const a = this.candyGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      const x = this.candyRest[i * 3],
        y = this.candyRest[i * 3 + 1],
        z = this.candyRest[i * 3 + 2];
      const length = Math.hypot(x, y, z);
      // Corners erode sooner than the broad faces; low-frequency uneven erosion
      // leaves a rounded residual core, rather than scaling a perfect cube away.
      const rounded = 0.145 / Math.max(length, 0.001);
      const edge = 1 + (rounded - 1) * Math.min(1, f.dissolve * 1.8);
      const uneven =
        1 - f.dissolve * 0.09 * (Math.sin(x * 23 + y * 17) * Math.cos(z * 21));
      const size = Math.pow(1 - f.dissolve, 0.58) * edge * uneven;
      a.setXYZ(i, x * size, y * size, z * size);
    }
    a.needsUpdate = true;
    if (f.dissolve === 0) {
      (this.candyGeometry.attributes.normal.array as Float32Array).set(
        this.candyNormals,
      );
      this.candyGeometry.attributes.normal.needsUpdate = true;
    } else this.candyGeometry.computeVertexNormals();
    for (const candy of [this.exterior, this.interior]) {
      candy.position.fromArray(f.candy);
      candy.rotation.set(
        f.entry * 0.18 + f.settle * 0.12,
        0.24 + f.entry * 0.14,
        f.settle * 0.1,
      );
      candy.visible = f.dissolve < 0.998;
    }
    this.opacity.value = 1 - Math.pow(f.dissolve, 4);
    this.shadowAlpha.value = 1 - f.entry;
    this.shadow.position.x = f.candy[0];
    this.shadow.position.z = f.candy[2];
    return f;
  }
  bubblePosition(p: THREE.Vector3) {
    this.q[0] = p.x;
    this.q[1] = p.y;
    this.q[2] = p.z;
    deformAbsorptionPoint(this.q, this.timeline.frame, this.q);
    return p.set(...this.q);
  }
  dispose() {
    this.exterior.removeFromParent();
    this.interior.removeFromParent();
    this.shadow.removeFromParent();
    this.resources.forEach((r) => r.dispose());
  }
}
