import * as THREE from '../vendor/three.module.min.js';
import { clamp, mulberry32, smoothstep } from './util.js';

/** Streaks that rush past the camera at speed. Lives in camera space. */
export class SpeedLines {
  constructor(camera, count = 56) {
    this.count = count;
    this.rng = mulberry32(99);
    this.lines = [];
    const pos = new Float32Array(count * 4 * 3);
    const col = new Float32Array(count * 4 * 4);
    const idx = [];
    for (let i = 0; i < count; i++) {
      this.lines.push(this.spawn({}, true));
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      for (let k = 0; k < 4; k++) {
        const far = k < 2;
        col.set([1, 1, 1, far ? 0 : 1], (b + k) * 4);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    camera.add(this.mesh);
  }

  spawn(l, initial) {
    const r = this.rng;
    l.a = r() * Math.PI * 2;
    l.r = 2.6 + r() * 5.5;
    l.z = initial ? -5 - r() * 70 : -60 - r() * 25;
    l.w = 0.025 + r() * 0.03;
    return l;
  }

  update(dt, speed, boost, enabled) {
    const intensity = enabled ? clamp(smoothstep(50, 92, speed) * 0.55 + boost * 0.45, 0, 1) : 0;
    this.mat.opacity = intensity;
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    const pos = this.geo.attributes.position.array;
    const len = 2 + speed * 0.09 + boost * 4;
    for (let i = 0; i < this.count; i++) {
      const l = this.lines[i];
      l.z += speed * dt * 1.15;
      if (l.z > 1.5) this.spawn(l, false);
      const cx = Math.cos(l.a) * l.r;
      const cy = Math.sin(l.a) * l.r * 1.25; // portrait: stretch vertically
      const tx = -Math.sin(l.a) * l.w;
      const ty = Math.cos(l.a) * l.w;
      const z0 = l.z - len;
      const z1 = l.z;
      const b = i * 12;
      pos[b] = cx - tx;
      pos[b + 1] = cy - ty;
      pos[b + 2] = z0;
      pos[b + 3] = cx + tx;
      pos[b + 4] = cy + ty;
      pos[b + 5] = z0;
      pos[b + 6] = cx - tx;
      pos[b + 7] = cy - ty;
      pos[b + 8] = z1;
      pos[b + 9] = cx + tx;
      pos[b + 10] = cy + ty;
      pos[b + 11] = z1;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/** Pooled spark particles for wall scrapes and bumps. World space. */
export class Sparks {
  constructor(scene, count = 120) {
    this.count = count;
    this.next = 0;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.rng = mulberry32(42);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = 0;
  }

  /** Emit n sparks at p, thrown along dir (world units/s) with spread. */
  emit(p, dir, n, spread = 6) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = dir.x + (r() - 0.5) * spread;
      this.vel[i * 3 + 1] = dir.y + r() * spread * 0.8;
      this.vel[i * 3 + 2] = dir.z + (r() - 0.5) * spread;
      this.life[i] = 0.25 + r() * 0.35;
    }
    this.active = 1;
  }

  update(dt) {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 22 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = clamp(this.life[i] / 0.5, 0, 1);
      this.col[i * 4] = 1;
      this.col[i * 4 + 1] = 0.55 + t * 0.4;
      this.col[i * 4 + 2] = 0.2 + t * 0.5;
      this.col[i * 4 + 3] = t;
    }
    this.active = alive > 0 ? 1 : 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
