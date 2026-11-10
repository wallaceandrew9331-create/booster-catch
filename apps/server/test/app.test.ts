import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SIM_VERSION, type Mode } from '@booster/sim';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/db.ts';
import { DAY, legitRun, NOON } from './fixtures.ts';

const daily: Mode = { kind: 'daily', date: DAY };
const run = legitRun(daily);
const calm = legitRun({ kind: 'level', id: 'calm' });

describe('HTTP API', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    store = new Store(':memory:');
    app = await buildApp({ store, now: NOON, submitPerMinute: 5 });
  });
  afterEach(async () => {
    await app.close();
    store.close();
  });

  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/runs', payload });
  const body = (name: string, r = run, mode: Mode = daily) => ({ simVersion: SIM_VERSION, mode, name, inputs: r.inputs, claimedScore: r.score });

  it('health', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true, simVersion: SIM_VERSION });
  });

  it('verifies, stores and ranks a run, then serves it as the ghost', async () => {
    const res = await post(body('Ace'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, score: run.score, rank: 1 });

    const board = await app.inject(`/api/leaderboard?board=daily&date=${DAY}`);
    expect(board.json().entries).toEqual([{ rank: 1, name: 'Ace', score: run.score, grade: expect.any(String) }]);

    const ghost = await app.inject(`/api/ghost?board=daily&date=${DAY}`);
    expect(ghost.json().run).toMatchObject({ name: 'Ace', score: run.score, inputs: run.inputs });

    const alltime = await app.inject('/api/leaderboard?board=alltime');
    expect(alltime.json().entries[0]).toMatchObject({ name: 'Ace', date: DAY });
  });

  it('keeps one best per player per board', async () => {
    await post(body('Ace'));
    const again = await post(body('Ace')); // same score: no duplicate, not an improvement
    expect(again.json()).toMatchObject({ accepted: true, improved: false, rank: 1 });
    await post(body('Bee', calm, { kind: 'level', id: 'calm' }));
    expect((await app.inject(`/api/leaderboard?board=daily&date=${DAY}`)).json().entries).toHaveLength(1);
    expect((await app.inject('/api/leaderboard?board=level&id=calm')).json().entries).toMatchObject([{ name: 'Bee', score: calm.score }]);
  });

  it('rejects a forged score with 422 and stores nothing', async () => {
    const res = await post({ ...body('Cheat'), claimedScore: 9999 });
    expect(res.statusCode).toBe(422);
    expect(res.json().accepted).toBe(false);
    expect((await app.inject(`/api/leaderboard?board=daily&date=${DAY}`)).json().entries).toEqual([]);
  });

  it('rate-limits submissions per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post(body(`P${i}`))).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });

  it('rejects oversized bodies', async () => {
    const huge = { ...body('Big'), inputs: Array.from({ length: 40000 }, (_, i) => [i, 0]) };
    expect((await post(huge)).statusCode).toBe(413);
  });

  it('validates board queries', async () => {
    expect((await app.inject('/api/leaderboard?board=nope')).statusCode).toBe(400);
    expect((await app.inject('/api/ghost?board=alltime')).statusCode).toBe(400);
  });
});
