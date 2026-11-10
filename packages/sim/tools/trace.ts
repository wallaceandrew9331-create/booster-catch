/** Print a flight trace for one mode, flown by the autopilot. npm exec tsx packages/sim/tools/trace.ts calm */
import { Autopilot, configFor, createSim, hardpointError, step, type Mode } from '../src/index.ts';

const arg = process.argv[2] ?? 'calm';
const mode: Mode = arg === 'free' ? { kind: 'free', seed: Number(process.argv[3] ?? 1) }
  : arg === 'daily' ? { kind: 'daily', date: process.argv[3] ?? '2026-11-09' } : { kind: 'level', id: arg };
const s = createSim(configFor(mode));
const ap = new Autopilot();
while (!s.outcome) {
  const m = ap.next(s);
  if (s.tick % 60 === 0) {
    const hp = hardpointError(s);
    console.log(`t=${(s.tick / 120).toFixed(1)} x=${s.x.toFixed(1)} y=${s.y.toFixed(1)} vx=${s.vx.toFixed(1)} vy=${s.vy.toFixed(1)} ang=${(s.angle * 57.3).toFixed(1)} thr=${s.throttle.toFixed(2)}/${s.throttleCmd.toFixed(2)} on=${s.engineOn} fuel=${s.fuel.toFixed(3)} wind=${s.wind.toFixed(1)} hp=${hp.dx.toFixed(1)},${hp.dy.toFixed(1)} mask=${m}`);
  }
  step(s, m);
}
console.log(s.outcome, hardpointError(s), s.x, s.y, s.vx, s.vy);
