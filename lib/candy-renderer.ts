import * as THREE from 'three/webgpu';
import { candyCompressionMatrix } from './candy-deformation.ts';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { uv, float, positionView } from 'three/tsl';
import type { SlimeOptics } from './slime-optics';
import type { CandyBody, CandyKind } from './candy-physics';
import { BASE_CANDY_RADIUS, HARD_CUBE_BEVEL } from './candy-physics.ts';
import {
  candyDetailTexture,
  hardCandyMaterial,
} from './hard-candy-material.ts';

// Every candy is a pickable mesh from tray to hand, flight, floor and mouth.
export class CandyRenderer {
  onCreate?: (candy: CandyBody, mesh: THREE.Mesh) => void;
  onRemove?: (id: number) => void;
  private scene: THREE.Scene;
  private shapes: Record<CandyKind, THREE.BufferGeometry>;
  private details = {
    cube: candyDetailTexture('cube'),
    round: candyDetailTexture('round'),
  };
  private materials = new Map<string, THREE.MeshPhysicalNodeMaterial>();
  private shadowGeometry = new THREE.PlaneGeometry(1, 1);
  private shadowMaterial: THREE.MeshBasicNodeMaterial;
  private pieces = new Map<number, { mesh: THREE.Mesh; shadow: THREE.Mesh }>();
  private landingScale = new THREE.Matrix4();
  private interiors = new Map<
    number,
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalNodeMaterial>
  >();
  private optics?: SlimeOptics;
  constructor(scene: THREE.Scene, optics?: SlimeOptics) {
    this.optics = optics;
    this.scene = scene;
    this.shapes = {
      gummy: new RoundedBoxGeometry(0.17, 0.17, 0.17, 3, 0.045),
      hard: new THREE.IcosahedronGeometry(BASE_CANDY_RADIUS, 2),
      cube: new RoundedBoxGeometry(0.17, 0.17, 0.17, 3, HARD_CUBE_BEVEL),
      round: new THREE.IcosahedronGeometry(BASE_CANDY_RADIUS, 8),
    };
    // Weld once before any candy is shown. Both free and absorbing meshes keep
    // this layout, without repeating erosion work for identical seam vertices.
    for (const kind of ['gummy', 'hard', 'cube', 'round'] as const) {
      const raw = this.shapes[kind];
      raw.deleteAttribute('uv');
      this.shapes[kind] = mergeVertices(raw, 0.0001);
      raw.dispose();
      if (kind === 'cube' || kind === 'round') {
        const pos = this.shapes[kind].attributes.position;
        const coords = Float32Array.from(
          pos.array,
          (v) => v / BASE_CANDY_RADIUS,
        );
        this.shapes[kind].setAttribute(
          'candyCoord',
          new THREE.BufferAttribute(coords, 3),
        );
      }
    }
    this.shadowMaterial = new THREE.MeshBasicNodeMaterial({
      color: '#796770',
      transparent: true,
      depthWrite: false,
    });
    const distance = uv().sub(0.5).length().mul(2);
    this.shadowMaterial.opacityNode = float(1)
      .sub(distance.smoothstep(0.05, 1))
      .pow(2)
      .mul(0.24);
  }
  get pickables() {
    return [...this.pieces.values()]
      .filter((p) => p.mesh.visible && !p.mesh.userData.embedded)
      .map((p) => p.mesh);
  }
  mesh(id: number) {
    return this.pieces.get(id)?.mesh;
  }
  update(candies: CandyBody[]) {
    const present = new Set(candies.map((c) => c.id));
    for (const [id, p] of this.pieces)
      if (!present.has(id)) {
        this.onRemove?.(id);
        this.scene.remove(p.mesh, p.shadow);
        const inner = this.interiors.get(id);
        if (inner) {
          inner.removeFromParent();
          inner.material.dispose();
          inner.geometry.dispose();
          this.interiors.delete(id);
        }
        this.pieces.delete(id);
      }
    for (const c of candies) {
      let p = this.pieces.get(c.id);
      const created = !p;
      if (!p) {
        const key = c.kind + c.hex;
        let material = this.materials.get(key);
        if (!material) {
          material =
            c.kind === 'cube' || c.kind === 'round'
              ? hardCandyMaterial(c.kind, c.hex, this.details[c.kind])
              : new THREE.MeshPhysicalNodeMaterial({
                  color: new THREE.Color(c.hex).lerp(
                    new THREE.Color('white'),
                    0.15,
                  ),
                  roughness: c.kind === 'gummy' ? 0.12 : 0.045,
                  metalness: 0,
                  transmission: c.kind === 'gummy' ? 0.62 : 0.78,
                  thickness: 0.15,
                  ior: c.kind === 'gummy' ? 1.4 : 1.5,
                  attenuationColor: new THREE.Color(c.hex),
                  attenuationDistance: 0.35,
                  clearcoat: 1,
                  clearcoatRoughness: 0.04,
                  envMapIntensity: 0.95,
                });
          this.materials.set(key, material);
        }
        const mesh = new THREE.Mesh(this.shapes[c.kind], material);
        mesh.userData.candyId = c.id;
        mesh.frustumCulled = false;
        const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
        shadow.rotation.x = -Math.PI / 2;
        shadow.renderOrder = -2;
        p = { mesh, shadow };
        this.pieces.set(c.id, p);
        this.scene.add(mesh, shadow);
      }
      p.mesh.position.set(c.x, c.y, c.z);
      p.mesh.rotation.set(c.rx, c.ry, c.rz);
      p.mesh.matrixAutoUpdate = false;
      const size = c.radius / BASE_CANDY_RADIUS;
      p.mesh.scale.setScalar(size * (1 - (c.melt ?? 0) * 0.98));
      p.mesh.updateMatrix();
      if (c.kind === 'gummy') {
        // Floor impacts use Y; a held candy uses its measured contact normal.
        const squeeze = 1 - c.compression;
        candyCompressionMatrix(
          this.landingScale,
          c.compression,
          c.compressionAxis,
        );
        p.mesh.matrix.premultiply(this.landingScale);
        p.mesh.matrix.setPosition(
          c.x,
          !c.contactHeld && c.mode !== 'merging' && c.y < c.radius + 0.03
            ? c.radius * squeeze
            : c.y,
          c.z,
        );
      }
      p.mesh.matrixWorldNeedsUpdate = true;
      const height = Math.max(0, c.y - c.radius);
      p.shadow.visible =
        c.mode !== 'mouth' && c.mode !== 'merging' && !c.contactHeld;
      p.shadow.position.set(c.x, 0.005, c.z);
      p.shadow.scale.setScalar(0.38 * size + height * 0.22);
      // A separate per-instance alpha avoids modifying shared shadow material.
      p.shadow.scale.y = (0.38 * size + height * 0.22) / (1 + height * 0.12);
      p.mesh.visible = c.mode !== 'merging' && !c.contactHeld;
      p.mesh.userData.embedded = c.mode === 'mouth';
      if (created) this.onCreate?.(c, p.mesh);
      if (c.mode === 'mouth' && this.optics) {
        let inner = this.interiors.get(c.id);
        if (!inner) {
          const material = new THREE.MeshPhysicalNodeMaterial({
            color: new THREE.Color(c.hex).lerp(new THREE.Color('white'), 0.18),
            roughness: 0.17,
            clearcoat: 0.7,
            transparent: true,
            depthWrite: true,
            envMapIntensity: 1.4,
          });
          const distance = positionView.z.negate().sub(this.optics.front);
          material.maskNode = distance
            .greaterThan(0.002)
            .and(this.optics.front.greaterThan(0));
          material.opacityNode = distance.max(0).mul(-0.25).exp().mul(0.96);
          inner = new THREE.Mesh(this.shapes[c.kind].clone(), material);
          p.mesh.geometry = inner.geometry;
          inner.userData.rest = new Float32Array(
            inner.geometry.attributes.position.array,
          );
          inner.matrixAutoUpdate = false;
          inner.frustumCulled = false;
          this.interiors.set(c.id, inner);
          this.optics.interiorScene.add(inner);
        }
        const rest = inner.userData.rest as Float32Array;
        const vertices = inner.geometry.attributes
          .position as THREE.BufferAttribute;
        const round = c.melt ?? 0;
        for (let i = 0; i < vertices.count; i++) {
          const j = i * 3,
            x = rest[j],
            y = rest[j + 1],
            z = rest[j + 2];
          const length = Math.hypot(x, y, z) || 1;
          const k = 1 + (0.083 / length - 1) * round;
          vertices.setXYZ(i, x * k, y * k, z * k);
        }
        vertices.needsUpdate = true;
        inner.geometry.computeVertexNormals();
        inner.matrix.copy(p.mesh.matrix);
        inner.matrixWorldNeedsUpdate = true;
      }
    }
  }
  dispose() {
    for (const [id, p] of this.pieces) {
      this.onRemove?.(id);
      this.scene.remove(p.mesh, p.shadow);
    }
    this.pieces.clear();
    for (const mesh of this.interiors.values()) {
      mesh.removeFromParent();
      mesh.material.dispose();
      mesh.geometry.dispose();
    }
    this.interiors.clear();
    Object.values(this.shapes).forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    Object.values(this.details).forEach((t) => t.dispose());
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
  }
}
