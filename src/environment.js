import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import * as TX from './textures.js';
import { clamp, lerp, mulberry32, smoothstep, valueNoise2 } from './util.js';

export const SUN_DIRS = [new THREE.Vector3(-0.26, 0.14, -0.96).normalize(), new THREE.Vector3(-0.4, 0.085, -0.91).normalize()];

/** Coarse point set for distance-to-track queries during world generation. */
function trackPoints(track, step = 6) {
  const pts = [];
  for (let s = 0; s < track.length; s += step) {
    const i = Math.floor(s / track.ds) % track.n;
    pts.push(track.pos[i * 3], track.pos[i * 3 + 2]);
  }
  return pts;
}

function distToTrack(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - x;
    const dz = pts[i + 1] - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function buildEnvironment(track) {
  const group = new THREE.Group();
  group.name = 'environment';
  const pts = trackPoints(track);
  const rng = mulberry32(1234);

  // Track bounds for placing things around it.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]);
    maxZ = Math.max(maxZ, pts[i + 1]);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const sky = buildSky();
  group.add(buildGround(pts, cx, cz));
  group.add(buildRocks(track, pts, rng, { minX, maxX, minZ, maxZ }));
  group.add(buildCanyon(track, pts, rng));
  group.add(buildArches(track));
  group.add(buildGrandstand(track, rng));

  return {
    group,
    sky,
    update(camera) {
      sky.position.copy(camera.position);
    },
  };
}

function buildSky() {
  const sky = new THREE.Group();
  sky.name = 'sky';
  const geo = new THREE.SphereGeometry(3000, 40, 20);
  const top = new THREE.Color(PALETTE.skyTop);
  const horizon = new THREE.Color(PALETTE.skyHorizon);
  const below = new THREE.Color(PALETTE.fog);
  const sunGlow = new THREE.Color('#fff0d0');
  const col = new Float32Array(geo.attributes.position.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    v.fromBufferAttribute(geo.attributes.position, i).normalize();
    const h = v.y;
    if (h >= 0) c.copy(horizon).lerp(top, Math.pow(smoothstep(0, 0.75, h), 0.7));
    else c.copy(horizon).lerp(below, smoothstep(0, -0.08, h));
    const sun = Math.max(v.dot(SUN_DIRS[0]), v.dot(SUN_DIRS[1]));
    c.lerp(sunGlow, Math.pow(Math.max(0, sun), 18) * 0.85);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dome = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -10;
  sky.add(dome);

  // Twin suns: a soft halo plus a hot core each.
  const glow = TX.glowTexture();
  SUN_DIRS.forEach((dir, i) => {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: '#ffd59a',
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    halo.scale.setScalar(i === 0 ? 900 : 620);
    halo.position.copy(dir).multiplyScalar(2600);
    halo.renderOrder = -9;
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: PALETTE.sun, depthWrite: false, fog: false, transparent: true }),
    );
    core.scale.setScalar(i === 0 ? 210 : 150);
    core.position.copy(halo.position);
    core.renderOrder = -8;
    sky.add(halo, core);
  });

  sky.add(buildMountains());
  return sky;
}

/** Hazy ridge lines on the horizon; they ride with the camera (infinitely far away). */
function buildMountains() {
  const group = new THREE.Group();
  const layers = [
    { r: 2500, h: 150, var: 190, top: '#9b86b0', bottom: '#e7b892', seed: 3, seg: 120 },
    { r: 2300, h: 70, var: 120, top: '#b48c8f', bottom: '#ebbd94', seed: 9, seg: 140 },
  ];
  for (const L of layers) {
    const pos = [];
    const col = [];
    const ct = new THREE.Color(L.top);
    const cb = new THREE.Color(L.bottom);
    for (let i = 0; i <= L.seg; i++) {
      const a = (i / L.seg) * Math.PI * 2;
      const n = valueNoise2(i * 0.18, 0, L.seed) * 0.6 + valueNoise2(i * 0.7, 3, L.seed) * 0.4;
      const h = L.h + Math.max(0, n) * L.var + (n + 1) * 25;
      const x = Math.cos(a) * L.r;
      const z = Math.sin(a) * L.r;
      pos.push(x, -60, z, x, h, z);
      col.push(cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
    }
    const idx = [];
    for (let i = 0; i < L.seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.renderOrder = -7;
    group.add(mesh);
  }
  return group;
}

function buildGround(pts, cx, cz) {
  const size = 7000;
  const seg = 150; // ~47 m cells; the flat zone below must exceed a cell diagonal
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, cz);
  const pos = geo.attributes.position;
  const sand = new THREE.Color(PALETTE.sand);
  const dark = new THREE.Color(PALETTE.sandDark);
  const light = new THREE.Color('#ecc08a');
  const packed = new THREE.Color('#c9925e');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = distToTrack(pts, x, z);
    const n1 = valueNoise2(x / 260, z / 260, 1);
    const n2 = valueNoise2(x / 90, z / 90, 2);
    const dunes = (n1 * 0.7 + n2 * 0.3 + 0.35) * 26;
    const away = smoothstep(85, 260, d);
    const h = -0.4 + Math.max(0, dunes) * away;
    pos.setY(i, h);
    c.copy(sand)
      .lerp(dark, clamp(0.5 - n2 * 0.8, 0, 1) * 0.6)
      .lerp(light, clamp(n1, 0, 1) * 0.5);
    c.lerp(packed, (1 - smoothstep(14, 60, d)) * 0.55);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'ground';
  return mesh;
}

function rockColor(rng) {
  const a = new THREE.Color(PALETTE.rock);
  const b = new THREE.Color(PALETTE.rockLight);
  const d = new THREE.Color(PALETTE.rockDark);
  const t = rng();
  return t < 0.5 ? a.lerp(b, t * 2) : a.lerp(d, (t - 0.5) * 1.2);
}

function buildRocks(track, pts, rng, bounds) {
  const group = new THREE.Group();
  const strata = TX.strataTexture();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const pad = 700;
  const rand = (a, b) => lerp(a, b, rng());
  const place = (count, minDist, maxDist) => {
    const out = [];
    let attempts = count * 80;
    while (out.length < count && attempts-- > 0) {
      const x = rand(bounds.minX - pad, bounds.maxX + pad);
      const z = rand(bounds.minZ - pad, bounds.maxZ + pad);
      const d = distToTrack(pts, x, z);
      if (d >= minDist && d <= maxDist) out.push({ x, z, d });
    }
    return out;
  };

  // Mesas: big flat-topped, banded.
  const mesaGeo = new THREE.CylinderGeometry(0.82, 1, 1, 7, 1);
  mesaGeo.translate(0, 0.5, 0);
  const mesaSpots = place(26, 190, 1400);
  const mesas = new THREE.InstancedMesh(mesaGeo, new THREE.MeshLambertMaterial({ map: strata, flatShading: true }), mesaSpots.length);
  mesaSpots.forEach((sp, i) => {
    const r = rand(35, 95);
    const h = rand(45, 120) * (sp.d > 600 ? 1.4 : 1);
    q.setFromEuler(e.set(0, rng() * Math.PI, 0));
    m.compose(p.set(sp.x, -2, sp.z), q, s.set(r, h, r * rand(0.7, 1.2)));
    mesas.setMatrixAt(i, m);
    mesas.setColorAt(i, rockColor(rng));
  });
  group.add(mesas);

  // Spires: tall thin buttes, closer in for parallax.
  const spireGeo = new THREE.CylinderGeometry(0.45, 1, 1, 6, 1);
  spireGeo.translate(0, 0.5, 0);
  const spireSpots = place(46, 70, 700);
  const spires = new THREE.InstancedMesh(spireGeo, new THREE.MeshLambertMaterial({ map: strata, flatShading: true }), spireSpots.length);
  spireSpots.forEach((sp, i) => {
    const r = rand(6, 16);
    q.setFromEuler(e.set(rand(-0.06, 0.06), rng() * Math.PI, rand(-0.06, 0.06)));
    m.compose(p.set(sp.x, -1, sp.z), q, s.set(r, rand(28, 85), r));
    spires.setMatrixAt(i, m);
    spires.setColorAt(i, rockColor(rng));
  });
  group.add(spires);

  // Boulders: scattered close to the track for near-field speed cues.
  const boulderGeo = new THREE.IcosahedronGeometry(1, 0);
  const boulderSpots = place(160, 26, 220);
  const boulders = new THREE.InstancedMesh(boulderGeo, new THREE.MeshLambertMaterial({ flatShading: true }), boulderSpots.length);
  boulderSpots.forEach((sp, i) => {
    const r = rand(1.5, 7) * (sp.d > 80 ? 1.6 : 1);
    q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
    m.compose(p.set(sp.x, r * 0.3 - 0.6, sp.z), q, s.set(r * rand(0.8, 1.6), r * rand(0.6, 1), r * rand(0.8, 1.4)));
    boulders.setMatrixAt(i, m);
    boulders.setColorAt(i, rockColor(rng));
  });
  group.add(boulders);
  return group;
}

const _fr = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };

/** Tall sandstone blocks lining the canyon section on both sides. */
function buildCanyon(track, pts, rng) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const spots = [];
  for (const c of track.canyons) {
    const len = track.delta(c.s0, c.s1);
    for (let d = 0; d < len; d += 21) {
      const s = c.s0 + d;
      track.frameAt(s, _fr);
      const flatR = new THREE.Vector3(_fr.r.x, 0, _fr.r.z).normalize();
      for (const side of [-1, 1]) {
        const off = track.halfWidth + lerp(20, 34, rng());
        const x = _fr.p.x + flatR.x * side * off;
        const z = _fr.p.z + flatR.z * side * off;
        // Skip blocks that would poke into another part of the track.
        if (distToTrack(pts, x, z) < track.halfWidth + 12) continue;
        spots.push({ x, z, yaw: Math.atan2(_fr.t.x, _fr.t.z), h: lerp(38, 78, rng()), w: lerp(24, 34, rng()), dpt: lerp(18, 30, rng()) });
      }
    }
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: TX.strataTexture(), flatShading: true }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((sp, i) => {
    q.setFromAxisAngle(up, sp.yaw + (rng() - 0.5) * 0.3);
    m.compose(new THREE.Vector3(sp.x, -2, sp.z), q, new THREE.Vector3(sp.dpt, sp.h, sp.w));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, rockColor(rng));
  });
  mesh.name = 'canyon';
  return mesh;
}

/** Natural stone arches spanning the track. */
function buildArches(track) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.rock, flatShading: true });
  for (const a of track.arches) {
    track.frameAt(a.s, _fr);
    const span = track.halfWidth + 12;
    const geo = new THREE.TorusGeometry(span, 4.2, 5, 14, Math.PI);
    const mesh = new THREE.Mesh(geo, mat);
    const flatR = new THREE.Vector3(_fr.r.x, 0, _fr.r.z).normalize();
    const flatT = new THREE.Vector3(_fr.t.x, 0, _fr.t.z).normalize();
    const basis = new THREE.Matrix4().makeBasis(flatR, new THREE.Vector3(0, 1, 0), flatT);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.set(_fr.p.x, -1, _fr.p.z);
    mesh.scale.set(1, (a.height + 1) / span, 1.6);
    group.add(mesh);
    // Chunky feet so the arch reads as rock, not a pipe.
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 8, 9, 6), mat);
      foot.position.set(_fr.p.x + flatR.x * side * span, 3, _fr.p.z + flatR.z * side * span);
      group.add(foot);
    }
  }
  return group;
}

/** A blocky grandstand + flags along the start straight. */
function buildGrandstand(track, rng) {
  const group = new THREE.Group();
  const hw = track.halfWidth;
  track.frameAt(40, _fr);
  const flatR = new THREE.Vector3(_fr.r.x, 0, _fr.r.z).normalize();
  const flatT = new THREE.Vector3(_fr.t.x, 0, _fr.t.z).normalize();
  const basis = new THREE.Matrix4().makeBasis(flatR, new THREE.Vector3(0, 1, 0), flatT.clone().negate());
  const q = new THREE.Quaternion().setFromRotationMatrix(basis);
  const origin = new THREE.Vector3(_fr.p.x, 0, _fr.p.z).addScaledVector(flatR, -(hw + 14));
  group.position.copy(origin);
  group.quaternion.copy(q);

  const len = 150;
  const concrete = new THREE.MeshLambertMaterial({ color: '#cfc6b8' });
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(4, 2 + i * 2.2, len), concrete);
    step.position.set(-i * 4, (2 + i * 2.2) / 2, 0);
    group.add(step);
  }
  // Crowd: instanced coloured blocks on each step.
  const crowdGeo = new THREE.BoxGeometry(0.7, 1.1, 0.7);
  const perRow = 90;
  const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshLambertMaterial(), perRow * 6);
  const colors = ['#ff4a4a', '#ffd23f', '#3df2ff', '#ff3fa4', '#f4f4f4', '#2f7bff', '#2fdc8a', '#ff8a2b'].map((h) => new THREE.Color(h));
  const m = new THREE.Matrix4();
  let k = 0;
  for (let row = 0; row < 6; row++) {
    for (let j = 0; j < perRow; j++) {
      if (rng() < 0.22) continue;
      const z = -len / 2 + 2 + (j / perRow) * (len - 4) + (rng() - 0.5);
      m.makeTranslation(-row * 4 + (rng() - 0.5) * 1.5, 2 + row * 2.2 + 0.55, z);
      crowd.setMatrixAt(k, m);
      crowd.setColorAt(k, colors[Math.floor(rng() * colors.length)]);
      k++;
    }
  }
  crowd.count = k;
  group.add(crowd);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, len + 6), new THREE.MeshLambertMaterial({ color: '#2b2f3b' }));
  roof.position.set(-11, 19, 0);
  roof.rotation.z = -0.12;
  group.add(roof);
  for (const z of [-len / 2, -len / 4, 0, len / 4, len / 2]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, 18, 0.6), concrete);
    pole.position.set(-22, 9, z);
    group.add(pole);
  }
  // Flags along the front.
  const flagGeo = new THREE.PlaneGeometry(2.6, 1.6);
  for (let i = 0; i < 9; i++) {
    const z = -len / 2 + 8 + i * ((len - 16) / 8);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 9, 0.18), concrete);
    pole.position.set(3.2, 4.5, z);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
    flag.position.set(3.2, 8, z + 1.4);
    flag.rotation.y = Math.PI / 2;
    group.add(pole, flag);
  }
  return group;
}
