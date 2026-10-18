import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSIST, GAME } from '../src/config.js';
import { Race } from '../src/race.js';
import { buildTrack } from '../src/track.js';

const track = buildTrack();

function simulate(race, { playerDrives = true, maxSeconds = 300 } = {}) {
  const dt = 1 / 60;
  const events = [];
  const driver = race.player.ai;
  for (let t = 0; t < maxSeconds; t += dt) {
    let input = { steer: 0, throttle: 0 };
    if (race.phase === 'racing' && playerDrives) {
      driver.update(dt, track, race.racers, race.time);
      input = { steer: driver.steer, throttle: driver.throttle };
    }
    race.update(dt, input, { thrust: 1, vmax: 1, assist: ASSIST.low });
    events.push(...race.events);
    race.events.length = 0;
    if (race.phase === 'finished' && race.racers.every((r) => r.finished)) break;
  }
  return events;
}

test('countdown announces 3, 2, 1 then GO', () => {
  const race = new Race(track);
  race.startCountdown();
  const events = simulate(race, { maxSeconds: 3.5 });
  const seq = events.filter((e) => e.type === 'count' || e.type === 'go').map((e) => e.n ?? 'go');
  assert.deepEqual(seq, [3, 2, 1, 'go']);
  assert.equal(race.phase, 'racing');
});

test('nobody moves before GO', () => {
  const race = new Race(track);
  race.startCountdown();
  const before = race.racers.map((r) => r.craft.progress);
  for (let i = 0; i < 100; i++) race.update(1 / 60, { steer: 1, throttle: 1 }, { thrust: 1, vmax: 1, assist: 0 });
  assert.deepEqual(
    race.racers.map((r) => r.craft.progress),
    before,
  );
});

test('a full race completes with sane laps, places and timing', () => {
  const race = new Race(track);
  race.startCountdown();
  const events = simulate(race);
  const p = race.player;
  assert.ok(p.finished, 'player should finish');
  assert.equal(p.lapTimes.length, GAME.laps);
  for (const lap of p.lapTimes) assert.ok(lap > 25 && lap < 70, `lap time ${lap}`);
  const places = race.racers.map((r) => r.place).sort();
  assert.deepEqual(places, [1, 2, 3, 4, 5, 6]);
  assert.ok(
    race.racers.every((r) => r.finished),
    'all AI racers finish too',
  );
  assert.ok(race.racers.every((r) => Number.isFinite(r.craft.progress)));
  const laps = events.filter((e) => e.type === 'lap');
  assert.equal(laps.length, GAME.laps - 1);
  assert.ok(laps.at(-1).final);
  assert.equal(events.filter((e) => e.type === 'finish').length, 1);
});

test('the field stays competitive with a player who never moves', () => {
  const race = new Race(track);
  race.startCountdown();
  simulate(race, { playerDrives: false, maxSeconds: 60 });
  // AI must lap on their own without the player.
  const leaders = race.racers.filter((r) => !r.isPlayer);
  assert.ok(
    leaders.every((r) => r.craft.progress > track.length * 0.9),
    'every AI should be close to a lap in 60s',
  );
});

test('turning around triggers the wrong-way warning', () => {
  const race = new Race(track);
  race.startCountdown();
  simulate(race, { maxSeconds: 3.2 });
  const c = race.player.craft;
  c.heading = Math.PI;
  c.vs = -20;
  let warned = false;
  for (let i = 0; i < 90; i++) {
    race.update(1 / 60, { steer: 0, throttle: 1 }, { thrust: 1, vmax: 1, assist: 0 });
    warned ||= race.events.some((e) => e.type === 'wrongway' && e.on);
    race.events.length = 0;
  }
  assert.ok(warned);
});
