import { Autopilot, createSim, InputRecorder, step, type InputLog, type RunConfig, type SimState } from '../src/index.ts';

/** Fly a run live with the autopilot, recording inputs like the browser does. */
export function flyAutopilot(cfg: RunConfig): { state: SimState; log: InputLog } {
  const state = createSim(cfg);
  const ap = new Autopilot();
  const rec = new InputRecorder();
  while (!state.outcome) {
    const mask = ap.next(state);
    rec.record(state.tick, mask);
    step(state, mask);
  }
  return { state, log: rec.log };
}
