# Mobile interaction verification — 2026-09-12

Target: the existing `softie-jelly-play.zhaorong.chatgpt.site` project. The separate frozen mobile site is unchanged.

## Behavior

- Small screens and coarse pointers start with the camera locked on the center. Settings can unlock it; two-finger zoom remains available.
- The resting view is closer. Small body jiggles do not move the camera target or pump the lens, and active grabs freeze camera motion. Large released jumps remain in view.
- Pointer movement is merged to the latest position per pointer before each simulation frame. Release flushes the final position; cancellation clears pending movement.
- Mobile rendering uses a smaller visible canvas, lower optical resolution, simpler bubble meshes, and a capped pixel ratio. Sustained low frame rates reduce render scale only between gestures. Physics and feeding behavior are preserved.
- Compact landscape layouts keep the candy tray alongside the stage and avoid header wrapping.

## Validation

- TypeScript: `tsc --noEmit` passed.
- Production: `vinext build` passed using the installed Node CLI. Existing large-chunk warning remains.
- Mobile experience: 5 tests passed, covering burst input, stable framing, jump containment, held-camera stability, and immediate pinch response.
- Pointer ownership/takeover: 17 tests passed, including locked-camera background drag, pinch, and tray-drag bursts.
- Physics, camera, and capture targeted regression set passed: touch orbit, tabletop physics, frame budget, camera motion, studio camera, and gel capture.
- Game intake, candy handoff, and product motion: 26 tests passed. Includes complete meals in both play modes and contact/withdrawal/cancellation behavior.
- Browser checked at 320×740, 393×852, and 844×390. No horizontal page overflow or browser error logs. Actual browser drags preserved central camera orientation and released ownership correctly.
- At 393×852 the stage canvas is 393×608, down from the full viewport. Desktop GPU browser emulation was used; these checks do not measure frame rate or input latency on a physical phone.

Independent review caught a manual zoom regression in the first implementation. It was corrected, covered by two regression tests, and re-reviewed without an outstanding important finding.
