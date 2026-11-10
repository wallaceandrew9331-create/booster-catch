import { describe, expect, it } from 'vitest';
import { configFor, createSim, step } from '@booster/sim';
import { lerpSnapshot, snapshot } from '../src/render/view.ts';
import { modeKey, nextLevel } from '../src/modes.ts';

describe('render interpolation', () => {
  it('blends between the last two ticks', () => {
    const s = createSim(configFor({ kind: 'level', id: 'calm' }));
    const a = snapshot(s);
    step(s, 0);
    const b = snapshot(s);
    const mid = lerpSnapshot(a, b, 0.5);
    expect(mid.y).toBeCloseTo((a.y + b.y) / 2, 9);
    expect(lerpSnapshot(a, b, 0)).toEqual(a);
    expect(lerpSnapshot(a, b, 1).y).toBe(b.y);
  });
});

describe('modes', () => {
  it('free play shares one best across seeds; dailies are per date', () => {
    expect(modeKey({ kind: 'free', seed: 1 })).toBe(modeKey({ kind: 'free', seed: 2 }));
    expect(modeKey({ kind: 'daily', date: '2026-11-09' })).not.toBe(modeKey({ kind: 'daily', date: '2026-11-10' }));
  });

  it('levels chain in order and end after the sea platform', () => {
    expect(nextLevel({ kind: 'level', id: 'calm' })).toEqual({ kind: 'level', id: 'gusty' });
    expect(nextLevel({ kind: 'level', id: 'sea' })).toBeNull();
  });
});
