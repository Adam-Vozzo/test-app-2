import { PHYSICS as P } from './config.js';
import { clamp, lerp, smoothstep } from './util.js';

// Craft physics in track space. The racing surface is treated as a developed 2D strip:
//   s = distance along the centre line, x = lateral offset (+ right),
//   heading = yaw relative to the local tangent (+ right).
// Velocity is stored in the track frame (vs along, vx across). As the craft advances, the
// track frame rotates under it by kappa * ds, which is what makes corners need steering.

export function createCraft() {
  return {
    s: 0, // wrapped 0..length
    progress: 0, // unwrapped distance travelled along the centre line
    x: 0,
    heading: 0,
    vs: 0,
    vx: 0,
    yawRate: 0,
    speed: 0,
    forwardSpeed: 0,
    slip: 0, // lateral speed in the craft frame (for visuals)
    boost: 0, // seconds of boost remaining
    padLock: -1, // pad id we are currently over (prevents re-triggering)
    wallSide: 0,
    scraping: false,
    // Per-frame event accumulators, consumed by effects/audio/haptics.
    events: { wall: 0, wallSide: 0, boost: false },
  };
}

export function maxYawRate(v) {
  const low = lerp(P.yawLowSpeed, 1, smoothstep(0, 25, v));
  const high = lerp(1, P.yawHighSpeed, smoothstep(40, 100, v));
  return P.yawMax * low * high;
}

/**
 * Advance one craft by dt.
 * @param c craft state
 * @param steer -1..1
 * @param throttle 0..1
 * @param track Track
 * @param mods { thrust, vmax, assist } multipliers / assist strength
 */
export function stepCraft(c, steer, throttle, track, dt, mods) {
  const kappa = track.kappaAt(c.s);
  const limit = track.halfWidth - P.craftHalfWidth;

  // --- yaw -------------------------------------------------------------------------
  const cosH = Math.cos(c.heading);
  const sinH = Math.sin(c.heading);
  let vF = c.vs * cosH + c.vx * sinH; // along the nose
  let vL = -c.vs * sinH + c.vx * cosH; // sideways slide
  const yawCap = maxYawRate(Math.abs(vF));
  // Assist feeds forward part of the yaw needed to follow the curve, so tilt players
  // don't have to hold extreme angles through long corners.
  const assistYaw = mods.assist * kappa * Math.max(0, vF);
  const targetYaw = clamp(steer * yawCap + assistYaw, -yawCap * 1.15, yawCap * 1.15);
  c.yawRate += (targetYaw - c.yawRate) * (1 - Math.exp(-P.yawResponse * dt));

  // --- longitudinal ------------------------------------------------------------------
  const boosting = c.boost > 0;
  const vmax = P.vmax * mods.vmax * (boosting ? P.boostVmax : 1);
  const thrust = P.thrust * mods.thrust * (boosting ? P.boostThrust : 1);
  if (vF < vmax) {
    const headroom = clamp(1 - vF / vmax, 0, 1);
    vF += throttle * thrust * Math.pow(headroom, P.thrustExponent) * dt;
  } else {
    vF -= (vF - vmax) * P.overspeedBleed * dt;
  }
  const coast = 1 - throttle;
  if (coast > 0 && vF > 0) {
    vF = Math.max(0, vF - coast * (P.coastDrag + P.coastDragLinear * vF) * dt);
  } else if (vF < 0) {
    // Reversing is slow and draggy: it's only for getting unstuck.
    vF = Math.min(0, vF + 6 * dt);
  }
  vF -= Math.abs(c.yawRate) * vF * P.turnScrub * dt;

  // Gravity on slopes and banks (attenuated: these are anti-grav craft).
  const slope = track.slopeAt(c.s);
  const lean = track.leanAt(c.s);
  const aAlong = -P.slopeGravity * slope;
  const aAcross = -P.bankGravity * lean;
  vF += (aAlong * cosH + aAcross * sinH) * dt;
  vL += (-aAlong * sinH + aAcross * cosH) * dt;

  // --- lateral grip -------------------------------------------------------------------
  vL *= Math.exp(-P.grip * dt);

  // Back to track frame.
  c.vs = vF * cosH - vL * sinH;
  c.vx = vF * sinH + vL * cosH;

  // --- integrate ----------------------------------------------------------------------
  c.heading += c.yawRate * dt;
  const metric = Math.max(0.3, 1 - kappa * c.x); // inside of a curve is a shorter path
  const ds = (c.vs * dt) / metric;
  c.s = track.wrap(c.s + ds);
  c.progress += ds;
  c.x += c.vx * dt;

  // The track frame turned by kappa*ds underneath us: rotate heading and velocity back.
  const turn = kappa * ds;
  if (turn !== 0) {
    c.heading -= turn;
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    const vs = c.vs;
    c.vs = vs * ct + c.vx * st;
    c.vx = -vs * st + c.vx * ct;
  }
  if (c.heading > Math.PI) c.heading -= Math.PI * 2;
  else if (c.heading < -Math.PI) c.heading += Math.PI * 2;

  // --- walls --------------------------------------------------------------------------
  c.scraping = false;
  if (c.x > limit || c.x < -limit) {
    const side = c.x > 0 ? 1 : -1;
    c.x = side * limit;
    const into = c.vx * side;
    if (into > 0) {
      c.vx = -side * into * P.wallRestitution;
      const loss = clamp(into * P.wallSpeedLoss, 0, P.wallMaxLoss);
      c.vs *= 1 - loss;
      if (c.heading * side > 0) c.heading *= P.wallAlign;
      if (into > c.events.wall) {
        c.events.wall = into;
        c.events.wallSide = side;
      }
    }
    if (c.heading * side > 0) c.heading *= Math.exp(-8 * dt);
    c.vs -= c.vs * P.wallFriction * dt;
    c.scraping = true;
    c.wallSide = side;
  }

  // --- speed pads ---------------------------------------------------------------------
  let onPad = -1;
  const pads = track.pads;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    const along = track.delta(pad.s, c.s);
    if (along >= 0 && along <= pad.length && Math.abs(c.x - pad.x) <= pad.halfWidth + P.craftHalfWidth * 0.5) {
      onPad = pad.id;
      break;
    }
  }
  if (onPad !== -1 && onPad !== c.padLock && c.vs > 0) {
    c.boost = P.boostDuration;
    const h = c.heading;
    c.vs += P.boostImpulse * Math.cos(h);
    c.vx += P.boostImpulse * Math.sin(h);
    c.events.boost = true;
  }
  c.padLock = onPad;
  if (c.boost > 0) c.boost = Math.max(0, c.boost - dt);

  // --- derived ------------------------------------------------------------------------
  c.speed = Math.hypot(c.vs, c.vx);
  const ch = Math.cos(c.heading);
  const sh = Math.sin(c.heading);
  c.forwardSpeed = c.vs * ch + c.vx * sh;
  c.slip = -c.vs * sh + c.vx * ch;
}

export function clearEvents(c) {
  c.events.wall = 0;
  c.events.wallSide = 0;
  c.events.boost = false;
}

/**
 * Pairwise collisions between craft, resolved in track space. Returns the strongest
 * impact involving `focus` (the player) so the caller can fire feedback.
 */
export function resolveCraftCollisions(crafts, track, focus) {
  const len = P.craftLength;
  const wid = P.craftHalfWidth * 2;
  let focusImpact = 0;
  for (let i = 0; i < crafts.length; i++) {
    const a = crafts[i];
    for (let j = i + 1; j < crafts.length; j++) {
      const b = crafts[j];
      const ds = track.delta(a.s, b.s); // + if b is ahead of a
      const dx = b.x - a.x;
      const ox = wid - Math.abs(dx);
      const os = len - Math.abs(ds);
      if (ox <= 0 || os <= 0) continue;
      // Resolve along the axis of least penetration (scaled: we prefer sideways shoves).
      if (ox < os * 0.6) {
        const sgn = dx >= 0 ? 1 : -1;
        a.x -= sgn * ox * 0.5;
        b.x += sgn * ox * 0.5;
        const rel = (b.vx - a.vx) * sgn;
        if (rel < 0) {
          const imp = -rel * 0.6;
          a.vx -= sgn * imp;
          b.vx += sgn * imp;
          if (a === focus || b === focus) focusImpact = Math.max(focusImpact, -rel);
        }
      } else {
        const sgn = ds >= 0 ? 1 : -1; // b ahead of a when +
        const back = sgn > 0 ? a : b;
        const front = sgn > 0 ? b : a;
        const rel = back.vs - front.vs;
        back.s = track.wrap(back.s - os * 0.5);
        back.progress -= os * 0.5;
        front.s = track.wrap(front.s + os * 0.5);
        front.progress += os * 0.5;
        if (rel > 0) {
          // Rear-ender: trade some speed, nudge apart sideways so nobody gets stuck.
          back.vs -= rel * 0.55;
          front.vs += rel * 0.35;
          const side = dx >= 0 ? 1 : -1;
          back.vx -= side * 1.5;
          front.vx += side * 1.5;
          if (a === focus || b === focus) focusImpact = Math.max(focusImpact, rel);
        }
      }
    }
  }
  return focusImpact;
}
