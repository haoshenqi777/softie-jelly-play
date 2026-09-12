# Softie volume kernel

The checked-in `public/physics/volume.wasm` accelerates our original solver's
tetrahedral projection and inversion barrier loops. It does not contain Jelly
Baby source. `build.mjs` extracts these functions from `lib/softbody/solver.ts`
and the matrix helpers, so the JS reference remains the source of truth.

Compiler: AssemblyScript 0.28.9. This isolated tool package avoids touching the
site's shared `node_modules` junction. From the site directory:

```sh
bun install --cwd tools/wasm-compiler --frozen-lockfile --ignore-scripts
node tools/wasm-compiler/build.mjs
node --test tests/softbody-wasm.test.mjs
```

If registry downloads fail, `node tools/wasm-compiler/bootstrap.mjs`
is an alternative installer that fetches
three pinned official npm packages, checks their registry SHA-512 integrity,
validates archive entry paths and extracts them under this tool directory.
The compiler is not shipped to browsers; the small compiled kernel is.

The kernel uses double precision, a per-instance memory arena and no per-step
allocations. It projects four iterations, while the existing JS solver retains
input handling, integration, contacts, orientation checks, damping and sleep.
Parity is tested through impact and dragging on the actual approved cage.

## Contact kernel

`node tools/wasm-compiler/build-contact.mjs` builds
`public/physics/contact-skin.wasm` using the same isolated compiler. It extracts
strain/bending/area math from `lib/softbody/contact-skin.ts` and includes
`contact-collision.ts` for the frozen-surface rounded-box projections and wetting.
Do not hand-edit generated `contact-kernel.ts`. Regenerate the binary after
changing either reference math or collision source.

The arena is allocated once per character. Rebinding contacts changes counts
and buffers without allocating native memory. The browser loads this optional
accelerator before enabling interactions; the JS implementation is the fallback.
Run `node --experimental-transform-types --test tests/contact-kernel.test.mjs`
for skin/rebind and compressed rotated collision/wetting parity. Use
`CONTACT_SKIN_WASM=1` with the shape and game-intake suites to test the native path.
