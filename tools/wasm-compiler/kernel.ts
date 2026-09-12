// Generated from our TypeScript solver by build.mjs. Do not hand edit.
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
/** Row-major 3x3 helpers. All writes are into caller-owned buffers. */
function determinant(a: Float64Array): f64 {
  return (
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6])
  );
}
function cofactor(a: Float64Array, out: Float64Array): void {
  out[0] = a[4] * a[8] - a[5] * a[7];
  out[1] = a[5] * a[6] - a[3] * a[8];
  out[2] = a[3] * a[7] - a[4] * a[6];
  out[3] = a[2] * a[7] - a[1] * a[8];
  out[4] = a[0] * a[8] - a[2] * a[6];
  out[5] = a[1] * a[6] - a[0] * a[7];
  out[6] = a[1] * a[5] - a[2] * a[4];
  out[7] = a[2] * a[3] - a[0] * a[5];
  out[8] = a[0] * a[4] - a[1] * a[3];
}

  function deformation(t: i32): void {
    const a = ids[t * 4] * 3,
      d = inverseRest,
      o = t * 9;
    for (let r = 0; r < 3; r++) {
      const p = x[ids[t * 4 + 1] * 3 + r] - x[a + r],
        q = x[ids[t * 4 + 2] * 3 + r] - x[a + r],
        s = x[ids[t * 4 + 3] * 3 + r] - x[a + r];
      for (let k = 0; k < 3; k++)
        f[r * 3 + k] = p * d[o + k] + q * d[o + 3 + k] + s * d[o + 6 + k];
    }
  }

  function gradients(t: i32, stretch: f64): void {
    const d = inverseRest,
      o = t * 9;
    gs.fill(0);
    gv.fill(0);
    for (let j = 1; j < 4; j++)
      for (let r = 0; r < 3; r++) {
        let s: f64 = 0,
          v: f64 = 0;
        for (let k = 0; k < 3; k++) {
          s += (f[r * 3 + k] * d[o + (j - 1) * 3 + k]) / stretch;
          v += cof[r * 3 + k] * d[o + (j - 1) * 3 + k];
        }
        gs[j * 3 + r] = s;
        gv[j * 3 + r] = v;
        gs[r] -= s;
        gv[r] -= v;
      }
  }

  function projectTet(t: i32, dt: f64): void {
    deformation(t);
    cofactor(f, cof);
    const j = determinant(f);
    let norm: f64 = 0;
    for (let k = 0; k < 9; k++) norm += f[k] * f[k];
    const stretch = Math.sqrt(Math.max(1e-12, norm));
    gradients(t, stretch);
    const alphaS = 1 / (mu[t] * volumes[t] * dt * dt),
      alphaV = 1 / (bulk * volumes[t] * dt * dt);
    let ss = alphaS,
      vv = alphaV,
      sv: f64 = 0;
    for (let n = 0; n < 4; n++)
      for (let k = 0; k < 3; k++) {
        const w = invMass[ids[t * 4 + n]],
          s = gs[n * 3 + k],
          v = gv[n * 3 + k];
        ss += w * s * s;
        vv += w * v * v;
        sv += w * s * v;
      }
    const cs = stretch + alphaS * lambdas[t * 2],
      cv = j - 1 - mu[t] / bulk + alphaV * lambdas[t * 2 + 1];
    const denominator = ss * vv - sv * sv,
      ds = (-cs * vv + cv * sv) / denominator,
      dv = (-cv * ss + cs * sv) / denominator;
    lambdas[t * 2] += ds;
    lambdas[t * 2 + 1] += dv;
    for (let n = 0; n < 4; n++) {
      const id = ids[t * 4 + n],
        w = invMass[id];
      for (let k = 0; k < 3; k++)
        x[id * 3 + k] +=
          w * (ds * gs[n * 3 + k] + dv * gv[n * 3 + k]);
    }
  }

  function barrier(t: i32): void {
    deformation(t);
    const j = determinant(f);
    if (j >= 0.22) return;
    cofactor(f, cof);
    gradients(t, 1);
    let denom: f64 = 0;
    for (let n = 0; n < 4; n++)
      for (let k = 0; k < 3; k++) {
        const id = ids[t * 4 + n];
        // A contact node cannot move down. Including that forbidden direction
        // in the effective mass makes floor projection undo volume recovery.
        if (k === 1 && x[id * 3 + 1] <= 1e-8 && gv[n * 3 + k] < 0)
          continue;
        denom += invMass[id] * gv[n * 3 + k] ** 2;
      }
    const dl = (0.22 - j) / Math.max(denom, 1e-12);
    for (let n = 0; n < 4; n++)
      for (let k = 0; k < 3; k++) {
        const id = ids[t * 4 + n];
        if (k === 1 && x[id * 3 + 1] <= 1e-8 && gv[n * 3 + k] < 0)
          continue;
        x[id * 3 + k] += dl * invMass[id] * gv[n * 3 + k];
      }
  }
