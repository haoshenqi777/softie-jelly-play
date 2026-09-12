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
