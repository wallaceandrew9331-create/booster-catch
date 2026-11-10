/**
 * Physical and gameplay constants. Units are SI (metres, seconds, m/s^2)
 * except mass, which is normalised so the dry booster weighs 1.
 *
 * These numbers are tuned for fun first and realism second; the README's
 * "Tuning" section explains the choices. Changing anything here changes
 * every replay, so bump SIM_VERSION when you do.
 */

/** Bump whenever physics changes: old input logs no longer reproduce. */
export const SIM_VERSION = 1;

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;
/** Hard cap on a run: 90 s. A normal attempt lasts 25-35 s. */
export const MAX_TICKS = 90 * TICK_HZ;

export const G = 9.81;

// --- Booster ---------------------------------------------------------------
export const BOOSTER_LENGTH = 70;
export const BOOSTER_WIDTH = 9;
/** Centre of mass, measured up from the engine end. */
export const COM_FROM_BOTTOM = 28;
/** Catch hardpoints the arms close under, measured up from the engine end. */
export const HARDPOINT_FROM_BOTTOM = 58;

export const DRY_MASS = 1;
/** Maximum thrust as an acceleration on a 1-mass booster (= 2.5 g at full fuel 0.36). */
export const MAX_THRUST = 34;
/**
 * Engines can't throttle to zero once lit; below this they'd flame out.
 * At 0.2 a near-empty booster still sinks at ~3 m/s^2 on minimum throttle.
 * Playtests at 0.3 left a light booster floating upward with no way down
 * except cutting the engine, which felt unfair rather than hard.
 */
export const MIN_THROTTLE = 0.2;
/** Fuel mass burned per second at 100% throttle. */
export const BURN_RATE = 0.026;
/** Ignition takes time: thrust ramps in over this many seconds. */
export const SPOOL_UP_S = 0.45;
/** Actual throttle chases the command with this time constant. */
export const THROTTLE_LAG_S = 0.12;
/** How fast holding throttle up/down moves the command (fraction per second). */
export const THROTTLE_RATE = 0.9;
/** How fast the steering command follows the stick (per second). */
export const STEER_RATE = 5;

// --- Aerodynamics ----------------------------------------------------------
/** Scale height for the density approximation (see density()). */
export const DENSITY_SCALE = 7000;
/** Axial drag: terminal velocity ~150 m/s at sea level, full fuel. */
export const CD_AXIAL = 5.9e-4;
/** Broadside drag on a big cylinder. */
export const CD_SIDE = 2.6e-3;
/**
 * Extra speed added to the side-drag term so a crosswind still pushes the
 * booster when it is almost hovering. Pure quadratic drag would make wind
 * vanish exactly when the catch gets interesting.
 */
export const SIDE_DRAG_FLOOR = 25;
/** Lateral force per unit dynamic pressure from grid-fin deflection. */
export const FIN_LIFT = 2.2e-3;
/** Torque per unit dynamic pressure from grid-fin deflection. */
export const FIN_TORQUE = 2.0e-5;
/** Fins sit above the centre of mass, so airflow pushes the nose back upright. */
export const AERO_STABILITY = 1.4e-4;
/** Crosswind also twists the booster a little (centre of pressure above CoM). */
export const WIND_TORQUE = 4e-4;

// --- Engine steering -------------------------------------------------------
/**
 * Engine-gimbal angular acceleration at full deflection is
 * GIMBAL_TORQUE * sqrt(thrust acceleration). Physically it's linear in
 * thrust (T * sin(gimbal) * lever), but playtests found that made full
 * throttle twitchy (a half-second tap overshot to 20 degrees of tilt) and
 * hover mushy. The square root keeps both ends controllable.
 */
export const GIMBAL_TORQUE = 0.2;
/** Tilt beyond this is unrecoverable: the booster breaks up. */
export const MAX_TILT = 1.3;

// --- Tower -----------------------------------------------------------------
export const TOWER_FACE_X = 14;
export const TOWER_WIDTH = 16;
export const TOWER_HEIGHT = 140;
/** Height of the catch arms above the ground/deck. */
export const ARM_Y = 92;
export const MOUNT_HALF_WIDTH = 8;
export const MOUNT_HEIGHT = 18;
/** Arms take this long to swing shut. */
export const ARM_CLOSE_S = 0.4;
/** After closing on nothing the arms reopen for another try. */
export const ARM_REOPEN_S = 0.7;

/** Where the hardpoints must be when the arms finish closing. */
export const CATCH_WINDOW = { dx: 3.2, dyLow: -2.5, dyHigh: 4 };

/** Envelope the tower computer waits for before clamping on its own. */
export const AUTO_CLAMP = { dx: 1.8, dyLow: -1.5, dyHigh: 2.5, vy: 3.5, vx: 2.0, tilt: 6, omega: 0.15 };

/**
 * Limits for a clean catch, judged when the arms close. Each error is
 * value/limit; the worst one decides catch (<= 1) vs wobble (<= WOBBLE_MAX)
 * vs crash.
 */
export const CATCH_LIMITS = { vy: 4.5, vx: 2.5, tilt: 8, omega: 0.3 };
export const WOBBLE_MAX = 1.7;

/** Leaving this box means the booster is lost. */
export const WORLD = { minX: -3000, maxX: 3000, maxY: 4000 };
