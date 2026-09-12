// Generated from lib/softbody/contact-skin.ts by build-contact.mjs.
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
export function prepareFrame():void {     degrees.fill(0);
    for (let ei = 0, e = selected[0]; ei < edgeCount; ei++, e = ei < edgeCount ? selected[ei] : selected[0]) {
      const a = e.a * 3,
        b = e.b * 3;
      e.length = hypot3(
        base[b] - base[a],
        base[b + 1] - base[a + 1],
        base[b + 2] - base[a + 2],
      );
      degrees[e.a] += e.length;
      degrees[e.b] += e.length;
    }
    for (let j = 0; j < triangleCount; j++) {
      const t = triangles[j],
        a = index[t] * 3,
        b = index[t + 1] * 3,
        c = index[t + 2] * 3,
        p = base;
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2],
        vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2];
      const x = uy * vz - uz * vy,
        y = uz * vx - ux * vz,
        z = ux * vy - uy * vx,
        len = hypot3(x, y, z) || 1;
      triangleFrames[j * 4] = x / len;
      triangleFrames[j * 4 + 1] = y / len;
      triangleFrames[j * 4 + 2] = z / len;
      triangleFrames[j * 4 + 3] = len;
    }
 }
export function project():void { solve(offset); }
  function solve(offset: Float64Array): void {

    if (idCount == 0) return;
    for (let ii = 0, i = ids[0]; ii < idCount; ii++, i = ii < idCount ? ids[ii] : 0)
      for (let a = 0; a < 3; a++)
        p[i * 3 + a] = base[i * 3 + a] + offset[i * 3 + a];
    fair();
    for (let ei = 0, e = selected[0]; ei < edgeCount; ei++, e = ei < edgeCount ? selected[ei] : selected[0]) {
      const a = e.a * 3,
        b = e.b * 3,
        wa = movable[e.a],
        wb = movable[e.b];
      if (wa + wb === 0) continue;
      const dx = p[b] - p[a],
        dy = p[b + 1] - p[a + 1],
        dz = p[b + 2] - p[a + 2],
        len = hypot3(dx, dy, dz);
      const rest = e.length;
      const target = Math.max(rest * 0.7, Math.min(rest * 1.45, len));
      if (len > 1e-7 && len !== target) {
        const s = ((len - target) / len / (wa + wb)) * 0.85;
        for (let k = 0; k < 3; k++) {
          const d = (k === 0 ? dx : k === 1 ? dy : dz) * s;
          p[a + k] += d * wa;
          p[b + k] -= d * wb;
        }
      }
    }
    for (let ei = 0, e = selected[0]; ei < edgeCount; ei++, e = ei < edgeCount ? selected[ei] : selected[0]) bend(e, true);
    preventInversion();
    for (let ii = 0, i = ids[0]; ii < idCount; ii++, i = ii < idCount ? ids[ii] : 0)
      if (movable[i])
        for (let a = 0; a < 3; a++)
          offset[i * 3 + a] = p[i * 3 + a] - base[i * 3 + a];
  }
  function fair(): void {
    sums.fill(0);
    for (let ei = 0, e = selected[0]; ei < edgeCount; ei++, e = ei < edgeCount ? selected[ei] : selected[0]) {
      const a = e.a * 3,
        b = e.b * 3;
      const weight = e.length;
      for (let d = 0; d < 3; d++) {
        sums[a + d] += (p[b + d] - base[b + d]) * weight;
        sums[b + d] += (p[a + d] - base[a + d]) * weight;
      }
    }
    for (let ii = 0, i = ids[0]; ii < idCount; ii++, i = ii < idCount ? ids[ii] : 0)
      if (movable[i] && degrees[i] > 0)
        for (let d = 0; d < 3; d++) {
          const j = i * 3 + d;
          p[j] +=
            (base[j] + sums[j] / degrees[i] - p[j]) * 0.35;
        }
  }
  function preventInversion(): void {
    const
      g = grads;
    for (let j = 0; j < triangleCount; j++) {
      const t = triangles[j],
        a = index[t] * 3,
        b = index[t + 1] * 3,
        c = index[t + 2] * 3;
      const nx = triangleFrames[j * 4],
        ny = triangleFrames[j * 4 + 1],
        nz = triangleFrames[j * 4 + 2],
        area = triangleFrames[j * 4 + 3];
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2],
        vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2];
      const C =
        (uy * vz - uz * vy) * nx +
        (uz * vx - ux * vz) * ny +
        (ux * vy - uy * vx) * nz -
        area * 0.25;
      if (C >= 0) continue;
      let denom: f64 = 0;
      for (let k = 0; k < 3; k++) {
        const i1 = index[t + ((k + 1) % 3)] * 3,
          i2 = index[t + ((k + 2) % 3)] * 3,
          dx = p[i1] - p[i2],
          dy = p[i1 + 1] - p[i2 + 1],
          dz = p[i1 + 2] - p[i2 + 2];
        g[k * 3] = dy * nz - dz * ny;
        g[k * 3 + 1] = dz * nx - dx * nz;
        g[k * 3 + 2] = dx * ny - dy * nx;
        denom +=
          movable[index[t + k]] *
          (g[k * 3] ** 2 + g[k * 3 + 1] ** 2 + g[k * 3 + 2] ** 2);
      }
      if (denom < 1e-15) continue;
      const s = (-C / denom) * 0.85;
      for (let k = 0; k < 3; k++)
        if (movable[index[t + k]])
          for (let d = 0; d < 3; d++)
            p[index[t + k] * 3 + d] += s * g[k * 3 + d];
    }
  }
  function bend(edge: Edge, solve: bool): f64 {
    // p0/p1 are opposite the shared p2/p3 edge.
    const
      i0 = edge.c * 3,
      i1 = edge.d * 3,
      i2 = edge.a * 3,
      i3 = edge.b * 3;
    const ex = p[i3] - p[i2],
      ey = p[i3 + 1] - p[i2 + 1],
      ez = p[i3 + 2] - p[i2 + 2],
      elen = hypot3(ex, ey, ez);
    if (elen < 1e-6) return NaN;
    const ax = p[i2] - p[i0],
      ay = p[i2 + 1] - p[i0 + 1],
      az = p[i2 + 2] - p[i0 + 2],
      bx = p[i3] - p[i0],
      by = p[i3 + 1] - p[i0 + 1],
      bz = p[i3 + 2] - p[i0 + 2];
    const cx = p[i3] - p[i1],
      cy = p[i3 + 1] - p[i1 + 1],
      cz = p[i3 + 2] - p[i1 + 2],
      dx = p[i2] - p[i1],
      dy = p[i2 + 1] - p[i1 + 1],
      dz = p[i2 + 2] - p[i1 + 2];
    let nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx,
      mx = cy * dz - cz * dy,
      my = cz * dx - cx * dz,
      mz = cx * dy - cy * dx;
    const n2 = nx * nx + ny * ny + nz * nz,
      m2 = mx * mx + my * my + mz * mz;
    if (n2 < 1e-16 || m2 < 1e-16) return NaN;
    const cosine = Math.max(
      -1,
      Math.min(1, (nx * mx + ny * my + nz * mz) / Math.sqrt(n2 * m2)),
    );
    if (solve && cosine >= edge.cosine) return 0;
    const phi = Math.acos(cosine);
    if (!solve) return phi;
    // Allow a smooth concave contact; only resist excess curvature at mesh scale.
    const limit = edge.angle + 0.19;
    if (phi <= limit) return phi;
    const sign =
      (ny * mz - nz * my) * ex +
        (nz * mx - nx * mz) * ey +
        (nx * my - ny * mx) * ez >
      0
        ? -1
        : 1;
    nx /= n2;
    ny /= n2;
    nz /= n2;
    mx /= m2;
    my /= m2;
    mz /= m2;
    const a0 = (-bx * ex - by * ey - bz * ez) / elen,
      a1 = (-cx * ex - cy * ey - cz * ez) / elen,
      b0 = (ax * ex + ay * ey + az * ez) / elen,
      b1 = (dx * ex + dy * ey + dz * ez) / elen;
    const g = grads;
    g[0] = elen * nx;
    g[1] = elen * ny;
    g[2] = elen * nz;
    g[3] = elen * mx;
    g[4] = elen * my;
    g[5] = elen * mz;
    g[6] = a0 * nx + a1 * mx;
    g[7] = a0 * ny + a1 * my;
    g[8] = a0 * nz + a1 * mz;
    g[9] = b0 * nx + b1 * mx;
    g[10] = b0 * ny + b1 * my;
    g[11] = b0 * nz + b1 * mz;
    const ids = edge.ids;
    let denom: f64 = 0;
    for (let k = 0; k < 4; k++)
      denom +=
        movable[ids[k]] *
        (g[k * 3] ** 2 + g[k * 3 + 1] ** 2 + g[k * 3 + 2] ** 2);
    if (denom < 1e-10) return phi;
    const scale = ((phi - limit) / denom) * 0.6 * sign;
    for (let k = 0; k < 4; k++)
      if (movable[ids[k]])
        for (let a = 0; a < 3; a++) p[ids[k] * 3 + a] -= scale * g[k * 3 + a];
    return phi;
  }
function min3(a:f64,b:f64,c:f64):f64 {return Math.min(a,Math.min(b,c));}
function max3(a:f64,b:f64,c:f64):f64 {return Math.max(a,Math.max(b,c));}
// Included by build-contact.mjs. Same frozen-surface rounded-box projections as
// ContactShell.project / projectFaces, after coarse volume integration finishes.
let contactCandidates = new Int32Array(0), contactTriangles = new Int32Array(0);
let contactTouched = new Uint8Array(0), faceStamps = new Uint32Array(0);
let facePositions = new Float64Array(0), shape = new Float64Array(14);
let candidateCount:i32=0, contactTriangleCount:i32=0, facePass:u32=0;
let triangle = new Float64Array(9), local = new Float64Array(3), gradient = new Float64Array(3);
function initCollision(nodes:i32, indices:i32):void {
  contactCandidates=new Int32Array(nodes); contactTriangles=new Int32Array(indices/3);
  contactTouched=new Uint8Array(nodes); faceStamps=new Uint32Array(nodes); facePositions=new Float64Array(nodes*3);
}
export function collisionPointer(k:i32):usize {
  if(k==0)return contactCandidates.dataStart; if(k==1)return contactTriangles.dataStart;
  if(k==2)return shape.dataStart; return contactTouched.dataStart;
}
export function bindCollision(n:i32,t:i32):void {candidateCount=n;contactTriangleCount=t;}
function transformPoint(x:f64,y:f64,z:f64):void {
  local[0]=shape[3]*x+shape[4]*y+shape[5]*z;
  local[1]=shape[6]*x+shape[7]*y+shape[8]*z;
  local[2]=shape[9]*x+shape[10]*y+shape[11]*z;
}
function distance(x:f64,y:f64,z:f64):f64 {
  const h=shape[12]-shape[13], a=Math.abs(x)-h, b=Math.abs(y)-h, c=Math.abs(z)-h;
  const u=Math.max(0,a),v=Math.max(0,b),w=Math.max(0,c);
  return Math.sqrt(u*u+v*v+w*w)+Math.min(max3(a,b,c),0)-shape[13];
}
function outward(x:f64,y:f64,z:f64):f64 {
  const e=0.0001;
  let gx=distance(x+e,y,z)-distance(x-e,y,z), gy=distance(x,y+e,z)-distance(x,y-e,z), gz=distance(x,y,z+e)-distance(x,y,z-e);
  let len=Math.sqrt(gx*gx+gy*gy+gz*gz); if(len==0)len=1;
  gx/=len;gy/=len;gz/=len;
  gradient[0]=shape[3]*gx+shape[6]*gy+shape[9]*gz;
  gradient[1]=shape[4]*gx+shape[7]*gy+shape[10]*gz;
  gradient[2]=shape[5]*gx+shape[8]*gy+shape[11]*gz;
  let scale=Math.sqrt(gradient[0]*gradient[0]+gradient[1]*gradient[1]+gradient[2]*gradient[2]);if(scale==0)scale=1;
  for(let k=0;k<3;k++)gradient[k]/=scale;
  return scale;
}
function projectVertices():void {
  for(let q=0;q<candidateCount;q++) {
    const i=contactCandidates[q], j=i*3;
    if(!movable[i])continue;
    transformPoint(base[j]+offset[j]-shape[0],base[j+1]+offset[j+1]-shape[1],base[j+2]+offset[j+2]-shape[2]);
    const x=local[0],y=local[1],z=local[2],d=distance(x,y,z);
    if(d>=-0.00005)continue;
    const amount=(-d+0.00015)/outward(x,y,z);
    for(let k=0;k<3;k++)offset[j+k]+=gradient[k]*amount;
    contactTouched[i]=1;
  }
}
function projectContactFaces(bound:f64):void {
  const pass=++facePass;
  for(let q=0;q<contactTriangleCount;q++) {
    const ti=contactTriangles[q];
    if(!movable[index[ti]]&&!movable[index[ti+1]]&&!movable[index[ti+2]])continue;
    for(let k=0;k<3;k++) {
      const i=index[ti+k], j=i*3;
      if(faceStamps[i]!=pass) {
        faceStamps[i]=pass;
        for(let a=0;a<3;a++)facePositions[j+a]=base[j+a]+offset[j+a];
      }
      for(let a=0;a<3;a++)triangle[k*3+a]=facePositions[j+a];
    }
    if(min3(triangle[0],triangle[3],triangle[6])>shape[0]+bound||max3(triangle[0],triangle[3],triangle[6])<shape[0]-bound||min3(triangle[1],triangle[4],triangle[7])>shape[1]+bound||max3(triangle[1],triangle[4],triangle[7])<shape[1]-bound||min3(triangle[2],triangle[5],triangle[8])>shape[2]+bound||max3(triangle[2],triangle[5],triangle[8])<shape[2]-bound)continue;
    for(let sample=0;sample<4;sample++) {
      const w0=sample==0?1.0/3:sample==2?0:0.5, w1=sample==0?1.0/3:sample==3?0:0.5, w2=sample==0?1.0/3:sample==1?0:0.5;
      transformPoint(triangle[0]*w0+triangle[3]*w1+triangle[6]*w2-shape[0],triangle[1]*w0+triangle[4]*w1+triangle[7]*w2-shape[1],triangle[2]*w0+triangle[5]*w1+triangle[8]*w2-shape[2]);
      const x=local[0],y=local[1],z=local[2],d=distance(x,y,z);
      if(d>=-0.0002)continue;
      const scale=outward(x,y,z);
      const inv=w0*w0*movable[index[ti]]+w1*w1*movable[index[ti+1]]+w2*w2*movable[index[ti+2]];
      if(inv==0)continue;
      const correction=(-d+0.0008)/scale/inv;
      for(let k=0;k<3;k++)if(movable[index[ti+k]])for(let a=0;a<3;a++) {
        const change=gradient[a]*correction*(k==0?w0:k==1?w1:w2), j=index[ti+k]*3+a;
        offset[j]+=change;facePositions[j]+=change;triangle[k*3+a]+=change;
      }
    }
  }
}
export function regularize(passes:i32, colliding:bool, bound:f64):void {
  contactTouched.fill(0);
  for(let pass=0;pass<passes;pass++) {
    solve(offset);
    if(colliding){projectVertices();projectContactFaces(bound);}
  }
}
let wetMask:i32=0;
let wetNx:f64=0,wetNy:f64=0,wetNz:f64=0,wetUx:f64=0,wetUy:f64=0,wetUz:f64=0,wetVx:f64=0,wetVy:f64=0,wetVz:f64=0,wetBound:f64=0;
function sampleWet(x:f64,y:f64,z:f64):void {
  x-=shape[0];y-=shape[1];z-=shape[2];
  const squared=x*x+y*y+z*z, h=shape[12];
  if(squared>wetBound*wetBound)return;
  const axial=x*wetNx+y*wetNy+z*wetNz;
  if(axial < -h*1.1 || axial > h*0.6 || squared-axial*axial < h*h*0.75*0.75)return;
  transformPoint(x,y,z);
  const d=distance(local[0],local[1],local[2]);
  if(d < -0.003 || d > 0.018)return;
  const angle=Math.atan2(x*wetVx+y*wetVy+z*wetVz,x*wetUx+y*wetUy+z*wetUz);
  const sector=i32(Math.min(11,Math.floor((angle+Math.PI)/(2*Math.PI)*12)));
  wetMask |= 1<<sector;
}
export function wetting(nx:f64,ny:f64,nz:f64,bound:f64):f64 {
  wetNx=nx;wetNy=ny;wetNz=nz;wetBound=bound;wetMask=0;
  wetUx=Math.abs(ny)<0.85?-nz:0;wetUy=Math.abs(ny)<0.85?0:nz;wetUz=Math.abs(ny)<0.85?nx:-ny;
  let len=Math.sqrt(wetUx*wetUx+wetUy*wetUy+wetUz*wetUz);if(len==0)len=1;
  wetUx/=len;wetUy/=len;wetUz/=len;
  wetVx=ny*wetUz-nz*wetUy;wetVy=nz*wetUx-nx*wetUz;wetVz=nx*wetUy-ny*wetUx;
  for(let q=0;q<contactTriangleCount;q++) {
    const ti=contactTriangles[q];
    if(!movable[index[ti]]&&!movable[index[ti+1]]&&!movable[index[ti+2]])continue;
    for(let k=0;k<3;k++) {
      const j=index[ti+k]*3;
      for(let a=0;a<3;a++)triangle[k*3+a]=base[j+a]+offset[j+a];
      sampleWet(triangle[k*3],triangle[k*3+1],triangle[k*3+2]);
    }
    for(let sample=0;sample<4;sample++) {
      const w0=sample==0?1.0/3:sample==2?0:0.5,w1=sample==0?1.0/3:sample==3?0:0.5,w2=sample==0?1.0/3:sample==1?0:0.5;
      sampleWet(triangle[0]*w0+triangle[3]*w1+triangle[6]*w2,triangle[1]*w0+triangle[4]*w1+triangle[7]*w2,triangle[2]*w0+triangle[5]*w1+triangle[8]*w2);
    }
  }
  return f64(i32.popcnt(wetMask))/12;
}
