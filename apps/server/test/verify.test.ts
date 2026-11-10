import { describe, expect, it } from 'vitest';
import { Input, SIM_VERSION, type InputEvent } from '@booster/sim';
import { verifySubmission } from '../src/verify.ts';
import { DAY, legitRun, NOON } from './fixtures.ts';

const daily = { kind: 'daily', date: DAY } as const;
const run = legitRun(daily);
const submit = (over: Record<string, unknown> = {}, now = NOON()) =>
  verifySubmission({ simVersion: SIM_VERSION, mode: daily, name: 'Ace', inputs: run.inputs, claimedScore: run.score, ...over }, now);

describe('verifySubmission', () => {
  it('fixture is a real catch', () => {
    expect(run.score).toBeGreaterThan(0);
  });

  it('accepts a genuine run and scores it itself', () => {
    expect(submit()).toMatchObject({ ok: true, run: { board: 'daily', key: DAY, name: 'Ace', score: run.score } });
  });

  it('rejects an inflated claimed score', () => {
    expect(submit({ claimedScore: 10000 })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining('score mismatch') });
  });

  it('rejects tampered inputs: the replay no longer produces the claimed score', () => {
    const inputs = run.inputs.map(([t, m]) => [t, m & ~Input.Clamp] as InputEvent).slice(0, -5);
    expect(submit({ inputs }).ok).toBe(false);
  });

  it('rejects a run for a closed daily', () => {
    expect(submit({ mode: { kind: 'daily', date: '2026-11-01' } })).toMatchObject({ ok: false, error: 'that daily challenge is closed' });
  });

  it("still accepts yesterday's daily just after midnight", () => {
    expect(submit({}, new Date('2026-11-10T00:05:00Z')).ok).toBe(true);
  });

  it('does not let a daily run be replayed against another day', () => {
    // Same inputs under tomorrow's seed and wind: a different flight entirely.
    const v = submit({ mode: { kind: 'daily', date: '2026-11-10' } }, new Date('2026-11-10T12:00:00Z'));
    expect(v.ok).toBe(false);
  });

  it('refuses free play (client-chosen seeds can be cherry-picked)', () => {
    expect(submit({ mode: { kind: 'free', seed: 1 } })).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses inputs no human could produce', () => {
    const bot: InputEvent[] = Array.from({ length: 300 }, (_, t) => [t, t % 2 ? Input.Left : Input.Right]);
    expect(submit({ inputs: bot })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining('impossible inputs') });
  });

  it.each([
    ['garbage inputs', { inputs: 'lol' }],
    ['bad mask', { inputs: [[0, 999]] }],
    ['old game version', { simVersion: SIM_VERSION - 1 }],
    ['bad name', { name: '<script>' }],
    ['unknown level', { mode: { kind: 'level', id: 'moon' } }],
    ['missing mode', { mode: null }],
  ])('rejects %s', (_n, over) => {
    expect(submit(over).ok).toBe(false);
  });

  it('rejects runs that crash', () => {
    expect(submit({ inputs: [], claimedScore: 0 })).toMatchObject({ ok: false, error: 'that run did not end in a catch' });
  });

  it('rejects inputs padded past the end of the run', () => {
    const padded = [...run.inputs, [run.inputs.at(-1)![0] + 2000, 0] as InputEvent];
    expect(submit({ inputs: padded })).toMatchObject({ ok: false, error: 'inputs continue after the run ended' });
  });

  it('re-simulates a run in a few milliseconds', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) submit();
    expect((performance.now() - t0) / 10).toBeLessThan(50);
  });
});
