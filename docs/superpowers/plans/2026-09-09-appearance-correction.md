# Appearance correction — local review only

User feedback: the reference is an oblique view, not a leaning frontal model.
Side view must remain plump; body must read as rose gel and eyes as embedded,
glossy black beans. User explicitly chose local review without publishing.

## Findings

- The resting crown was moved 0.50 units forward over a 2.25-unit height,
  incorrectly baking the reference's pose into the rest shape.
- An experimental full dielectric shader perturbed exit normals without
  validating the next inside/outside bracket. Independent CPU replay found
  invalid exits. Residual energy was also added as light without escaping.
- Its flat paper-based scattering and multiple ideal reflections were not a
  model of cloudy gel. Increasing its bounce count did not resolve this.

## Chosen correction

1. Keep the rest shape centered in X and almost centered in Z, with enough
   depth for side views. Embed the bean eyes more deeply. Preserve shared morphs.
2. Remove the failed lighting shader, caustic baker and floor reflector from
   the application. Use Three's physical transmission, roughness, Fresnel and
   absorption with the captured front/back depth as an optical thickness
   approximation. A tested single-refracted-segment variant still flattened
   the appearance against the plain studio and was also removed from runtime.
   Do not invent trapped-ray illumination.
3. Calibrate a coral-rose absorption color and neutral softbox illumination.
   Eye highlights and bubbles use that same environment.
4. Verify actual front, oblique and side views, rest/squash/puff and clay mode;
   run regression, types, lint and build. Record the remaining reference gap.

## Acceptance boundary

This correction is complete only when the reported leaning silhouette and red
bands are absent from actual browser captures. That does not establish parity
with the AI reference, full volumetric scattering, mobile 60 FPS, or the final
toy's action quality. Do not publish this local study or change Site access.
