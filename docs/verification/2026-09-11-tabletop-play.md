# Mobile tabletop verification

Approved scope: remain in front, allow local squeezing, a small lift and small hops. Free activity stays available in Settings. Coarse-pointer devices default to tabletop; a saved choice takes precedence. Existing approved body, optical material and Apple linear-capture sampler are unchanged.

## Changes
- Saturating local grip displacement, limited release centre velocity, and soft centre-of-mass restraint. Relative nodal velocities remain intact. No per-frame pose or position resets.
- Lift budget considers body height at grab start, preventing repeated grabs from accumulating altitude. Input also takes priority when grabbing a digesting body.
- Fixed camera, pinch zoom without accidental orbit, nearby candy placement and slower candy throws; lower three-variant feeding hops.
- Mode switch clears active capture/candy and resets the play area; choice persists. User-facing description explains the reset.

## Evidence
- Real WASM repeated-grab tests (12 fast upward/side pulls), both idle and feeding: maximum horizontal COM radius 0.7684 world units, maximum COM lift 0.47999, retained local crown stretch 0.65965. These are stress-case simulation measurements, not phone frame rates.
- 7 tabletop tests pass. Touch handler harness passes 8 lifecycle scenarios including fixed-mode pinch without orbit, synchronous/deferred capture loss and both finger-release orders.
- Game suite: free/tabletop three distinct physical feeding contacts complete with visible post-digestion expression; five floor angles, manual deep release, withdrawal, color retention and cleanup pass. 24 tests in the initial combined run passed.
- Final focused rerun after ownership fixes: camera takeover without a held body preserves flight velocity; all three tabletop meals still complete (2/2).
- Apple texture selection/conversion, candy-hop and touch-orbit regressions pass (8/8).
- Local browser checked at 393 × 852: setting selector visible, free/tabletop state changes, saved tabletop mode restored after navigation without the QA override. Geometry/material appearance retained. Browser viewport emulation is not iPhone GPU/performance verification.
- TypeScript, lint and production build checked. Existing large-chunk and route-classification build warnings remain.

Independent review caught cumulative lift and cancel-without-ownership issues; both fixed and covered by regression tests. Live iPhone touch feel remains the next user acceptance check.
