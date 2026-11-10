import {
  Autopilot, COM_FROM_BOTTOM, configFor, createSim, DT, InputPlayer, InputRecorder,
  SimEvent, step, ARM_Y, TOWER_FACE_X, type InputLog, type Mode, type Outcome, type RunConfig, type SimState,
} from '@booster/sim';
import type { Sound } from './audio.ts';
import type { Controls } from './input.ts';
import { drawHud } from './render/hud.ts';
import { Kind, Particles } from './render/particles.ts';
import type { Renderer } from './render/scene.ts';
import { lerpSnapshot, snapshot, type Snapshot } from './render/view.ts';

export type InputSource = { kind: 'player' } | { kind: 'replay'; log: InputLog } | { kind: 'autopilot' };

export interface GhostSpec {
  cfg: RunConfig;
  log: InputLog;
  label: string;
}

export interface RunSpec {
  mode: Mode;
  modeLabel: string;
  source: InputSource;
  ghost: GhostSpec | null;
  best: number | null;
  attract?: boolean;
}

export interface RunResult {
  spec: RunSpec;
  cfg: RunConfig;
  outcome: Outcome;
  log: InputLog;
}

/** How long the end-of-run effects play before the results card appears. */
const RESULT_DELAY = 1.4;

/**
 * One attempt: owns the sim, the input recorder, an optional ghost, and the
 * cosmetic effects. The heart is `frame()`, a fixed-timestep loop:
 *
 *   accumulate wall-clock time; while a whole tick (1/120 s) is banked, step
 *   the sim; then render, interpolating between the last two ticks.
 *
 * Physics therefore runs at exactly 120 Hz on every machine, which is what
 * makes a recorded input log replay identically anywhere.
 */
export class Game {
  private sim!: SimState;
  private cfg!: RunConfig;
  private spec!: RunSpec;
  private recorder = new InputRecorder();
  private replayer: InputPlayer | null = null;
  private autopilot: Autopilot | null = null;
  private ghost: { sim: SimState; player: InputPlayer; prev: Snapshot; curr: Snapshot; label: string } | null = null;
  private prev!: Snapshot;
  private curr!: Snapshot;
  private acc = 0;
  private time = 0;
  private endTime = -1;
  private reported = false;
  private exploded = false;
  private wobble = -1;
  private caught = -1;
  private beepTimer = 0;
  readonly particles = new Particles();
  showGhost = true;
  paused = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly sound: Sound,
    private readonly controls: Controls,
    private readonly onEnd: (r: RunResult) => void,
    private readonly touch: () => boolean,
  ) {}

  start(spec: RunSpec): void {
    this.spec = spec;
    this.cfg = configFor(spec.mode);
    this.sim = createSim(this.cfg);
    this.recorder = new InputRecorder();
    this.replayer = spec.source.kind === 'replay' ? new InputPlayer(spec.source.log) : null;
    this.autopilot = spec.source.kind === 'autopilot' ? new Autopilot() : null;
    this.ghost = null;
    if (spec.ghost) {
      const gs = createSim(spec.ghost.cfg);
      const snap = snapshot(gs);
      this.ghost = { sim: gs, player: new InputPlayer(spec.ghost.log), prev: snap, curr: snap, label: spec.ghost.label };
    }
    this.prev = this.curr = snapshot(this.sim);
    this.acc = 0;
    this.time = 0;
    this.endTime = -1;
    this.reported = false;
    this.exploded = false;
    this.wobble = -1;
    this.caught = -1;
    this.paused = false;
    this.particles.clear();
    this.controls.reset();
    // Snap the camera to the new start instead of swooping across the map.
    this.renderer.camX = this.sim.x;
    this.renderer.camY = this.sim.y;
    this.renderer.scale = this.renderer.height / (spec.attract ? 560 : 690);
    this.renderer.shake = 0;
  }

  get state(): SimState {
    return this.sim;
  }

  frame(dt: number): void {
    if (!this.paused) {
      // Clamp long frames (tab switch, debugger) so we don't fast-forward
      // through seconds of physics in one go: the "spiral of death".
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= DT) {
        this.tick();
        this.acc -= DT;
      }
      this.time += dt;
      if (this.endTime >= 0) {
        this.endTime += dt;
        if (this.wobble >= 0) this.wobble += dt;
        if (this.caught >= 0) this.caught += dt;
        if (this.endTime > RESULT_DELAY && !this.reported) {
          this.reported = true;
          this.onEnd({ spec: this.spec, cfg: this.cfg, outcome: this.sim.outcome!, log: this.recorder.log });
        }
      }
    }
    const alpha = this.acc / DT;
    // After the run ends the engine is shut down for good (the sim is frozen, so do it here).
    const snap = this.sim.outcome ? { ...this.curr, thrust: 0, engineOn: false } : lerpSnapshot(this.prev, this.curr, alpha);
    this.emitParticles(snap, Math.min(dt, 0.05));
    this.particles.update(Math.min(dt, 0.05), snap.wind);
    if (!this.spec.attract && !this.paused) this.sound.update(this.exploded || this.sim.outcome ? 0 : snap.thrust, this.sim.outcome ? 0 : snap.q);

    const g = this.ghost && this.showGhost && !(this.ghost.sim.outcome && this.ghost.sim.outcome.score === 0 && this.ghost.sim.tick < this.sim.tick - 60)
      ? { snap: this.ghost.sim.outcome ? this.ghost.curr : lerpSnapshot(this.ghost.prev, this.ghost.curr, alpha), label: this.ghost.label }
      : null;

    this.renderer.render(
      {
        level: this.cfg.level,
        player: snap,
        ghost: g,
        exploded: this.exploded,
        wobble: this.wobble,
        caught: this.caught,
        time: this.time,
        particles: this.particles,
        attract: this.spec.attract === true,
      },
      dt,
    );
    if (!this.spec.attract) {
      drawHud(this.renderer, {
        sim: this.sim,
        snap,
        level: this.cfg.level,
        modeLabel: this.spec.modeLabel,
        best: this.spec.best,
        ghostLabel: g ? this.ghost!.label : null,
        replaying: this.spec.source.kind === 'replay',
        touch: this.touch(),
      });
    }
  }

  private tick(): void {
    if (this.sim.outcome) return;
    let mask: number;
    if (this.replayer) mask = this.replayer.maskAt(this.sim.tick);
    else if (this.autopilot) mask = this.autopilot.next(this.sim);
    else mask = this.controls.sample();
    this.recorder.record(this.sim.tick, mask);
    this.prev = this.curr;
    step(this.sim, mask);
    this.curr = snapshot(this.sim);

    if (this.ghost && !this.ghost.sim.outcome) {
      this.ghost.prev = this.ghost.curr;
      step(this.ghost.sim, this.ghost.player.maskAt(this.ghost.sim.tick));
      this.ghost.curr = snapshot(this.ghost.sim);
    }

    if (!this.spec.attract) this.playEvents();
    if (this.sim.outcome) this.onOutcome(this.sim.outcome);
  }

  private playEvents(): void {
    const e = this.sim.events;
    if (e & SimEvent.Ignite) {
      this.sound.ignite();
      this.burstAtEngine(30);
    }
    if (e & (SimEvent.Shutdown | SimEvent.Flameout)) this.sound.shutdown();
    if (e & SimEvent.NoRelights) this.sound.denied();
    if (e & SimEvent.ClampStart) this.sound.armsMoving();
    if (e & SimEvent.ClampMiss) this.sound.miss();
    const fuelFrac = this.sim.fuel / this.cfg.level.fuel;
    this.beepTimer -= DT;
    if (this.sim.engineOn && fuelFrac < 0.15 && this.beepTimer <= 0) {
      this.sound.beep();
      this.beepTimer = fuelFrac < 0.07 ? 0.25 : 0.5;
    }
  }

  private onOutcome(o: Outcome): void {
    this.endTime = 0;
    const s = this.sim;
    if (o.kind === 'crash') {
      this.exploded = true;
      this.renderer.shake = 1;
      if (!this.spec.attract) this.sound.explode();
      this.explode(s);
    } else if (o.kind === 'catch' || o.kind === 'wobble') {
      const ay = ARM_Y + s.deckY;
      for (let i = 0; i < 40; i++) {
        this.particles.spawn(Kind.Spark, (Math.random() - 0.5) * 10, ay, (Math.random() - 0.5) * 30, Math.random() * 18, 0.4 + Math.random() * 0.6, 0.35);
      }
      if (o.kind === 'wobble') {
        this.wobble = 0;
        this.renderer.shake = 0.55;
        if (!this.spec.attract) {
          this.sound.clank();
          this.sound.wobble();
        }
      } else {
        this.caught = 0;
        this.renderer.shake = 0.3;
        if (!this.spec.attract) {
          this.sound.clank();
          this.sound.success();
        }
      }
    } else if (!this.spec.attract) {
      this.sound.denied();
    }
    this.sound.silence();
  }

  private explode(s: SimState): void {
    const p = this.particles;
    // Centre the fireball on the lower tanks, clamped above the ground.
    const cx = s.x - 8 * Math.sin(s.angle);
    const cy = Math.max(s.deckY + 6, s.y - 8 * Math.cos(s.angle));
    this.renderer.flash = 1;
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 10;
      const v = 6 + Math.random() * 32;
      p.spawn(Kind.Fire, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.6, Math.cos(a) * v + s.vx * 0.2, Math.sin(a) * v * 0.7 + 8, 0.7 + Math.random() * 1.1, 3 + Math.random() * 6);
    }
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 14;
      p.spawn(Kind.Smoke, cx + (Math.random() - 0.5) * 24, cy + Math.random() * 30, Math.cos(a) * v, Math.abs(Math.sin(a)) * v + 4, 3.5 + Math.random() * 3, 5 + Math.random() * 7);
    }
    for (let i = 0; i < 45; i++) {
      const a = 0.15 + Math.random() * (Math.PI - 0.3);
      const v = 18 + Math.random() * 50;
      p.spawn(Kind.Debris, cx + (Math.random() - 0.5) * 8, cy, Math.cos(a) * v, Math.sin(a) * v, 3 + Math.random() * 2, 0.8 + Math.random() * 2.4);
    }
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 25 + Math.random() * 70;
      p.spawn(Kind.Spark, cx, cy, Math.cos(a) * v, Math.sin(a) * v, 0.4 + Math.random() * 0.9, 0.5);
    }
    this.renderer.shockwave(cx, cy);
  }

  private burstAtEngine(n: number): void {
    const s = this.sim;
    const sa = Math.sin(s.angle);
    const ca = Math.cos(s.angle);
    const ex = s.x - (COM_FROM_BOTTOM + 3) * sa;
    const ey = s.y - (COM_FROM_BOTTOM + 3) * ca;
    for (let i = 0; i < n; i++) {
      this.particles.spawn(Kind.Fire, ex, ey, s.vx + (Math.random() - 0.5) * 20, s.vy - Math.random() * 20, 0.4, 2 + Math.random() * 2);
    }
  }

  private emitParticles(p: Snapshot, dt: number): void {
    if (this.exploded || this.sim.outcome || this.paused) return;
    const sa = Math.sin(p.angle);
    const ca = Math.cos(p.angle);
    const ex = p.x - (COM_FROM_BOTTOM + 3) * sa;
    const ey = p.y - (COM_FROM_BOTTOM + 3) * ca;
    if (p.thrust > 0.02) {
      const n = Math.ceil(dt * 180 * p.thrust);
      for (let i = 0; i < n; i++) {
        const v = 40 + 60 * p.thrust;
        this.particles.spawn(Kind.Fire, ex, ey, p.vx - sa * v + (Math.random() - 0.5) * 10, p.vy - ca * v + (Math.random() - 0.5) * 10, 0.25 + Math.random() * 0.2, 1.5 + Math.random() * 1.5);
        if (Math.random() < 0.5) {
          this.particles.spawn(Kind.Smoke, ex - sa * 20, ey - ca * 20, p.vx * 0.5 - sa * v * 0.4, p.vy * 0.5 - ca * v * 0.4, 1.5 + Math.random() * 1.5, 2.5 + Math.random() * 2);
        }
      }
      // Exhaust hitting the ground/deck kicks up a dust or steam cloud.
      const groundY = p.deckY;
      const h = ey - groundY;
      if (h < 70 && h > -5) {
        const strength = p.thrust * (1 - h / 70);
        const m = Math.ceil(dt * 120 * strength);
        for (let i = 0; i < m; i++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const kind = this.cfg.level.sea ? Kind.Steam : Kind.Smoke;
          const gx = ex + (ey - groundY) * sa;
          // The tower blocks the cloud on its side.
          const vx = dir * (20 + Math.random() * 35);
          if (gx + vx * 0.2 > TOWER_FACE_X) continue;
          this.particles.spawn(kind, gx, groundY + 1 + Math.random() * 3, vx, 1 + Math.random() * 4, 1.5 + Math.random() * 2, 3 + Math.random() * 3);
        }
      }
    }
    // Re-entry: plasma sparks streaming up past the hull.
    if (!p.engineOn && p.q > 5000) {
      const heat = Math.min(1, (p.q - 5000) / 6000);
      const n = Math.ceil(dt * 90 * heat);
      const bx = p.x - COM_FROM_BOTTOM * sa;
      const by = p.y - COM_FROM_BOTTOM * ca;
      for (let i = 0; i < n; i++) {
        this.particles.spawn(Kind.Spark, bx + (Math.random() - 0.5) * 9, by, p.vx + (Math.random() - 0.5) * 8, p.vy * 0.7, 0.25 + Math.random() * 0.25, 0.5);
      }
    }
  }
}
