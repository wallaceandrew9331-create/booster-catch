import { ARM_Y, AUTO_CLAMP, DEG, DRY_MASS, DT, G, MAX_THRUST, MIN_THROTTLE, type LevelDef, type SimState } from '@booster/sim';
import type { Renderer } from './scene.ts';
import type { Snapshot } from './view.ts';

export interface HudInfo {
  sim: SimState;
  snap: Snapshot;
  level: LevelDef;
  modeLabel: string;
  best: number | null;
  ghostLabel: string | null;
  replaying: boolean;
  touch: boolean;
}

const GREEN = '#5dffa0';
const AMBER = '#ffcf5a';
const RED = '#ff5d5d';
const DIM = 'rgba(220,232,255,0.55)';
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

/** Screen-space heads-up display, drawn on the same canvas after the world. */
export function drawHud(r: Renderer, h: HudInfo): void {
  const ctx = r.ctx;
  const { width: w, height: hgt } = r;
  const s = h.sim;
  const p = h.snap;
  const compact = w < 640;
  const pad = compact ? 10 : 18;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // --- Top-left: flight data -----------------------------------------------
  // HGT is the hardpoints' height above the catch arms, the number that matters.
  const alt = Math.max(0, p.dy);
  const rows: [string, string, string][] = [
    ['HGT', alt > 999 ? `${(alt / 1000).toFixed(2)} km` : `${alt.toFixed(0)} m`, '#e8f0ff'],
    ['V↓', `${(-p.vyRel).toFixed(1)} m/s`, limitColor(Math.abs(p.vyRel), AUTO_CLAMP.vy)],
    ['V→', `${p.vx.toFixed(1)} m/s`, limitColor(Math.abs(p.vx), AUTO_CLAMP.vx)],
    ['TILT', `${(p.angle / DEG).toFixed(1)}°`, limitColor(Math.abs(p.angle / DEG), AUTO_CLAMP.tilt)],
    ['ΔX', `${p.dx.toFixed(1)} m`, limitColor(Math.abs(p.dx), AUTO_CLAMP.dx)],
  ];
  panel(ctx, pad - 6, pad - 6, compact ? 132 : 158, rows.length * (compact ? 18 : 21) + 10);
  rows.forEach(([label, value, color], i) => {
    const y = pad + 12 + i * (compact ? 18 : 21);
    ctx.font = `600 ${compact ? 10 : 11}px ${FONT}`;
    ctx.fillStyle = DIM;
    ctx.fillText(label, pad, y);
    ctx.font = `700 ${compact ? 13 : 15}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(value, pad + (compact ? 120 : 146), y);
    ctx.textAlign = 'left';
  });

  // --- Top-center: mode, timer, best ---------------------------------------
  ctx.textAlign = 'center';
  ctx.font = `700 ${compact ? 12 : 14}px ${FONT}`;
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText(h.replaying ? `▶ REPLAY · ${h.modeLabel}` : h.modeLabel, w / 2, pad + 10);
  ctx.font = `600 ${compact ? 11 : 12}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = DIM;
  const time = (s.tick * DT).toFixed(1);
  ctx.fillText(`T+${time}s${h.best ? `   BEST ${h.best}` : ''}`, w / 2, pad + 27);
  if (h.ghostLabel) {
    ctx.fillStyle = 'rgba(140,225,255,0.8)';
    ctx.fillText(`ghost: ${h.ghostLabel}`, w / 2, pad + 43);
  }

  // --- Top-right: wind -----------------------------------------------------
  const wx = w - pad - 60;
  const wy = pad + 20;
  panel(ctx, wx - 54, pad - 6, 120, 56);
  ctx.font = `600 ${compact ? 10 : 11}px ${FONT}`;
  ctx.fillStyle = DIM;
  ctx.textAlign = 'left';
  ctx.fillText('WIND', wx - 46, pad + 10);
  ctx.font = `700 14px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = Math.abs(p.wind) > 7 ? AMBER : '#e8f0ff';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.abs(p.wind).toFixed(1)}`, wx + 58, pad + 10);
  arrow(ctx, wx + 6, wy + 14, p.wind * 4.2, Math.abs(p.wind) > 7 ? AMBER : '#cfe0ff');

  // --- Bottom-left: engine block ------------------------------------------
  const by = hgt - pad - (h.touch ? 150 : 0);
  const bx = pad;
  panel(ctx, bx - 6, by - 92, 190, 98);
  bar(ctx, bx, by - 72, 150, 10, s.throttleCmd, s.engineOn ? '#ffb347' : '#6d7787', 'THROTTLE', `${Math.round(Math.max(s.engineOn ? MIN_THROTTLE : 0, s.throttleCmd) * 100)}%`);
  // Minimum-throttle floor (dim) and the hover throttle for the current mass (bright).
  const mass = DRY_MASS + s.fuel;
  const hover = Math.min(1, (G * mass) / MAX_THRUST);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(bx, by - 72, 150 * MIN_THROTTLE, 10);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx + 150 * hover - 1, by - 76, 2, 18);
  const fuelFrac = s.fuel / h.level.fuel;
  bar(ctx, bx, by - 36, 150, 10, fuelFrac, fuelFrac < 0.2 ? RED : '#59c3ff', 'FUEL', `${Math.round(fuelFrac * 100)}%`);
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = s.engineOn && !s.outcome ? '#ffb347' : DIM;
  const engineLabel = s.outcome
    ? s.outcome.score > 0 ? 'SECURED' : 'ENGINE OFF'
    : s.engineOn ? (s.spool < 1 ? 'IGNITION…' : 'ENGINE ON') : s.fuel <= 0 ? 'NO FUEL' : 'ENGINE OFF';
  ctx.fillText(engineLabel, bx, by - 6);
  ctx.fillStyle = DIM;
  ctx.textAlign = 'right';
  ctx.fillText('RELIGHTS', bx + 128, by - 6);
  for (let i = 0; i < h.level.relights; i++) {
    ctx.fillStyle = i < s.relightsLeft ? '#ffb347' : 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(bx + 138 + i * 11, by - 10, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Burn cue ------------------------------------------------------------
  // Stopping distance at full throttle: near terminal velocity drag roughly
  // cancels gravity, so deceleration is about thrust/mass. New players don't
  // know when to light the engine; this tells them, with some margin.
  if (!s.engineOn && !s.outcome && p.vyRel < -25 && s.relightsLeft > 0 && s.fuel > 0) {
    const stop = (p.vyRel * p.vyRel) / (2 * (MAX_THRUST / mass));
    const spool = -p.vyRel * 0.5; // metres fallen while the engine spools up
    const need = stop + spool;
    if (alt < need * 1.45 + 60) {
      const late = alt < need * 1.05;
      const flash = Math.sin(performance.now() / 90) > -0.2;
      if (flash || late) {
        ctx.textAlign = 'center';
        ctx.font = `900 ${compact ? 20 : 26}px ${FONT}`;
        ctx.fillStyle = late ? RED : AMBER;
        ctx.fillText(late ? 'LIGHT ENGINE NOW!' : `LIGHT ENGINE · ${h.touch ? 'ENG' : 'SPACE'}`, w / 2, hgt * 0.3);
      }
    }
  }

  // --- Catch envelope (bottom-right) when on final approach ----------------
  if (Math.abs(p.dy) < 60 && Math.abs(p.dx) < 60 && !s.outcome) {
    const checks: [string, boolean][] = [
      ['ALIGN', Math.abs(p.dx) < AUTO_CLAMP.dx && p.dy > AUTO_CLAMP.dyLow && p.dy < AUTO_CLAMP.dyHigh],
      ['V↓', Math.abs(p.vyRel) < AUTO_CLAMP.vy],
      ['V→', Math.abs(p.vx) < AUTO_CLAMP.vx],
      ['TILT', Math.abs(p.angle) < AUTO_CLAMP.tilt * DEG],
    ];
    const ex = w - pad - 150;
    const ey = hgt - pad - (h.touch ? 150 : 0) - 70;
    panel(ctx, ex - 6, ey - 20, 156, 78);
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM;
    ctx.fillText(h.touch ? 'CATCH WINDOW · tap CLAMP' : 'CATCH WINDOW · C to clamp', ex, ey - 5);
    checks.forEach(([label, ok], i) => {
      const cx = ex + (i % 2) * 74;
      const cy = ey + 14 + Math.floor(i / 2) * 22;
      ctx.fillStyle = ok ? 'rgba(93,255,160,0.18)' : 'rgba(255,93,93,0.12)';
      ctx.fillRect(cx, cy - 13, 68, 18);
      ctx.fillStyle = ok ? GREEN : RED;
      ctx.fillText(`${ok ? '✓' : '✗'} ${label}`, cx + 6, cy);
    });
  }

  // --- Off-screen tower pointer -------------------------------------------
  const [tx, ty] = r.toScreen(0, ARM_Y + p.deckY);
  const margin = 40;
  if (tx < margin || tx > w - margin || ty < margin || ty > hgt - margin) {
    const cx = Math.min(w - margin, Math.max(margin, tx));
    const cy = Math.min(hgt - margin - (h.touch ? 150 : 0), Math.max(margin + 50, ty));
    const ang = Math.atan2(ty - cy, tx - cx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,207,90,0.9)';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-6, 8);
    ctx.fill();
    ctx.restore();
    ctx.font = `700 11px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,207,90,0.9)';
    ctx.fillText(`TOWER ${Math.round(Math.hypot(p.dx, p.dy))} m`, cx, cy + 22);
  }
}

function limitColor(v: number, limit: number): string {
  return v < limit ? GREEN : v < limit * 2 ? AMBER : RED;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(8,14,28,0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, color: string, label: string, value: string): void {
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = DIM;
  ctx.fillText(label, x, y - 4);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e8f0ff';
  ctx.fillText(value, x + w + 28, y + h - 1);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), h);
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, color: string): void {
  const l = Math.max(-46, Math.min(46, len));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - l / 2, cy);
  ctx.lineTo(cx + l / 2, cy);
  ctx.stroke();
  if (Math.abs(l) > 3) {
    const dir = Math.sign(l);
    ctx.beginPath();
    ctx.moveTo(cx + l / 2 + dir * 6, cy);
    ctx.lineTo(cx + l / 2 - dir * 2, cy - 6);
    ctx.lineTo(cx + l / 2 - dir * 2, cy + 6);
    ctx.fill();
  }
}
