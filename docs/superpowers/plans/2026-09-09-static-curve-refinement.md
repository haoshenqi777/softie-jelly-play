# Static curve refinement

> For agentic workers: use executing-plans for the asset changes. The Site owner makes project edits; independent agents review only.

**Goal:** Refine the original concept's crown, shoulder and grounded lower curve while preserving the accepted appearance exactly at the renderer level.

**Architecture:** Author the rest meridians with continuous Bezier controls, export the shared Blender/GLB asset, and keep existing face and bubble attachments in the same cross-section coordinates. Put shape authoring data in a versioned JSON recipe so an accepted shape can be reproduced without recovering scattered constants.

**Tech Stack:** Blender 4.5, glTF, Three.js WebGPU, Node asset tests.

**Spec:** `../../outputs/softie-design-lock/appearance-freeze.md` from the project root.

## User steering during execution

The user requested a new neutral/static multi-view concept sheet before further
shape fitting: the original six-panel candy storyboard shows different poses.
The exported curves in this checkpoint are a reversible candidate, not an
approved master. Stop further geometry iterations; retain a valid build and
consistent diagnostic assets. Generate the new static sheet outside the Site
checkout, inspect multi-view consistency, then obtain the user's visual choice
before treating any of its measurements as locked anatomy. All appearance
freeze constraints continue to apply.

The first generated turnaround was explicitly rejected: it changed the
character identity (crown, proportions, eye spacing and mouth), not just
multi-view alignment. The original storyboard character remains the sole
approved visual identity. A new image must use the actual original image as
an editing input, retain the original reference view for direct comparison,
and add other views without inventing a symmetric round-headed redesign.
See `../../outputs/softie-design-lock/static-master-status.md` from the project
root. No generated turnaround has yet been approved as a master.

## Constraints

- The original storyboard, first panel, is the target. A/B/C candidate images are unapproved.
- No material, matcap, lighting, camera, normal/thickness algorithm, shadow or color changes.
- No new gameplay, deformation or physics system. Existing morphs remain compatible.
- Local preview only. Preserve the previous GLB and Blender source for rollback.

## 1. Measure and establish asset guards

- [ ] Save the current GLB/Blend and reference-view screenshot under `outputs/softie-static-refine-qa`.
- [ ] Check dense crown/shoulder contour against the original, recording uncertainty at translucent edges and floor shadow.
- [ ] Extend `tests/studio-silhouette.test.mjs` with the previously untested top 2.5% / 5% of height, using the measured contour. Run the test against the old asset and verify the crown mismatch fails.
- [ ] Keep the existing convexity, face, bubble and framing guards.

## 2. Refine and export

- [ ] Add `assets/slime-rest-shape.json`, with named meridian handles, height, revision and reference provenance.
- [ ] Modify only shape authoring in `assets/create-slime-studio.py`. Use `radius(y)` to invert monotone Bezier heights; connect cap and belly with matching tangent/curvature. Preserve max width/depth and height; preserve center, materials, topology, facial proportions and random seed.
- [ ] Re-export `assets/slime-studio.blend` and `public/models/slime-studio.glb`; update only the model cache revision in `lib/studio-scene.ts`.
- [ ] Inspect the actual WebGPU result in reference/front/side/gray views, with motion stopped. Obtain independent visual review and correct any new shoulder band or flat crown.

## 3. Validate and retain the candidate

- [ ] Re-render the four Cycles diagnostic views from the final shared geometry using the unchanged physical recipe, changing only its revision/provenance.
- [ ] Run `node --experimental-strip-types --test tests/*.test.mjs`, TypeScript, targeted lint and the production build.
- [ ] Verify appearance-freeze SHA-256 hashes and inspect the scene/authoring diff for forbidden renderer/material changes.
- [ ] Save reference/front/side/gray screenshots and a concise report distinguishing measured improvement from aesthetic approval. Leave the browser at the reference view.
- [ ] Commit locally; fast-forward the clean source checkout. Do not push or publish.

Static visual approval belongs to the user. Passing numerical tests does not certify a perfect match or approve the character for final animation work.
