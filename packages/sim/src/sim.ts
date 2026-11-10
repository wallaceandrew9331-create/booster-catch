import {
  AERO_STABILITY, ARM_CLOSE_S, ARM_REOPEN_S, ARM_Y, AUTO_CLAMP, BOOSTER_LENGTH, BOOSTER_WIDTH,
  BURN_RATE, CATCH_LIMITS, CATCH_WINDOW, CD_AXIAL, CD_SIDE, COM_FROM_BOTTOM, DENSITY_SCALE,
  DRY_MASS, DT, FIN_LIFT, FIN_TORQUE, G, GIMBAL_TORQUE, HARDPOINT_FROM_BOTTOM, MAX_THRUST,
  MAX_TICKS, MAX_TILT, MIN_THROTTLE, MOUNT_HALF_WIDTH, MOUNT_HEIGHT, SIDE_DRAG_FLOOR, SPOOL_UP_S,
  STEER_RATE, THROTTLE_LAG_S, THROTTLE_RATE, TOWER_FACE_X, TOWER_HEIGHT, TOWER_WIDTH, WIND_TORQUE,
  WOBBLE_MAX, WORLD,
} from './constants.ts';
import { approach, clamp, dcos, DEG, dsin, lerp, TWO_PI } from './dmath.ts';
import { Input } from './input.ts';
import type { LevelDef, RunConfig } from './levels.ts';
import { range } from './rng.ts';
import { gradeFor, scoreCatch, type ScoreBreakdown } from './score.ts';

export type OutcomeKind = 'catch' | 'wobble' | 'crash' | 'lost' | 'timeout';

export interface Outcome {
  kind: OutcomeKind;
  reason: string;
  score: number;
  grade: string;
  tick: number;
  manual: boolean;
  breakdown: ScoreBreakdown | null;
}

/** Arm state machine: open -> closing -> closed (caught) | reopening -> open. */
export const ArmPhase = { Open: 0, Closing: 1, Closed: 2, Reopening: 3 } as const;
export type ArmPhase = (typeof ArmPhase)[keyof typeof ArmPhase];

/** One-tick event flags so the client can play sounds and spawn effects. */
export const SimEvent = {
  Ignite: 1 << 0,
  Shutdown: 1 << 1,
  Flameout: 1 << 2,
  ClampStart: 1 << 3,
  ClampMiss: 1 << 4,
  NoRelights: 1 << 5,
} as const;

/** Altitudes (m) of the wind-shear layers; wind is interpolated between them. */
export const LAYER_ALTS = [0, 250, 600, 1100, 1800, 2600] as const;

/**
 * The complete simulation state. Plain data with no methods and no references
 * to anything outside itself, so it can be hashed, cloned and stepped in Node
 * or a browser alike.
 */
export interface SimState {
  readonly level: LevelDef;
  readonly seed: number;
  tick: number;
  /** Centre of mass position (m) and velocity (m/s). y is up; the tower stands at x = 0. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Tilt in radians: 0 = upright, positive = nose leaning right (clockwise). */
  angle: number;
  omega: number;
  fuel: number;
  /** What the player asked for, 0..1. */
  throttleCmd: number;
  /** What the engine is actually producing (lags the command), 0..1. */
  throttle: number;
  /** Ignition ramp, 0..1. Thrust = MAX_THRUST * throttle * spool. */
  spool: number;
  engineOn: boolean;
  relightsLeft: number;
  /** Smoothed steering command, -1..1. Drives both the engine gimbal and the grid fins. */
  steer: number;
  prevMask: number;
  armPhase: ArmPhase;
  armT: number;
  armManual: boolean;
  /** Wind at the booster's altitude this tick (m/s, positive blows right). */
  wind: number;
  gust: number;
  gustTarget: number;
  gustTimer: number;
  readonly layers: readonly number[];
  /** PRNG state for in-flight randomness (gusts). */
  rng: number;
  /** Tower/deck heave for the sea platform; 0 on land. */
  deckY: number;
  deckVy: number;
  /** Dynamic pressure this tick (HUD and reentry glow). */
  q: number;
  maxQ: number;
  events: number;
  outcome: Outcome | null;
}

export function createSim(cfg: RunConfig): SimState {
  const { level, seed } = cfg;
  // Setup draws come from their own stream so changing in-flight randomness
  // doesn't move the start position, and vice versa.
  const setup = { rng: (seed ^ 0x9e3779b9) | 0 };
  // Boosters always come in from the open side (x < 0): approaching over the
  // tower would mean threading past its top, which isn't fun, just unfair.
  const offset = range(setup, level.startOffset[0], level.startOffset[1]);
  const drift = range(setup, level.startDrift[0], level.startDrift[1]);
  const layers = LAYER_ALTS.map(() => range(setup, -level.shear, level.shear));
  const gustTarget = range(setup, -level.gust, level.gust);

  const s: SimState = {
    level,
    seed,
    tick: 0,
    x: -offset,
    y: level.startAlt,
    vx: drift,
    vy: level.startVy,
    angle: 0,
    omega: 0,
    fuel: level.fuel,
    // Start at full: the first burn is always a hard one, and new players
    // shouldn't have to find the throttle key while falling at 150 m/s.
    throttleCmd: 1,
    throttle: 0,
    spool: 0,
    engineOn: false,
    relightsLeft: level.relights,
    steer: 0,
    prevMask: 0,
    armPhase: ArmPhase.Open,
    armT: 0,
    armManual: false,
    wind: 0,
    gust: gustTarget,
    gustTarget,
    gustTimer: 1,
    layers,
    rng: (seed ^ 0x85ebca6b) | 0,
    deckY: 0,
    deckVy: 0,
    q: 0,
    maxQ: 0,
    events: 0,
    outcome: null,
  };
  updateDeck(s);
  s.wind = windAt(s, s.y);
  return s;
}

/**
 * Air density relative to sea level. The real curve is exp(-y/H); we use
 * 1 / (1 + u + u^2/2), the reciprocal of exp's first Taylor terms, which
 * stays within 1% over the altitudes we fly and needs no Math.exp (see dmath.ts).
 */
export function density(y: number): number {
  const u = Math.max(0, y) / DENSITY_SCALE;
  return 1 / (1 + u + 0.5 * u * u);
}

/** Wind at altitude y: the shear profile (piecewise linear between layers) plus the current gust. */
export function windAt(s: SimState, y: number): number {
  let steady = s.layers[s.layers.length - 1]!;
  for (let i = 1; i < LAYER_ALTS.length; i++) {
    const hi = LAYER_ALTS[i]!;
    if (y < hi) {
      const lo = LAYER_ALTS[i - 1]!;
      const t = clamp((y - lo) / (hi - lo), 0, 1);
      steady = lerp(s.layers[i - 1]!, s.layers[i]!, t);
      break;
    }
  }
  return steady + s.gust;
}

function updateDeck(s: SimState): void {
  const sea = s.level.sea;
  if (!sea) return;
  // Two incommensurate swells so the heave doesn't feel like a metronome.
  // Position and velocity are both closed-form functions of the tick, so the
  // deck never drifts no matter how long the run is.
  const t = s.tick * DT;
  const w1 = TWO_PI / sea.period;
  const w2 = TWO_PI / (sea.period * 0.43);
  s.deckY = sea.amp * (0.75 * dsin(w1 * t) + 0.25 * dsin(w2 * t + 1.3));
  s.deckVy = sea.amp * (0.75 * w1 * dcos(w1 * t) + 0.25 * w2 * dcos(w2 * t + 1.3));
}

/** A point on the booster: `along` metres up the axis from the CoM, `across` metres to its right. */
export function boosterPoint(st: SimState, along: number, across: number): { x: number; y: number } {
  const sa = dsin(st.angle);
  const ca = dcos(st.angle);
  return { x: st.x + along * sa + across * ca, y: st.y + along * ca - across * sa };
}

/** Where the catch hardpoints are relative to the arms (dx, dy) and how fast they approach (vy). */
export function hardpointError(st: SimState): { dx: number; dy: number; vy: number } {
  const lever = HARDPOINT_FROM_BOTTOM - COM_FROM_BOTTOM;
  const hp = boosterPoint(st, lever, 0);
  // Point velocity includes rotation (v = v_com + omega x r). For r along the
  // axis, the vertical part is -omega * lever * sin(angle): tiny, but honest.
  const vy = st.vy - st.omega * lever * dsin(st.angle) - st.deckVy;
  return { dx: hp.x, dy: hp.y - (ARM_Y + st.deckY), vy };
}

/**
 * Advance the simulation by one fixed tick (1/120 s) under input `mask`.
 * Mutates `s` in place so the hot loop allocates almost nothing.
 */
export function step(s: SimState, mask: number): void {
  if (s.outcome) return;
  s.events = 0;
  const level = s.level;
  const pressed = mask & ~s.prevMask; // rising edges only
  s.prevMask = mask;

  // --- Controls ------------------------------------------------------------
  const thrDir = (mask & Input.ThrottleUp ? 1 : 0) - (mask & Input.ThrottleDown ? 1 : 0);
  s.throttleCmd = clamp(s.throttleCmd + thrDir * THROTTLE_RATE * DT, 0, 1);
  const stick = (mask & Input.Right ? 1 : 0) - (mask & Input.Left ? 1 : 0);
  s.steer = approach(s.steer, stick, STEER_RATE * DT);

  if (pressed & Input.Engine) {
    if (s.engineOn) {
      s.engineOn = false;
      s.events |= SimEvent.Shutdown;
    } else if (s.relightsLeft > 0 && s.fuel > 0) {
      s.engineOn = true;
      s.relightsLeft--;
      s.spool = 0;
      s.events |= SimEvent.Ignite;
    } else {
      s.events |= SimEvent.NoRelights;
    }
  }

  // --- Engine --------------------------------------------------------------
  // Once lit, the engine can't throttle below MIN_THROTTLE. That's what makes
  // the last few metres a balancing act instead of a lazy hover.
  const target = s.engineOn ? Math.max(MIN_THROTTLE, s.throttleCmd) : 0;
  s.throttle += (target - s.throttle) * Math.min(1, DT / THROTTLE_LAG_S);
  if (s.engineOn) s.spool = Math.min(1, s.spool + DT / SPOOL_UP_S);
  const output = s.throttle * s.spool;
  s.fuel -= output * BURN_RATE * DT;
  if (s.fuel <= 0) {
    s.fuel = 0;
    if (s.engineOn) s.events |= SimEvent.Flameout;
    s.engineOn = false;
  }
  const mass = DRY_MASS + s.fuel;
  const thrustAcc = (MAX_THRUST * output) / mass;

  // --- Environment ---------------------------------------------------------
  updateDeck(s);
  s.gustTimer -= DT;
  if (s.gustTimer <= 0) {
    s.gustTarget = range(s, -level.gust, level.gust);
    s.gustTimer = range(s, level.gustEvery[0], level.gustEvery[1]);
  }
  // Gusts ease toward their target (first-order lag, ~0.8 s) instead of snapping.
  s.gust += (s.gustTarget - s.gust) * (DT / 0.8);
  s.wind = windAt(s, s.y);

  // --- Forces --------------------------------------------------------------
  const rho = density(s.y);
  const relX = s.vx - s.wind;
  const relY = s.vy;
  const airspeed = Math.sqrt(relX * relX + relY * relY);
  const q = 0.5 * rho * airspeed * airspeed;
  s.q = q;
  if (q > s.maxQ) s.maxQ = q;

  const sa = dsin(s.angle);
  const ca = dcos(s.angle);
  // Thrust acts along the body axis. The gimbal's few degrees matter for
  // torque, not for the direction of the push, so we ignore them here.
  let ax = thrustAcc * sa;
  let ay = thrustAcc * ca - G;

  // Drag split into world axes: a near-vertical booster is slim end-on and
  // fat broadside. Fine while |angle| stays small, which it must anyway.
  ax -= (CD_SIDE * rho * (airspeed + SIDE_DRAG_FLOOR) * relX) / mass;
  ay -= (CD_AXIAL * rho * airspeed * relY) / mass;

  // Grid fins only bite when air flows up past them (falling engine-first).
  const finFlow = airspeed > 1 ? clamp(-relY / airspeed, 0, 1) : 0;
  ax += (FIN_LIFT * q * finFlow * s.steer) / mass;

  // --- Rotation ------------------------------------------------------------
  // Steering right tilts the nose right, so thrust (or fin lift) pushes right.
  let alpha = GIMBAL_TORQUE * Math.sqrt(thrustAcc) * s.steer + FIN_TORQUE * q * finFlow * s.steer;
  alpha -= AERO_STABILITY * q * finFlow * s.angle; // fins weathervane the nose upright
  alpha -= WIND_TORQUE * rho * relX; // wind from the left leans the nose right
  // Flight-computer assist: rate damping always, plus an attitude-hold spring
  // that pulls the booster upright, both scaled by the level's assist value.
  const damping = 1.2 + 1.4 * level.assist;
  const spring = 3.2 * level.assist;
  alpha -= damping * s.omega + spring * s.angle;

  // Semi-implicit (symplectic) Euler: velocity first, then position with the
  // new velocity. Same cost as explicit Euler, and it doesn't pump energy
  // into the spring-like attitude hold.
  s.omega += alpha * DT;
  s.angle += s.omega * DT;
  s.vx += ax * DT;
  s.vy += ay * DT;
  s.x += s.vx * DT;
  s.y += s.vy * DT;

  stepArms(s, pressed);
  if (!s.outcome) checkCollisions(s);
  s.tick++;
  if (!s.outcome && s.tick >= MAX_TICKS) end(s, 'timeout', 'Out of time');
}

function stepArms(s: SimState, pressed: number): void {
  if (s.armPhase === ArmPhase.Open) {
    const hp = hardpointError(s);
    const manual = (pressed & Input.Clamp) !== 0;
    const auto =
      Math.abs(hp.dx) < AUTO_CLAMP.dx &&
      hp.dy > AUTO_CLAMP.dyLow &&
      hp.dy < AUTO_CLAMP.dyHigh &&
      Math.abs(hp.vy) < AUTO_CLAMP.vy &&
      Math.abs(s.vx) < AUTO_CLAMP.vx &&
      Math.abs(s.angle) < AUTO_CLAMP.tilt * DEG &&
      Math.abs(s.omega) < AUTO_CLAMP.omega;
    if (manual || auto) {
      s.armPhase = ArmPhase.Closing;
      s.armT = 0;
      s.armManual = manual;
      s.events |= SimEvent.ClampStart;
    }
  } else if (s.armPhase === ArmPhase.Closing) {
    s.armT += DT / ARM_CLOSE_S;
    if (s.armT >= 1) {
      s.armT = 1;
      judgeCatch(s);
    }
  } else if (s.armPhase === ArmPhase.Reopening) {
    s.armT -= DT / ARM_REOPEN_S;
    if (s.armT <= 0) {
      s.armT = 0;
      s.armPhase = ArmPhase.Open;
    }
  }
}

/** The arms just finished closing: did they close around the booster, and how hard was it? */
function judgeCatch(s: SimState): void {
  const hp = hardpointError(s);
  const inWindow =
    Math.abs(hp.dx) <= CATCH_WINDOW.dx && hp.dy >= CATCH_WINDOW.dyLow && hp.dy <= CATCH_WINDOW.dyHigh;
  if (!inWindow) {
    s.armPhase = ArmPhase.Reopening;
    s.events |= SimEvent.ClampMiss;
    return;
  }
  s.armPhase = ArmPhase.Closed;
  const tiltDeg = Math.abs(s.angle) / DEG;
  // Each error is normalised so its limit is 1.0; the worst one decides.
  const errVy = Math.abs(hp.vy) / CATCH_LIMITS.vy;
  const errVx = Math.abs(s.vx) / CATCH_LIMITS.vx;
  const errTilt = tiltDeg / CATCH_LIMITS.tilt;
  const errOmega = Math.abs(s.omega) / CATCH_LIMITS.omega;
  const severity = Math.max(errVy, errVx, errTilt, errOmega);
  if (severity > WOBBLE_MAX) {
    const what = errVy === severity ? 'too fast' : errVx === severity ? 'sliding sideways' : 'too tilted';
    end(s, 'crash', `The arms couldn't hold it: ${what}`);
    return;
  }
  const wobble = severity > 1;
  const { score, breakdown } = scoreCatch({
    vy: hp.vy,
    vx: s.vx,
    tiltDeg,
    dx: hp.dx,
    fuelFrac: s.fuel / s.level.fuel,
    manual: s.armManual,
    wobble,
  });
  s.outcome = {
    kind: wobble ? 'wobble' : 'catch',
    reason: wobble ? 'Caught, but it rattled the tower' : s.armManual ? 'Clean catch, manual clamp' : 'Clean catch',
    score,
    grade: gradeFor(score),
    tick: s.tick,
    manual: s.armManual,
    breakdown,
  };
}

const HALF_WIDTH = BOOSTER_WIDTH / 2;
const BOTTOM = -COM_FROM_BOTTOM;
const TOP = BOOSTER_LENGTH - COM_FROM_BOTTOM;
/** Hull outline samples (along, across): four corners plus the middle of each side. */
const HULL: readonly (readonly [number, number])[] = [
  [BOTTOM, -HALF_WIDTH], [BOTTOM, HALF_WIDTH], [TOP, -HALF_WIDTH], [TOP, HALF_WIDTH],
  [(BOTTOM + TOP) / 2, -HALF_WIDTH], [(BOTTOM + TOP) / 2, HALF_WIDTH],
];
/** Half-width of the sea barge deck. */
export const BARGE_HALF_WIDTH = 70;

function checkCollisions(s: SimState): void {
  if (Math.abs(s.angle) > MAX_TILT) return end(s, 'crash', 'Tumbled and broke apart');
  if (s.x < WORLD.minX || s.x > WORLD.maxX || s.y > WORLD.maxY) return end(s, 'lost', 'Drifted out of range');

  const deck = s.deckY;
  for (const [along, across] of HULL) {
    const p = boosterPoint(s, along, across);
    if (p.x > TOWER_FACE_X && p.x < TOWER_FACE_X + TOWER_WIDTH && p.y < deck + TOWER_HEIGHT) {
      return end(s, 'crash', 'Hit the tower');
    }
    if (Math.abs(p.x) < MOUNT_HALF_WIDTH && p.y < deck + MOUNT_HEIGHT) {
      return end(s, 'crash', 'Fell through onto the launch mount');
    }
    const overDeck = !s.level.sea || Math.abs(p.x) < BARGE_HALF_WIDTH;
    if (p.y < (overDeck ? deck : -1)) {
      return end(s, 'crash', overDeck ? 'Hit the ground' : 'Splashdown');
    }
  }
}

function end(s: SimState, kind: OutcomeKind, reason: string): void {
  s.outcome = { kind, reason, score: 0, grade: gradeFor(0), tick: s.tick, manual: false, breakdown: null };
}

export function isCaught(s: SimState): boolean {
  return s.outcome?.kind === 'catch' || s.outcome?.kind === 'wobble';
}
