# Appearance Studio Implementation Plan

> Execute inline with superpowers:executing-plans. The Site owner authors all source and assets in the retained isolated worktree.

**Goal:** Deliver a real WebGPU appearance study that compares a newly authored, rotatable jelly character with the approved storyboard, before integration into the full toy.

**Architecture:** Author a reusable Blender mesh and shared facial morphs, export GLB, and load them into a separate Three WebGPU studio. A small appearance module owns deformation; a material module owns gel/bubble optics; a page owns camera presets, gray/clay inspection, pause and reference comparison.

**Tech Stack:** Existing Three r183/Vinext/React/TypeScript; Blender 4.5 LTS portable asset authoring. No WebGL fallback.

**Spec:** User-approved appearance workflow in this conversation; workspace outputs/softie-absorption-design/storyboard-v2.png.

## Constraints
- Inspect actual realtime screenshots at fixed front, three-quarter and side views, both still and slightly deformed.
- Preserve a small low face, rounded shoulders and grounded underside. The user's later correction requires a centered resting crown; the reference asymmetry is primarily an oblique view.
- Build `/lookdev` as an appearance study with an obvious link to the existing toy. Mobile dragging starts only in the viewport; controls remain outside it.
- Keep the same private Site; do not claim photoreal equivalence, phone frame rates, or completed absorption choreography from this study.
- Asset authoring files and GLB must be reproducible. Keep downloads outside the source checkout.

## Task 1 — Character asset
Files: `assets/create-slime-studio.py`, `assets/slime-studio.blend`, `public/models/slime-studio.glb`, `tests/studio-asset.test.mjs`.
Produces a GLB with named `Gel`, `Eye.L`, `Eye.R`, `Smile` meshes and matching `Breathe`, `Squash`, `Puff` morphs; source mesh uses Y up after glTF export.
- [x] Obtain official Blender ZIP, verify published SHA256 and run its version command.
- [x] Write Node GLB checks before export: parse JSON chunk, require named meshes and finite position bounds, verify all three face/body morphs and a small lower face.
- [x] Model the body from an authored smooth asymmetric profile with closed ends. Place face vertices on the front surface; apply the same morph deformation to all meshes.
- [x] Save the Blender file and GLB; run asset checks and inspect mesh normals/bounds.

## Task 2 — Realtime appearance scene
Files: `lib/studio-scene.ts`, `lib/studio-material.ts`, `app/lookdev/page.tsx`, `app/lookdev/studio.css`, `public/reference/absorption-storyboard.png`.
Interface: `createStudio(host, callbacks): Promise<StudioHandle>`; handle exposes `setView('front'|'three-quarter'|'side')`, `setMaterial('gel'|'clay')`, `setMotion(boolean)`, `setPose('rest'|'squash'|'puff')`, `dispose()`.
- [x] Load named meshes with GLTFLoader, validate WebGPU backend, and render with explicit color management.
- [x] Use deformed body front/back depth for thickness; independent interior bubbles; restrained reflection and absorption without hand-painted white boundary replacement.
- [x] Build a studio lighting rig, ground shadow and controllable camera. Pointer capture must release on cancel; canvas-only orbit must not suppress page scrolling outside the scene.
- [x] Build a coherent comparison page with fixed views, clay/gel, pause, three poses, reference image and link to toy. No automatic orbit.
- [x] Start retained dev server, compile `/lookdev`, then show the first meaningful preview before further material edits.
- [x] Iterate on actual screenshots until silhouette, face placement, highlight shape and internal depth are materially closer to the storyboard. Avoid claiming quality from test counts.

## Task 3 — Verification and delivery
Files: README and workspace outputs/softie-studio-qa.
- [x] Verify all controls, front/side, gray model, pause and deformation; check responsive layout in a narrow viewport if available.
- [x] Run asset tests, existing regression suite, typecheck, lint, production build and diff check.
- [x] Request a read-only review of new route/resource disposal/input ownership and fix concrete findings.
- [x] Commit and fast-forward source checkout. Initial study was saved as version 9 without deployment.
- Publication deferred by explicit user choice: keep the study local. Save actual local screenshots.

## Review and delivery status
- Read-only review found camera clipping in narrow viewports and missing keyboard pitch; both are fixed. The camera test projects the actual GLB pose vertices at 192 view configurations.
- 90 tests, TypeScript, lint and production build passed. Actual screenshots include reference, side and narrow layout; no phone hardware benchmark is claimed.
- Current Site access is public (access policy revision 2). The user answered “先看本地样片，暂不发布”; do not deploy or ask again during local correction.
