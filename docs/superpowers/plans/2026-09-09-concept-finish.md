# Finish the concept style in live WebGPU

User directs the final look to match the original AI storyboard, including body
proportions, face, translucent material and contact detail. They authorize route
changes and implementation without another planning pause. Local review only.

Visual thesis: a clear rose jelly with a narrow rounded crown, broad low belly,
small low black eyes, visible air bubbles, a transparent thick rim and soft table
contact. Concept panel 01 is the resting-view target; panel 02 is squash.

1. Decompose target versus current render with independent read-only art and
   optics reviews. Keep the actual reference visible as the default comparison.
2. Replace the incomplete front-only transmission with front/back boundary
   refraction, Beer absorption, controlled rim reflection and clear air bubbles.
   Keep the shader bounded and suitable for real-time WebGPU; no image impostor.
3. Revise the authored mesh: narrower crown, broader base, low wide-set bean eyes,
   shallow embedded face. Shared geometry drives every authored deformation.
4. Render and inspect actual browser pixels. Iterate from identified differences,
   including front, oblique, side and squash. Maintain useful performance.
5. Update obsolete physical reference assets if the model changes; label those
   offline images as optional reference, never the final target or live output.
6. Review, meaningful regression checks, type/lint/build, local source integration.
   Report remaining visual limitations honestly rather than assert exact parity.

Existing Cycles reference is diagnostic. A physically plausible but wrong-looking
result is insufficient; art direction determines the final real-time image.

Implemented route after visual comparison: the complete two-interface analytical
candidate still looked flat, so its experimental shader was kept outside the
shipping source. The final body uses a generated normal-space gel light-response
texture, moderated internal patterns, actual mesh-derived thickness and refracted
3D air bubbles. Captured studio cards are removed analytically and replaced with
world-space PMREM reflections. WebGPU uses global NoToneMapping so the captured
display transform is not applied twice. Front/back geometry, the embedded face,
orbit, shared shape keys and depth-sorted interior all remain real-time 3D.
