import {
  ARM_Y, BARGE_HALF_WIDTH, BOOSTER_LENGTH, BOOSTER_WIDTH, COM_FROM_BOTTOM, HARDPOINT_FROM_BOTTOM,
  MOUNT_HALF_WIDTH, MOUNT_HEIGHT, TOWER_FACE_X, TOWER_HEIGHT, TOWER_WIDTH, type LevelDef,
} from '@booster/sim';
import type { Particles } from './particles.ts';
import type { Snapshot } from './view.ts';

/** Everything the renderer needs for one frame. */
export interface Frame {
  level: LevelDef;
  player: Snapshot;
  ghost: { snap: Snapshot; label: string } | null;
  /** Booster destroyed: don't draw it. */
  exploded: boolean;
  /** Seconds since a wobble catch started (render-only oscillation), or -1. */
  wobble: number;
  /** Seconds since a clean catch (little settle bounce), or -1. */
  caught: number;
  time: number;
  particles: Particles;
  /** Attract mode on the title screen: wider, calmer camera. */
  attract: boolean;
}

const BOTTOM = -COM_FROM_BOTTOM;
const TOP = BOOSTER_LENGTH - COM_FROM_BOTTOM;
const HALF = BOOSTER_WIDTH / 2;
const HARDPOINT = HARDPOINT_FROM_BOTTOM - COM_FROM_BOTTOM;
const ARM_LENGTH = TOWER_FACE_X + 10;

interface Cloud {
  x: number;
  y: number;
  r: number;
  puffs: [number, number, number][];
}

/**
 * Canvas 2D renderer. World drawing uses a transform with 1 unit = 1 m and
 * y pointing up, matching the sim; only the HUD works in screen pixels.
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  dpr = 1;
  // Camera (world metres) and zoom (pixels per metre); all smoothed.
  camX = -150;
  camY = 900;
  scale = 1;
  shake = 0;
  /** Full-screen flash on explosions, 1 -> 0. */
  flash = 0;
  /** Pixels at the bottom covered by touch controls; the camera frames above them. */
  bottomInset = 0;
  private wave: { x: number; y: number; t: number } | null = null;
  private clouds: Cloud[] = [];
  private stars: [number, number, number][] = [];
  private streaks: [number, number][] = [];
  private readonly puff: HTMLCanvasElement;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    // Cosmetic scenery: random but generated once, so it doesn't swim.
    for (let i = 0; i < 70; i++) {
      const puffs: [number, number, number][] = [];
      const r = 25 + Math.random() * 60;
      for (let k = 0; k < 6; k++) puffs.push([(Math.random() - 0.5) * r * 2.4, (Math.random() - 0.5) * r * 0.5, r * (0.45 + Math.random() * 0.5)]);
      this.clouds.push({ x: -2500 + Math.random() * 5000, y: 350 + Math.random() * 1700, r, puffs });
    }
    // One soft radial blob, reused (scaled) for every cloud puff.
    this.puff = document.createElement('canvas');
    this.puff.width = this.puff.height = 128;
    const pc = this.puff.getContext('2d')!;
    const grad = pc.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    pc.fillStyle = grad;
    pc.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 220; i++) this.stars.push([Math.random(), Math.random(), Math.random()]);
    for (let i = 0; i < 36; i++) this.streaks.push([Math.random(), Math.random()]);
    this.resize();
  }

  shockwave(x: number, y: number): void {
    this.wave = { x, y, t: 0 };
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  /** Smooth camera: follow the booster when high, frame booster + arms when close. */
  private updateCamera(f: Frame, dt: number): void {
    const p = f.player;
    const armX = 0;
    const armY = ARM_Y + p.deckY;
    const dist = Math.hypot(p.dx, p.dy);
    // 0 when near the tower, 1 when far away.
    const far = Math.min(1, Math.max(0, (dist - 50) / 450));
    const viewH = f.attract ? 260 + far * 220 : 170 + far * far * 300;
    // Fit the view height, but on a portrait phone also fit a minimum width
    // so the tower isn't cropped off the side.
    const visibleH = this.height - this.bottomInset;
    const targetScale = Math.min(visibleH / viewH, this.width / (viewH * 0.8));
    let tx = p.x + p.vx * 0.4 * far;
    let ty = p.y + p.vy * 0.25 * far;
    // Ease the framing toward the catch point on final approach.
    const k = (1 - far) * 0.55;
    tx = tx * (1 - k) + (armX + 8) * k;
    ty = ty * (1 - k) + (armY - 5) * k;
    // Never show much below the ground.
    ty = Math.max(ty, viewH * 0.36);
    const a = 1 - Math.exp(-dt * 4);
    this.camX += (tx - this.camX) * a;
    this.camY += (ty - this.camY) * a;
    this.scale += (targetScale - this.scale) * (1 - Math.exp(-dt * 2.5));
  }

  render(f: Frame, dt: number): void {
    this.updateCamera(f, dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const ctx = this.ctx;
    const { width: w, height: h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.drawSky(f);
    // World transform: x right, y up, metres.
    const s = this.scale;
    const shakeX = (Math.random() - 0.5) * this.shake * this.shake * 26;
    const shakeY = (Math.random() - 0.5) * this.shake * this.shake * 26;
    const cy = (h - this.bottomInset) / 2;
    ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (w / 2 - this.camX * s + shakeX), dpr * (cy + this.camY * s + shakeY));

    this.drawClouds(f, false);
    this.drawGround(f);
    this.drawTower(f, 'back');
    if (f.ghost) this.drawBooster(f.ghost.snap, f, true);
    f.particles.draw(ctx, f.level.night);
    if (!f.exploded) this.drawBooster(f.player, f, false);
    this.drawTower(f, 'front');
    this.drawClouds(f, true);
    if (this.wave) {
      // Expanding ring of compressed air: fast, then fading.
      this.wave.t += dt;
      const r = 8 + this.wave.t * 260;
      const a = Math.max(0, 0.5 - this.wave.t * 0.9);
      if (a <= 0) this.wave = null;
      else {
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(this.wave.x, this.wave.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawStreaks(f, dt);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,236,200,${this.flash * 0.7})`;
      ctx.fillRect(0, 0, w, h);
      this.flash = Math.max(0, this.flash - dt * 5);
    }
    if (f.ghost) this.drawGhostLabel(f.ghost.snap, f.ghost.label);
  }

  /** World -> CSS pixel coordinates. */
  toScreen(x: number, y: number): [number, number] {
    return [this.width / 2 + (x - this.camX) * this.scale, (this.height - this.bottomInset) / 2 - (y - this.camY) * this.scale];
  }

  private drawSky(f: Frame): void {
    const ctx = this.ctx;
    const alt = Math.max(0, Math.min(1, this.camY / 2200));
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    if (f.level.night) {
      g.addColorStop(0, '#02040b');
      g.addColorStop(1, mix('#0b1630', '#060b1a', alt));
    } else {
      g.addColorStop(0, mix('#4f8fd6', '#173f86', alt));
      g.addColorStop(1, mix('#cfe5f6', '#6aa1dc', alt));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    const starAlpha = f.level.night ? 0.9 : Math.max(0, alt - 0.75) * 1.2;
    if (starAlpha > 0) {
      for (const [sx, sy, b] of this.stars) {
        // Stars drift slowly with the camera for a hint of parallax.
        const x = (((sx * this.width * 3 - this.camX * 0.02) % this.width) + this.width) % this.width;
        const y = (((sy * this.height * 3 + this.camY * 0.02) % this.height) + this.height) % this.height;
        ctx.fillStyle = `rgba(255,255,255,${starAlpha * (0.3 + 0.7 * b) * (0.8 + 0.2 * Math.sin(f.time * 2 + b * 40))})`;
        ctx.fillRect(x, y, b > 0.8 ? 2 : 1, b > 0.8 ? 2 : 1);
      }
    }
  }

  private drawClouds(f: Frame, front: boolean): void {
    const ctx = this.ctx;
    ctx.globalAlpha = (front ? 0.3 : 0.75) * (f.level.night ? 0.35 : 1);
    for (let i = 0; i < this.clouds.length; i++) {
      if ((i % 4 === 0) !== front) continue; // a quarter of clouds pass in front of the booster
      const c = this.clouds[i]!;
      if (Math.abs(c.y - this.camY) > this.height / this.scale + 200) continue;
      for (const [px, py, r] of c.puffs) {
        // Flattened puffs read as cumulus rather than bubbles.
        ctx.drawImage(this.puff, c.x + px - r * 1.6, c.y + py - r * 0.8, r * 3.2, r * 1.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawGround(f: Frame): void {
    const ctx = this.ctx;
    const left = this.camX - this.width / this.scale;
    const right = this.camX + this.width / this.scale;
    const deck = f.player.deckY;
    if (f.level.sea) {
      // Water with two layers of travelling waves.
      ctx.fillStyle = f.level.night ? '#04101f' : '#1d4f7a';
      ctx.fillRect(left, -400, right - left, 400);
      ctx.fillStyle = f.level.night ? '#0a2340' : '#2f6d9e';
      ctx.beginPath();
      ctx.moveTo(left, -400);
      for (let x = left; x <= right; x += 6) ctx.lineTo(x, 0.9 * Math.sin(x * 0.05 + f.time * 1.3) + 0.6 * Math.sin(x * 0.11 - f.time * 2.1));
      ctx.lineTo(right, -400);
      ctx.fill();
      // Barge hull.
      ctx.fillStyle = '#2b3038';
      ctx.fillRect(-BARGE_HALF_WIDTH, deck - 9, BARGE_HALF_WIDTH * 2, 9);
      ctx.fillStyle = '#d8b13a';
      for (let x = -BARGE_HALF_WIDTH; x < BARGE_HALF_WIDTH; x += 8) ctx.fillRect(x, deck - 1, 4, 1);
      ctx.fillStyle = '#1b1f25';
      ctx.fillRect(-BARGE_HALF_WIDTH, deck - 9, BARGE_HALF_WIDTH * 2, 1.2);
    } else {
      // Distant ridges (parallax), then ground and pad.
      ctx.fillStyle = f.level.night ? '#0a1222' : '#7d9bb2';
      ctx.beginPath();
      ctx.moveTo(left, 0);
      for (let x = left; x <= right; x += 20) {
        const px = x - this.camX * 0.0;
        ctx.lineTo(x, 28 + 22 * Math.sin(px * 0.004) + 14 * Math.sin(px * 0.013 + 1));
      }
      ctx.lineTo(right, 0);
      ctx.fill();
      ctx.fillStyle = f.level.night ? '#0d1410' : '#5f7d4f';
      ctx.fillRect(left, -300, right - left, 300);
      ctx.fillStyle = f.level.night ? '#2a2e33' : '#b9b5aa';
      ctx.fillRect(-60, -1.5, 120, 1.5);
    }
    // Launch mount under the arms.
    ctx.fillStyle = '#3c434d';
    ctx.fillRect(-MOUNT_HALF_WIDTH, deck + MOUNT_HEIGHT - 3, MOUNT_HALF_WIDTH * 2, 3);
    for (const lx of [-MOUNT_HALF_WIDTH, MOUNT_HALF_WIDTH - 2]) ctx.fillRect(lx, deck, 2, MOUNT_HEIGHT);
    ctx.fillStyle = '#596270';
    ctx.fillRect(-MOUNT_HALF_WIDTH - 1, deck + MOUNT_HEIGHT - 0.6, MOUNT_HALF_WIDTH * 2 + 2, 0.6);
  }

  private drawTower(f: Frame, layer: 'back' | 'front'): void {
    const ctx = this.ctx;
    const deck = f.player.deckY;
    const x0 = TOWER_FACE_X;
    const x1 = TOWER_FACE_X + TOWER_WIDTH;
    const armY = ARM_Y + deck;
    const closed = f.player.armT;
    // Arms swing in a horizontal plane; seen from the side they look shorter
    // when open (foreshortened by cos of the open angle).
    const openAngle = (1 - closed) * 1.25;
    const reach = ARM_LENGTH * Math.cos(openAngle);

    if (layer === 'back') {
      // Lattice tower.
      ctx.fillStyle = f.level.night ? '#141a24' : '#3a4352';
      ctx.fillRect(x0, deck, TOWER_WIDTH, TOWER_HEIGHT);
      ctx.strokeStyle = f.level.night ? '#232c3a' : '#556073';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let y = deck; y < deck + TOWER_HEIGHT; y += 10) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y + 10);
        ctx.moveTo(x1, y);
        ctx.lineTo(x0, y + 10);
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
      // Crown, antenna and beacon.
      ctx.fillStyle = '#2a313c';
      ctx.fillRect(x0 - 1, deck + TOWER_HEIGHT, TOWER_WIDTH + 2, 3);
      ctx.fillRect(x0 + TOWER_WIDTH / 2 - 0.4, deck + TOWER_HEIGHT, 0.8, 14);
      const blink = Math.sin(f.time * 4) > 0.3;
      if (blink) {
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath();
        ctx.arc(x0 + TOWER_WIDTH / 2, deck + TOWER_HEIGHT + 14, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      // Arm carriage on the tower face.
      ctx.fillStyle = '#4b5566';
      ctx.fillRect(x0 - 2, armY - 4, 6, 9);
      this.drawArm(x0, armY + 0.8, reach, '#59606b', 0.85);
      if (f.level.night) this.drawFloodlights(f, x0, deck);
    } else {
      this.drawArm(x0, armY - 0.8, reach, '#8a93a1', 1);
      // Catch target: a faint marker where the hardpoints need to be.
      const p = f.player;
      if (closed === 0 && Math.hypot(p.dx, p.dy) < 160) {
        const lined = Math.abs(p.dx) < 1.8 && p.dy > -1.5 && p.dy < 2.5;
        ctx.strokeStyle = lined ? 'rgba(80,255,150,0.9)' : 'rgba(255,210,90,0.7)';
        ctx.lineWidth = 0.35;
        ctx.setLineDash([1.2, 1.2]);
        ctx.strokeRect(-HALF - 1.5, armY - 1.5, BOOSTER_WIDTH + 3, 4);
        ctx.setLineDash([]);
      }
    }
  }

  private drawArm(x0: number, y: number, reach: number, color: string, alpha: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y - 1.4);
    ctx.lineTo(x0 - reach, y - 0.7);
    ctx.lineTo(x0 - reach, y + 0.9);
    ctx.lineTo(x0, y + 1.6);
    ctx.closePath();
    ctx.fill();
    // Catch pad at the tip.
    ctx.fillStyle = '#d8a43a';
    ctx.fillRect(x0 - reach - 0.4, y - 0.9, 2.2, 2);
    ctx.globalAlpha = 1;
  }

  private drawFloodlights(f: Frame, x0: number, deck: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const ly of [40, 120]) {
      const g = ctx.createRadialGradient(x0, deck + ly, 0, x0, deck + ly, 90);
      g.addColorStop(0, 'rgba(255,240,200,0.20)');
      g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, deck + ly);
      ctx.arc(x0, deck + ly, 90, Math.PI * 0.75, Math.PI * 1.15);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,245,215,0.9)';
      ctx.fillRect(x0 - 1, deck + ly - 0.6, 1.4, 1.2);
    }
    ctx.globalCompositeOperation = 'source-over';
    void f;
  }

  private drawBooster(p: Snapshot, f: Frame, ghost: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    let angle = p.angle;
    let x = p.x;
    let y = p.y;
    if (!ghost && f.wobble >= 0) {
      // Decaying sway: the tower absorbing a hard catch.
      const k = Math.exp(-f.wobble * 1.6);
      angle += Math.sin(f.wobble * 11) * 0.09 * k;
      x += Math.sin(f.wobble * 11 + 1) * 0.6 * k;
    }
    if (!ghost && f.caught >= 0) {
      // Settle: a small drop onto the arms, then the clamps pull it upright.
      y -= Math.sin(Math.min(1, f.caught * 4) * Math.PI) * 0.35;
      angle *= Math.exp(-f.caught * 3);
    }
    ctx.translate(x, y);
    // Positive sim angle leans the nose right (clockwise); canvas rotate is
    // counter-clockwise in this y-up frame, hence the minus.
    ctx.rotate(-angle);
    if (ghost) ctx.globalAlpha = 0.33;

    if (p.thrust > 0.01) this.drawPlume(p, f, ghost);
    if (!ghost) this.drawReentryGlow(p);

    // Body: brushed steel, darker toward the engines from soot.
    const body = ctx.createLinearGradient(-HALF, 0, HALF, 0);
    if (ghost) {
      body.addColorStop(0, '#5fd4ff');
      body.addColorStop(1, '#2a8fd0');
    } else if (f.level.night) {
      body.addColorStop(0, '#6c737d');
      body.addColorStop(0.35, '#b9c0ca');
      body.addColorStop(1, '#4a5058');
    } else {
      body.addColorStop(0, '#9aa3ae');
      body.addColorStop(0.35, '#eef1f5');
      body.addColorStop(0.7, '#c3c9d1');
      body.addColorStop(1, '#7d858f');
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-HALF, BOTTOM);
    ctx.lineTo(-HALF, TOP - 4);
    ctx.quadraticCurveTo(-HALF, TOP, 0, TOP);
    ctx.quadraticCurveTo(HALF, TOP, HALF, TOP - 4);
    ctx.lineTo(HALF, BOTTOM);
    ctx.closePath();
    ctx.fill();
    if (!ghost) {
      const soot = ctx.createLinearGradient(0, BOTTOM, 0, BOTTOM + 26);
      soot.addColorStop(0, 'rgba(25,22,20,0.75)');
      soot.addColorStop(1, 'rgba(25,22,20,0)');
      ctx.fillStyle = soot;
      ctx.fillRect(-HALF, BOTTOM, BOOSTER_WIDTH, 26);
      // Panel seams.
      ctx.strokeStyle = 'rgba(60,66,75,0.35)';
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      for (let yy = BOTTOM + 7; yy < TOP - 4; yy += 7) {
        ctx.moveTo(-HALF, yy);
        ctx.lineTo(HALF, yy);
      }
      ctx.stroke();
      // Catch hardpoints.
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(-HALF - 0.8, HARDPOINT - 0.6, 1.4, 1.6);
      ctx.fillRect(HALF - 0.6, HARDPOINT - 0.6, 1.4, 1.6);
    }
    // Grid fins: deflect with the steering command.
    const finY = TOP - 7;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * HALF, finY);
      ctx.rotate(side * p.steer * 0.35);
      ctx.fillStyle = ghost ? '#5fd4ff' : '#3d434c';
      ctx.fillRect(side > 0 ? 0 : -3.4, -1.2, 3.4, 2.4);
      ctx.strokeStyle = ghost ? '#bdefff' : '#6f7884';
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        const fx = (side > 0 ? 0 : -3.4) + k * 0.85;
        ctx.moveTo(fx, -1.2);
        ctx.lineTo(fx, 1.2);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Engine bells.
    ctx.fillStyle = ghost ? '#2a8fd0' : '#24272c';
    for (const ex of [-2.8, 0, 2.8]) {
      ctx.beginPath();
      ctx.moveTo(ex - 0.9, BOTTOM);
      ctx.lineTo(ex + 0.9, BOTTOM);
      ctx.lineTo(ex + 1.3, BOTTOM - 2.4);
      ctx.lineTo(ex - 1.3, BOTTOM - 2.4);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPlume(p: Snapshot, f: Frame, ghost: boolean): void {
    const ctx = this.ctx;
    const t = p.thrust;
    const flicker = 0.9 + 0.1 * Math.sin(f.time * 53) + 0.06 * Math.sin(f.time * 31);
    const len = (12 + 46 * t) * flicker;
    const base = BOTTOM - 2.4;
    ctx.globalCompositeOperation = 'lighter';
    const outer = ctx.createLinearGradient(0, base, 0, base - len);
    outer.addColorStop(0, ghost ? 'rgba(120,220,255,0.6)' : 'rgba(255,190,90,0.9)');
    outer.addColorStop(0.4, ghost ? 'rgba(80,160,255,0.3)' : 'rgba(255,110,30,0.55)');
    outer.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(-4.2, base);
    ctx.quadraticCurveTo(-6.5 - 3 * t, base - len * 0.45, 0, base - len);
    ctx.quadraticCurveTo(6.5 + 3 * t, base - len * 0.45, 4.2, base);
    ctx.fill();
    // Hot core with shock diamonds.
    const core = ctx.createLinearGradient(0, base, 0, base - len * 0.6);
    core.addColorStop(0, 'rgba(255,255,240,0.95)');
    core.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(-2.5, base);
    ctx.lineTo(0, base - len * 0.6);
    ctx.lineTo(2.5, base);
    ctx.fill();
    if (!ghost) {
      for (let k = 1; k <= 3; k++) {
        const dy = base - k * len * 0.13;
        ctx.fillStyle = `rgba(255,255,255,${0.35 * t})`;
        ctx.beginPath();
        ctx.ellipse(0, dy, 1.6 - k * 0.3, 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Glow halo.
      const halo = ctx.createRadialGradient(0, base - 4, 0, 0, base - 4, 30 + 30 * t);
      halo.addColorStop(0, `rgba(255,160,60,${0.35 * t})`);
      halo.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, base - 4, 30 + 30 * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Falling engine-first at high dynamic pressure heats the base: draw a plasma glow. */
  private drawReentryGlow(p: Snapshot): void {
    const heat = Math.max(0, Math.min(1, (p.q - 4000) / 7000)) * (p.engineOn ? 0.3 : 1);
    if (heat <= 0) return;
    const ctx = this.ctx;
    // Normal blending: additive orange on a bright day sky washes out to pink.
    const g = ctx.createRadialGradient(0, BOTTOM - 1, 0, 0, BOTTOM - 1, 22);
    g.addColorStop(0, `rgba(255,236,170,${0.95 * heat})`);
    g.addColorStop(0.35, `rgba(255,140,40,${0.75 * heat})`);
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, BOTTOM - 1, 18, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bow-shock sheath up the sides.
    ctx.strokeStyle = `rgba(255,150,70,${0.45 * heat})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-HALF - 1.4, BOTTOM + 14);
    ctx.quadraticCurveTo(-HALF - 2, BOTTOM - 4, 0, BOTTOM - 5);
    ctx.quadraticCurveTo(HALF + 2, BOTTOM - 4, HALF + 1.4, BOTTOM + 14);
    ctx.stroke();
  }

  /** Speed streaks: screen-space lines moving with the relative airflow. */
  private drawStreaks(f: Frame, dt: number): void {
    const p = f.player;
    const relX = p.wind - p.vx;
    const relY = -p.vy;
    const speed = Math.hypot(relX, relY);
    if (speed < 4) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const px = Math.min(this.scale, 3);
    const alpha = Math.min(0.22, speed / 450) * (f.level.night ? 0.6 : 1);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const lx = (relX / speed) * Math.min(80, speed * 0.6);
    const ly = (-relY / speed) * Math.min(80, speed * 0.6);
    for (const st of this.streaks) {
      st[0] = (st[0] + (relX * px * dt) / w + 1) % 1;
      st[1] = (st[1] - (relY * px * dt) / h + 1) % 1;
      const x = st[0] * w;
      const y = st[1] * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x - lx * 0.3, y - ly * 0.3);
    }
    ctx.stroke();
  }

  private drawGhostLabel(p: Snapshot, label: string): void {
    const [sx, rawY] = this.toScreen(p.x, p.y + TOP + 6);
    const sy = Math.max(80, rawY); // keep clear of the HUD title
    const ctx = this.ctx;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(140,225,255,0.85)';
    ctx.fillText(label, sx, sy);
  }
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
