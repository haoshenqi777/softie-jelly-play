# Promote the device-verified gel sampler

User confirmed that stage-2 mode 2 removes the visible grid on iPhone 14 Pro,
including a deeply indented pose, with screenshot ef5ef418e648c1c08f6023fdd12c44dd.jpg.
This implicates the original upload/filter chain as a group; it does not prove
which of mip generation, sRGB upload or hardware interpolation caused the bug.

The exact verified CPU linear RGBA16F conversion and four-tap textureLoad sampler
are now shared by diagnostics and production. Apple mobile uses it by default;
desktop/Android retain their existing sampler. Both original and dyed materials
receive it. No artistic PNG, model, lighting or color constants changed.

Only one linear capture is allocated and owned by the scene. Normal Apple mobile
rendering does not upload/sample the original PNG texture on the GPU, compile
diagnostic branches, or allocate the gray material. Conversion occurs at load;
the sampler adds no render pass. Four explicit reads can still affect GPU cost;
do not equate a clean screenshot with a 60 FPS benchmark on all devices.

Verification:
- Device routing + conversion tests: 4 passed.
- TypeScript, scoped lint, production build passed.
- Local WebGPU forced-production path (?gelcapture=linear), without diagnostic
  controls: original pink and moonlight blue render with expected highlights;
  drag deformation responds; no captured console errors.
- Independent review found no wiring or resource-ownership blocker.

The fixed-LOD sampler trades automatic minification filtering for the validated
mobile path. Extreme zoom-out and sustained physical-device performance remain
follow-up QA; future changes must be compared against this user-approved version.
