/**
 * Deterministic math helpers.
 *
 * ECMAScript only requires `+ - * /` and `Math.sqrt` to be correctly rounded
 * IEEE-754 double operations, so those give bit-identical results in every JS
 * engine. Transcendentals (`Math.sin`, `Math.cos`, `Math.exp`, `Math.pow`,
 * `Math.atan2`, `Math.hypot`, ...) are "implementation-approximated": V8,
 * SpiderMonkey and JavaScriptCore may disagree in the last bit, and one
 * different bit at tick 200 becomes a different landing at tick 3000.
 *
 * So the sim never calls them. Everything it needs is built here from the
 * correctly-rounded basics. ESLint enforces this for packages/sim/src.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const DEG = PI / 180;

// Taylor coefficients, precomputed as literals so nothing depends on
// evaluation order of constant folding.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;

/**
 * sin(x) from a degree-13 Taylor polynomial after range reduction to
 * [-pi/2, pi/2]. Max error there is ~6e-10, far below anything the game can
 * show, and the result depends only on + - * / and Math.round.
 */
export function dsin(x: number): number {
  let r = x - TWO_PI * Math.round(x / TWO_PI); // now in [-pi, pi]
  // sin(pi - r) = sin(r): fold the outer quarters onto the inner half.
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return r * (1 + r2 * (S3 + r2 * (S5 + r2 * (S7 + r2 * (S9 + r2 * (S11 + r2 * S13))))));
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Move `v` toward `target` by at most `maxStep`. */
export function approach(v: number, target: number, maxStep: number): number {
  if (v < target) return Math.min(target, v + maxStep);
  if (v > target) return Math.max(target, v - maxStep);
  return v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
