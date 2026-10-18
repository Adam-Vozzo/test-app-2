import * as THREE from '../vendor/three.module.min.js';
import { CAMERA } from './config.js';
import { clamp, damp, smoothstep } from './util.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Chase camera tuned for a tall portrait view, plus an orbit "showroom" mode for menus.
 * Mode switches blend smoothly instead of cutting.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.roll = 0;
    this.fov = CAMERA.fovBase;
    this.shake = 0;
    this.orbitAngle = 0.6;
    this.blend = 1;
    this.blendFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: CAMERA.fovBase };
    this.reducedMotion = false;
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._camUp = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  setMode(mode, { instant = false } = {}) {
    if (mode === this.mode && !instant) return;
    this.mode = mode;
    if (instant) {
      this.blend = 1;
    } else {
      this.blend = 0;
      this.blendFrom.pos.copy(this.camera.position);
      this.blendFrom.quat.copy(this.camera.quaternion);
      this.blendFrom.fov = this.camera.fov;
    }
  }

  /** Snap the smoothed chase state to the target (e.g. after a reset). */
  snap(target) {
    this.fwd.copy(target.forward);
    this.up.copy(WORLD_UP).lerp(target.up, CAMERA.trackUpBlend).normalize();
    this.roll = 0;
  }

  addShake(amount) {
    if (!this.reducedMotion) this.shake = Math.min(1.2, this.shake + amount);
  }

  /**
   * target: { position, forward, up, yawRate, speed, boost (0..1) }
   */
  update(dt, target, aspect) {
    const cam = this.camera;
    let fovTarget = CAMERA.fovBase;

    if (this.mode === 'chase') {
      this.fwd.lerp(target.forward, 1 - Math.exp(-CAMERA.headingLag * dt)).normalize();
      const upT = this._camUp.copy(WORLD_UP).lerp(target.up, CAMERA.trackUpBlend).normalize();
      this.up.lerp(upT, 1 - Math.exp(-CAMERA.upLag * dt)).normalize();
      const speedK = smoothstep(20, 100, target.speed);
      const dist = CAMERA.distance + speedK * 1.4;
      this._pos.copy(target.position).addScaledVector(this.fwd, -dist).addScaledVector(this.up, CAMERA.height);
      this._look.copy(target.position).addScaledVector(this.fwd, CAMERA.lookAhead).addScaledVector(this.up, CAMERA.lookHeight);
      this.roll = damp(this.roll, clamp(target.yawRate * CAMERA.rollFromYaw, -0.2, 0.2), 4, dt);
      fovTarget = CAMERA.fovBase + speedK * CAMERA.fovSpeed + target.boost * CAMERA.fovBoost;
    } else if (this.mode === 'orbit' || this.mode === 'finish') {
      const finish = this.mode === 'finish';
      this.orbitAngle += dt * (finish ? 0.32 : 0.16);
      const r = finish ? 13 : 14;
      const h = finish ? 4.5 : 6.5;
      const side = this._side.crossVectors(target.forward, target.up).normalize();
      this._pos
        .copy(target.position)
        .addScaledVector(target.forward, Math.cos(this.orbitAngle) * r)
        .addScaledVector(side, Math.sin(this.orbitAngle) * r)
        .addScaledVector(target.up, h);
      this._look.copy(target.position).addScaledVector(target.up, finish ? 1.2 : -2.2);
      this.roll = damp(this.roll, 0, 3, dt);
      fovTarget = CAMERA.fovBase - 6;
      this.up.copy(target.up);
    }

    // Shake = decaying impulse (wall hits) + a faint rumble at top speed. Off with reduced motion.
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const rumble = this.mode === 'chase' ? smoothstep(70, 110, target.speed) * CAMERA.shakeSpeed : 0;
    const amp = this.reducedMotion ? 0 : this.shake * this.shake + rumble;
    if (amp > 0.001) {
      this._pos.x += (Math.random() - 0.5) * amp * 0.9;
      this._pos.y += (Math.random() - 0.5) * amp * 0.7;
      this._pos.z += (Math.random() - 0.5) * amp * 0.9;
    }

    // Build the desired orientation.
    const camUp = this._camUp.copy(this.up).applyAxisAngle(this.fwd, this.roll);
    this._m.lookAt(this._pos, this._look, camUp);
    this._q.setFromRotationMatrix(this._m);

    // Wider screens keep a portrait-like horizontal field of view.
    const aspectK = aspect > 0.62 ? Math.atan(Math.tan((fovTarget * Math.PI) / 360) * (0.62 / aspect)) * (360 / Math.PI) : fovTarget;
    this.fov = damp(this.fov, aspectK, 4, dt);

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 1.1);
      const t = smoothstep(0, 1, this.blend);
      cam.position.lerpVectors(this.blendFrom.pos, this._pos, t);
      cam.quaternion.slerpQuaternions(this.blendFrom.quat, this._q, t);
      cam.fov = this.blendFrom.fov + (this.fov - this.blendFrom.fov) * t;
    } else {
      cam.position.copy(this._pos);
      cam.quaternion.copy(this._q);
      cam.fov = this.fov;
    }
    cam.updateProjectionMatrix();
  }
}
