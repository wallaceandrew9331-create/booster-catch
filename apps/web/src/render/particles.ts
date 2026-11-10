/**
 * World-space particles (metres, y up). Purely cosmetic, so unlike the sim
 * they use Math.random and frame-time integration freely: they never feed
 * back into gameplay, so they can't break determinism.
 */
export const Kind = { Smoke: 0, Fire: 1, Spark: 2, Debris: 3, Steam: 4 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  rot: number;
}

const MAX = 2500;

export class Particles {
  private readonly items: Particle[] = [];

  spawn(kind: Kind, x: number, y: number, vx: number, vy: number, life: number, size: number): void {
    if (this.items.length >= MAX) this.items.shift();
    this.items.push({ kind, x, y, vx, vy, life, maxLife: life, size, spin: (Math.random() - 0.5) * 12, rot: Math.random() * 6 });
  }

  clear(): void {
    this.items.length = 0;
  }

  update(dt: number, wind: number): void {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        items[i] = items[items.length - 1]!;
        items.pop();
        continue;
      }
      switch (p.kind) {
        case Kind.Smoke:
        case Kind.Steam:
          // Smoke slows to the wind speed and rises a little.
          p.vx += (wind - p.vx) * dt * 0.8;
          p.vy += (3 - p.vy) * dt * 0.8;
          p.size += dt * 6;
          break;
        case Kind.Fire:
          p.vx *= 1 - dt * 2.5;
          p.vy = p.vy * (1 - dt * 2.5) + dt * 6;
          p.size += dt * 4;
          break;
        case Kind.Spark:
          p.vy -= 9.81 * dt;
          break;
        case Kind.Debris:
          p.vy -= 9.81 * dt;
          p.rot += p.spin * dt;
          break;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === Kind.Debris && p.y < 0) {
        p.y = 0;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
    }
  }

  /** Draw with the world transform already applied (1 unit = 1 m, y up). */
  draw(ctx: CanvasRenderingContext2D, night: boolean): void {
    // Smoke first with normal blending, then the glowing stuff additively.
    for (const p of this.items) {
      if (p.kind !== Kind.Smoke && p.kind !== Kind.Steam) continue;
      const t = p.life / p.maxLife;
      const shade = p.kind === Kind.Steam ? 235 : night ? 70 : 150;
      ctx.fillStyle = `rgba(${shade},${shade},${shade + 5},${0.35 * t})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.items) {
      if (p.kind !== Kind.Debris) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = '#2a2d33';
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    // Fire with normal blending: additive turns orange into white on a bright
    // day sky. Young fire is pale yellow, cooling through orange to dark red.
    for (const p of this.items) {
      if (p.kind !== Kind.Fire) continue;
      const t = p.life / p.maxLife;
      const r = 255;
      const g = Math.floor(60 + 190 * t * t);
      const b = Math.floor(30 + 140 * t * t * t);
      ctx.fillStyle = `rgba(${Math.floor(r * (0.55 + 0.45 * t))},${g},${b},${0.85 * Math.min(1, t * 1.6)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.items) {
      if (p.kind !== Kind.Spark) continue;
      const t = p.life / p.maxLife;
      ctx.fillStyle = `rgba(255,220,140,${t})`;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
