import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import * as TX from './textures.js';

// Track geometry is built by extruding 2D cross-section edges along the track frames.
// An edge a->b (in right/up coordinates) gets the face normal (-dy, dx), i.e. its direction
// rotated 90deg counter-clockwise, and triangles are wound to match so back-face culling works.

const _fr = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };

function sRange(track, s0, s1, step) {
  const list = [];
  const count = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= count; i++) list.push(s0 + ((s1 - s0) * i) / count);
  return list;
}

/**
 * @param edges [{ a:[x,y], b:[x,y], color?:Color, tile?:number(m), uFlip?:bool }]
 * @param sList arc-length positions of the rings (may exceed track length for the seam ring)
 */
function extrude(track, edges, sList, { uv = false, color = false } = {}) {
  const rings = sList.length;
  const vertCount = edges.length * rings * 2;
  const pos = new Float32Array(vertCount * 3);
  const nor = new Float32Array(vertCount * 3);
  const col = color ? new Float32Array(vertCount * 3) : null;
  const uvs = uv ? new Float32Array(vertCount * 2) : null;
  const index = [];
  let v = 0;
  for (const e of edges) {
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const base = v;
    for (let k = 0; k < rings; k++) {
      const s = sList[k];
      track.frameAt(s, _fr);
      for (const [px, py, u] of [
        [e.a[0], e.a[1], 0],
        [e.b[0], e.b[1], 1],
      ]) {
        pos[v * 3] = _fr.p.x + _fr.r.x * px + _fr.u.x * py;
        pos[v * 3 + 1] = _fr.p.y + _fr.r.y * px + _fr.u.y * py;
        pos[v * 3 + 2] = _fr.p.z + _fr.r.z * px + _fr.u.z * py;
        nor[v * 3] = _fr.r.x * nx + _fr.u.x * ny;
        nor[v * 3 + 1] = _fr.r.y * nx + _fr.u.y * ny;
        nor[v * 3 + 2] = _fr.r.z * nx + _fr.u.z * ny;
        if (col) {
          col[v * 3] = e.color.r;
          col[v * 3 + 1] = e.color.g;
          col[v * 3 + 2] = e.color.b;
        }
        if (uvs) {
          uvs[v * 2] = e.uFlip ? 1 - u : u;
          uvs[v * 2 + 1] = e.tile ? (s - sList[0]) / e.tile : k / (rings - 1);
        }
        v++;
      }
    }
    for (let k = 0; k < rings - 1; k++) {
      const p0 = base + k * 2;
      const p1 = p0 + 1;
      const p2 = p0 + 2;
      const p3 = p0 + 3;
      index.push(p0, p1, p2, p1, p3, p2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvs) geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/** Mirror a right-side edge to the left side (mirroring flips winding, so swap a/b). */
const mirror = (e) => ({ ...e, a: [-e.b[0], e.b[1]], b: [-e.a[0], e.a[1]], uFlip: !e.uFlip });

function tileFor(track, approx) {
  return track.length / Math.max(1, Math.round(track.length / approx));
}

export const WALL = { height: 1.35, top: 0.7, base: 0.36, deck: 1.7, curb: 0.9 };

export function buildTrackMeshes(track, aniso) {
  const group = new THREE.Group();
  group.name = 'track';
  const hw = track.halfWidth;
  const loop = [];
  for (let i = 0; i <= track.n; i++) loop.push(i * track.ds);

  // --- road + curbs -----------------------------------------------------------------
  const roadTile = tileFor(track, 16);
  const road = new THREE.Mesh(
    extrude(track, [{ a: [-hw + WALL.curb, 0], b: [hw - WALL.curb, 0], tile: roadTile }], loop, { uv: true }),
    new THREE.MeshLambertMaterial({ map: TX.roadTexture(aniso) }),
  );
  road.name = 'road';
  group.add(road);

  const curbTile = tileFor(track, 8);
  const curbR = { a: [hw - WALL.curb, 0], b: [hw, 0], tile: curbTile };
  const curbs = new THREE.Mesh(
    extrude(track, [curbR, { ...mirror(curbR), tile: curbTile }], loop, { uv: true }),
    new THREE.MeshLambertMaterial({ map: TX.curbTexture(aniso) }),
  );
  group.add(curbs);

  // --- walls + deck (vertex coloured) ---------------------------------------------------
  const c = (hex) => new THREE.Color(hex);
  const H = WALL.height;
  const wallRight = [
    { a: [hw, 0], b: [hw + 0.03, WALL.base], color: c(PALETTE.wallTrim) },
    { a: [hw + 0.03, WALL.base], b: [hw + 0.1, H], color: c(PALETTE.wall) },
    { a: [hw + 0.1, H], b: [hw + WALL.top, H], color: c('#4a5163') },
    { a: [hw + WALL.top, H], b: [hw + WALL.top + 0.2, -WALL.deck], color: c('#c9b9a3') },
  ];
  const walls = [...wallRight, ...wallRight.map(mirror)];
  walls.push({ a: [hw + WALL.top + 0.2, -WALL.deck], b: [-hw - WALL.top - 0.2, -WALL.deck], color: c('#3b3a40') });
  const wallMesh = new THREE.Mesh(extrude(track, walls, loop, { color: true }), new THREE.MeshLambertMaterial({ vertexColors: true }));
  group.add(wallMesh);

  // --- neon light strips along the wall tops (left magenta, right cyan) -----------------
  const stripTile = tileFor(track, 6);
  const stripTex = TX.stripTexture();
  const stripR = { a: [hw + 0.05, H - 0.42], b: [hw + 0.065, H - 0.12], tile: stripTile };
  const strips = new THREE.Group();
  for (const [edge, colr] of [
    [stripR, PALETTE.neonA],
    [mirror(stripR), PALETTE.neonB],
  ]) {
    // Pull the strip a few cm towards the road so it sits proud of the wall face.
    const inset = Math.sign(edge.a[0]) * -0.04;
    const e = { ...edge, a: [edge.a[0] + inset, edge.a[1]], b: [edge.b[0] + inset, edge.b[1]] };
    strips.add(new THREE.Mesh(extrude(track, [e], loop, { uv: true }), new THREE.MeshBasicMaterial({ map: stripTex, color: colr })));
  }
  group.add(strips);

  // --- start line -------------------------------------------------------------------
  const checker = TX.checkerTexture();
  const startLine = new THREE.Mesh(
    extrude(track, [{ a: [-hw + WALL.curb, 0.025], b: [hw - WALL.curb, 0.025] }], sRange(track, 0, 3.2, 1.6), { uv: true }),
    new THREE.MeshBasicMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  checker.repeat.set(1, 1);
  group.add(startLine);

  // --- speed pads ---------------------------------------------------------------------
  const padGeos = track.pads.map((pad) =>
    extrude(
      track,
      [{ a: [pad.x - pad.halfWidth, 0.03], b: [pad.x + pad.halfWidth, 0.03], tile: pad.length }],
      sRange(track, pad.s, pad.s + pad.length, 1.5),
      {
        uv: true,
      },
    ),
  );
  const padTex = TX.padTexture();
  const pads = new THREE.Mesh(
    mergeGeometries(padGeos),
    new THREE.MeshBasicMaterial({ map: padTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  pads.name = 'pads';
  group.add(pads);

  group.add(buildCornerSigns(track));
  group.add(buildPylons(track));
  const supports = buildSupports(track);
  if (supports) group.add(supports);
  const gantry = buildGantry(track);
  group.add(gantry.group);

  return {
    group,
    gantry,
    update(dt) {
      // Chevrons flow forward over the pads.
      padTex.offset.y = (padTex.offset.y - dt * 2.2) % 1;
    },
  };
}

/** Amber chevron boards on the outside wall of every tight corner. */
function buildCornerSigns(track) {
  const geos = [];
  const hw = track.halfWidth;
  const board = new THREE.PlaneGeometry(4.2, 2.1);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rot = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  let lastS = -1e9;
  for (let i = 0; i < track.n; i++) {
    const k = track.kappa[i];
    const s = i * track.ds;
    if (Math.abs(k) < 1 / 175 || s - lastS < 26) continue;
    lastS = s;
    track.frameAt(s, _fr);
    const side = k > 0 ? -1 : 1; // outside of the corner
    p.copy(_fr.p)
      .addScaledVector(_fr.r, side * (hw + WALL.top * 0.5))
      .addScaledVector(_fr.u, WALL.height + 1.35);
    // Face oncoming racers (-T), turned a little towards the road.
    m.makeBasis(_fr.r, _fr.u, _fr.t.clone().negate());
    q.setFromRotationMatrix(m);
    rot.setFromAxisAngle(_fr.u, -side * 0.45);
    q.premultiply(rot);
    const g = board.clone();
    if (k < 0) {
      const uv = g.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setX(j, 1 - uv.getX(j));
    }
    g.applyMatrix4(new THREE.Matrix4().compose(p, q, scale));
    geos.push(g);
    // Post holding the board up.
    const post = new THREE.BoxGeometry(0.25, 1.3, 0.25);
    post.deleteAttribute('uv');
    post.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(post.attributes.position.count * 2).fill(0.02), 2));
    const pp = p.clone().addScaledVector(_fr.u, -1.0);
    post.applyMatrix4(new THREE.Matrix4().compose(pp, q, scale));
    geos.push(post);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: TX.chevronSignTexture(), side: THREE.DoubleSide }));
  mesh.name = 'cornerSigns';
  return mesh;
}

/** Light posts on both walls: cheap, regular landmarks that sell speed. */
function buildPylons(track) {
  const hw = track.halfWidth;
  const spacing = 36;
  const count = Math.floor(track.length / spacing);
  const postGeo = new THREE.BoxGeometry(0.3, 4.2, 0.3);
  postGeo.translate(0, 2.1, 0);
  const lampGeo = new THREE.BoxGeometry(0.9, 0.22, 0.5);
  lampGeo.translate(-0.3, 4.2, 0);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: '#3a3f4c' }), count * 2);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), count * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLeft = new THREE.Quaternion();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const colA = new THREE.Color(PALETTE.neonA);
  const colB = new THREE.Color(PALETTE.neonB);
  let idx = 0;
  for (let i = 0; i < count; i++) {
    const s = i * spacing + 10;
    track.frameAt(s, _fr);
    m.makeBasis(_fr.r, _fr.u, _fr.t.clone().negate());
    q.setFromRotationMatrix(m);
    // Left-side lamps are turned 180deg (not mirrored: instancing can't flip culling).
    qLeft.copy(q).multiply(turn);
    for (const side of [1, -1]) {
      p.copy(_fr.p)
        .addScaledVector(_fr.r, side * (hw + WALL.top * 0.6))
        .addScaledVector(_fr.u, WALL.height);
      m.compose(p, side > 0 ? q : qLeft, one);
      posts.setMatrixAt(idx, m);
      lamps.setMatrixAt(idx, m);
      lamps.setColorAt(idx, side > 0 ? colA : colB);
      idx++;
    }
  }
  const g = new THREE.Group();
  g.add(posts, lamps);
  return g;
}

/** Pillars under elevated sections. */
function buildSupports(track) {
  const spots = [];
  for (let s = 0; s < track.length; s += 26) {
    track.frameAt(s, _fr);
    const bottom = _fr.p.y - WALL.deck;
    if (bottom > 1.5) spots.push({ p: _fr.p.clone(), h: bottom + 0.5, t: _fr.t.clone() });
  }
  if (!spots.length) return null;
  const geo = new THREE.BoxGeometry(3.2, 1, 2.2);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#8e8172' }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((sp, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sp.t.x, sp.t.z));
    m.compose(new THREE.Vector3(sp.p.x, -0.5, sp.p.z), q, new THREE.Vector3(1, sp.h, 1));
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

/** Start/finish gantry with the countdown lights. */
function buildGantry(track) {
  const group = new THREE.Group();
  track.frameAt(-6, _fr);
  const hw = track.halfWidth;
  const m = new THREE.Matrix4().makeBasis(_fr.r, _fr.u, _fr.t.clone().negate());
  group.quaternion.setFromRotationMatrix(m);
  group.position.copy(_fr.p);

  const dark = new THREE.MeshLambertMaterial({ color: '#2b2f3b' });
  const legGeo = new THREE.BoxGeometry(1.6, 15, 1.6);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(side * (hw + 2.4), 7.5 - 1.5, 0);
    group.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 6.4, 3.4, 1.4), dark);
  beam.position.set(0, 12.2, 0);
  group.add(beam);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 2, 3), new THREE.MeshBasicMaterial({ map: TX.bannerTexture('PODRUSH') }));
  banner.position.set(0, 12.2, 0.72);
  group.add(banner);

  const lightGeo = new THREE.CircleGeometry(0.85, 20);
  const lights = [];
  const housing = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.4, 0.8), dark);
  housing.position.set(0, 9.3, 0.2);
  group.add(housing);
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: '#331414' });
    const l = new THREE.Mesh(lightGeo, mat);
    l.position.set((i - 1) * 2.7, 9.3, 0.62);
    group.add(l);
    lights.push(mat);
  }
  const OFF = new THREE.Color('#331414');
  const RED = new THREE.Color('#ff2a2a');
  const GREEN = new THREE.Color('#33ff77');
  return {
    group,
    /** lit: number of red lights (0..3), or 'go' for all green. */
    setLights(lit) {
      lights.forEach((mat, i) => mat.color.copy(lit === 'go' ? GREEN : i < lit ? RED : OFF));
    },
  };
}

/** Minimal merge for non-indexed or indexed geometries sharing the same attribute set. */
export function mergeGeometries(geos) {
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[name];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[o++] = a.array[i * size + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = [];
  let base = 0;
  for (const g of geos) {
    const count = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + base);
    else for (let i = 0; i < count; i++) idx.push(i + base);
    base += count;
  }
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
