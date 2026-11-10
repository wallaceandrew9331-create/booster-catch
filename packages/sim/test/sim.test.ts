import { describe, expect, it } from 'vitest';
import {
  ArmPhase, configFor, createSim, dailyLevel, dailySeed, dcos, dsin, gradeFor, hashString, Input,
  InputPlayer, InputRecorder, LEVELS, MANUAL_BONUS, MIN_THROTTLE, nextRandom, replay, scoreCatch, SimEvent, step,
  validateLog, type InputEvent,
} from '../src/index.ts';
import { flyAutopilot } from './helpers.ts';

describe('dmath', () => {
  it('dsin/dcos track Math.sin/cos to 1e-9 over many turns', () => {
    for (let x = -50; x <= 50; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-9);
    }
  });
});

describe('rng', () => {
  it('is a pure function of its seed', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    const seqA = Array.from({ length: 5 }, () => nextRandom(a));
    expect(Array.from({ length: 5 }, () => nextRandom(b))).toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('hashes date strings stably', () => {
    expect(hashString('2026-11-09')).toBe(hashString('2026-11-09'));
    expect(dailySeed('2026-11-09')).not.toBe(dailySeed('2026-11-10'));
  });
});

describe('input log', () => {
  it('records only changes and plays them back exactly', () => {
    const masks = [0, 0, 1, 1, 1, 5, 4, 0, 0, 32];
    const rec = new InputRecorder();
    masks.forEach((m, t) => rec.record(t, m));
    expect(rec.log).toEqual([[2, 1], [5, 5], [6, 4], [7, 0], [9, 32]]);
    const player = new InputPlayer(rec.log);
    expect(masks.map((_, t) => player.maskAt(t))).toEqual(masks);
  });

  it('accepts a real log', () => {
    const { log } = flyAutopilot(configFor({ kind: 'free', seed: 7 }));
    expect(validateLog(log)).toEqual({ ok: true });
  });

  it.each([
    ['not an array', { a: 1 }],
    ['bad event shape', [[1, 2, 3]]],
    ['negative tick', [[-1, 1]]],
    ['fractional tick', [[1.5, 1]]],
    ['mask out of range', [[1, 64]]],
    ['out of order', [[10, 1], [10, 0]]],
    ['past the time limit', [[999999, 1]]],
  ])('rejects %s', (_name, log) => {
    expect(validateLog(log).ok).toBe(false);
  });

  it('rejects inputs that change faster than a human could press keys', () => {
    // A bot flipping keys every tick: 120 changes per second.
    const bot: InputEvent[] = Array.from({ length: 200 }, (_, t) => [t, t % 2 ? Input.Left : Input.Right]);
    expect(validateLog(bot)).toMatchObject({ ok: false });
  });
});

describe('modes', () => {
  it('daily conditions depend only on the date', () => {
    expect(configFor({ kind: 'daily', date: '2026-11-09' })).toEqual(configFor({ kind: 'daily', date: '2026-11-09' }));
    expect(dailyLevel('2026-11-09')).not.toEqual(dailyLevel('2026-11-10'));
  });

  it('levels ramp difficulty', () => {
    const [calm, gusty, night, sea] = LEVELS;
    expect(calm!.gust).toBeLessThan(gusty!.gust);
    expect(night!.night).toBe(true);
    expect(night!.assist).toBeLessThan(gusty!.assist);
    expect(sea!.sea).not.toBeNull();
  });
});

describe('flight', () => {
  it('a booster with no inputs falls and crashes', () => {
    const s = replay(configFor({ kind: 'level', id: 'calm' }), []);
    expect(s.outcome?.kind).toBe('crash');
    expect(s.outcome?.score).toBe(0);
  });

  it('the engine has limited relights and a minimum throttle', () => {
    const s = createSim(configFor({ kind: 'level', id: 'night' })); // 2 relights
    const tap = (extra = 0) => {
      step(s, Input.Engine | extra);
      step(s, extra);
    };
    tap();
    expect(s.engineOn).toBe(true);
    for (let i = 0; i < 240; i++) step(s, Input.ThrottleDown);
    expect(s.throttleCmd).toBe(0);
    expect(s.throttle).toBeCloseTo(MIN_THROTTLE, 2); // floor, not zero
    tap(); // shut down
    tap(); // relight #2
    tap(); // shut down
    step(s, Input.Engine); // none left
    expect(s.events & SimEvent.NoRelights).toBeTruthy();
    expect(s.engineOn).toBe(false);
    expect(s.relightsLeft).toBe(0);
  });

  it('closing the arms on nothing misses and reopens them', () => {
    const s = createSim(configFor({ kind: 'level', id: 'calm' }));
    step(s, Input.Clamp);
    expect(s.armPhase).toBe(ArmPhase.Closing);
    let missed = false;
    for (let i = 0; i < 200; i++) {
      step(s, 0);
      if (s.events & SimEvent.ClampMiss) missed = true;
    }
    expect(missed).toBe(true);
    expect(s.armPhase).toBe(ArmPhase.Open);
  });

  it.each(['calm', 'gusty', 'night'])('the autopilot can catch level %s', (id) => {
    const { state } = flyAutopilot(configFor({ kind: 'level', id }));
    expect(['catch', 'wobble']).toContain(state.outcome?.kind);
    expect(state.outcome!.score).toBeGreaterThan(0);
  });

  it('free play is reliably catchable', () => {
    let caught = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state } = flyAutopilot(configFor({ kind: 'free', seed }));
      if (state.outcome!.score > 0) caught++;
    }
    expect(caught).toBeGreaterThanOrEqual(27);
  });
});

describe('scoring', () => {
  const perfect = { vy: 0, vx: 0, tiltDeg: 0, dx: 0, fuelFrac: 1, manual: false, wobble: false };

  it('a perfect auto catch is 9000; clamping yourself adds the bonus', () => {
    expect(scoreCatch(perfect).score).toBe(9000);
    expect(scoreCatch({ ...perfect, manual: true }).score).toBe(9000 + MANUAL_BONUS);
  });

  it('a wobble halves the score and forfeits the bonus', () => {
    expect(scoreCatch({ ...perfect, manual: true, wobble: true }).score).toBe(4500);
  });

  it('every component degrades to zero at its limit', () => {
    const awful = { vy: -10, vx: 10, tiltDeg: 30, dx: 10, fuelFrac: 0, manual: false, wobble: false };
    expect(scoreCatch(awful).score).toBe(0);
  });

  it('grades', () => {
    expect([9500, 7500, 5500, 3500, 100, 0].map(gradeFor)).toEqual(['S', 'A', 'B', 'C', 'D', '–']);
  });
});
