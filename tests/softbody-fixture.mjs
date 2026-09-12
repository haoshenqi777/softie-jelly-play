import { readFileSync } from 'node:fs';
import {
  BufferGeometry,
  Float32BufferAttribute,
  BufferAttribute,
} from 'three/webgpu';
import { createCage } from '../lib/softbody/cage.ts';

export function characterFixture() {
  const file = readFileSync(
    new URL('../public/models/slime-studio.glb', import.meta.url),
  );
  const length = file.readUInt32LE(12),
    json = JSON.parse(file.subarray(20, 20 + length));
  const read = (id) => {
    const a = json.accessors[id],
      b = json.bufferViews[a.bufferView];
    const width = a.type === 'VEC3' ? 3 : 1,
      bytes = a.componentType === 5123 ? 2 : 4;
    const array =
      a.componentType === 5126
        ? new Float32Array(a.count * width)
        : new Uint32Array(a.count * width);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < width; k++) {
        const offset =
          28 +
          length +
          (b.byteOffset || 0) +
          (a.byteOffset || 0) +
          i * (b.byteStride || width * bytes) +
          k * bytes;
        array[i * width + k] =
          a.componentType === 5126
            ? file.readFloatLE(offset)
            : bytes === 2
              ? file.readUInt16LE(offset)
              : file.readUInt32LE(offset);
      }
    return array;
  };
  const geometry = (name) => {
    const n = json.nodes.find((n) => n.name === name),
      p = json.meshes[n.mesh].primitives[0];
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new Float32BufferAttribute(read(p.attributes.POSITION), 3),
    );
    g.setAttribute(
      'normal',
      new Float32BufferAttribute(read(p.attributes.NORMAL), 3),
    );
    g.setIndex(new BufferAttribute(read(p.indices), 1));
    return g;
  };
  const node = json.nodes.find((n) => n.name === 'Gel');
  const body = geometry('Gel'),
    profile = JSON.parse(node.extras.optical_profile);
  const cage = createCage(profile, body.attributes.position.array);
  return {
    cage,
    body,
    geometry,
    profile,
    bubbles: JSON.parse(node.extras.bubble_data),
  };
}
