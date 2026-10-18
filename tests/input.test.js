import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenGravity, shapeSteer, tiltAngle } from '../src/input.js';

const deg = (r) => (r * 180) / Math.PI;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

test('upright portrait phone reads as straight ahead', () => {
  near(deg(tiltAngle(90, 0)), 0, 1e-6, 'upright');
  near(deg(tiltAngle(60, 0)), 0, 1e-6, 'tipped back');
  const g = screenGravity(90, 0);
  near(g.y, -1, 1e-9, 'gravity points down the screen');
});

test('steering-wheel rotation maps 1:1 regardless of representation', () => {
  // Rotating an upright phone clockwise by theta is reported as gamma=+90, beta=90-theta
  // (or the equivalent gamma=-90, beta=90+theta). Both must read +theta.
  for (const theta of [5, 15, 30]) {
    near(deg(tiltAngle(90 - theta, 90)), theta, 1e-6, `cw ${theta}`);
    near(deg(tiltAngle(90 + theta, -90)), theta, 1e-6, `cw alt ${theta}`);
    near(deg(tiltAngle(90 - theta, -90)), -theta, 1e-6, `ccw ${theta}`);
  }
});

test('side tilt steers in the natural direction at normal holding angles', () => {
  const a = deg(tiltAngle(45, 10));
  assert.ok(a > 8 && a < 12, `45deg grip, 10deg tilt -> ${a}`);
  assert.ok(deg(tiltAngle(45, -10)) < -8);
});

test('near-flat phones do not become hypersensitive', () => {
  const a = deg(tiltAngle(5, 10));
  assert.ok(a > 8 && a < 13, `flat phone 10deg tilt -> ${a}`);
  near(deg(tiltAngle(0, 0)), 0, 1e-6, 'flat and level');
});

test('landscape screen rotation is compensated', () => {
  // Phone turned to landscape (top to the left): level from the player's view.
  near(deg(tiltAngle(0, -90, 90)), 0, 1e-6, 'level landscape');
  // Player tips their right hand down by 10 degrees.
  near(deg(tiltAngle(10, -90, 90)), 10, 1e-6, 'landscape right-down');
});

test('steer shaping: deadzone, full lock, monotonic, symmetric', () => {
  const r = (d) => (d * Math.PI) / 180;
  assert.equal(shapeSteer(r(1), 22, 1.5), 0);
  assert.equal(shapeSteer(r(22), 22, 1.5), 1);
  assert.equal(shapeSteer(r(40), 22, 1.5), 1);
  assert.equal(shapeSteer(r(-40), 22, 1.5), -1);
  let prev = 0;
  for (let d = 2; d <= 22; d += 1) {
    const v = shapeSteer(r(d), 22, 1.5);
    assert.ok(v > prev, 'monotonic');
    assert.ok(Math.abs(v + shapeSteer(r(-d), 22, 1.5)) < 1e-12, 'symmetric');
    prev = v;
  }
});
