import { ArmPhase, hardpointError, type SimState } from '@booster/sim';

/**
 * The slice of sim state the renderer needs, copied after every tick.
 * The renderer draws `lerpSnapshot(prev, curr, alpha)` where alpha is how far
 * the wall clock has progressed into the next tick. That decouples the
 * 120 Hz physics from whatever the display runs at (60, 144, 240 Hz...)
 * without the stutter you get from drawing the latest tick as-is.
 */
export interface Snapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrust: number;
  steer: number;
  q: number;
  deckY: number;
  armT: number;
  armPhase: ArmPhase;
  wind: number;
  engineOn: boolean;
  /** Hardpoint offset from the arms. */
  dx: number;
  dy: number;
  vyRel: number;
}

export function snapshot(s: SimState): Snapshot {
  const hp = hardpointError(s);
  return {
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    angle: s.angle,
    thrust: s.throttle * s.spool,
    steer: s.steer,
    q: s.q,
    deckY: s.deckY,
    armT: s.armT,
    armPhase: s.armPhase,
    wind: s.wind,
    engineOn: s.engineOn,
    dx: hp.dx,
    dy: hp.dy,
    vyRel: hp.vy,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function lerpSnapshot(a: Snapshot, b: Snapshot, t: number): Snapshot {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    angle: lerp(a.angle, b.angle, t),
    thrust: lerp(a.thrust, b.thrust, t),
    steer: lerp(a.steer, b.steer, t),
    q: lerp(a.q, b.q, t),
    deckY: lerp(a.deckY, b.deckY, t),
    armT: lerp(a.armT, b.armT, t),
    armPhase: b.armPhase,
    wind: lerp(a.wind, b.wind, t),
    engineOn: b.engineOn,
    dx: lerp(a.dx, b.dx, t),
    dy: lerp(a.dy, b.dy, t),
    vyRel: lerp(a.vyRel, b.vyRel, t),
  };
}
