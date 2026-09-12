# Mobile tabletop play

**Goal:** Keep Softie within easy reach, with local stretching, a small lift and soft hops. The user approved this mode; free play remains selectable. Preserve the approved appearance and Apple texture fix.

**Architecture:** A separate input/space policy limits grip displacement and centre-of-mass energy, without changing material stiffness or writing body positions. Feeding has exclusive motion ownership during jumps and absorption. Both modes share WebGPU rendering and soft-body simulation.

1. Verify bounded release and repeated grabs against the real WASM solver. Keep local strain; do not zero all velocities.
2. Wire a tabletop/free policy through scene, hand input, nearby candy and hop height. Lock orbit in tabletop while retaining pinch zoom and explicit view controls.
3. Default coarse-pointer devices to tabletop; remember the choice in Settings. Switching cancels gestures and resets the play area with an explicit UI description.
4. Run gesture, feeding and appearance regressions; inspect browser UI. Build and publish the existing authorized site. Actual iPhone performance and feel require device feedback; desktop viewport checks are not phone benchmarks.
