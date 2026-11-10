import { DRY_MASS, G, MAX_THRUST } from './constants.ts';
import { clamp } from './dmath.ts';
import { Input } from './input.ts';
import { ArmPhase, hardpointError, type SimState } from './sim.ts';

/**
 * A simple autopilot that flies the booster with the same 6-bit inputs a
 * player has. It exists for three reasons:
 *  - tests need realistic logs that end in a catch (server verification),
 *  - the tuning sweep uses it to check that every mode is catchable,
 *  - the title screen flies it as an attract-mode demo.
 *
 * It only changes its keys every `decideEvery` ticks (20 Hz by default), so its
 * logs look like a busy human's and pass the input-density check. Digital keys
 * can't hold the stick at 40%, so it pulse-width-modulates: press while the
 * smoothed steering command is short of the target, release when past it.
 */
export class Autopilot {
  private mask = 0;
  private lit = false;

  constructor(private readonly decideEvery = 6) {}

  next(s: SimState): number {
    if (s.tick % this.decideEvery === 0) this.mask = this.decide(s);
    return this.mask;
  }

  private decide(s: SimState): number {
    let mask = 0;
    const hp = hardpointError(s);
    const height = hp.dy; // hardpoints above the arms
    const mass = DRY_MASS + s.fuel;

    // Ignite when the stopping distance at ~80% throttle reaches the height
    // left. Near terminal velocity drag already cancels gravity, so the burn's
    // deceleration is roughly the thrust itself.
    const decel = (MAX_THRUST * 0.8) / mass;
    const stopDist = (s.vy * s.vy) / (2 * decel);
    if (!s.engineOn && !this.lit && s.vy < 0 && height < stopDist + 40) {
      this.lit = true;
      return Input.Engine; // a tap: the next decision releases it
    }

    let u: number; // desired steering, -1..1
    if (!s.engineOn) {
      // Falling: the grid fins push sideways almost directly.
      const wantVx = clamp(-hp.dx * 0.3, -70, 70);
      u = clamp((wantVx - s.vx) * 0.15, -1, 1);
    } else {
      // Powered: pick a sideways speed, then the tilt that produces it, then a
      // PD steer toward that tilt.
      // sqrt profile: the speed from which we can still brake to zero in |dx|.
      const wantVx = -Math.sign(hp.dx) * Math.min(12, Math.sqrt(2 * 0.5 * Math.abs(hp.dx)));
      const wantTilt = clamp((wantVx - s.vx) * 0.15, -0.3, 0.3);
      u = clamp((wantTilt - s.angle) * 6 - s.omega * 4, -1, 1);

      // Vertical: a descent profile that slows to ~1.2 m/s at the arms, holding
      // a little above them until lined up.
      const holdH = Math.abs(hp.dx) > 3 ? Math.min(25, 3 + Math.abs(hp.dx) * 0.6) : 0;
      const above = height - holdH;
      const wantVy = above > 0 ? -Math.min(1.2 + Math.sqrt(2 * 4 * above), 120) : -above * 0.6;
      const accelNeeded = (wantVy - hp.vy) * 1.5 + G;
      const wantThrottle = clamp((accelNeeded * mass) / MAX_THRUST, 0, 1);
      if (wantThrottle > s.throttleCmd + 0.03) mask |= Input.ThrottleUp;
      else if (wantThrottle < s.throttleCmd - 0.03) mask |= Input.ThrottleDown;
    }
    if (u > 0.05 && s.steer < u) mask |= Input.Right;
    else if (u < -0.05 && s.steer > u) mask |= Input.Left;

    // Close the arms ourselves when it looks good: that's worth the manual bonus.
    const lined = Math.abs(hp.dx) < 2.2 && hp.dy > -1 && hp.dy < 3.5;
    const gentle = Math.abs(hp.vy) < 3 && Math.abs(s.vx) < 1.8 && Math.abs(s.angle) < 0.09;
    if (s.armPhase === ArmPhase.Open && lined && gentle) mask |= Input.Clamp;
    return mask;
  }
}
