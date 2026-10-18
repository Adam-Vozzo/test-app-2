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

    const click = (id, fn) =>
      $(id).addEventListener('click', (e) => {
        e.preventDefault();
        this.h.onUiTap?.();
        fn();
      });
    click('btn-race', () => this.h.onRace());
    click('btn-settings', () => this.openSettings('title'));
    click('btn-ready-back', () => this.h.onQuit());
    click('btn-pause', () => this.h.onPause());
    click('btn-resume', () => this.h.onResume());
    click('btn-recenter', () => this.h.onRecenter());
    click('btn-restart', () => this.h.onRestart());
    click('btn-pause-settings', () => this.openSettings('pause'));
    click('btn-quit', () => this.h.onQuit());
    click('btn-settings-done', () => this.closeSettings());
    click('btn-again', () => this.h.onRestart());
    click('btn-menu', () => this.h.onQuit());

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
