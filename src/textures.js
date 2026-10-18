import * as THREE from '../vendor/three.module.min.js';
import { mulberry32 } from './util.js';

// All textures are drawn procedurally on canvases: no image assets to load.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = false, srgb = true, aniso = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Road surface: dark panels, seams, centre dashes and thin guide lines. One tile = 16 m. */
export function roadTexture(aniso) {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#2a2f3b';
  g.fillRect(0, 0, 256, 512);
  // Subtle panel noise.
  const rnd = mulberry32(11);
  for (let i = 0; i < 1400; i++) {
    const v = 36 + Math.floor(rnd() * 14);
    g.fillStyle = `rgba(${v},${v + 4},${v + 14},0.35)`;
    g.fillRect(rnd() * 256, rnd() * 512, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  // Panel seams across the track.
  g.fillStyle = 'rgba(14,16,22,0.9)';
  for (let y = 0; y < 512; y += 128) g.fillRect(0, y, 256, 3);
  g.fillStyle = 'rgba(80,88,108,0.5)';
  for (let y = 0; y < 512; y += 128) g.fillRect(0, y + 3, 256, 1);
  // Lane separators: two dashed lines.
  g.fillStyle = 'rgba(233,236,245,0.85)';
  for (const x of [85, 171]) {
    g.fillRect(x - 3, 40, 6, 120);
    g.fillRect(x - 3, 296, 6, 120);
  }
  // Guide lines near the edges (left magenta, right cyan, matching the wall strips).
  g.fillStyle = 'rgba(255,63,164,0.55)';
  g.fillRect(16, 0, 3, 512);
  g.fillStyle = 'rgba(61,242,255,0.55)';
  g.fillRect(237, 0, 3, 512);
  return toTexture(c, { repeat: true, aniso });
}

/** Hazard curb that runs along both road edges. One tile = 8 m. */
export function curbTexture(aniso) {
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#f2efe8';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#e8483c';
  g.save();
  g.beginPath();
  g.rect(0, 0, 64, 256);
  g.clip();
  for (let y = -96; y < 256 + 96; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(64, y + 32);
    g.lineTo(64, y + 64);
    g.lineTo(0, y + 32);
    g.closePath();
    g.fill();
  }
  g.restore();
  return toTexture(c, { repeat: true, aniso });
}

/** Light strip segments for the wall tops: bright blocks with dark gaps. Tile = 6 m. */
export function stripTexture() {
  const [c, g] = canvas(16, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 16, 128);
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(0, 100, 16, 28);
  return toTexture(c, { repeat: true, srgb: true });
}

/** Animated speed-pad chevrons (scroll the texture offset). Tile = pad length. */
export function padTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#071a24';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#3df2ff';
  g.lineWidth = 6;
  g.strokeRect(5, -10, 118, 276);
  g.fillStyle = '#3df2ff';
  for (let i = 0; i < 3; i++) {
    const y = i * 85 + 10;
    g.beginPath();
    g.moveTo(14, y + 52);
    g.lineTo(64, y + 6);
    g.lineTo(114, y + 52);
    g.lineTo(114, y + 74);
    g.lineTo(64, y + 28);
    g.lineTo(14, y + 74);
    g.closePath();
    g.fill();
  }
  return toTexture(c, { repeat: true });
}

/** Corner warning board: black chevrons on amber, pointing right (mirror for left). */
export function chevronSignTexture() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#ffcc33';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#16120a';
  for (let i = 0; i < 3; i++) {
    const x = 28 + i * 72;
    g.beginPath();
    g.moveTo(x, 14);
    g.lineTo(x + 34, 14);
    g.lineTo(x + 74, 64);
    g.lineTo(x + 34, 114);
    g.lineTo(x, 114);
    g.lineTo(x + 40, 64);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = '#16120a';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 120);
  return toTexture(c);
}

export function checkerTexture() {
  const [c, g] = canvas(128, 32);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111318' : '#f4f4f4';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const t = toTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Soft dark ellipse used as a cheap contact shadow under each pod. */
export function shadowTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c, { srgb: false });
}

/** White radial glow, tinted per use via material colour (additive). */
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

/** Start gantry banner. */
export function bannerTexture(title) {
  const [c, g] = canvas(1024, 160);
  g.fillStyle = '#10131b';
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#ff3fa4';
  g.fillRect(0, 0, 1024, 10);
  g.fillStyle = '#3df2ff';
  g.fillRect(0, 150, 1024, 10);
  g.font = 'italic 700 104px "Chakra Petch", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(title, 512, 84);
  g.fillStyle = '#ffcc33';
  for (let i = 0; i < 6; i++) {
    g.fillRect(24 + i * 22, 64, 12, 36);
    g.fillRect(1024 - 36 - i * 22, 64, 12, 36);
  }
  return toTexture(c);
}

/** Vertical stripes for canyon rock: banded sandstone. */
export function strataTexture() {
  const [c, g] = canvas(8, 256);
  const rnd = mulberry32(5);
  let y = 0;
  while (y < 256) {
    const h = 6 + rnd() * 26;
    const v = 0.8 + rnd() * 0.2;
    g.fillStyle = `rgb(${Math.round(255 * v)},${Math.round(236 * v)},${Math.round(220 * v)})`;
    g.fillRect(0, y, 8, h);
    y += h;
  }
  return toTexture(c, { repeat: true });
}
