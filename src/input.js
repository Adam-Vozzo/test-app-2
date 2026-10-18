import { INPUT } from './config.js';
import { clamp, smoothstep, wrapAngle } from './util.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------------------------------------------------------------------------------------
// Pure tilt maths (unit tested). Device orientation angles follow the W3C convention:
// beta = front/back tilt about the device x axis, gamma = left/right tilt about y.
// ---------------------------------------------------------------------------------------

/**
 * Gravity projected into the screen plane, in screen coordinates (x right, y up), unit
 * length overall. screenAngle is screen.orientation.angle in degrees.
 */
export function screenGravity(beta, gamma, screenAngle = 0) {
  const b = beta * D2R;
  const g = gamma * D2R;
  const dx = Math.sin(g) * Math.cos(b);
  const dy = -Math.sin(b);
  const a = screenAngle * D2R;
  return {
    x: dx * Math.cos(a) - dy * Math.sin(a),
    y: dx * Math.sin(a) + dy * Math.cos(a),
  };
}

/**
 * How far the phone is "turned like a steering wheel", in radians (+ = right side down).
 * Upright-ish phones use the in-screen roll of gravity (independent of how far the phone
 * is tipped back). Near-flat phones fall back to the side-tilt angle, which stays calm
 * where the roll angle would become hypersensitive.
 */
export function tiltAngle(beta, gamma, screenAngle = 0) {
  const { x, y } = screenGravity(beta, gamma, screenAngle);
  const m = Math.hypot(x, y);
  const roll = Math.atan2(x, -y);
  const side = Math.asin(clamp(x, -1, 1));
  const w = smoothstep(0.25, 0.55, m);
  return side + wrapAngle(roll - side) * w;
}

/** Map an angle offset (radians) to a -1..1 steer with deadzone and gentle expo. */
export function shapeSteer(delta, fullLockDeg, deadzoneDeg = INPUT.tiltDeadzone) {
  const deg = delta * R2D;
  const mag = Math.abs(deg);
  if (mag <= deadzoneDeg) return 0;
  const t = clamp((mag - deadzoneDeg) / (fullLockDeg - deadzoneDeg), 0, 1);
  return Math.sign(deg) * (0.65 * t + 0.35 * t * t * t);
}

function currentScreenAngle() {
  const so = typeof screen !== 'undefined' ? screen.orientation : null;
  if (so && typeof so.angle === 'number') return so.angle;
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') return (window.orientation + 360) % 360;
  return 0;
}

/** Element.closest that tolerates non-element targets (document, window, text nodes). */
function closest(target, selector) {
  return typeof Element !== 'undefined' && target instanceof Element ? target.closest(selector) : null;
}

// ---------------------------------------------------------------------------------------
// Input manager: hold-anywhere throttle, tilt / touch-drag steering, keyboard fallback.
// ---------------------------------------------------------------------------------------

export class Input {
  constructor(surface) {
    this.surface = surface;
    this.mode = 'tilt'; // 'tilt' | 'touch'
    this.sensitivity = 'medium';
    this.invert = false;

    this.steer = 0; // final, -1..1
    this.throttle = 0; // final, 0..1
    this.tiltSteer = 0;
    this.touchSteer = 0;

    this.tiltReady = false; // a real sensor reading has arrived
    this.rawTilt = 0; // radians, unfiltered
    this.tilt = 0; // radians, filtered
    this.neutral = 0;
    this.lastReadingAt = 0;
    this.listening = false;

    this.pointers = new Map(); // id -> { x0, x }
    this.steerPointer = null;
    this.keys = new Set();
    this.keySteer = 0;
    this.holdStartedAt = 0;
    this.enabled = true;

    this._onOrientation = this._onOrientation.bind(this);
  }

  attach() {
    const opts = { passive: false };
    // Listen on window, not the canvas: "hold anywhere" must survive overlays and moments
    // (e.g. a fullscreen transition) where hit-testing lands on <html> instead.
    window.addEventListener('pointerdown', (e) => this._down(e), opts);
    window.addEventListener('pointermove', (e) => this._move(e), opts);
    window.addEventListener('pointerup', (e) => this._up(e), opts);
    window.addEventListener('pointercancel', (e) => this._up(e), opts);
    // iOS: stop long-press callouts, double-tap zoom and bounce everywhere except real UI.
    document.addEventListener(
      'touchstart',
      (e) => {
        if (e.cancelable && !closest(e.target, 'button, a, input, label, select, textarea, [data-ui], .panel-scroll')) e.preventDefault();
      },
      opts,
    );
    document.addEventListener('contextmenu', (e) => {
      if (!closest(e.target, 'input, textarea')) e.preventDefault();
    });
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    this.listenOrientation();
  }

  get holding() {
    return this.pointers.size > 0 || this.keys.has('throttle');
  }

  releaseAll() {
    this.pointers.clear();
    this.steerPointer = null;
    this.touchSteer = 0;
    this.keys.clear();
  }

  // --- tilt -------------------------------------------------------------------------

  listenOrientation() {
    if (this.listening || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    window.addEventListener('deviceorientation', this._onOrientation);
    this.listening = true;
  }

  /** Whether this browser needs an explicit motion permission prompt (iOS 13+). */
  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /**
   * Must be called synchronously from a user gesture (tap) for iOS to show its prompt.
   * Resolves to 'granted' once real readings flow, otherwise 'denied' or 'unavailable'.
   */
  requestTilt() {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return Promise.resolve('unavailable');
    let permission = Promise.resolve('granted');
    if (Input.needsPermission()) {
      try {
        permission = DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      } catch {
        permission = Promise.resolve('denied');
      }
    }
    return permission.then((state) => {
      if (state !== 'granted') return 'denied';
      this.listenOrientation();
      return this.waitForReading(1500).then((ok) => (ok ? 'granted' : 'unavailable'));
    });
  }

  waitForReading(timeoutMs) {
    if (this.tiltReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      const start = performance.now();
      const poll = () => {
        if (this.tiltReady) resolve(true);
        else if (performance.now() - start > timeoutMs) resolve(false);
        else setTimeout(poll, 50);
      };
      poll();
    });
  }

  _onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    this.rawTilt = tiltAngle(e.beta, e.gamma, currentScreenAngle());
    if (!this.tiltReady) {
      this.tilt = this.rawTilt;
      this.neutral = 0;
    }
    this.tiltReady = true;
    this.lastReadingAt = performance.now();
  }

  /** Treat the current grip as "straight ahead". */
  recenter() {
    if (this.tiltReady) {
      this.neutral = this.tilt;
      this.tiltSteer = 0;
    }
  }

  get fullLock() {
    return INPUT.tiltFullLock[this.sensitivity] ?? INPUT.tiltFullLock.medium;
  }

  // --- pointers -----------------------------------------------------------------------

  _down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Presses on controls and menu panels are UI, not throttle.
    if (closest(e.target, 'button, a, input, label, select, textarea, [data-ui], .panel, .toast')) return;
    if (e.cancelable) e.preventDefault();
    this.pointers.set(e.pointerId, { x0: e.clientX, x: e.clientX, y0: e.clientY });
    if (this.steerPointer === null) this.steerPointer = e.pointerId;
    if (this.pointers.size === 1) this.holdStartedAt = performance.now();
    try {
      this.surface.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    if (e.pointerId === this.steerPointer) {
      const range = Math.max(60, window.innerWidth * INPUT.touchRange);
      let dx = p.x - p.x0;
      // Drag-along anchor: reversing direction responds immediately.
      if (Math.abs(dx) > range) {
        p.x0 = p.x - Math.sign(dx) * range;
        dx = p.x - p.x0;
      }
      this.touchSteer = clamp(dx / range, -1, 1);
    }
  }

  _up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (e.pointerId === this.steerPointer) {
      this.steerPointer = null;
      this.touchSteer = 0;
      // Hand steering to another finger that is still down, re-anchored where it is.
      for (const [id, p] of this.pointers) {
        this.steerPointer = id;
        p.x0 = p.x;
        break;
      }
    }
  }

  get touchAnchor() {
    const p = this.steerPointer !== null ? this.pointers.get(this.steerPointer) : null;
    return p ? { x0: p.x0, x: p.x, y0: p.y0 } : null;
  }

  // --- keyboard -----------------------------------------------------------------------

  _key(e, down) {
    const map = {
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      ArrowUp: 'throttle',
      KeyW: 'throttle',
      Space: 'throttle',
    };
    const k = map[e.code];
    if (!k) return;
    if (!down) {
      // Releases always count, wherever focus ended up, so a key can never stick.
      this.keys.delete(k);
      return;
    }
    if (closest(e.target, 'input, select, textarea')) return;
    // Space on a focused button should press the button, not the throttle.
    if (k === 'throttle' && e.code === 'Space' && closest(e.target, 'button')) return;
    e.preventDefault();
    this.keys.add(k);
  }

  // --- per frame ----------------------------------------------------------------------

  update(dt) {
    // Low-pass the sensor to remove jitter without adding noticeable lag (~40 ms).
    if (this.tiltReady) {
      const a = 1 - Math.exp(-INPUT.tiltSmoothing * dt);
      this.tilt += wrapAngle(this.rawTilt - this.tilt) * a;
      const s = shapeSteer(wrapAngle(this.tilt - this.neutral), this.fullLock);
      this.tiltSteer = this.invert ? -s : s;
    }

    const kTarget = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    const rate = kTarget === 0 ? 10 : 5; // ramp in, snap back
    this.keySteer += clamp(kTarget - this.keySteer, -rate * dt, rate * dt);

    const base = this.mode === 'tilt' && this.tiltReady ? this.tiltSteer : this.touchSteer;
    this.steer = this.enabled ? clamp(base + this.keySteer, -1, 1) : 0;
    this.throttle = this.enabled && this.holding ? 1 : 0;
  }
}
