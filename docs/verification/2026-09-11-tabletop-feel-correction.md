# Tabletop feel correction

User requirement: preserve nearby play while restoring useful deformation, lift, head pressure and full jumps. Empty-space one-finger input orbits 360 degrees. Two fingers zoom only.

Implemented:
- Removed the 0.72 local input scaling, half-unit compression stop, global tabletop damping and tabletop restitution override.
- Full ordinary grip response; soft lift ceiling beyond ordinary travel. Edge-only COM restraint and bounded horizontal release preserve relative nodal velocities.
- Original candy, turn and selected drop heights restored. An intentional drop clears the previous hand-release energy guard.
- Background touch owns orbit until release. Pinch can take over background/body/tray candy; its remaining finger stays suppressed until all release.
- Vertical flight framing resumes after gesture ownership ends, independently of horizontal camera quiet time. Full-height tabletop framing includes maximum saved jump at closest zoom.

Verification:
- 8 tabletop physics/parameter cases pass, including real WASM head compression/rebound comparison against free mode and repeated rapid grabs.
- Twelve repeated grabs: maximum COM radius 0.979, lift 1.888 and local stretch 1.253 world units; same result while digestion flag is active.
- 14 touch lifecycle harness cases pass: single-background orbit beyond 360 degrees, no body-hit retarget, pinch promotion, both lift orders, capture loss sync/deferred, body ownership and tray cleanup.
- Real WASM three meals in EACH mode complete, use distinct contact locations and full-height variation, and retain non-neutral finish expressions. Deep hand press/withdraw/release absorption passes.
- Regression reproduced: a selected maximum jump immediately after a hand release peaked at 4.046 instead of 4.623. Clearing only the intentional-launch release guard passes the comparison.
- Independent read-only review executed current camera code against real WASM maximum-jump trajectories, portrait/landscape, zoom 0.85 and four pitches: all vertices inside viewport; worst landscape NDC y 0.964. Active body/candy/background/pinch ownership freezes automatic framing.
- Browser QA at 393 x 852: WebGPU + linear capture retained; background drag rotated to side with zero body grabs. UI text matches one-finger orbit/two-finger zoom. Viewport reset afterwards.
- TypeScript and scoped lint pass.

Limits: touch lifecycle is an event harness, not iPhone hardware QA. Embedded preview runs at ~1 FPS when backgrounded; no new device FPS claim. Body, eye, lighting and iPhone texture-sampling files unchanged.
