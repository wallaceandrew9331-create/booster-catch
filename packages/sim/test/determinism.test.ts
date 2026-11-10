import { describe, expect, it } from 'vitest';
import { configFor, createSim, hashState, Input, replay, SIM_VERSION, step } from '../src/index.ts';
import { flyAutopilot } from './helpers.ts';

describe('determinism', () => {
  const cfg = configFor({ kind: 'free', seed: 12345 });

  it('replaying the recorded input log reproduces the live run bit for bit', () => {
    const live = flyAutopilot(cfg);
    const replayed = replay(cfg, live.log);
    expect(replayed.tick).toBe(live.state.tick);
    expect(replayed.outcome).toEqual(live.state.outcome);
    expect(hashState(replayed)).toBe(hashState(live.state));
  });

  it('two replays of the same log give identical hashes at every tick', () => {
    const { log } = flyAutopilot(cfg);
    const a = createSim(cfg);
    const b = createSim(cfg);
    const masks = new Map(log.map(([t, m]) => [t, m]));
    let mask = 0;
    while (!a.outcome) {
      mask = masks.get(a.tick) ?? mask;
      step(a, mask);
      step(b, mask);
      if (a.tick % 240 === 0) expect(hashState(a)).toBe(hashState(b));
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it('a single different input changes the end state', () => {
    const { log } = flyAutopilot(cfg);
    const tampered = [...log];
    const [t, m] = tampered[10]!;
    tampered[10] = [t, m ^ Input.Left]; // flip one bit for one stretch of ticks
    expect(hashState(replay(cfg, tampered))).not.toBe(hashState(replay(cfg, log)));
  });

  it('a different seed changes the run', () => {
    const { log } = flyAutopilot(cfg);
    const other = configFor({ kind: 'free', seed: 54321 });
    expect(hashState(replay(other, log))).not.toBe(hashState(replay(cfg, log)));
  });

  /**
   * Golden values pin the physics. If this fails after an intentional physics
   * change, bump SIM_VERSION (old replays no longer reproduce) and update the
   * hashes. If it fails without one, something nondeterministic crept in, or a
   * JS engine disagrees with us: that's exactly what this test is for.
   */
  it('matches the golden end-state hashes for this SIM_VERSION', () => {
    expect(SIM_VERSION).toBe(1);
    const golden: Record<string, string> = {
      free12345: hashState(flyAutopilot(cfg).state),
      calm: hashState(flyAutopilot(configFor({ kind: 'level', id: 'calm' })).state),
      daily: hashState(flyAutopilot(configFor({ kind: 'daily', date: '2026-11-09' })).state),
    };
    expect(golden).toMatchInlineSnapshot(`
      {
        "calm": "6c5199208b9c5e83",
        "daily": "96bd43183e87818a",
        "free12345": "3d84b83f6c675fbf",
      }
    `);
  });
});
