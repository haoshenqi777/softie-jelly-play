import * as THREE from 'three/webgpu';
import {
  attribute,
  bumpMap,
  color,
  float,
  log,
  mix,
  normalLocal,
  modelScale,
  texture,
  vec3,
} from 'three/tsl';

type Shape = 'cube' | 'round';
/** The internal capture has no backdrop to refract. Carry the same Beer
 * absorption and geometric path into it explicitly, rather than copying
 * the nearly white shell as an opaque diffuse material. */
export function internalCandyColor(source: THREE.MeshPhysicalNodeMaterial) {
  // Opaque sugar carries its pigment and crystals in diffuse reflectance.
  // The surrounding gel must not turn that surface into a white glass shell.
  if (source.transmission === 0 && !source.transmissionNode)
    return vec3(source.colorNode ?? color(source.color));
  const distance = Math.max(0.0001, source.attenuationDistance || 1e6);
  const thickness = source.thicknessNode
    ? float(source.thicknessNode)
    : float(source.thickness);
  const path = thickness.mul(modelScale.x.abs());
  const tint = vec3(color(source.attenuationColor)).max(vec3(0.0001));
  const d = path.div(distance);
  const transmittance = vec3(
    log(tint.x).mul(d).exp(),
    log(tint.y).mul(d).exp(),
    log(tint.z).mul(d).exp(),
  );
  const surface = vec3(source.colorNode ?? color(source.color));
  return surface.mul(transmittance);
}
const hash = (x: number, y: number, seed = 0) => {
  let n = Math.imul(x + seed, 374761393) ^ Math.imul(y + 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
/** Packed height, roughness and sugar bloom. Built once, mipmapped on GPU. */
export function candyDetailTexture(shape: Shape) {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const qx = x / 8,
        qy = y / 8,
        ix = Math.floor(qx),
        iy = Math.floor(qy);
      let first = 10,
        second = 10,
        grain = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const gx = ix + i,
            gy = iy + j;
          const wx = (gx + 32) % 32,
            wy = (gy + 32) % 32;
          const dx = gx + hash(wx, wy) - qx,
            dy = gy + hash(wx, wy, 81) - qy;
          const distance = Math.hypot(dx, dy);
          if (distance < first) {
            second = first;
            first = distance;
            grain = hash(wx, wy, 197);
          } else second = Math.min(second, distance);
        }
      const edge = Math.max(0, 1 - (second - first) * 18);
      const dust = hash(x, y, 433),
        crystal = grain > 0.83 ? 1 : 0;
      const pit = grain > 0.91 && first < 0.22 ? 1 : 0;
      const facet = (1 - edge) * (0.25 + grain * 0.65);
      const height =
        shape === 'cube'
          ? 0.3 + facet * 0.32 + crystal * 0.08 + (dust - 0.5) * 0.07
          : 0.32 + facet * 0.24 + (dust - 0.5) * 0.12 - pit * 0.12;
      const rough =
        shape === 'cube'
          ? 0.3 + grain * 0.21 + edge * 0.12
          : 0.4 + grain * 0.17 + pit * 0.12;
      const k = (y * size + x) * 4;
      data[k] = Math.round(height * 255);
      data[k + 1] = Math.round(rough * 255);
      data[k + 2] = Math.round(
        (shape === 'cube'
          ? facet * 0.65 + crystal * 0.23
          : facet * 0.73 + dust * 0.16) * 255,
      );
      data[k + 3] = 255;
    }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  map.name = 'hard-candy-' + shape + '-surface';
  return map;
}

export function hardCandyMaterial(
  shape: Shape,
  hex: string,
  detail: THREE.DataTexture,
) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    roughness: shape === 'cube' ? 0.42 : 0.5,
    metalness: 0,
    transmission: 0,
    thickness: 0.17,
    ior: 1.48,
    attenuationColor: hex,
    attenuationDistance: 0.28,
    clearcoat: shape === 'cube' ? 0.18 : 0.08,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1,
  });
  // This attribute survives scale, cloning and erosion: no sliding or texture
  // density jump when the candy changes draw mesh at first contact.
  const coord = vec3(attribute('candyCoord', 'vec3'));
  const q = coord.mul(shape === 'cube' ? 0.36 : 0.42);
  const w = vec3(normalLocal).abs().pow(vec3(6));
  const weight = w.div(w.x.add(w.y).add(w.z).max(0.0001));
  const sample = texture(detail, q.yz)
    .mul(weight.x)
    .add(texture(detail, q.zx).mul(weight.y))
    .add(texture(detail, q.xy).mul(weight.z));
  material.colorNode = mix(
    color(hex).mul(sample.r.mul(0.4).add(0.69)),
    mix(color(hex), color('#fff8ee'), float(0.65)),
    sample.b.mul(shape === 'cube' ? 0.72 : 0.62),
  );
  material.roughnessNode = sample.g;
  material.normalNode = bumpMap(
    sample.r,
    float(shape === 'cube' ? 0.003 : 0.0022),
  );
  // No second transmission pass: the jelly supplies refraction over the solid
  // sugar core. Stable local coordinates serve the free and buried mesh alike.
  return material;
}
