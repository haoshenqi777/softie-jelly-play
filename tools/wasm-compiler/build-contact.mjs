// Compile the existing contact math; JS remains the reference implementation.
import { readFileSync, writeFileSync } from 'node:fs';
import asc from './node_modules/assemblyscript/dist/asc.js';
const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('lib/softbody/contact-skin.ts', root), 'utf8');
const prepareBody = source.slice(source.indexOf('    this.degrees.fill(0);'), source.indexOf('    // End reference preparation;'))
  .replaceAll('this.', '').replaceAll('for (const e of selected)', 'for (let ei = 0, e = selected[0]; ei < edgeCount; ei++, e = ei < edgeCount ? selected[ei] : selected[0])')
  .replaceAll('triangles.length', 'triangleCount').replaceAll('Math.hypot(', 'hypot3(');
function method(name, next) {
  const start = source.indexOf(`  ${name === 'solve' ? '' : 'private '}${name}(`);
  let s = source.slice(start, next ? source.indexOf(`\n  private ${next}(`, start) : source.lastIndexOf('\n}'));
  // The reference solve delegates when accelerated; never compile that branch.
  s = s.replace(/    if \(this\.kernel\) \{[\s\S]*?\n    \}/, '');
  return s.replace(/(?:private )?(solve|fair|preventInversion|bend)\(/, 'function $1(')
    .replaceAll('this.', '').replace('const p = p,', 'const').replace(': boolean', ': bool')
    .replace(/\) \{/, `): ${name === 'bend' ? 'f64' : 'void'} {`)
    .replace('if (!ids.length)', 'if (idCount == 0)')
    .replaceAll('for (const i of ids)', 'for (let ii = 0; ii < idCount; ii++) if (true)')
    // Insert the id binding in both braced and unbraced loops by using an indexed helper array.
    .replaceAll('for (let ii = 0; ii < idCount; ii++) if (true)', 'for (let ii = 0, i = ids[0]; ii < idCount; ii++, i = ii < idCount ? ids[ii] : 0)')
    .replaceAll('for (const e of selected)', 'for (let ei = 0, e = selected[0]; ei < edgeCount; ei++, e = ei < edgeCount ? selected[ei] : selected[0])')
    .replaceAll('triangles.length', 'triangleCount')
    .replaceAll('let denom = 0', 'let denom: f64 = 0')
    .replaceAll('Math.hypot(', 'hypot3(');
}
const code = `// Generated from lib/softbody/contact-skin.ts by build-contact.mjs.
class Edge { a:i32=0; b:i32=0; c:i32=0; d:i32=0; angle:f64=0; cosine:f64=1; length:f64=0; ids:Int32Array=new Int32Array(4); }
let selected = new Array<Edge>();
let p=new Float64Array(0), base=new Float64Array(0), offset=new Float64Array(0), sums=new Float64Array(0), degrees=new Float64Array(0), triangleFrames=new Float64Array(0), edgeData=new Float64Array(0);
let movable=new Uint8Array(0), ids=new Int32Array(0), triangles=new Int32Array(0), index=new Uint32Array(0), grads=new Float64Array(12);
let idCount:i32=0, edgeCount:i32=0, triangleCount:i32=0;
function hypot3(x:f64,y:f64,z:f64):f64 { return Math.sqrt(x*x+y*y+z*z); }
export function init(nodes:i32, indices:i32, edges:i32):void {
  p=new Float64Array(nodes*3); base=new Float64Array(nodes*3); offset=new Float64Array(nodes*3); sums=new Float64Array(nodes*3); degrees=new Float64Array(nodes);
  movable=new Uint8Array(nodes); ids=new Int32Array(nodes); index=new Uint32Array(indices); triangles=new Int32Array(indices/3); triangleFrames=new Float64Array(indices/3*4); edgeData=new Float64Array(edges*7);
  for(let i=0;i<edges;i++) selected.push(new Edge());
  initCollision(nodes, indices);
}
export function pointer(k:i32):usize {
  if(k==0)return base.dataStart; if(k==1)return offset.dataStart; if(k==2)return movable.dataStart; if(k==3)return ids.dataStart; if(k==4)return index.dataStart;
  if(k==5)return triangles.dataStart; if(k==6)return triangleFrames.dataStart; if(k==7)return degrees.dataStart; return edgeData.dataStart;
}
export function bind(ni:i32, ne:i32, nt:i32):void {
  idCount=ni; edgeCount=ne; triangleCount=nt;
  for(let i=0;i<ne;i++) { let e=selected[i]; e.a=i32(edgeData[i*7]); e.b=i32(edgeData[i*7+1]); e.c=i32(edgeData[i*7+2]); e.d=i32(edgeData[i*7+3]); e.angle=edgeData[i*7+4]; e.cosine=edgeData[i*7+5]; e.ids[0]=e.c; e.ids[1]=e.d; e.ids[2]=e.a; e.ids[3]=e.b; }
}
export function prepare():void { for(let i=0;i<edgeCount;i++)selected[i].length=edgeData[i*7+6]; }
export function prepareFrame():void { ${prepareBody} }
export function project():void { solve(offset); }
${method('solve','fair')}
${method('fair','preventInversion')}
${method('preventInversion','bend')}
${method('bend')}
${readFileSync(new URL('contact-collision.ts', import.meta.url),'utf8')}
`;
const path = u => u.pathname.replace(/^\/(\w:)/, '$1');
const kernel = new URL('contact-kernel.ts', import.meta.url);
writeFileSync(kernel, code);
const result = await asc.main([path(kernel), '--outFile', path(new URL('public/physics/contact-skin.wasm', root)), '-O3', '--runtime','stub','--noAssert','--uncheckedBehavior','always']);
if(result.error){console.error(result.stderr.toString()); process.exit(1);}
console.log('Built public/physics/contact-skin.wasm');
