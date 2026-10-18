import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHYSICS } from '../src/config.js';
import { clearEvents, createCraft, maxYawRate, resolveCraftCollisions, stepCraft } from '../src/physics.js';
import { buildTrack } from '../src/track.js';

const track = buildTrack();
const NO_MODS = { thrust: 1, vmax: 1, assist: 0 };
const dt = 1 / 120;

function run(craft, seconds, steer, throttle, mods = NO_MODS) {
  for (let t = 0; t < seconds; t += dt) stepCraft(craft, steer, throttle, track, dt, mods);
}

// A point on the main straight (behind the start line), clear of the speed pads.
const STRAIGHT_S = track.wrap(-120);

test('full throttle reaches most of top speed within a few seconds', () => {
  const c = createCraft();
  c.s = STRAIGHT_S;
  run(c, 5, 0, 1);
  assert.ok(c.speed > PHYSICS.vmax * 0.8, `speed after 5s: ${c.speed.toFixed(1)}`);
  assert.ok(c.speed <= PHYSICS.vmax * PHYSICS.boostVmax + 20);
});

test('letting go of the screen slows the craft noticeably', () => {
  const c = createCraft();
  c.s = STRAIGHT_S;
  c.vs = 85;
  run(c, 1, 0, 0);
  assert.ok(c.speed < 70, `coasted to ${c.speed.toFixed(1)}`);
  assert.ok(c.speed > 40);
});

test('without steering, a curve carries the craft to the outside wall', () => {
  // Find a clear right-hander and start in the middle of the road.
  let s = 0;
  for (let i = 0; i < track.n; i++) {
    if (track.kappa[i] > 1 / 120) {
      s = i * track.ds - 60;
      break;
    }
  }
  const c = createCraft();
  c.s = track.wrap(s);
  c.vs = 70;
  run(c, 2.5, 0, 1);
  assert.ok(c.x < -3, `expected drift to the left (outside), x=${c.x.toFixed(2)}`);
});

test('the craft never leaves the road and wall hits cost speed', () => {
  const c = createCraft();
  c.s = STRAIGHT_S;
  c.vs = 80;
  c.heading = 0.5; // pointing at the right wall
  const limit = track.halfWidth - PHYSICS.craftHalfWidth;
  let hit = 0;
  for (let t = 0; t < 2; t += dt) {
    clearEvents(c);
    stepCraft(c, 0, 1, track, dt, NO_MODS);
    hit = Math.max(hit, c.events.wall);
    assert.ok(Math.abs(c.x) <= limit + 1e-9);
  }
  assert.ok(hit > 10, `impact ${hit}`);
  assert.ok(Math.abs(c.heading) < 0.3, 'impact should align the craft with the wall');
});

test('driving over a speed pad triggers a boost', () => {
  const pad = track.pads[0];
  const c = createCraft();
  c.s = track.wrap(pad.s - 20);
  c.x = pad.x;
  c.vs = 60;
  let boosted = false;
  for (let t = 0; t < 1; t += dt) {
    clearEvents(c);
    stepCraft(c, 0, 1, track, dt, NO_MODS);
    boosted ||= c.events.boost;
  }
  assert.ok(boosted);
  assert.ok(c.boost > 0 || c.speed > 70);
});

test('steering authority shrinks at very low and very high speed', () => {
  assert.ok(maxYawRate(0) < maxYawRate(35));
  assert.ok(maxYawRate(95) < maxYawRate(35));
  assert.ok(maxYawRate(0) > 0.3, 'must still be able to turn around when stopped');
});

test('assist reduces the steering needed through a corner', () => {
  // Constant right-hander; window kept short enough that neither run reaches the wall.
  const k = 1 / 300;
  const fakeTrack = { ...track, kappaAt: () => k, slopeAt: () => 0, leanAt: () => 0, wrap: (s) => s, delta: (a, b) => b - a, pads: [] };
  const drift = (assist) => {
    const c = createCraft();
    c.vs = 50;
    for (let t = 0; t < 1.2; t += dt) stepCraft(c, 0, 0.5, fakeTrack, dt, { thrust: 1, vmax: 1, assist });
    assert.ok(!c.scraping);
    return c.x;
  };
  assert.ok(drift(0.55) > drift(0) + 1.5, 'assisted craft should drift wide far less');
});

test('craft collisions separate overlapping racers', () => {
  const a = createCraft();
  const b = createCraft();
  a.s = b.s = 100;
  a.x = 0;
  b.x = 1;
  a.vx = 3;
  b.vx = -3;
  resolveCraftCollisions([a, b], track, a);
  assert.ok(b.x - a.x >= PHYSICS.craftHalfWidth * 2 - 1e-6);
  assert.ok(a.vx < 3 && b.vx > -3);
});
