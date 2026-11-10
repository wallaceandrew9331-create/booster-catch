import { CATCH_LIMITS, CATCH_WINDOW } from './constants.ts';
import { clamp } from './dmath.ts';

export interface CatchConditions {
  /** Vertical speed relative to the arms, m/s (negative = descending). */
  vy: number;
  vx: number;
  /** Tilt in degrees. */
  tiltDeg: number;
  /** Hardpoint offset from the arm centreline, m. */
  dx: number;
  /** Fuel left as a fraction of the starting load. */
  fuelFrac: number;
  manual: boolean;
  wobble: boolean;
}

export interface ScoreBreakdown {
  softness: number;
  drift: number;
  attitude: number;
  alignment: number;
  fuel: number;
  manualBonus: number;
  wobblePenalty: boolean;
}

/** Points per component at a perfect value; they sum to 9000. */
const WEIGHTS = { softness: 2500, drift: 1500, attitude: 1500, alignment: 2000, fuel: 1500 };
/** Closing the arms yourself (instead of waiting for the computer) is worth this much. */
export const MANUAL_BONUS = 1000;

export function scoreCatch(c: CatchConditions): { score: number; breakdown: ScoreBreakdown } {
  const part = (err: number, limit: number) => clamp(1 - Math.abs(err) / limit, 0, 1);
  const softness = Math.round(WEIGHTS.softness * part(c.vy, CATCH_LIMITS.vy));
  const drift = Math.round(WEIGHTS.drift * part(c.vx, CATCH_LIMITS.vx));
  const attitude = Math.round(WEIGHTS.attitude * part(c.tiltDeg, CATCH_LIMITS.tilt));
  const alignment = Math.round(WEIGHTS.alignment * part(c.dx, CATCH_WINDOW.dx));
  const fuel = Math.round(WEIGHTS.fuel * clamp(c.fuelFrac, 0, 1));
  const manualBonus = c.manual && !c.wobble ? MANUAL_BONUS : 0;
  let score = softness + drift + attitude + alignment + fuel + manualBonus;
  // A wobble still counts, but the tower had to absorb it: half points.
  if (c.wobble) score = Math.round(score / 2);
  return {
    score,
    breakdown: { softness, drift, attitude, alignment, fuel, manualBonus, wobblePenalty: c.wobble },
  };
}

export function gradeFor(score: number): string {
  if (score >= 8500) return 'S';
  if (score >= 7000) return 'A';
  if (score >= 5000) return 'B';
  if (score >= 3000) return 'C';
  if (score > 0) return 'D';
  return '–';
}
