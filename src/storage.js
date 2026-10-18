// Settings and personal bests in localStorage. Every access is guarded: private mode,
// blocked storage or quota errors must never break the game.

const PREFIX = 'podrush.v1.';

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export function defaultSettings() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    controlMode: coarse ? 'tilt' : 'touch',
    sensitivity: 'medium',
    assist: 'low',
    sound: true,
    haptics: true,
    reducedMotion: reduce,
    invertTilt: false,
  };
}

export function loadSettings() {
  const d = defaultSettings();
  const saved = read('settings');
  if (!saved || typeof saved !== 'object') return d;
  const out = { ...d };
  for (const k of Object.keys(d)) if (typeof saved[k] === typeof d[k]) out[k] = saved[k];
  return out;
}

export function saveSettings(s) {
  write('settings', s);
}

export function loadRecords() {
  const r = read('records');
  return {
    bestRace: Number.isFinite(r?.bestRace) ? r.bestRace : null,
    bestLap: Number.isFinite(r?.bestLap) ? r.bestLap : null,
    bestPlace: Number.isFinite(r?.bestPlace) ? r.bestPlace : null,
    races: Number.isFinite(r?.races) ? r.races : 0,
  };
}

export function saveRecords(r) {
  write('records', r);
}
