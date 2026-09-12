import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  color,
  float,
  matcapUV,
  mix,
  normalViewGeometry,
  pmremTexture,
  positionView,
  positionWorld,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { SlimeOptics } from './slime-optics';
import type { GelRenderCheck } from './gel-render-check';
import { sampleLinearCapture } from './gel-linear-capture';

const project = Fn(([p]: [ReturnType<typeof vec3>]) => {
  const clip = cameraProjectionMatrix.mul(vec4(p, 1));
  return clip.xy.div(clip.w).mul(vec2(0.5, -0.5)).add(0.5);
});

// The concept's light response is art directed in normal space. Geometry,
// deformation, volume thickness and the refracted interior remain live 3D.
export function createConceptGel(
  optics: SlimeOptics,
  capture: THREE.Texture,
  environment: THREE.Texture,
  check?: GelRenderCheck,
  linearCapture?: THREE.DataTexture,
) {
  const m = new THREE.MeshBasicNodeMaterial();
  // The studio uses NoToneMapping globally. sRGB decode/encode stays enabled.
  m.colorNode = Fn(() => {
    const incident = positionView.normalize();
    const n = normalViewGeometry.normalize();
    const ray = incident.refract(n, float(1 / 1.34)).normalize();
    const lo = float(0.002).toVar();
    const hi = float(5).toVar();
    Loop(8, () => {
      const distance = lo.add(hi).mul(0.5).toVar();
      const p = positionView.add(ray.mul(distance));
      const depth = texture(
        optics.backImage,
        project(p).clamp(0.001, 0.999),
        0,
      ).r;
      const inside = depth
        .greaterThan(p.z.negate())
        .and(depth.greaterThan(0.01))
        .toVar();
      lo.assign(inside.select(distance, lo));
      hi.assign(inside.select(hi, distance));
    });
    if (check) lo.assign(mix(lo, float(1.8), check.fixedDepth));
    const radius = vec2(matcapUV).sub(0.5).length().div(0.495);
    const baseUV = vec2(matcapUV).sub(0.5).mul(0.923).add(vec2(0.5, 0.5));
    const uv = baseUV;
    const sample = check
      ? check.sample(capture, uv)
      : linearCapture
        ? sampleLinearCapture(linearCapture, uv)
        : texture(capture, uv);
    // Transparent texels contain black RGB: composite on white in linear light.
    const captured = mix(vec3(1), sample.rgb, sample.a);
    const thickness = lo.sub(1.8).mul(-0.018).exp();
    const highlight = captured.r
      .min(captured.g)
      .min(captured.b)
      .smoothstep(0.7, 0.97);
    const smoothBody = mix(
      color('#f5adb6'),
      color('#ec8b9b'),
      baseUV.y.smoothstep(0.2, 0.85),
    );
    const softness = radius
      .smoothstep(0.65, 0.94)
      .oneMinus()
      .mul(highlight.oneMinus())
      .mul(0.65);
    const leftCard = uv
      .sub(vec2(0.279, 0.766))
      .div(vec2(0.105, 0.145))
      .length()
      .smoothstep(0.55, 1.15)
      .oneMinus();
    const rightCard = uv
      .sub(vec2(0.724, 0.766))
      .div(vec2(0.105, 0.145))
      .length()
      .smoothstep(0.55, 1.15)
      .oneMinus();
    const card = leftCard.max(rightCard);
    const rose = mix(captured, smoothBody, softness.max(card));
    // WGSL pow is undefined for negative bases, even with exponent 2.
    const altitude = positionWorld.y.sub(0.7).div(0.6);
    const warmth = altitude.mul(altitude).negate().exp();
    const warmRose = vec3(
      rose.r.add(warmth.mul(0.018)),
      rose.g,
      rose.b.mul(float(1).sub(warmth.mul(0.06))),
    );
    const foot = positionWorld.y.mul(-18).exp().mul(0.68);
    const gel = mix(
      warmRose.mul(vec3(1, thickness, thickness)),
      color('#a94f60'),
      foot,
    );
    const innerUV = project(positionView.add(ray.mul(lo.mul(0.3))));
    const insideSample = texture(
      optics.innerImage,
      innerUV.clamp(0.001, 0.999),
      0,
    );
    const inside = check ? insideSample.mul(check.interior) : insideSample;
    // Air sits below the wet surface, so the lightbox reflection passes over it.
    const visibility = highlight.mul(card.oneMinus()).oneMinus();
    const reflection = pmremTexture(
      environment,
      cameraWorldMatrix.mul(vec4(incident.reflect(n), 0)).xyz,
      float(0.08),
    ).rgb;
    const fresnel = float(0.022).add(
      n.dot(incident.negate()).clamp(0, 1).oneMinus().pow(5).mul(0.978),
    );
    return gel
      .mul(float(1).sub(inside.a.mul(visibility)))
      .add(inside.rgb.mul(visibility))
      .add(reflection.mul(fresnel).mul(check ? check.reflection : float(1)));
  })();
  return m;
}
