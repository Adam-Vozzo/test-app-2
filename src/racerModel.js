import * as THREE from '../vendor/three.module.min.js';
import { PHYSICS } from './config.js';
import { mergeGeometries } from './trackMesh.js';
import { clamp, damp } from './util.js';

// Blockout pod racer: two engines joined by energy binders, towing a cockpit on cables.
// Local frame: forward = -Z, up = +Y, right = +X. Origin sits on the track surface; the
// body floats at hover height above it.

const ENGINE_X = 1.45;
const ENGINE_Z = -2.0;
const COCKPIT_Z = 3.0;

let shared = null;
function sharedAssets(glowTexture, shadowTexture) {
  if (shared) return shared;
  shared = {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    cable: new THREE.MeshLambertMaterial({ color: '#1b1d24' }),
    flameGeo: (() => {
      const g = new THREE.ConeGeometry(0.34, 1, 8, 1, true);
      g.rotateX(Math.PI / 2); // tip towards +Z (backwards)
      g.translate(0, 0, 0.5);
      return g;
    })(),
    binderGeo: new THREE.BoxGeometry(ENGINE_X * 2 - 0.9, 0.07, 0.07),
    cableGeo: (() => {
      const g = new THREE.BoxGeometry(0.07, 0.07, 1);
      g.translate(0, 0, 0.5);
      return g;
    })(),
    shadowGeo: (() => {
      const g = new THREE.PlaneGeometry(5.4, 10.5);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.06, 0.4);
      return g;
    })(),
    shadowMat: new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
    glowTexture,
  };
  return shared;
}

/** Add a part with a flat vertex colour to the list, after transforming it. */
function part(list, geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) {
    col[i] = c.r;
    col[i + 1] = c.g;
    col[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  list.push(g);
}

function engineGeometry(body, accent, side) {
  const parts = [];
  const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg).rotateX(Math.PI / 2);
  // Main nacelle (front narrower, like a turbine intake).
  part(parts, cyl(0.52, 0.44, 3.4), body, { pos: [0, 0, 0] });
  part(parts, cyl(0.6, 0.52, 0.42), accent, { pos: [0, 0, -1.9] }); // intake lip
  part(parts, new THREE.CircleGeometry(0.46, 8), '#0b0d12', { pos: [0, 0, -2.12], rot: [0, Math.PI, 0] }); // intake mouth
  part(parts, cyl(0.38, 0.47, 0.34), '#24272f', { pos: [0, 0, 1.86] }); // nozzle
  // Vertical fin and a side stripe facing outwards.
  part(parts, new THREE.BoxGeometry(0.09, 0.72, 1.3), accent, { pos: [0, 0.62, 0.55], rot: [-0.25, 0, 0] });
  part(parts, new THREE.BoxGeometry(0.08, 0.16, 2.6), accent, { pos: [side * 0.47, 0.05, 0.1] });
  // Little stabiliser under the engine.
  part(parts, new THREE.BoxGeometry(0.9, 0.06, 0.6), '#24272f', { pos: [side * 0.25, -0.5, 0.9] });
  return mergeGeometries(parts);
}

function cockpitGeometry(body, accent) {
  const parts = [];
  // Hull: a box tapered at the front.
  const hull = new THREE.BoxGeometry(1.15, 0.72, 2.3, 1, 1, 1);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) < 0) {
      p.setX(i, p.getX(i) * 0.55);
      p.setY(i, p.getY(i) * 0.7 - 0.08);
    }
  }
  part(parts, hull, body);
  part(parts, new THREE.BoxGeometry(0.72, 0.32, 1.0), '#16263a', { pos: [0, 0.46, -0.05] }); // canopy
  part(parts, new THREE.BoxGeometry(0.1, 0.55, 0.7), accent, { pos: [0, 0.55, 0.85], rot: [-0.4, 0, 0] }); // tail fin
  part(parts, new THREE.BoxGeometry(1.3, 0.12, 0.5), accent, { pos: [0, -0.18, 0.95] }); // rear spoiler
  return mergeGeometries(parts);
}

export class RacerModel {
  constructor(racer, glowTexture, shadowTexture) {
    const A = sharedAssets(glowTexture, shadowTexture);
    this.racer = racer;
    this.root = new THREE.Group();
    this.root.name = `racer-${racer.name}`;
    this.body = new THREE.Group();
    this.root.add(this.body);

    const shadow = new THREE.Mesh(A.shadowGeo, A.shadowMat);
    shadow.renderOrder = 1;
    this.root.add(shadow);

    this.engines = [-1, 1].map((side) => {
      const mesh = new THREE.Mesh(engineGeometry(racer.body, racer.accent, side), A.solid);
      mesh.position.set(side * ENGINE_X, 0, ENGINE_Z);
      this.body.add(mesh);
      return mesh;
    });

    // Energy binders between the engines (additive, pulsing).
    const binderColor = new THREE.Color(racer.isPlayer ? '#8fe9ff' : '#ffc4f0');
    this.binderMat = new THREE.MeshBasicMaterial({
      color: binderColor,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const z of [ENGINE_Z - 1.0, ENGINE_Z + 0.6]) {
      const b = new THREE.Mesh(A.binderGeo, this.binderMat);
      b.position.set(0, 0.05, z);
      this.body.add(b);
    }
    this.binderGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: A.glowTexture,
        color: binderColor,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.5,
      }),
    );
    this.binderGlow.scale.set(3.4, 1.1, 1);
    this.binderGlow.position.set(0, 0.05, ENGINE_Z - 0.2);
    this.body.add(this.binderGlow);

    // Exhaust flames + glow.
    this.flameMat = new THREE.MeshBasicMaterial({
      color: '#ffb347',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });
    this.flames = this.engines.map((engine) => {
      const f = new THREE.Mesh(A.flameGeo, this.flameMat);
      f.position.set(engine.position.x, 0, engine.position.z + 2.0);
      this.body.add(f);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: A.glowTexture,
          color: '#ffb35c',
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      glow.position.set(engine.position.x, 0, engine.position.z + 2.2);
      glow.scale.setScalar(2.2);
      this.body.add(glow);
      return { mesh: f, glow };
    });

    this.cockpit = new THREE.Mesh(cockpitGeometry(racer.body, racer.accent), A.solid);
    this.cockpit.position.set(0, 0.05, COCKPIT_Z);
    this.body.add(this.cockpit);

    this.cables = [-1, 1].map(() => {
      const c = new THREE.Mesh(A.cableGeo, A.cable);
      this.body.add(c);
      return c;
    });

    this.phase = racer.id * 1.7;
    this.time = 0;
    this.roll = 0;
    this.pitch = 0;
    this.swing = 0;
    this.prevSpeed = 0;
    this.throttleVis = 0;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  /** Place the model on the track and animate it. */
  update(dt, track, frame, reducedMotion) {
    const c = this.racer.craft;
    this.time += dt;
    // Root sits on the track surface, yawed by the craft heading.
    track.pointAt(c.s, c.x, 0, this.root.position);
    const ch = Math.cos(c.heading);
    const sh = Math.sin(c.heading);
    const fwd = this._a.copy(frame.t).multiplyScalar(ch).addScaledVector(frame.r, sh);
    const right = this._b.copy(frame.r).multiplyScalar(ch).addScaledVector(frame.t, -sh);
    RacerModel._m.makeBasis(right, frame.u, fwd.negate());
    this.root.quaternion.setFromRotationMatrix(RacerModel._m);

    // Bank into turns, pitch with acceleration, hover bob.
    const accel = dt > 0 ? (c.forwardSpeed - this.prevSpeed) / dt : 0;
    this.prevSpeed = c.forwardSpeed;
    this.roll = damp(this.roll, clamp(-c.yawRate * 0.42 - c.slip * 0.012, -0.65, 0.65), 7, dt);
    this.pitch = damp(this.pitch, clamp(accel * 0.0035, -0.07, 0.09), 5, dt);
    const bob = reducedMotion ? 0 : Math.sin(this.time * 2.4 + this.phase) * 0.07;
    this.body.position.y = PHYSICS.hoverHeight + bob;
    this.body.rotation.set(this.pitch, 0, this.roll);

    // Engines jostle independently; it sells the "barely tamed" podracer feel.
    const speedK = clamp(c.speed / 90, 0, 1);
    for (let i = 0; i < 2; i++) {
      const e = this.engines[i];
      const w = reducedMotion ? 0 : 0.012 + speedK * 0.02;
      e.rotation.z = Math.sin(this.time * (13 + i * 3.1) + this.phase) * w;
      e.position.y = Math.sin(this.time * (9 + i * 2.3) + this.phase) * w * 2;
    }

    // Cockpit swings out of corners on its cables.
    const lateralAccel = c.yawRate * c.forwardSpeed;
    this.swing = damp(this.swing, clamp(-lateralAccel * 0.012, -1.1, 1.1), 3.5, dt);
    this.cockpit.position.x = this.swing;
    this.cockpit.rotation.y = this.swing * 0.12;
    this.cockpit.rotation.z = -this.swing * 0.1;
    // Cables are oriented in body space (world matrices are a frame stale at this point).
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const cable = this.cables[i];
      const from = this._a.set(side * (ENGINE_X - 0.42), 0, ENGINE_Z + 1.1);
      const to = this._b.set(this.swing + side * 0.36, 0.08, COCKPIT_Z - 1.0);
      cable.position.copy(from);
      const len = to.sub(from).length();
      cable.quaternion.setFromUnitVectors(RacerModel._z, to.divideScalar(len));
      cable.scale.z = len;
    }

    // Exhaust and binder.
    this.throttleVis = damp(this.throttleVis, this.racer.throttle, 10, dt);
    const boost = c.boost > 0 ? 1 : 0;
    const flicker = 0.85 + Math.sin(this.time * 47 + this.phase) * 0.08 + Math.sin(this.time * 31) * 0.07;
    const len = (0.6 + this.throttleVis * 1.9 + boost * 2.2) * flicker;
    for (const f of this.flames) {
      f.mesh.scale.set(1 + boost * 0.25, 1 + boost * 0.25, len);
      f.glow.scale.setScalar((1.6 + this.throttleVis * 1.2 + boost * 1.5) * flicker);
    }
    this.flameMat.color.set(boost ? '#9ff3ff' : '#ffb347');
    this.binderMat.opacity = 0.55 + Math.sin(this.time * 22 + this.phase) * 0.25 + Math.random() * 0.2;
    this.binderGlow.material.opacity = 0.25 + this.throttleVis * 0.35;
  }
}
RacerModel._m = new THREE.Matrix4();
RacerModel._z = new THREE.Vector3(0, 0, 1);
