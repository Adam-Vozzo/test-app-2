import { formatTime, ordinalSuffix } from './util.js';

const SPEED_SCALE = 3.6 * 2.2; // m/s -> "pod" km/h (podracers are absurdly fast)

/** In-race heads-up display. Writes to the DOM only when something changed. */
export class Hud {
  constructor(track, laps, racerCount) {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.el = {
      pos: $('hud-pos'),
      posSuffix: $('hud-pos-suffix'),
      posPop: $('hud-pos-pop'),
      lap: $('hud-lap'),
      laps: $('hud-laps'),
      time: $('hud-time'),
      best: $('hud-best'),
      speed: $('hud-speed'),
      speedbar: $('hud-speedbar'),
      steer: $('hud-steer'),
      hold: $('hud-hold'),
      count: $('hud-count'),
      banner: $('hud-banner'),
      wrongway: $('hud-wrongway'),
      flashBoost: $('flash-boost'),
      flashL: $('flash-hit-l'),
      flashR: $('flash-hit-r'),
      stick: $('touch-stick'),
    };
    this.el.laps.textContent = String(laps);
    this.root.querySelector('.pos-of').textContent = `/${racerCount}`;
    this.cache = new Map();
    this.textTimer = 0;
    this.minimap = new Minimap($('minimap'), track);
    // Cached so the touch stick never forces a layout read mid-frame.
    this.rect = this.root.getBoundingClientRect();
    window.addEventListener('resize', () => {
      this.rect = this.root.getBoundingClientRect();
    });
  }

  show(on) {
    this.root.classList.toggle('active', on);
  }

  _set(key, value, apply) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply(value);
  }

  _restart(el, cls = 'show') {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }

  countdown(text, go = false) {
    const el = this.el.count;
    el.textContent = text;
    el.classList.toggle('go', go);
    this._restart(el);
  }

  banner(title, sub = '') {
    this.el.banner.querySelector('b').textContent = title;
    this.el.banner.querySelector('small').textContent = sub;
    this._restart(this.el.banner);
  }

  flash(kind) {
    const el = kind === 'boost' ? this.el.flashBoost : kind === 'left' ? this.el.flashL : this.el.flashR;
    this._restart(el);
  }

  wrongWay(on) {
    this.el.wrongway.classList.toggle('show', on);
  }

  popPosition(place) {
    this.el.posPop.textContent = `▲ ${place}${ordinalSuffix(place)}`;
    this._restart(this.el.posPop);
  }

  reset() {
    this.cache.clear();
    this.el.wrongway.classList.remove('show');
    this.el.hold.classList.remove('show');
    for (const el of [this.el.count, this.el.banner, this.el.posPop]) el.classList.remove('show');
  }

  /**
   * @param s { race, input, showHoldHint, touchMode, reducedMotion }
   */
  update(dt, s) {
    const { race, input } = s;
    const p = race.player;
    const c = p.craft;

    this._set('pos', p.place, (v) => {
      this.el.pos.textContent = String(v);
      this.el.posSuffix.textContent = ordinalSuffix(v);
    });
    const lap = Math.min(race.laps, p.lapsDone + 1);
    this._set('lap', lap, (v) => (this.el.lap.textContent = String(v)));

    this.textTimer -= dt;
    if (this.textTimer <= 0) {
      this.textTimer = 1 / 15;
      const t = race.phase === 'racing' || race.phase === 'finished' ? (p.finished ? p.finishTime : race.time) : 0;
      this._set('time', formatTime(t), (v) => (this.el.time.textContent = v));
      const best = Number.isFinite(p.bestLap) ? `Best ${formatTime(p.bestLap)}` : '';
      this._set('best', best, (v) => (this.el.best.textContent = v));
      this._set('speed', Math.round(c.speed * SPEED_SCALE), (v) => (this.el.speed.textContent = String(v)));
    }
    this.el.speedbar.style.setProperty('--v', Math.min(1, c.speed / 118).toFixed(3));
    this.el.steer.style.setProperty('--steer', input.steer.toFixed(3));
    this._set('boost', c.boost > 0, (v) => this.root.classList.toggle('boosting', v));
    this._set('holding', input.holding, (v) => this.root.classList.toggle('holding', v));
    this._set('hint', s.showHoldHint, (v) => this.el.hold.classList.toggle('show', v));

    // Floating stick under the steering thumb in touch-slide mode.
    const anchor = s.touchMode ? input.touchAnchor : null;
    this._set('stick', !!anchor, (v) => this.el.stick.classList.toggle('show', v));
    if (anchor) {
      const rect = this.rect;
      this.el.stick.style.left = `${anchor.x0 - rect.left}px`;
      this.el.stick.style.top = `${anchor.y0 - rect.top}px`;
      this.el.stick.style.setProperty('--dx', `${Math.max(-42, Math.min(42, (anchor.x - anchor.x0) * 0.6))}px`);
    }

    this.minimap.draw(dt, race);
  }
}

export { SPEED_SCALE };

/** Tiny track map with racer dots. Track outline is pre-rendered once. */
class Minimap {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.track = track;
    this.timer = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 64;
    const h = canvas.clientHeight || 80;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.ctx = canvas.getContext('2d');
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.pos[i * 3]);
      maxX = Math.max(maxX, track.pos[i * 3]);
      minZ = Math.min(minZ, track.pos[i * 3 + 2]);
      maxZ = Math.max(maxZ, track.pos[i * 3 + 2]);
    }
    const pad = 6 * dpr;
    const scale = Math.min((canvas.width - pad * 2) / (maxX - minX), (canvas.height - pad * 2) / (maxZ - minZ));
    const ox = (canvas.width - (maxX - minX) * scale) / 2;
    const oy = (canvas.height - (maxZ - minZ) * scale) / 2;
    this.map = (x, z) => [ox + (x - minX) * scale, oy + (z - minZ) * scale];
    this.dpr = dpr;

    this.base = document.createElement('canvas');
    this.base.width = canvas.width;
    this.base.height = canvas.height;
    const g = this.base.getContext('2d');
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.n; i += 3) {
        const k = i % track.n;
        const [x, y] = this.map(track.pos[k * 3], track.pos[k * 3 + 2]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 5 * dpr;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2 * dpr;
    g.stroke();
    // Start line tick.
    const [sx, sy] = this.map(track.pos[0], track.pos[2]);
    g.fillStyle = '#ffcc33';
    g.fillRect(sx - 3 * dpr, sy - 1.5 * dpr, 6 * dpr, 3 * dpr);
  }

  draw(dt, race) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 20;
    const g = this.ctx;
    const d = this.dpr;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    const v = { x: 0, z: 0 };
    const order = race.racers.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const r of order) {
      const i = Math.floor(this.track.wrap(r.craft.s) / this.track.ds) % this.track.n;
      v.x = this.track.pos[i * 3] + this.track.right[i * 3] * r.craft.x;
      v.z = this.track.pos[i * 3 + 2] + this.track.right[i * 3 + 2] * r.craft.x;
      const [x, y] = this.map(v.x, v.z);
      g.beginPath();
      g.arc(x, y, (r.isPlayer ? 3.6 : 2.6) * d, 0, Math.PI * 2);
      g.fillStyle = r.isPlayer ? '#ffffff' : r.body;
      g.fill();
      if (r.isPlayer) {
        g.lineWidth = 1.6 * d;
        g.strokeStyle = '#3df2ff';
        g.stroke();
      }
    }
  }
}
