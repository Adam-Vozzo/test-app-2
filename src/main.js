import { AudioEngine } from './audio.js';
import { ASSIST, GAME } from './config.js';
import { haptics } from './haptics.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Race } from './race.js';
import { loadRecords, loadSettings, saveRecords, saveSettings } from './storage.js';
import { buildTrack } from './track.js';
import { UI } from './ui.js';
import { clamp, formatTime, ordinalSuffix, wrapAngle } from './util.js';
import { World } from './world.js';

const app = document.getElementById('app');
const canvas = document.getElementById('scene');
const HOLD_TO_START = 0.5; // seconds of holding to start the countdown

// Game flow:
//   title -> ready (learn the controls, hold to start) -> countdown -> racing -> finished
//   racing/countdown <-> paused (resume runs a short 3-2-1 so you can re-grip)
let state = 'boot';
let pausedFrom = null;
let holdTime = 0;
let resumeTimer = 0;
let resumeShown = 0;
let finishTimer = 0;
let notHolding = 0;
let wallHitsLap1 = 0;
let tipShown = false;
let tiltBlocked = false;
let finishBadges = [];
let tiltState = 'unknown'; // unknown | pending | granted | denied | unavailable
let wakeLock = null;
let readyTextFor = null;
let standingsTimer = 0;
let pausedByRotation = false;
let last = performance.now();

const settings = loadSettings();
const records = loadRecords();
let track;
let race;
let world;
let input;
let hud;
let ui;
const audio = new AudioEngine();

const finePointer = matchMedia('(pointer: fine)').matches && !matchMedia('(pointer: coarse)').matches;
const usingTilt = () => settings.controlMode === 'tilt' && !tiltBlocked && !finePointer;

boot();

async function boot() {
  // Canvas textures (the start gantry banner) are drawn once, so give the font a moment.
  try {
    await Promise.race([document.fonts?.load('italic 700 100px "Chakra Petch"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* fall back to system fonts */
  }
  try {
    track = buildTrack();
    race = new Race(track);
    world = new World(canvas, track, race);
  } catch (err) {
    console.error(err);
    showBootError(
      /webgl|context/i.test(String(err?.message))
        ? "Your browser couldn't start 3D graphics (WebGL). Try updating it or turning on hardware acceleration."
        : 'Something went wrong while loading. Please reload the page.',
    );
    return;
  }

  input = new Input(canvas);
  input.attach();
  hud = new Hud(track, race.laps, race.racers.length);
  ui = new UI({
    onUiTap: () => {
      audio.unlock();
      audio.play('ui');
      haptics.pulse(8);
    },
    onRace: startFromTitle,
    onPause: pause,
    onResume: resume,
    onRecenter: () => {
      input.recenter();
      haptics.pulse(20);
      ui.toast('Steering centred on how you hold the phone now');
    },
    onRestart: () => goReady(),
    onQuit: () => goTitle(),
    onSetting: changeSetting,
    onSettingsOpen: () => {
      if (usingTilt() && tiltState !== 'granted') requestTilt();
    },
  });

  applySettings();
  window.addEventListener('keydown', onKey);
  for (const type of ['pointerup', 'touchend']) window.addEventListener(type, () => audio.unlock(), { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  const landscape = matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 600px)');
  const onOrient = () => {
    app.classList.toggle('landscape-phone', landscape.matches);
    if (landscape.matches) {
      if (pause()) pausedByRotation = true;
    } else if (state === 'paused' && pausedByRotation) {
      // An accidental rotation (e.g. a big steer without portrait lock) resumes by itself.
      resume();
    }
  };
  landscape.addEventListener?.('change', onOrient);
  onOrient();

  goTitle();
  // Warm the camera so the first frame is already framed nicely.
  for (let i = 0; i < 30; i++) world.update(1 / 30, { reducedMotion: settings.reducedMotion });
  requestAnimationFrame(() => app.classList.remove('is-booting'));
  requestAnimationFrame(frame);
}

function showBootError(message) {
  const boot = document.getElementById('boot');
  boot.classList.add('error');
  document.getElementById('boot-text').textContent = message;
}

// ---------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------

function applySettings() {
  input.mode = usingTilt() ? 'tilt' : 'touch';
  input.sensitivity = settings.sensitivity;
  input.invert = settings.invertTilt;
  audio.setEnabled(settings.sound);
  haptics.enabled = settings.haptics;
  const kind = finePointer ? 'keys' : usingTilt() ? 'tilt' : 'touch';
  ui.setControlHints(kind);
  ui.syncSettings(settings, {
    tiltAvailable: tiltState === 'unavailable' ? false : undefined,
    hapticsSupported: haptics.supported,
    tiltNote: finePointer
      ? 'Tilt steering needs a phone. On desktop use ← → or A / D.'
      : tiltState === 'denied'
        ? 'Motion access is blocked. Allow it for this site in your browser settings, then reload.'
        : undefined,
  });
  ui.setRecenterVisible(usingTilt());
  ui.setBest(records);
  saveSettings(settings);
}

function changeSetting(key, value) {
  settings[key] = value;
  if (key === 'controlMode' && value === 'tilt') {
    tiltBlocked = false;
    requestTilt();
  }
  applySettings();
}

/** Ask for motion access (iOS shows a prompt); fall back to touch steering if refused. */
function requestTilt() {
  if (finePointer) return Promise.resolve('unavailable');
  tiltState = 'pending';
  return input.requestTilt().then((result) => {
    tiltState = result;
    if (result !== 'granted' && settings.controlMode === 'tilt') {
      tiltBlocked = true;
      ui.toast(
        result === 'denied'
          ? 'Motion access was declined, so steering is set to touch: keep your thumb down and slide. You can switch back in Settings.'
          : 'No motion sensor found, so steering is set to touch: keep your thumb down and slide.',
        5200,
      );
    }
    applySettings();
    return result;
  });
}

// ---------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------

function goTitle() {
  state = 'title';
  race.reset();
  hud.reset();
  hud.show(false);
  world.trackView.gantry.setLights(0);
  world.rig.setMode('orbit', { instant: true });
  input.enabled = false;
  input.releaseAll();
  ui.setBest(records);
  ui.show('title');
  releaseWakeLock();
}

function startFromTitle() {
  // Order matters on iOS: the permission prompt must be requested inside the tap.
  if (usingTilt() && tiltState !== 'granted') requestTilt();
  enterFullscreen();
  goReady();
}

function goReady() {
  const fromTitle = state === 'title';
  state = 'ready';
  race.reset();
  hud.reset();
  hud.show(false);
  world.trackView.gantry.setLights(0);
  world.rig.snap(world.refreshTarget());
  world.rig.setMode('chase', { instant: !fromTitle });
  input.enabled = true;
  input.releaseAll();
  document.activeElement?.blur?.();
  holdTime = 0;
  readyTextFor = null;
  notHolding = 0;
  wallHitsLap1 = 0;
  const p = race.player;
  document.getElementById('ready-pill').textContent = `${race.laps} laps · start ${p.place}${ordinalSuffix(p.place)}`;
  updateReadyText();
  ui.show('ready');
  requestWakeLock();
}

function updateReadyText() {
  const el = document.getElementById('ready-text');
  const demo = document.getElementById('ready-demo');
  let alt = demo.querySelector('.demo-alt');
  if (finePointer) {
    el.innerHTML = 'Steer with <b>← →</b><small>Hold Space or the mouse button to accelerate</small>';
  } else if (usingTilt()) {
    el.innerHTML =
      tiltState === 'pending'
        ? 'Waiting for motion access…'
        : 'Tilt your phone like a steering wheel<small>Straight ahead is however you hold it when you start</small>';
  } else {
    el.innerHTML = 'Keep your thumb down and <b>slide</b> to steer<small>Let go to brake</small>';
  }
  const showAlt = finePointer || !usingTilt();
  if (showAlt && !alt) {
    alt = document.createElement('div');
    alt.className = 'demo-alt';
    demo.appendChild(alt);
  }
  if (alt) {
    alt.hidden = !showAlt;
    alt.textContent = finePointer ? '← →' : '⟵ ● ⟶';
  }
  document.getElementById('hold-label').textContent = finePointer ? 'Hold Space or click to start' : 'Hold anywhere to start';
}

function startCountdown() {
  input.recenter(); // calibrate tilt to the grip the player chose
  state = 'countdown';
  race.startCountdown();
  ui.show(null);
  hud.reset();
  hud.show(true);
  haptics.pulse(25);
}

function pause() {
  if (state !== 'racing' && state !== 'countdown' && state !== 'resuming') return false;
  pausedByRotation = false;
  pausedFrom = state === 'resuming' ? 'racing' : state;
  state = 'paused';
  input.releaseAll();
  input.enabled = false;
  ui.show('pause');
  audio.engine(0, 0, false, false);
  return true;
}

function resume() {
  pausedByRotation = false;
  ui.show(null);
  input.enabled = true;
  if (pausedFrom === 'countdown') {
    state = 'countdown';
    return;
  }
  state = 'resuming';
  resumeTimer = 1.2;
  resumeShown = 4;
}

function finish() {
  state = 'finished';
  finishTimer = 1.8;
  const p = race.player;
  const badges = [];
  records.races += 1;
  if (!records.bestRace || p.finishTime < records.bestRace) {
    if (records.bestRace) badges.push('New best time');
    records.bestRace = p.finishTime;
  }
  if (!records.bestLap || p.bestLap < records.bestLap) {
    if (records.bestLap) badges.push('New best lap');
    records.bestLap = p.bestLap;
  }
  if (p.place === 1 && (!records.bestPlace || records.bestPlace > 1)) badges.push('First win!');
  records.bestPlace = Math.min(records.bestPlace ?? 99, p.place);
  saveRecords(records);
  finishBadges = badges;
  hud.banner(p.place === 1 ? 'Winner!' : 'Finish', `${p.place}${ordinalSuffix(p.place)} · ${formatTime(p.finishTime)}`);
  audio.play('finish');
  haptics.pulse([30, 60, 30, 60, 80]);
}

// ---------------------------------------------------------------------------------------
// Race events -> feedback
// ---------------------------------------------------------------------------------------

function handleEvents() {
  for (const e of race.events) {
    switch (e.type) {
      case 'count':
        hud.countdown(String(e.n));
        world.trackView.gantry.setLights(4 - e.n);
        audio.play('count');
        haptics.pulse(15);
        break;
      case 'go':
        state = 'racing';
        hud.countdown('GO', true);
        world.trackView.gantry.setLights('go');
        audio.play('go');
        haptics.pulse(45);
        break;
      case 'lap':
        hud.banner(e.final ? 'Final lap' : `Lap ${e.lap}`, `${formatTime(e.lapTime)}${e.best && e.lap > 2 ? ' · best' : ''}`);
        audio.play(e.final ? 'final' : 'lap');
        haptics.pulse([20, 50, 20]);
        break;
      case 'finish':
        finish();
        break;
      case 'boost':
        hud.flash('boost');
        audio.play('boost');
        haptics.pulse(30);
        break;
      case 'wall':
        hud.flash(e.side > 0 ? 'right' : 'left');
        audio.play('wall', e.impact);
        haptics.pulse(Math.round(clamp(12 + e.impact * 2.5, 15, 90)));
        world.rig.addShake(clamp(e.impact * 0.035, 0.15, 0.9));
        if (race.player.lapsDone === 0 && e.impact > 8) wallHitsLap1++;
        break;
      case 'bump':
        audio.play('bump');
        haptics.pulse(22);
        world.rig.addShake(0.3);
        break;
      case 'overtake':
        hud.popPosition(e.place);
        audio.play('overtake');
        break;
      case 'wrongway':
        hud.wrongWay(e.on);
        if (e.on) {
          audio.play('wrong');
          haptics.pulse([40, 80, 40]);
        }
        break;
      case 'recover':
        ui.toast('Turned you back around');
        break;
      default:
        break;
    }
  }
  race.events.length = 0;

  // Adaptive help: struggling on lap one suggests the gentler settings, once.
  if (!tipShown && wallHitsLap1 >= 4) {
    tipShown = true;
    ui.toast(
      usingTilt() && settings.sensitivity !== 'low'
        ? 'Tip: lower tilt sensitivity or raise steering assist in Settings (pause button).'
        : 'Tip: raise steering assist in Settings (pause button).',
      5200,
    );
  }
}

// ---------------------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  const dt = Math.min(0.05, Math.max(0, rawMs / 1000));
  input.update(dt);

  const mods = { thrust: 1, vmax: 1, assist: ASSIST[settings.assist] ?? ASSIST.low };
  switch (state) {
    case 'ready':
      updateReady(dt);
      break;
    case 'countdown':
    case 'racing':
      race.update(dt, input, mods);
      handleEvents();
      if (state === 'racing') notHolding = input.holding ? 0 : notHolding + dt;
      break;
    case 'resuming':
      resumeTimer -= dt;
      {
        const n = Math.ceil(resumeTimer / 0.4);
        if (n < resumeShown && n > 0) {
          resumeShown = n;
          hud.countdown(String(n));
          audio.play('count');
        }
      }
      if (resumeTimer <= 0) {
        state = 'racing';
        hud.countdown('GO', true);
        audio.play('go');
      }
      break;
    case 'finished':
      race.update(dt, input, mods);
      handleEvents();
      finishTimer -= dt;
      if (finishTimer <= 0 && ui.current !== 'results') {
        hud.show(false);
        world.rig.setMode('finish');
        ui.showResults(race, finishBadges);
      }
      standingsTimer -= dt;
      if (ui.current === 'results' && standingsTimer <= 0) {
        standingsTimer = 0.25;
        ui.updateStandings(race);
      }
      break;
    default:
      break;
  }

  if (ui.current === 'settings') {
    const meter = document.getElementById('settings-meter');
    meter.style.setProperty('--steer', (input.tiltReady ? input.tiltSteer : 0).toFixed(3));
  }
  if (state === 'paused') return; // keep the last frame on screen, save battery

  world.update(dt, { reducedMotion: settings.reducedMotion });
  if (state === 'countdown' || state === 'racing' || state === 'resuming' || (state === 'finished' && ui.current !== 'results')) {
    hud.update(dt, {
      race,
      input,
      touchMode: !usingTilt() && !finePointer,
      showHoldHint: state === 'racing' && notHolding > 0.9 && race.player.craft.speed < 70,
    });
  }
  updateEngineAudio();
  world.render();
  world.adaptQuality(rawMs);
}

function updateReady(dt) {
  // Rev the engine and fill the ring while holding; release drains it. Never while the
  // rotate overlay is up: the race would start where the player can't see it.
  const blocked = app.classList.contains('landscape-phone');
  holdTime = input.holding && !blocked ? holdTime + dt : Math.max(0, holdTime - dt * 2.5);
  const t = clamp(holdTime / HOLD_TO_START, 0, 1);
  document.getElementById('hold-ring').style.setProperty('--hold', t.toFixed(3));
  const tiltDeg = input.tiltReady ? clamp((wrapAngle(input.tilt - input.neutral) * 180) / Math.PI, -50, 50) : 0;
  document.getElementById('demo-phone').style.setProperty('--tilt', `${(settings.invertTilt ? -tiltDeg : tiltDeg).toFixed(1)}deg`);
  document.getElementById('ready-meter').style.setProperty('--steer', input.steer.toFixed(3));
  race.player.throttle = input.throttle;
  if (readyTextFor !== tiltState) {
    readyTextFor = tiltState;
    updateReadyText();
  }
  if (t >= 1) startCountdown();
}

function updateEngineAudio() {
  const p = race.player;
  const c = p.craft;
  const active = state === 'ready' || state === 'countdown' || state === 'racing' || state === 'resuming' || state === 'finished';
  let nearest = Infinity;
  let closing = 0;
  for (const r of race.racers) {
    if (r === p) continue;
    const ds = track.delta(c.s, r.craft.s);
    const d = Math.hypot(ds, r.craft.x - c.x);
    if (d < nearest) {
      nearest = d;
      closing = (r.craft.vs - c.vs) * -Math.sign(ds);
    }
  }
  const throttle = state === 'racing' || state === 'finished' ? p.throttle : input.throttle;
  audio.engine(Math.min(1.3, c.speed / 92), throttle, c.boost > 0, active, nearest, closing);
}

// ---------------------------------------------------------------------------------------
// Platform glue
// ---------------------------------------------------------------------------------------

function onKey(e) {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'paused') resume();
    else pause();
  } else if (e.code === 'Enter' && state === 'title' && document.activeElement === document.body) {
    audio.unlock();
    startFromTitle();
  }
}

function onVisibility() {
  if (document.hidden) {
    pause();
    input.releaseAll();
    audio.suspend();
  } else {
    audio.resume();
    if (state !== 'title' && state !== 'boot') requestWakeLock();
    last = performance.now();
  }
}

function enterFullscreen() {
  const el = document.documentElement;
  if (finePointer || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('portrait'))
    .catch(() => {});
}

async function requestWakeLock() {
  try {
    if (!wakeLock && 'wakeLock' in navigator && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// Handy for debugging from the console.
window.podrush = {
  get race() {
    return race;
  },
  get world() {
    return world;
  },
  get input() {
    return input;
  },
  get state() {
    return state;
  },
  GAME,
};
