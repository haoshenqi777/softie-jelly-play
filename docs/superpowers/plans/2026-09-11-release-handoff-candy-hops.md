# Release handoff and discrete candy hops — 2026-09-11

## User-approved scope

Fix candy stuck after contact/release. Restore discovery, anticipation and discrete jump landings at the real floor candy position. Continuous approach, side pushing and attraction remain removed. Publish this version to the existing Site and audience. The approved body/material/light/camera assets remain unchanged.

## Diagnosis and implementation

- Captured the actual page before resetting it: cube id3 had remained wrapping for 141 seconds, full wrap, 8/12 measured wet sectors, pressure0, permeability0. The old 10/12 threshold could not be satisfied against the table.
- A supported, loaded contact with at least 8/12 sectors must stay fully wrapped another .55 seconds before inward wetting may proceed. Unsupported, unloaded or lower-coverage contacts do not use this exception. Full burial and healed skin still gate digestion.
- The actual low-belly geometry regression now completes pressing -> wrapping -> entering -> sealing -> inside -> dissolving -> settling -> done. Existing full hand pressure and release already preserved physical depth; that code remains unchanged.
- Restored floor attention with .55 s notice and .8 s inspection, then .3 s takeoff preparation. CandyHop gives one gravity/drag-aware velocity impulse, freezes its destination for flight, and has no in-flight attraction or position writes.
- Landing points preserve the real candy direction and the existing face heading. A width*.42 underbelly offset chooses the rounded shoulder, where the approved mesh has a resolved contact patch. A central flat triangle fan cannot reliably represent a small sugar dent; this version avoids that area for voluntary jump landings instead of changing the approved shape or faking contact. Arbitrary free impacts on that sparse patch remain a collision-mesh limitation.
- Input takeover, absorption and self-righting interrupt the hop motor. A missed jump has a quiet landing interval before another attempt. Home-return motor and material rendering remain unchanged.
- Root route now reuses the current softbody product page so the original published URL opens the current game.

## Verification

- 73/73 targeted regression tests passed, no failures or skips. Log: outputs/product-qa/release-hop-regression.log.
- New real-model WASM test completes left, right and rear sugar landings and digestion, and asserts three distinct local body contact regions. Read-only review additionally verified front and farther diagonal placements with one jump and full digestion.
- Actual existing browser tab, WebGPU: clicked a cube; observed launches1, completed1, stage done, candy count0, zero console errors. Current sampled page fps59 is a desktop observation, not a mobile performance certification. Evidence: outputs/product-qa/release-hop-browser-after.json and .png.
- TypeScript noEmit passed. Sites build helper passed all five build environments. Existing large-bundle and route-classification notices remain.
- Original live stuck-state evidence retained in outputs/product-qa/stuck-wrap-before.json and .png.
- Model, studio-gel, studio-material, slime-optics and studio-camera SHA256 hashes match the protected baseline recorded in 2026-09-11-manual-feeding-rollback.md.
- Read-only code review found no actionable correctness findings in the tested routes. Real mobile device QA remains outstanding; no mobile frame-rate claim is made.
