import { formatTime, ordinalSuffix } from './util.js';

/** Menus, settings form, results sheet and toasts. All game logic lives in main.js. */
export class UI {
  constructor(handlers) {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.app = $('app');
    this.h = handlers;
    this.screens = {
      title: $('screen-title'),
      ready: $('screen-ready'),
      pause: $('screen-pause'),
      settings: $('screen-settings'),
      results: $('screen-results'),
    };
    this.current = null;
    this.settingsReturn = null;
    this.toastTimer = 0;

    // Browsers send no `click` for a tap made while another finger is down, and in a
    // hold-to-accelerate game a finger usually is. Buttons that can be reached mid-race
    // therefore fire from pointer events: 'down' (pause: instant) or 'tap' (down + up on
    // the button). `click` stays as the keyboard / assistive-tech path. Plain 'click' is
    // kept where the press may trigger the iOS motion prompt, which wants a real click.
    const bind = (id, fn, mode = 'click') => {
      const el = $(id);
      let armed = null;
      let pointerAt = -Infinity; // last time a pointer path handled a press
      const fire = () => {
        this.h.onUiTap?.();
        fn();
      };
      if (mode !== 'click') {
        el.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          armed = e.pointerId;
          if (mode === 'down') {
            pointerAt = Infinity; // swallow the click this press may still produce
            fire();
          }
        });
        // Watch the release on window: after a 'down' press opens a menu, a mouse release
        // lands on that menu, not on this button, and must still be seen.
        const release = (e, cancelled) => {
          if (e.pointerId !== armed) return;
          armed = null;
          pointerAt = performance.now();
          if (mode === 'tap' && !cancelled) {
            const r = el.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) fire();
          }
        };
        window.addEventListener('pointerup', (e) => release(e, false), true);
        window.addEventListener('pointercancel', (e) => release(e, true), true);
      }
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (performance.now() - pointerAt < 700) return;
        fire();
      });
    };
    bind('btn-race', () => this.h.onRace());
    bind('btn-settings', () => this.openSettings('title'));
    bind('btn-ready-back', () => this.h.onQuit(), 'tap');
    bind('btn-pause', () => this.h.onPause(), 'down');
    bind('btn-resume', () => this.h.onResume(), 'tap');
    bind('btn-recenter', () => this.h.onRecenter(), 'tap');
    bind('btn-restart', () => this.h.onRestart(), 'tap');
    bind('btn-pause-settings', () => this.openSettings('pause'), 'tap');
    bind('btn-quit', () => this.h.onQuit(), 'tap');
    bind('btn-settings-done', () => this.closeSettings(), 'tap');
    bind('btn-again', () => this.h.onRestart(), 'tap');
    bind('btn-menu', () => this.h.onQuit(), 'tap');

    // Segmented controls behave as radio groups (arrow keys move the selection).
    for (const group of document.querySelectorAll('.segmented')) {
      const key = group.dataset.setting;
      const buttons = [...group.querySelectorAll('button')];
      buttons.forEach((b, i) => {
        b.addEventListener('click', () => {
          this.h.onUiTap?.();
          this.h.onSetting(key, b.dataset.value);
        });
        b.addEventListener('keydown', (e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const next = buttons[(i + d + buttons.length) % buttons.length];
          next.focus();
          this.h.onSetting(key, next.dataset.value);
        });
      });
    }
    for (const input of document.querySelectorAll('.toggle input')) {
      input.addEventListener('change', () => {
        this.h.onUiTap?.();
        this.h.onSetting(input.dataset.setting, input.checked);
      });
    }
  }

  /** Show exactly one screen (or none). */
  show(name) {
    for (const [key, el] of Object.entries(this.screens)) {
      const on = key === name;
      el.classList.toggle('active', on);
      el.toggleAttribute('inert', !on);
    }
    this.current = name;
    const first = name && this.screens[name].querySelector('.btn-primary');
    // Move focus for keyboard / screen reader users without scrolling on touch devices.
    if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
  }

  openSettings(from) {
    this.settingsReturn = from;
    this.show('settings');
    this.h.onSettingsOpen?.();
  }

  closeSettings() {
    this.show(this.settingsReturn ?? 'title');
    this.h.onSettingsClosed?.(this.settingsReturn);
  }

  syncSettings(settings, { tiltAvailable, hapticsSupported, tiltNote }) {
    for (const group of document.querySelectorAll('.segmented')) {
      const value = settings[group.dataset.setting];
      for (const b of group.querySelectorAll('button')) {
        const on = b.dataset.value === value;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    }
    for (const input of document.querySelectorAll('.toggle input')) input.checked = !!settings[input.dataset.setting];
    const tilt = settings.controlMode === 'tilt';
    for (const el of document.querySelectorAll('[data-when="tilt"]')) el.hidden = !tilt;
    this.$('toggle-haptics').hidden = !hapticsSupported;
    this.$('tilt-note').textContent = tiltNote ?? (tiltAvailable === false ? 'No motion sensor detected on this device.' : '');
    this.app.classList.toggle('reduce-motion', settings.reducedMotion);
  }

  /** Which control hints to show on the title screen. */
  setControlHints(kind) {
    for (const li of document.querySelectorAll('#howto li[data-mode]')) li.hidden = li.dataset.mode !== kind;
    this.app.classList.toggle('input-keys', kind === 'keys');
    this.app.classList.toggle('mode-touch', kind === 'touch');
  }

  setBest(records) {
    const el = this.$('title-best');
    el.innerHTML = records.bestRace ? `Best race<b>${formatTime(records.bestRace)}</b>` : records.races ? '' : 'First race? Have fun!';
  }

  toast(message, ms = 3600) {
    const el = this.$('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  setRecenterVisible(on) {
    this.$('btn-recenter').hidden = !on;
    this.$('recenter-hint').hidden = !on;
  }

  // --- results ---------------------------------------------------------------------

  showResults(race, badges) {
    const p = race.player;
    const place = p.place;
    const placeEl = this.$('res-place');
    placeEl.classList.remove('gold', 'silver', 'bronze');
    if (place <= 3) placeEl.classList.add(['gold', 'silver', 'bronze'][place - 1]);
    this.$('res-num').textContent = String(place);
    this.$('res-suffix').textContent = ordinalSuffix(place);
    this.$('res-title').textContent = place === 1 ? 'Victory' : place <= 3 ? 'Podium' : 'Finished';
    this.$('res-time').textContent = `Time ${formatTime(p.finishTime)} · Best lap ${formatTime(p.bestLap)}`;
    this.$('res-badges').innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join('');
    this.updateStandings(race);
    this.show('results');
  }

  /** Live standings: rivals still racing show their gap until they cross the line. */
  updateStandings(race) {
    const list = this.$('res-standings');
    const leader = race.standings[0];
    const rows = race.standings.map((r) => {
      let t;
      if (r.finished) t = r === leader ? formatTime(r.finishTime) : `+${(r.finishTime - leader.finishTime).toFixed(2)}`;
      else t = 'racing…';
      return `<li class="${r.isPlayer ? 'me' : ''}"><span class="p">${r.place}</span><span class="c" style="background:${r.body}"></span><span>${r.name}</span><span class="t">${t}</span></li>`;
    });
    const html = rows.join('');
    if (html !== this._lastStandings) {
      list.innerHTML = html;
      this._lastStandings = html;
    }
  }
}
