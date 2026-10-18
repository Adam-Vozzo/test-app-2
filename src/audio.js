// Fully synthesised audio (no files): a raspy twin-engine drone, wind, rival pass-bys,
// and short UI/race cues. The context is created on the first tap (browser autoplay rules).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Engine: two detuned saws + a sub square, soft-clipped and low-passed, with an
    // amplitude flutter that gives the podracer rattle.
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.5);
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    this.oscA = osc(ctx, 'sawtooth', 60);
    this.oscB = osc(ctx, 'sawtooth', 121);
    this.oscC = osc(ctx, 'square', 30);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.oscA.connect(mix);
    this.oscB.connect(mix);
    this.oscC.connect(subGain).connect(mix);
    mix.connect(shaper).connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.flutter = osc(ctx, 'sine', 22);
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0;
    this.flutter.connect(this.flutterDepth).connect(this.engGain.gain);

    // Wind / air rush.
    this.noise = noiseBuffer(ctx);
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 800;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Nearest rival: a buzzier, higher drone that swells as they pass.
    this.rival = osc(ctx, 'sawtooth', 140);
    this.rivalFilter = ctx.createBiquadFilter();
    this.rivalFilter.type = 'bandpass';
    this.rivalFilter.frequency.value = 900;
    this.rivalFilter.Q.value = 1.2;
    this.rivalGain = ctx.createGain();
    this.rivalGain.gain.value = 0;
    this.rival.connect(this.rivalFilter).connect(this.rivalGain).connect(this.master);

    for (const o of [this.oscA, this.oscB, this.oscC, this.flutter, this.rival]) o.start();
    this.ready = true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.ready) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /**
   * Per-frame engine update.
   * @param speedK 0..1+ speed fraction, throttle 0..1, boost bool, active (engine audible)
   */
  engine(speedK, throttle, boost, active, rivalDist = Infinity, rivalClosing = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = 0.06;
    const f = 46 + speedK * 150 + throttle * 22 + (boost ? 25 : 0);
    this.oscA.frequency.setTargetAtTime(f, t, k);
    this.oscB.frequency.setTargetAtTime(f * 2.013, t, k);
    this.oscC.frequency.setTargetAtTime(f * 0.5, t, k);
    this.engFilter.frequency.setTargetAtTime(380 + throttle * 900 + speedK * 2200 + (boost ? 1500 : 0), t, k);
    const level = active ? 0.11 + throttle * 0.07 + speedK * 0.05 : 0;
    this.engGain.gain.setTargetAtTime(level, t, 0.08);
    this.flutter.frequency.setTargetAtTime(14 + speedK * 34, t, k);
    this.flutterDepth.gain.setTargetAtTime(active ? level * 0.45 : 0, t, k);
    this.windGain.gain.setTargetAtTime(active ? speedK * speedK * 0.12 : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(500 + speedK * 1800, t, 0.1);
    const near = active && rivalDist < 45 ? (1 - rivalDist / 45) ** 2 : 0;
    this.rivalGain.gain.setTargetAtTime(near * 0.09, t, 0.06);
    this.rival.frequency.setTargetAtTime(110 + speedK * 120 + rivalClosing * 2.5, t, 0.08);
  }

  /** One-shot cues. */
  play(type, amount = 1) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    switch (type) {
      case 'count':
        tone(ctx, this.master, 'square', 660, t, 0.13, 0.16);
        break;
      case 'go':
        tone(ctx, this.master, 'square', 1320, t, 0.4, 0.16);
        tone(ctx, this.master, 'triangle', 660, t, 0.4, 0.2);
        break;
      case 'lap':
        tone(ctx, this.master, 'triangle', 880, t, 0.12, 0.2);
        tone(ctx, this.master, 'triangle', 1320, t + 0.11, 0.22, 0.2);
        break;
      case 'final':
        [784, 988, 1319].forEach((f, i) => tone(ctx, this.master, 'triangle', f, t + i * 0.1, 0.2, 0.2));
        break;
      case 'finish':
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ctx, this.master, 'triangle', f, t + i * 0.09, i === 4 ? 0.6 : 0.16, 0.2));
        break;
      case 'boost': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(240, t);
        o.frequency.exponentialRampToValueAtTime(1100, t + 0.35);
        const g = env(ctx, t, 0.18, 0.42);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        o.connect(lp).connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.5);
        this.burst(t, 0.35, 0.12, 'highpass', 1200);
        break;
      }
      case 'wall': {
        const a = Math.min(1, amount / 30);
        this.burst(t, 0.12 + a * 0.15, 0.12 + a * 0.35, 'lowpass', 900 + a * 2500);
        tone(ctx, this.master, 'sine', 70 + a * 30, t, 0.16, 0.25 * a + 0.08);
        break;
      }
      case 'bump':
        tone(ctx, this.master, 'sine', 95, t, 0.14, 0.22);
        this.burst(t, 0.1, 0.1, 'lowpass', 1400);
        break;
      case 'overtake':
        tone(ctx, this.master, 'triangle', 740, t, 0.08, 0.14);
        tone(ctx, this.master, 'triangle', 1110, t + 0.07, 0.12, 0.14);
        break;
      case 'wrong':
        tone(ctx, this.master, 'square', 220, t, 0.18, 0.12);
        tone(ctx, this.master, 'square', 185, t + 0.2, 0.25, 0.12);
        break;
      case 'ui':
        tone(ctx, this.master, 'triangle', 1200, t, 0.05, 0.1);
        break;
      default:
        break;
    }
  }

  burst(t, dur, gain, type, freq) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = env(ctx, t, gain, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
}

function osc(ctx, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

function env(ctx, t, peak, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

function tone(ctx, dest, type, freq, t, dur, peak) {
  const o = osc(ctx, type, freq);
  const g = env(ctx, t, peak, dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function softClip(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
