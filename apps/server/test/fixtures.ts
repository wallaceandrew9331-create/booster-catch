import { Autopilot, configFor, createSim, InputRecorder, step, type InputLog, type Mode } from '@booster/sim';

export const DAY = '2026-11-09';
export const NOON = () => new Date(`${DAY}T12:00:00Z`);

/** A genuine run, flown by the autopilot and recorded exactly as the browser records a player. */
export function legitRun(mode: Mode): { inputs: InputLog; score: number } {
  const s = createSim(configFor(mode));
  const ap = new Autopilot();
  const rec = new InputRecorder();
  while (!s.outcome) {
    const m = ap.next(s);
    rec.record(s.tick, m);
    step(s, m);
  }
  return { inputs: rec.log, score: s.outcome!.score };
}
