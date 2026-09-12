import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  Loop,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  color,
  float,
  matcapUV,
  mix,
  normalViewGeometry,
  normalView,
  reflectVector,
  pmremTexture,
  positionView,
  positionWorld,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { SlimeOptics } from './slime-optics';
import type { PigmentLayer } from './studio-pigment';
import type { AbsorptionField } from './absorption-field';
import type { AbsorptionInterior } from './absorption-interior';
import type { GelRenderCheck } from './gel-render-check';
import { sampleLinearCapture } from './gel-linear-capture';

const project = Fn(([p]: [ReturnType<typeof vec3>]) => {
  const clip = cameraProjectionMatrix.mul(vec4(p, 1));
  return clip.xy.div(clip.w).mul(vec2(0.5, -0.5)).add(0.5);
});

// Experimental color branch derived from the frozen studio-gel.ts. Keep its
// optical solve identical; pigment acts before interior composition and the
// separate neutral environment reflection. Rose uses the original factory.
export function createDyedGel(
  optics: SlimeOptics,
  capture: THREE.Texture,
  environment: THREE.Texture,
  pigment: PigmentLayer,
  field?: AbsorptionField,
  candyOptics?: AbsorptionInterior,
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
    // Same artistic curve, defined on both sides of y=0.7 on mobile GPUs.
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
    const materialPoint = vec3(attribute('absorptionRest', 'vec3'));
    const coloredGel = field
      ? field.tint(
          gel,
          materialPoint,
          materialPoint.add(
            field
              .materialDirection(cameraWorldMatrix.mul(vec4(ray, 0)).xyz)
              .mul(lo.mul(0.32)),
          ),
        )
      : pigment.tint(gel);
    let candyGel = coloredGel;
    if (candyOptics) {
      const depthToCandy = candyOptics.centerView.z
        .sub(positionView.z)
        .div(ray.z.min(-0.001))
        .max(0);
      const candyUV = project(positionView.add(ray.mul(depthToCandy)));
      const candy = texture(candyOptics.image, candyUV.clamp(0.001, 0.999), 0);
      const candyVisibility = visibility.mul(
        depthToCandy.lessThan(lo.add(0.2)).select(1, 0),
      );
      // Only candy rays: retain the approved empty-body look. A thin film has
      // zero contrast loss at entry, then the current gel colour filters light
      // continuously as the same textured, lit core moves further inside.
      const overburden = depthToCandy.min(lo).max(0);
      const gelFilter = mix(
        vec3(1),
        coloredGel.max(vec3(0.12)),
        overburden.mul(0.45).min(0.58),
      );
      const veil = overburden.mul(-0.3).exp().oneMinus().min(0.3);
      const core = candy.rgb
        .mul(gelFilter)
        .mul(veil.oneMinus())
        .add(coloredGel.mul(candy.a).mul(veil));
      candyGel = coloredGel
        .mul(float(1).sub(candy.a.mul(candyVisibility)))
        .add(core.mul(candyVisibility));
    }
    return candyGel
      .mul(float(1).sub(inside.a.mul(visibility)))
      .add(inside.rgb.mul(visibility))
      .add(reflection.mul(fresnel).mul(check ? check.reflection : float(1)));
  })();
  return m;
}

export function createDyedBubble(
  optics: SlimeOptics,
  environment: THREE.Texture,
  pigment: PigmentLayer,
  field?: AbsorptionField,
) {
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const depth = positionView.z.negate().sub(optics.front).max(0);
  const cosine = normalView.dot(positionView.negate().normalize()).abs();
  const fresnel = float(1).sub(cosine);
  const lobe = normalView.x
    .mul(-0.452)
    .add(normalView.y.mul(0.723))
    .add(normalView.z.mul(0.522))
    .clamp(0, 1);
  const reflected = pmremTexture(environment, reflectVector, float(0.08));
  const lowerGlint = normalView.x
    .mul(0.55)
    .sub(normalView.y.mul(0.58))
    .add(normalView.z.mul(0.59))
    .clamp(0, 1)
    .pow(80);
  // The air interface has a critical ring: gel -> air, eta=1.34.
  const ring = cosine.oneMinus().smoothstep(0.3, 0.55);
  const brightSide = normalView.y
    .mul(0.65)
    .sub(normalView.x.mul(0.45))
    .add(0.2)
    .clamp(0, 1);
  const white = lobe
    .pow(58)
    .mul(0.95)
    .add(lowerGlint.mul(0.55))
    .add(ring.mul(brightSide).mul(0.7))
    .clamp(0, 1);
  const bubbleColor = mix(
    mix(color('#f6a6b1'), color('#bf697a'), ring),
    vec3(1.3),
    white,
  );
  const tint = vec3(
    depth.mul(-0.025).exp(),
    depth.mul(-0.34).exp(),
    depth.mul(-0.29).exp(),
  );
  const bubbleTint = field
    ? field.tint(bubbleColor.mul(tint), field.materialPoint(positionWorld))
    : pigment.tint(bubbleColor.mul(tint));
  m.colorNode = bubbleTint.add(reflected.mul(0.016));
  m.opacityNode = ring
    .mul(0.62)
    .add(lobe.pow(58).mul(0.9))
    .add(lowerGlint.mul(0.5))
    .add(cosine.pow(2).mul(0.14))
    .add(fresnel.mul(0.08))
    .mul(depth.mul(-0.06).exp())
    .min(0.92);
  m.maskNode = positionView.z.negate().greaterThan(optics.front.add(0.003));
  return m;
}
