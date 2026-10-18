import { AIDriver, computeRacingLine } from './ai.js';
import { GAME, PLAYER_LOOK, ROSTER } from './config.js';
import { clearEvents, createCraft, resolveCraftCollisions, stepCraft } from './physics.js';
import { mulberry32 } from './util.js';

const COUNTDOWN = 3; // seconds: 3, 2, 1, GO

/** Finishers by finish time first, then everyone else by distance covered. */
function byPlace(a, b) {
  if (a.finished && b.finished) return a.finishTime - b.finishTime;
  if (a.finished) return -1;
  if (b.finished) return 1;
  return b.craft.progress - a.craft.progress;
}

/**
 * Owns the racers, runs AI + physics, counts laps and ranks the field. Knows nothing
 * about rendering or the DOM; it reports what happened through `events`.
 */
export class Race {
  constructor(track) {
    this.track = track;
    this.racing = computeRacingLine(track);
    this.laps = GAME.laps;
    this.racers = [];
    this.events = [];
    this.buildRoster();
    this.reset();
  }

  buildRoster() {
    const rng = mulberry32(7);
    let ai = 0;
    for (let slot = 0; slot < ROSTER.length + 1; slot++) {
      const isPlayer = slot === GAME.playerGridSlot;
      const look = isPlayer ? PLAYER_LOOK : ROSTER[ai++];
      const racer = {
        id: slot,
        name: look.name,
        body: look.body,
        accent: look.accent,
        skill: look.skill ?? 1,
        isPlayer,
        craft: createCraft(),
        ai: null,
        steer: 0,
        throttle: 0,
      };
      racer.ai = new AIDriver(racer, this.racing, rng);
      this.racers.push(racer);
    }
    this.player = this.racers.find((r) => r.isPlayer);
    this.crafts = this.racers.map((r) => r.craft);
    this.standings = this.racers.slice();
    // The player's AI only drives after the finish line (autopilot during results).
    this.player.ai.skill = 0.95;
    this.player.ai.reaction = 0;
  }

  reset() {
    const L = this.track.length;
    for (const r of this.racers) {
      const row = Math.floor(r.id / 2);
      const col = r.id % 2;
      const s = -14 - row * 15 - col * 7.5;
      Object.assign(r.craft, createCraft());
      r.craft.s = this.track.wrap(s);
      r.craft.progress = s;
      r.craft.x = col === 0 ? -4.6 : 4.6;
      r.lapsDone = 0;
      r.lapStart = 0;
      r.lapTimes = [];
      r.bestLap = Infinity;
      r.finished = false;
      r.finishTime = 0;
      r.place = r.id + 1;
      r.steer = 0;
      r.throttle = 0;
    }
    this.length = L;
    this.tick = 0; // increments every simulated frame; lets views ignore stale craft events
    this.time = 0;
    this.phase = 'grid'; // grid | countdown | racing | finished
    this.countdown = 0;
    this.lastCount = 0;
    this.wrongWayTimer = 0;
    this.wrongWay = false;
    this.stuckTimer = 0;
    this.events.length = 0;
    this.rank();
    this.lastPlayerPlace = this.player.place;
  }

  startCountdown() {
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.lastCount = COUNTDOWN + 1;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  /** Player progress through the whole race, 0..1. */
  get playerFraction() {
    return Math.max(0, Math.min(1, this.player.craft.progress / (this.length * this.laps)));
  }

  update(dt, input, playerMods) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const shown = Math.ceil(this.countdown);
      if (shown < this.lastCount && shown > 0) {
        this.lastCount = shown;
        this.emit('count', { n: shown });
      }
      // Engines rev on the grid but nobody moves.
      for (const r of this.racers) r.throttle = r.isPlayer ? input.throttle : 0.3;
      this.player.steer = input.steer;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.time = 0;
        this.emit('go');
      }
      return;
    }
    if (this.phase !== 'racing' && this.phase !== 'finished') return;

    this.time += dt;
    this.tick++;
    const track = this.track;
    const player = this.player;

    for (const r of this.racers) {
      if (r.isPlayer && !r.finished) {
        r.steer = input.steer;
        r.throttle = input.throttle;
      } else {
        r.ai.update(dt, track, this.racers, this.time);
        r.steer = r.ai.steer;
        r.throttle = r.ai.throttle;
      }
      clearEvents(r.craft);
    }

    const steps = Math.max(1, Math.ceil(dt / GAME.fixedStep - 1e-6));
    const h = dt / steps;
    let bump = 0;
    const crafts = this.crafts;
    for (let i = 0; i < steps; i++) {
      for (const r of this.racers) {
        const mods = r.isPlayer && !r.finished ? playerMods : r.ai.mods(player.craft.progress);
        stepCraft(r.craft, r.steer, r.throttle, track, h, mods);
      }
      bump = Math.max(bump, resolveCraftCollisions(crafts, track, player.craft));
    }

    // Player feedback only while they drive; after the finish the autopilot has the wheel.
    const pc = player.craft;
    if (!player.finished) {
      if (pc.events.wall > 1.5) this.emit('wall', { impact: pc.events.wall, side: pc.events.wallSide });
      if (pc.events.boost) this.emit('boost');
      if (bump > 1) this.emit('bump', { impact: bump });
    }

    this.updateLaps();
    this.rank();
    if (!player.finished) this.watchPlayer(dt);
  }

  updateLaps() {
    const L = this.length;
    for (const r of this.racers) {
      if (r.finished) continue;
      const done = Math.max(0, Math.floor(r.craft.progress / L));
      if (done > r.lapsDone) {
        const lapTime = this.time - r.lapStart;
        r.lapTimes.push(lapTime);
        r.lapStart = this.time;
        r.lapsDone = done;
        const best = lapTime < r.bestLap;
        if (best) r.bestLap = lapTime;
        if (done >= this.laps) {
          r.finished = true;
          r.finishTime = this.time;
          if (r.isPlayer) {
            this.phase = 'finished';
            this.wrongWay = false;
            this.emit('finish', { time: this.time });
          }
        } else if (r.isPlayer) {
          this.emit('lap', { lap: done + 1, lapTime, best, final: done + 1 === this.laps });
        }
      }
    }
  }

  rank() {
    const sorted = this.standings.sort(byPlace);
    for (let i = 0; i < sorted.length; i++) sorted[i].place = i + 1;
    const p = this.player;
    if (this.phase === 'racing' && p.place < this.lastPlayerPlace) this.emit('overtake', { place: p.place });
    this.lastPlayerPlace = p.place;
  }

  /** Wrong-way warning and a gentle auto-recovery if the player gets turned around. */
  watchPlayer(dt) {
    const c = this.player.craft;
    const backwards = Math.abs(c.heading) > 1.9 && c.vs < -2;
    this.wrongWayTimer = backwards ? this.wrongWayTimer + dt : Math.max(0, this.wrongWayTimer - dt * 2);
    const ww = this.wrongWayTimer > 0.7;
    if (ww !== this.wrongWay) {
      this.wrongWay = ww;
      this.emit('wrongway', { on: ww });
    }
    const stuck = Math.abs(c.heading) > 1.6 && c.speed < 6;
    this.stuckTimer = stuck ? this.stuckTimer + dt : 0;
    if (this.stuckTimer > 2.2) {
      c.heading = 0;
      c.yawRate = 0;
      c.vs = Math.max(c.vs, 8);
      c.vx = 0;
      this.stuckTimer = 0;
      this.emit('recover');
    }
  }
}
