import { AI as CFG, PHYSICS } from './config.js';
import { maxYawRate } from './physics.js';
import { clamp } from './util.js';

/**
 * Precompute, per track sample, a lateral racing line and a target speed.
 * The speed profile uses the same yaw limits the player has, so the AI can't cheat on
 * cornering — difficulty comes from line choice and rubber-banding only.
 */
export function computeRacingLine(track) {
  const n = track.n;
  const ds = track.ds;
  const half = track.halfWidth - PHYSICS.craftHalfWidth - 1.2;

  // Wide average of curvature, shifted ahead, decides which side to favour.
  const win = Math.round(45 / ds);
  const lead = Math.round(12 / ds);
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -win; k <= win; k++) sum += track.kappa[(i + lead + k + n * 4) % n];
    const k = sum / (2 * win + 1);
    line[i] = clamp(k * 120, -1, 1) * half;
  }
  // Smooth the line so transitions are gradual.
  const sm = new Float32Array(n);
  const r = Math.round(30 / ds);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += line[(i + k + n) % n];
    sm[i] = sum / (2 * r + 1);
  }

  // Corner speed limit: v such that kappa * v <= margin * maxYaw(v). Uncapped on
  // straights (physics vmax does the capping there), so rubber-banding can add pace.
  const cap = PHYSICS.vmax * 2;
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let kmax = 0;
    for (let k = -3; k <= 3; k++) kmax = Math.max(kmax, Math.abs(track.kappa[(i + k + n) % n]));
    let v = PHYSICS.vmax;
    for (let it = 0; it < 8; it++) {
      const lim = kmax > 1e-5 ? (CFG.cornerMargin * maxYawRate(v)) / kmax : cap;
      v = Math.min(cap, (v + lim) / 2);
    }
    speed[i] = v;
  }
  // Backward pass: start lifting early enough to reach the corner speed (coasting decel).
  const decelAt = (v) => PHYSICS.coastDrag + PHYSICS.coastDragLinear * v;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n];
      const allowed = Math.sqrt(next * next + 2 * decelAt(next) * ds);
      if (speed[i] > allowed) speed[i] = allowed;
    }
  }
  return { line: sm, speed };
}

function sampleArray(track, arr, s) {
  const u = track.wrap(s) / track.ds;
  const i = Math.floor(u);
  const f = u - i;
  const a = arr[i % track.n];
  const b = arr[(i + 1) % track.n];
  return a + (b - a) * f;
}

export class AIDriver {
  constructor(racer, racing, rng) {
    this.racer = racer;
    this.racing = racing;
    this.skill = racer.skill;
    this.laneBias = (rng() - 0.5) * 4;
    this.wander = rng() * 100;
    this.reaction = 0.08 + rng() * 0.35; // seconds of hesitation at the start
    this.steer = 0;
    this.throttle = 0;
    this._mods = { thrust: 1, vmax: 1, assist: 0 };
  }

  /** Rubber band: modest boost when behind the player, modest lift when ahead. */
  mods(playerProgress) {
    const gap = playerProgress - this.racer.craft.progress; // + when AI is behind
    const t = clamp(gap / CFG.rubberBandRange, -1, 1);
    const band = t > 0 ? t * CFG.rubberBandBehind : t * CFG.rubberBandAhead;
    const m = this.skill * (1 + band);
    this._mods.thrust = m;
    this._mods.vmax = m;
    return this._mods;
  }

  update(dt, track, racers, time) {
    const c = this.racer.craft;
    if (time < this.reaction) {
      this.steer = 0;
      this.throttle = 0;
      return;
    }
    const v = Math.max(0, c.forwardSpeed);
    const look = CFG.lookAheadBase + v * CFG.lookAheadSpeed;
    let target = sampleArray(track, this.racing.line, c.s + look);
    target += this.laneBias + Math.sin(time * 0.31 + this.wander) * 1.6;

    // Simple avoidance: if someone is just ahead in our lane, pick the roomier side.
    for (const other of racers) {
      if (other === this.racer) continue;
      const o = other.craft;
      const ahead = track.delta(c.s, o.s);
      if (ahead > 2 && ahead < 22 && Math.abs(o.x - target) < 4.2 && o.forwardSpeed < v + 2) {
        const goRight = o.x < 0;
        target = o.x + (goRight ? 5 : -5);
        break;
      }
    }
    const lim = track.halfWidth - PHYSICS.craftHalfWidth - 0.8;
    target = clamp(target, -lim, lim);

    const desired = Math.atan2(target - c.x, look);
    const kappa = track.kappaAt(c.s);
    const yawNeeded = kappa * Math.max(0, c.vs) + (desired - c.heading) * CFG.headingGain;
    this.steer = clamp(yawNeeded / maxYawRate(v), -1, 1);

    const vTarget = sampleArray(track, this.racing.speed, c.s + 6 + v * 0.25) * (0.5 + 0.5 * this.skill);
    if (v < vTarget - 1) this.throttle = 1;
    else if (v < vTarget + 2) this.throttle = 0.5;
    else this.throttle = 0;
    // Recover if facing the wrong way.
    if (Math.abs(c.heading) > 1.6) this.throttle = 0.6;
  }
}
