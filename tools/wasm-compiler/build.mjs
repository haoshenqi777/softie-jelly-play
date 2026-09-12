// Compile the same original solver hot loops; parity tests guard numerical drift.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import asc from './node_modules/assemblyscript/dist/asc.js';
const root = new URL('../../', import.meta.url);
const solver = readFileSync(new URL('lib/softbody/solver.ts', root), 'utf8');
const extract = (name) => {
  const start = solver.indexOf(`  private ${name}(`);
  const end = solver.indexOf('\n  private ', start + 1);
  return solver.slice(start, end)
    .replace(`private ${name}`, `function ${name}`)
    .replaceAll('this.', '')
    .replace('t: number', 't: i32')
    .replaceAll(': number', ': f64')
    .replace(/\b(norm|s|v|sv|denom) = 0/g, '$1: f64 = 0');
};
let math = readFileSync(new URL('lib/softbody/math.ts', root), 'utf8');
math = math.slice(0, math.indexOf('export function inverse'))
  .replaceAll('export function', 'function')
  .replaceAll('ArrayLike<number>', 'Float64Array')
  .replaceAll(': number', ': f64');
const code = `// Generated from our TypeScript solver by build.mjs. Do not hand edit.
let x = new Float64Array(0), inverseRest = new Float64Array(0), volumes = new Float64Array(0), invMass = new Float64Array(0), mu = new Float64Array(0), lambdas = new Float64Array(0);
let ids = new Int32Array(0);
let f = new Float64Array(9), cof = new Float64Array(9), gs = new Float64Array(12), gv = new Float64Array(12);
let bulk: f64 = 2200;
export function init(nodes: i32, tetrahedra: i32): void {
 x = new Float64Array(nodes * 3); ids = new Int32Array(tetrahedra * 4);
 inverseRest = new Float64Array(tetrahedra * 9); volumes = new Float64Array(tetrahedra);
 invMass = new Float64Array(nodes); mu = new Float64Array(tetrahedra); lambdas = new Float64Array(tetrahedra * 2);
}
export function pointer(which: i32): usize {
 if(which == 0) return x.dataStart; if(which == 1) return ids.dataStart;
 if(which == 2) return inverseRest.dataStart; if(which == 3) return volumes.dataStart;
 if(which == 4) return invMass.dataStart; if(which == 5) return mu.dataStart;
 return lambdas.dataStart;
}
export function resetLambdas(): void { lambdas.fill(0); }
export function project(dt: f64, reverse: bool, stiffness: f64): void {
 bulk = stiffness;
 for(let q = 0; q < volumes.length; q++) projectTet(reverse ? volumes.length - 1 - q : q, dt);
 for(let i = 1; i < x.length; i += 3) if(x[i] < 0) x[i] = 0;
 for(let q = 0; q < volumes.length; q++) barrier(reverse ? volumes.length - 1 - q : q);
}
${math}
${['deformation','gradients','projectTet','barrier'].map(extract).join('\n')}
`;
const source = new URL('kernel.ts', import.meta.url);
writeFileSync(source, code);
mkdirSync(new URL('public/physics', root), { recursive: true });
const result = await asc.main([source.pathname.replace(/^\/(\w:)/, '$1'), '--outFile', new URL('public/physics/volume.wasm', root).pathname.replace(/^\/(\w:)/, '$1'), '-O3', '--runtime', 'stub', '--noAssert', '--uncheckedBehavior', 'always']);
if (result.error) { console.error(result.stderr.toString()); process.exit(1); }
console.log('Built public/physics/volume.wasm');
