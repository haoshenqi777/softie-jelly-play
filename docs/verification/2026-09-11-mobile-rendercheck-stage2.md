# Mobile grid artifact: second-stage isolation

The iPhone 14 Pro screenshots supplied by the user retain the grid with each
first-stage toggle: no added reflection, constant refraction depth, no interior
bubbles. These results do not identify any one of those components as the cause.
Desktop does not reproduce the mobile artifact. No claim of a mobile fix.

The normal product path, model, authored PNG, studio colors/lights, candy behavior
and physics remain unchanged. Only ?rendercheck=1 allocates a second capture.

Modes:
1. Original optical shader with the original image sampler.
2. Same image pixels, CPU sRGB-to-linear RGBA16F conversion and row flip, buffer
   upload, no mipmaps, four textureLoad reads with explicit bilinear interpolation.
   Original reflection, thickness, bubbles and pigment composition remain active.
   This deliberately bypasses the shared image upload/sampler chain as a group.
3. A separate texture-free diffuse grayscale shader on the same deforming mesh,
   with the same vertex normals and rasterizer. This is not a proposed appearance.

Mode 2 is diagnostic: fixed LOD can alias under strong minification and costs four
explicit texture reads plus an extra 12 MiB capture. Do not enable it by device
sniffing or make it the default without actual mobile visual/performance evidence.
Canvas readback may round low-alpha source RGB; no authored texture is modified.

Verification:
- CPU conversion: linear midpoint, unchanged alpha, Y orientation, odd dimensions.
- TypeScript, scoped lint, production build passed.
- Local WebGPU: all three modes render; compatibility capture retains pink, card
  direction and visible gel response; gray uses a separate untextured shader.
- iPhone verification remains pending. Desktop viewport emulation is not proof.

Interpretation:
- Only mode 2 removes grid: isolate which upload/filter stage is responsible next.
- Mode 2 retains grid, gray removes it: inspect remaining optical shader/UV terms.
- Gray retains grid: investigate normal interpolation, geometry/depth and raster
  behavior instead of retuning gel colors.
