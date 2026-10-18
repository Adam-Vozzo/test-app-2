import * as THREE from '../vendor/three.module.min.js';
import { clamp } from './util.js';

// Control points are world coordinates [x, y(elevation), z]. Forward on the start
// straight is -z. The spline passes through every point, so this list *is* the layout.
export const TRACK_DEF = {
  name: 'Sunspire Canyon',
  width: 22,
  sampleSpacing: 2,
  bankGain: 62, // bank radians per unit of curvature (1/m)
  maxBank: 0.42,
  bankSmoothing: 26, // metres either side
  minEdgeHeight: 0.7, // lowest the road edge may sit above the ground on banked turns
  points: [
    [0, 1, -90], //  0 start line, heading north (grid sits on the straight behind it)
    [0, 1, -170], //  1
    [6, 2, -320], //  2
    [52, 5, -452], //  3 fast right sweeper
    [152, 8, -546], //  4
    [300, 9, -586], //  5 heading east
    [460, 9, -576], //  6 pad straight
    [600, 9, -524], //  7
    [688, 9, -430], //  8 hairpin right
    [694, 8, -322], //  9
    [620, 7, -250], // 10 heading west
    [500, 5, -262], // 11
    [420, 3, -328], // 12 esses
    [330, 2, -334], // 13
    [262, 2, -266], // 14
    [236, 2, -160], // 15 heading south into the canyon
    [236, 4, -20], // 16 canyon straight
    [236, 19, 120], // 17 crest
    [236, 6, 250], // 18 drop
    [216, 3, 390], // 19
    [146, 3, 490], // 20 long banked right
    [20, 3, 522], // 21 heading west
    [-90, 2, 472], // 22
    [-140, 1, 362], // 23 heading north
    [-112, 1, 240], // 24
    [-62, 1, 172], // 25 kink back onto the main straight
    [-16, 1, 110], // 26
    [0, 1, 48], // 27 main straight
    [0, 1, 0], // 28 grid
  ],
  // Speed pads: anchored to a control point index + metres after it, lateral offset x (+ is right).
  pads: [
    { at: 0, ds: 150, x: -5 },
    { at: 1, ds: 60, x: 5 },
    { at: 5, ds: 70, x: 0 },
    { at: 6, ds: 40, x: 5.5 },
    { at: 10, ds: 30, x: -5 },
    { at: 15, ds: 60, x: 0 },
    { at: 16, ds: 40, x: -5.5 },
    { at: 18, ds: 40, x: 5 },
    { at: 23, ds: 30, x: 0 },
  ],
  // Stone arches spanning the track (podracing canyon vibe).
  arches: [
    { at: 15, ds: 110, height: 30 },
    { at: 16, ds: 90, height: 36 },
    { at: 18, ds: 80, height: 28 },
    { at: 3, ds: 40, height: 32 },
  ],
  // Sections lined with tall canyon walls.
  canyons: [{ from: 15, fromDs: 40, to: 19, toDs: 0 }],
};

/**
 * A closed track sampled at (near) uniform arc length. Physics treats the racing surface
 * as a developed 2D strip: s along the centre line, x across it. Everything in world
 * space is derived from the per-sample frame (centre, tangent, right, up).
 */
export class Track {
  constructor(data) {
    Object.assign(this, data);
    this.halfWidth = this.width / 2;
    this._i0 = 0;
    this._i1 = 0;
    this._f = 0;
    this._scratch = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
  }

  wrap(s) {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  /** Signed shortest distance from a to b along the loop. */
  delta(a, b) {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    else if (d < -L / 2) d += L;
    return d;
  }

  _locate(s) {
    const u = this.wrap(s) / this.ds;
    const i = Math.floor(u);
    this._i0 = i % this.n;
    this._i1 = (this._i0 + 1) % this.n;
    this._f = u - i;
  }

  _lerpScalar(arr, s) {
    this._locate(s);
    const a = arr[this._i0];
    return a + (arr[this._i1] - a) * this._f;
  }

  kappaAt(s) {
    return this._lerpScalar(this.kappa, s);
  }

  bankAt(s) {
    return this._lerpScalar(this.bank, s);
  }

  /** Fills out.{p,t,r,u} (THREE.Vector3) with the interpolated frame at s. */
  frameAt(s, out) {
    this._locate(s);
    const a = this._i0 * 3;
    const b = this._i1 * 3;
    const f = this._f;
    const P = this.pos;
    const T = this.tan;
    const R = this.right;
    const U = this.up;
    out.p.set(P[a] + (P[b] - P[a]) * f, P[a + 1] + (P[b + 1] - P[a + 1]) * f, P[a + 2] + (P[b + 2] - P[a + 2]) * f);
    out.t.set(T[a] + (T[b] - T[a]) * f, T[a + 1] + (T[b + 1] - T[a + 1]) * f, T[a + 2] + (T[b + 2] - T[a + 2]) * f).normalize();
    out.r.set(R[a] + (R[b] - R[a]) * f, R[a + 1] + (R[b + 1] - R[a + 1]) * f, R[a + 2] + (R[b + 2] - R[a + 2]) * f).normalize();
    out.u.set(U[a] + (U[b] - U[a]) * f, U[a + 1] + (U[b + 1] - U[a + 1]) * f, U[a + 2] + (U[b + 2] - U[a + 2]) * f).normalize();
    return out;
  }

  /** World position of track coordinates (s along, x across, h above surface). */
  pointAt(s, x, h, outVec) {
    const fr = this.frameAt(s, this._scratch);
    return outVec.copy(fr.p).addScaledVector(fr.r, x).addScaledVector(fr.u, h);
  }

  /** Tangent.y (slope) and right.y (bank lean) at s — used by physics. */
  slopeAt(s) {
    this._locate(s);
    const a = this._i0 * 3 + 1;
    const b = this._i1 * 3 + 1;
    return this.tan[a] + (this.tan[b] - this.tan[a]) * this._f;
  }

  leanAt(s) {
    this._locate(s);
    const a = this._i0 * 3 + 1;
    const b = this._i1 * 3 + 1;
    return this.right[a] + (this.right[b] - this.right[a]) * this._f;
  }
}

function smoothCircular(src, radius) {
  const n = src.length;
  const out = new Float32Array(n);
  if (radius < 1) {
    out.set(src);
    return out;
  }
  // Triangle-weighted moving average around the loop.
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = radius + 1 - Math.abs(k);
      sum += src[(i + k + n) % n] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

export function buildTrack(def = TRACK_DEF) {
  const pts = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = Math.max(4000, pts.length * 300);
  const length = curve.getLength();
  const n = Math.max(64, Math.round(length / def.sampleSpacing));
  const ds = length / n;

  const pos = new Float32Array(n * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    curve.getPointAt(i / n, tmp);
    pos[i * 3] = tmp.x;
    pos[i * 3 + 1] = tmp.y;
    pos[i * 3 + 2] = tmp.z;
  }

  // Tangents by central difference on the uniformly spaced samples.
  const tan = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = ((i + 1) % n) * 3;
    const x = pos[b] - pos[a];
    const y = pos[b + 1] - pos[a + 1];
    const z = pos[b + 2] - pos[a + 2];
    const l = Math.hypot(x, y, z) || 1;
    tan[i * 3] = x / l;
    tan[i * 3 + 1] = y / l;
    tan[i * 3 + 2] = z / l;
  }

  // Horizontal signed curvature (+ = turning right) drives the banking.
  const flatRight = new Float32Array(n * 3);
  const kFlat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tx = tan[i * 3];
    const tz = tan[i * 3 + 2];
    const l = Math.hypot(tz, tx) || 1;
    flatRight[i * 3] = -tz / l; // T x UP, normalised
    flatRight[i * 3 + 1] = 0;
    flatRight[i * 3 + 2] = tx / l;
  }
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = ((i + 1) % n) * 3;
    const dtx = (tan[b] - tan[a]) / (2 * ds);
    const dtz = (tan[b + 2] - tan[a + 2]) / (2 * ds);
    kFlat[i] = dtx * flatRight[i * 3] + dtz * flatRight[i * 3 + 2];
  }
  const kBank = smoothCircular(kFlat, Math.round(def.bankSmoothing / ds));
  const bank = new Float32Array(n);
  for (let i = 0; i < n; i++) bank[i] = clamp(kBank[i] * def.bankGain, -def.maxBank, def.maxBank);

  // Banking drops the low edge of the road; lift banked sections so that edge always
  // clears the ground (y = 0). Spread with a moving max, then smooth into gentle ramps.
  const lift = new Float32Array(n);
  const edge = def.width / 2 + 0.5;
  for (let i = 0; i < n; i++) lift[i] = Math.max(0, def.minEdgeHeight + edge * Math.sin(Math.abs(bank[i])) - pos[i * 3 + 1]);
  const reach = Math.round(45 / ds);
  const spread = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = -reach; k <= reach; k++) m = Math.max(m, lift[(i + k + n) % n]);
    spread[i] = m;
  }
  const raise = smoothCircular(spread, reach);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] += raise[i];
  // Elevation changed, so refresh the tangents (their horizontal direction is unchanged).
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = ((i + 1) % n) * 3;
    const x = pos[b] - pos[a];
    const y = pos[b + 1] - pos[a + 1];
    const z = pos[b + 2] - pos[a + 2];
    const l = Math.hypot(x, y, z) || 1;
    tan[i * 3] = x / l;
    tan[i * 3 + 1] = y / l;
    tan[i * 3 + 2] = z / l;
  }

  // Banked frames: rotate the flat right vector about the tangent (+bank = right side down).
  const right = new Float32Array(n * 3);
  const up = new Float32Array(n * 3);
  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const U = new THREE.Vector3();
  const TxR = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    T.fromArray(tan, i * 3);
    R.fromArray(flatRight, i * 3);
    TxR.crossVectors(T, R);
    const c = Math.cos(bank[i]);
    const s = Math.sin(bank[i]);
    R.multiplyScalar(c).addScaledVector(TxR, s).normalize();
    U.crossVectors(R, T).normalize();
    R.toArray(right, i * 3);
    U.toArray(up, i * 3);
  }

  // Curvature within the (banked) racing surface, used by the track-space physics.
  const kRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = ((i + 1) % n) * 3;
    let k = 0;
    for (let c = 0; c < 3; c++) k += ((tan[b + c] - tan[a + c]) / (2 * ds)) * right[i * 3 + c];
    kRaw[i] = k;
  }
  const kappa = smoothCircular(kRaw, 3);

  // Arc length of each control point (nearest sample), used to anchor features.
  const sOfPoint = pts.map((p) => {
    let best = Infinity;
    let bestI = 0;
    for (let i = 0; i < n; i++) {
      const d = (pos[i * 3] - p.x) ** 2 + (pos[i * 3 + 1] - p.y) ** 2 + (pos[i * 3 + 2] - p.z) ** 2;
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    return bestI * ds;
  });

  const track = new Track({
    name: def.name,
    def,
    n,
    ds,
    length,
    width: def.width,
    pos,
    tan,
    right,
    up,
    bank,
    kappa,
    sOfPoint,
  });

  const anchor = (at, d) => track.wrap(sOfPoint[at] + d);
  track.pads = def.pads.map((p, id) => ({ id, s: anchor(p.at, p.ds), x: p.x, length: 9, halfWidth: 2.6 }));
  track.arches = def.arches.map((a) => ({ s: anchor(a.at, a.ds), height: a.height }));
  track.canyons = def.canyons.map((c) => ({ s0: anchor(c.from, c.fromDs), s1: anchor(c.to, c.toDs) }));
  return track;
}
