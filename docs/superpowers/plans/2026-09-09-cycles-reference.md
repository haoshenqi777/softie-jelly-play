# Cycles reference study implementation plan

> Execute inline with superpowers:executing-plans. The Site owner authors all
> source; any review is read-only. Reuse the clean isolated feature worktree.

**Goal:** Produce a reproducible four-view Cycles render of the same slime asset,
then compare it with the real WebGPU scene at matching camera angles and poses.

**Architecture:** A Blender background script loads the retained authoring mesh,
builds physical surface/volume materials, lights, bubbles and a floor from a
recorded JSON recipe. It exports PNGs plus camera/material metadata. `/lookdev`
offers the finished Cycles images alongside the existing concept reference.

**Tech:** Blender 4.5.9 / Cycles OptiX, Three r183 WebGPU, current React/Vinext.
**Spec:** User approved the preceding three-step material-reference workflow.

## Constraints

- Keep body and facial geometry/morphs shared with the web asset.
- Four views: front/rest; yaw -.6/rest; yaw -pi/2/rest; yaw -.6/squash.
- Camera: vertical FOV 30 degrees, pitch .12, target Y=1.05 and the same camera
  distance formula as studio-camera.ts. Render at 768×720.
- No AI-generated substitute, no claim that offline rendering runs at 60 FPS.
- Keep the current public Site unchanged; user selected local-only review.
- Do not tune the live shader while establishing the first physical reference.

## Task 1 — Reproducible physical reference

Files: assets/render-studio-cycles.py, assets/studio-cycles-recipe.json.

- [x] Load assets/slime-studio.blend and assert Gel/Eye.L/Eye.R/Smile and all
  three shape keys exist; reset them before each view.
- [x] Build a white transmissive surface with IOR 1.36, explicit volume
  absorption coefficients and low scattering; no emission in the body.
- [x] Use shared bubble coordinates from Gel metadata; model air interfaces as
  refractive spheres. Record any approximation to overlapping volumes.
- [x] Add a neutral studio, rectangular softboxes and a physically shaded floor.
  Set deterministic samples/seed and explicit color management.
- [x] Render side-front first; inspect actual pixels before the remaining views.
  Adjust the recipe only from a stated visual hypothesis, preserving iterations.
- [x] Render all four PNGs, save studio.blend and a metadata JSON with model hash,
  recipe, cameras, pose, render engine, sample count and timings.

Verification: Blender exits successfully; PNGs exist with 768×720 dimensions;
metadata identifies the actual shared model and four prescribed poses. Inspect
each image for a grounded shape, readable face, clear gel and distinct bubbles.

## Task 2 — Browser comparison

Files: app/lookdev/page.tsx, app/lookdev/studio.css, public/reference/cycles/*.

- [x] Add a clearly labeled toggle between AI concept and offline Cycles render.
- [x] Match the Cycles image to supported camera/pose presets; indicate when the
  live camera is freely rotated or an unsupported pose/motion is selected.
- [x] Keep existing live WebGPU controls and original toy route intact.
- [x] Show and inspect real browser captures of both outputs side by side.

Verification: control flow, no false claim of live Cycles, no new browser errors,
typecheck/lint/build, existing regression suite. Capture actual final comparison.

## Task 3 — Evidence and delivery

- [x] Record what the physical render resolves and what still differs from the
  concept. Define the next realtime material change from this evidence.
- [x] Read-only review of script/metadata/comparison state. Fix concrete issues.
- [x] Commit and fast-forward the local source checkout. Leave local preview
  available. No upload or deployment.

## Evidence — 2026-09-09

- Four actual Cycles images inspected at 128 samples. RTX 4070 Ti timings:
  front 10.173 s, oblique 9.518 s, side 8.647 s, squash 9.056 s.
- Hypotheses tested in preserved physical-01 through physical-05 iterations:
  neutral world fill brightens transmission; a seamless studio removes the
  environment horizon; hiding the body proved the silver lower eyes were mainly
  strong eye reflections, then lower eye specular response restored black beans.
- Air bubbles, volumetric tint and contact illumination improve. Top internal
  reflection remains too strong; contact edge and bubble distribution still
  differ from the concept. The reference is a material baseline, not final art.
- Actual browser screenshots: outputs/softie-cycles-study/browser-qa. Both
  desktop panes measured 509.045 x 477.223 CSS pixels, same 16:15 framing.
  Front alignment: WebGPU, rest, weights [0,0,0], yaw 0, pitch .12.
  Alignment after paused breathing clears its residual weight; squash uses
  [0,1,0]. Manual orbit removes the alignment claim. User also interacted with
  the live preview during checks, so freely rotated captures are not treated as
  matched-view evidence. Narrow concept layout was inspected; temporary viewport
  override reset. This is not a mobile GPU performance test.
- Read-only review independently loaded the saved Blender scene, verified actual
  volume/surface settings and the shared geometry/morphs; no blocking findings.
- 91 tests pass. TypeScript, lint and production build pass. Build retains the
  existing large-chunk notice. No new browser warnings/errors after reload.
- Next runtime work is staged: match neutral lighting/black eyes, replace bubble
  dots with air-interface refraction, then refine bottom thickness and floor
  reflection. Measure each stage separately; do not substitute PNGs for live gel.
- Local-only integration and preview retained; no push or deployment.