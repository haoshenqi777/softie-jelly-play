import * as THREE from 'three/webgpu';
import { ivec2, mix, textureLoad, vec2 } from 'three/tsl';

/** Mobile-compatible upload path: same source pixels, decoded once on the CPU.
 * No HTML-image GPU upload, hardware sRGB decode, GPU flip or mip generation. */
export function linearCaptureFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const linear = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const s = i / 255;
    linear[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  const data = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = ((height - 1 - y) * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        data[dst + c] = THREE.DataUtils.toHalfFloat(linear[pixels[src + c]]);
      }
      data[dst + 3] = THREE.DataUtils.toHalfFloat(pixels[src + 3] / 255);
    }
  }
  const t = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  t.name = 'gel-linear-capture';
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export function createLinearCapture(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  if (!context) throw new Error('Cannot prepare the gel texture');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const capture = linearCaptureFromPixels(pixels, canvas.width, canvas.height);
  canvas.width = canvas.height = 1;
  return capture;
}

/** Same four-tap path verified by the user on iPhone. No hardware filtering,
 * automatic mip selection, per-frame conversion, or additional render pass. */
export function sampleLinearCapture(
  capture: THREE.DataTexture,
  uv: ReturnType<typeof vec2>,
) {
  const size = vec2(capture.image.width, capture.image.height);
  const p = uv.mul(size).sub(0.5);
  const lo = p.floor();
  const f = p.sub(lo);
  const fetch = (offset: ReturnType<typeof vec2>) => {
    const pixel = lo.add(offset).clamp(vec2(0), size.sub(1));
    return textureLoad(capture, ivec2(pixel.x, pixel.y), 0);
  };
  return mix(
    mix(fetch(vec2(0, 0)), fetch(vec2(1, 0)), f.x),
    mix(fetch(vec2(0, 1)), fetch(vec2(1, 1)), f.x),
    f.y,
  );
}
