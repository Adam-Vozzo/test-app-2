import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from '../vendor/three.module.min.js';
import { buildTrack } from '../src/track.js';

const track = buildTrack();

test('track has a sensible length and sample spacing', () => {
  assert.ok(track.length > 3000 && track.length < 4000, `length ${track.length}`);
  assert.ok(Math.abs(track.ds - 2) < 0.1, `ds ${track.ds}`);
});

test('every frame is orthonormal and right-handed (right = tangent x up)', () => {
  const t = new THREE.Vector3();
  const r = new THREE.Vector3();
  const u = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < track.n; i++) {
    t.fromArray(track.tan, i * 3);
    r.fromArray(track.right, i * 3);
    u.fromArray(track.up, i * 3);
    assert.ok(Math.abs(t.length() - 1) < 1e-3 && Math.abs(r.length() - 1) < 1e-3 && Math.abs(u.length() - 1) < 1e-3);
    assert.ok(Math.abs(t.dot(r)) < 1e-3 && Math.abs(t.dot(u)) < 1e-3 && Math.abs(r.dot(u)) < 1e-3);
    c.crossVectors(t, u);
    assert.ok(c.distanceTo(r) < 1e-3, `handedness at sample ${i}`);
    assert.ok(u.y > 0.85, `up vector should stay mostly up (sample ${i})`);
  }
});

test('corners are drivable and banking leans into the turn', () => {
  let minRadius = Infinity;
  for (let i = 0; i < track.n; i++) {
    const k = track.kappa[i];
    minRadius = Math.min(minRadius, 1 / Math.max(1e-9, Math.abs(k)));
    // Right turn (k > 0) => right side lower => right.y < 0.
    if (Math.abs(k) > 1 / 150) assert.ok(Math.sign(track.right[i * 3 + 1]) === -Math.sign(k), `bank sign at ${i}`);
  }
  assert.ok(minRadius > 55, `tightest corner radius ${minRadius.toFixed(1)}m`);
});

test('non-adjacent sections never come close to overlapping', () => {
  let min = Infinity;
  for (let i = 0; i < track.n; i += 2) {
    for (let j = i + 2; j < track.n; j += 2) {
      const along = Math.min(j - i, track.n - (j - i)) * track.ds;
      if (along < 250) continue;
      const d = Math.hypot(track.pos[i * 3] - track.pos[j * 3], track.pos[i * 3 + 2] - track.pos[j * 3 + 2]);
      min = Math.min(min, d);
    }
  }
  assert.ok(min > track.width * 3, `closest approach ${min.toFixed(1)}m`);
});

test('wrap and delta handle the start/finish seam', () => {
  const L = track.length;
  assert.equal(track.wrap(-1), L - 1);
  assert.equal(track.wrap(L + 5), 5);
  assert.ok(Math.abs(track.delta(L - 2, 3) - 5) < 1e-9);
  assert.ok(Math.abs(track.delta(3, L - 2) + 5) < 1e-9);
});

test('pointAt agrees with the sampled centre line and offsets along right', () => {
  const v = new THREE.Vector3();
  for (const s of [0, 123.4, 1500, track.length - 0.5]) {
    track.pointAt(s, 0, 0, v);
    const i = Math.round(track.wrap(s) / track.ds) % track.n;
    const d = Math.hypot(v.x - track.pos[i * 3], v.y - track.pos[i * 3 + 1], v.z - track.pos[i * 3 + 2]);
    assert.ok(d < track.ds, `centre at s=${s} off by ${d}`);
    const a = track.pointAt(s, 5, 0, new THREE.Vector3());
    assert.ok(Math.abs(a.distanceTo(v) - 5) < 1e-3);
  }
});

test('features are anchored on the track', () => {
  assert.ok(track.pads.length >= 6);
  for (const pad of track.pads) {
    assert.ok(pad.s >= 0 && pad.s < track.length);
    assert.ok(Math.abs(pad.x) + pad.halfWidth < track.halfWidth);
  }
  for (const a of track.arches) assert.ok(a.s >= 0 && a.s < track.length && a.height > 20);
});
