import * as THREE from '../vendor/three.module.min.js';
import { CameraRig } from './camera.js';
import { PALETTE } from './config.js';
import { SpeedLines, Sparks } from './effects.js';
import { buildEnvironment } from './environment.js';
import { RacerModel } from './racerModel.js';
import * as TX from './textures.js';
import { buildTrackMeshes } from './trackMesh.js';

/**
 * Owns the renderer, scene and everything visual. Reads race state, never writes it.
 */
export class World {
  constructor(canvas, track, race) {
    this.track = track;
    this.race = race;
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    renderer.setClearColor(PALETTE.fog);
    this.renderer = renderer;

    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;
    this.frameTimes = [];
    this.goodWindows = 0;
    this.trial = null; // pending resolution drop being evaluated
    this.floor = 0; // lowest pixel ratio a drop is still worth trying from

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PALETTE.fog, 170, 1500);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(72, 1, 0.3, 6000);
    scene.add(camera);
    this.camera = camera;
    this.rig = new CameraRig(camera);

    scene.add(new THREE.HemisphereLight('#d6e4ff', '#c98a50', 2.1));
    const key = new THREE.DirectionalLight('#ffe2bd', 2.3);
    key.position.set(0.45, 0.8, 0.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#ffb27a', 0.9);
    rim.position.set(-0.3, 0.25, -0.9);
    scene.add(rim);

    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.trackView = buildTrackMeshes(track, aniso);
    scene.add(this.trackView.group);
    this.env = buildEnvironment(track);
    scene.add(this.env.group, this.env.sky);

    const glow = TX.glowTexture();
    const shadow = TX.shadowTexture();
    this.models = race.racers.map((r) => {
      const m = new RacerModel(r, glow, shadow);
      scene.add(m.root);
      return m;
    });
    this.playerModel = this.models.find((m) => m.racer.isPlayer);

    this.speedLines = new SpeedLines(camera);
    this.sparks = new Sparks(scene);

    this._frame = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
    this._fwd = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.target = { position: new THREE.Vector3(), forward: new THREE.Vector3(), up: new THREE.Vector3(), yawRate: 0, speed: 0, boost: 0 };
    this.boostVis = 0;
    this.lastTick = -1;

    this.resize();
    // Resizing clears the canvas, so redraw at once (nothing else renders while paused).
    window.addEventListener('resize', () => {
      this.resize();
      this.render();
    });
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.aspect = w / h;
  }

  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    this.resize();
    this.render();
  }

  /**
   * Lower or raise render resolution to hold frame rate. A drop is a trial that is kept
   * only if frames really got faster: under a fixed 30 fps cap (iOS Low Power Mode,
   * Android battery saver) they don't, so the drop is undone and not retried.
   */
  adaptQuality(frameMs) {
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length < 90) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    this.frameTimes.length = 0;
    if (this.trial) {
      if (p50 > this.trial.before * 0.88) {
        this.floor = this.trial.ratio;
        this.setPixelRatio(this.trial.ratio);
      }
      this.trial = null;
      return;
    }
    if (p50 > 21 && this.pixelRatio - 0.25 >= Math.max(0.75, this.floor)) {
      this.trial = { before: p50, ratio: this.pixelRatio };
      this.goodWindows = 0;
      this.setPixelRatio(this.pixelRatio - 0.25);
    } else if (p50 < 14) {
      this.goodWindows++;
      if (this.goodWindows >= 4 && this.pixelRatio < this.maxPixelRatio) {
        this.goodWindows = 0;
        this.setPixelRatio(Math.min(this.maxPixelRatio, this.pixelRatio + 0.25));
      }
    }
  }

  /** Craft forward direction in world space. */
  craftForward(craft, frame, out) {
    const ch = Math.cos(craft.heading);
    const sh = Math.sin(craft.heading);
    return out.copy(frame.t).multiplyScalar(ch).addScaledVector(frame.r, sh).normalize();
  }

  update(dt, { reducedMotion }) {
    const track = this.track;
    this.trackView.update(dt);
    // Craft events only mean something on frames where the race actually stepped.
    const fresh = this.race.tick !== this.lastTick;
    this.lastTick = this.race.tick;

    for (const m of this.models) {
      const c = m.racer.craft;
      track.frameAt(c.s, this._frame);
      m.update(dt, track, this._frame, reducedMotion);
      // Sparks at the wall contact point on impacts and while scraping.
      if (fresh && (c.events.wall > 2 || (c.scraping && c.speed > 25 && Math.random() < 0.5))) {
        const side = c.events.wallSide || c.wallSide;
        track.pointAt(c.s, c.x + side * 1.8, 0.6, this._tmp);
        this.craftForward(c, this._frame, this._dir).multiplyScalar(c.speed * 0.6);
        const n = c.events.wall > 2 ? Math.min(30, 6 + Math.round(c.events.wall)) : 2;
        this.sparks.emit(this._tmp, this._dir, n, 7);
      }
    }
    this.sparks.update(dt);

    // Camera target follows the player.
    const pc = this.race.player.craft;
    this.refreshTarget();
    const T = this.target;
    this.boostVis += ((pc.boost > 0 ? 1 : 0) - this.boostVis) * Math.min(1, dt * (pc.boost > 0 ? 8 : 2.5));
    T.boost = this.boostVis;
    this.rig.reducedMotion = reducedMotion;
    this.rig.update(dt, T, this.aspect);
    this.env.update(this.camera);
    const inChase = this.rig.mode === 'chase';
    this.speedLines.update(dt, inChase ? pc.speed : 0, this.boostVis, !reducedMotion);
  }

  /** Recompute the camera target from the player's current craft state. */
  refreshTarget() {
    const pc = this.race.player.craft;
    this.track.frameAt(pc.s, this._frame);
    const T = this.target;
    this.track.pointAt(pc.s, pc.x, 1.2, T.position);
    this.craftForward(pc, this._frame, T.forward);
    T.up.copy(this._frame.u);
    T.yawRate = pc.yawRate;
    T.speed = pc.speed;
    return T;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
