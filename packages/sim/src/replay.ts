import { MAX_TICKS, TICK_HZ } from './constants.ts';
import { INPUT_MASK_ALL, InputPlayer, type InputLog } from './input.ts';
import type { RunConfig } from './levels.ts';
import { createSim, step, type SimState } from './sim.ts';

/**
 * Re-run a whole attempt from (config, input log). This is the function the
 * leaderboard server trusts instead of the client's claimed score.
 */
export function replay(cfg: RunConfig, log: InputLog, maxTicks = MAX_TICKS): SimState {
  const s = createSim(cfg);
  const player = new InputPlayer(log);
  while (!s.outcome && s.tick < maxTicks) step(s, player.maskAt(s.tick));
  return s;
}

/**
 * 64-bit FNV-1a over the raw IEEE-754 bytes of every numeric field, so two
 * states hash equal only if they are bit-for-bit identical. Floats are
 * written little-endian through a DataView to be independent of host byte order.
 */
export function hashState(s: SimState): string {
  const fields: number[] = [
    s.tick, s.x, s.y, s.vx, s.vy, s.angle, s.omega, s.fuel, s.throttleCmd, s.throttle, s.spool,
    s.engineOn ? 1 : 0, s.relightsLeft, s.steer, s.prevMask, s.armPhase, s.armT, s.armManual ? 1 : 0,
    s.wind, s.gust, s.gustTarget, s.gustTimer, s.rng, s.deckY, s.deckVy, s.maxQ,
    s.outcome?.score ?? -1, s.outcome?.tick ?? -1,
  ];
  const view = new DataView(new ArrayBuffer(fields.length * 8));
  fields.forEach((v, i) => view.setFloat64(i * 8, v, true));
  // Two independent 32-bit FNV-1a lanes give a 64-bit digest without BigInt.
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < view.byteLength; i++) {
    const b = view.getUint8(i);
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul(h2 ^ b, 0x01000193) ^ (h2 >>> 13);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

export type LogProblem = { ok: true } | { ok: false; error: string };

/** Max input changes in any one-second window. Mashing every key hits ~25. */
export const MAX_EVENTS_PER_SECOND = 40;
export const MAX_LOG_EVENTS = 4000;

/**
 * Reject logs no human could have produced, before spending CPU on them.
 * This is the "impossible inputs" filter: shape, range, ordering and density.
 * Anything that passes is then judged purely by re-simulation.
 */
export function validateLog(log: unknown): LogProblem {
  if (!Array.isArray(log)) return { ok: false, error: 'inputs must be an array' };
  if (log.length > MAX_LOG_EVENTS) return { ok: false, error: 'too many input events' };
  let prevTick = -1;
  for (let i = 0; i < log.length; i++) {
    const e: unknown = log[i];
    if (!Array.isArray(e) || e.length !== 2) return { ok: false, error: `event ${i} is not [tick, mask]` };
    const [tick, mask] = e as unknown[];
    if (!Number.isInteger(tick) || (tick as number) < 0 || (tick as number) >= MAX_TICKS) {
      return { ok: false, error: `event ${i} has a bad tick` };
    }
    if (!Number.isInteger(mask) || (mask as number) < 0 || (mask as number) > INPUT_MASK_ALL) {
      return { ok: false, error: `event ${i} has a bad mask` };
    }
    if ((tick as number) <= prevTick) return { ok: false, error: `event ${i} is out of order` };
    prevTick = tick as number;
  }
  // Sliding one-second window over event ticks.
  for (let lo = 0, hi = 0; hi < log.length; hi++) {
    while ((log[hi] as number[])[0]! - (log[lo] as number[])[0]! >= TICK_HZ) lo++;
    if (hi - lo + 1 > MAX_EVENTS_PER_SECOND) return { ok: false, error: 'inputs change faster than a human can press keys' };
  }
  return { ok: true };
}
