# Gel rendering and soft motion implementation plan

> Execute inline with superpowers:executing-plans. The existing linked worktree is isolated; the Site owner owns all source edits.

**Goal:** Move the approved absorption storyboard toward a real WebGPU scene with optical depth, soft contact and a visible continuous candy wrap.
**Architecture:** A back-surface depth pass measures deformed gel thickness; an interior pass handles embedded bubbles/food, attenuated by their front-surface depth. A small spring lattice augments existing volume-preserving body modes with propagating contact deformation. Absorption uses the same candy entity and material-space coordinates through approach, capture, enclosure, dissolve.
**Tech Stack:** Existing Three r183 / TSL / WebGPU, TypeScript, React/Vinext; no new dependencies.
**Spec:** Workspace outputs/softie-absorption-design/design.md and the accepted five-layer rendering proposal in this conversation.

## Global constraints
- WebGPU only; do not enable fallback.
- Preserve existing room orbit, dragging, candy physics, fullness and emotions.
- Keep soft round silhouettes and skin-bound facial features.
- Validate actual visual quality before publishing to the already authorized private Site.

## Tasks
- [x] 1. Render: add deformed front/back depth targets, restrained gel absorption/reflection and studio lighting. Retain the existing output color transform after visual comparison. Move bubbles into a real interior depth layer; compare front and side.
- [x] 2. Motion: test contact-wave propagation, volume compensation and damping; add an axial spring lattice to the existing displacement field, preserve all existing physics tests.
- [x] 3. Absorption: test held-food ownership, floor approach/contact, continuous enclosure and full refusal. Add body wrapping and retained visible internal candy; replace mouth-centric scooping/chewing in the live scene.
- [ ] 4. Verify: unit tests, typecheck, lint, production build, real WebGPU front/side, press/drop, wrap/multiple/full, frame-time sample; review diff and deploy verified private version.

## Test fixtures
- Contact spring impulse at y=.35: local band responds before crown; energy decays; displacements remain finite under repeated impacts.
- A free candy at x=2,y=.085,z=1.2 remains a physical entity while slime approaches and wraps it. Held candy never changes ownership during contact.
- Wrap age 0 preserves position/scale; age .8 is enclosed; age 1.5 retains substantial solid volume; dissolve is continuous; fullness counted once.
- Opposite-view screenshots must show bubbles behind the front boundary and highlights without white clipping or black contour bands.

## Verification before publication
- 88 tests, TypeScript, lint and production build pass. Build warns about the existing large Three.js chunk.
- Read-only review found one compression discontinuity; fixed and regression-tested. A rejected second meal also now preserves absorption state.
- Actual WebGPU front/side, lift/release, visible interior candy and soft concentration spread checked. Ten candies yielded seven absorbed and three resting after fullness.
- Desktop in-app browser: 128–144 FPS observed, frame P95 7–8.1 ms at DPR 1.5 (1281×1599 canvas). Not a phone/independent Chrome claim.
- Screen-space optics and a small-strain spring lattice are explicit approximations; this iteration does not claim path-traced image quality or a full volumetric solver.
- Actual screenshots are in workspace outputs/softie-gel-qa. Publication uses the existing owner-private Site.
