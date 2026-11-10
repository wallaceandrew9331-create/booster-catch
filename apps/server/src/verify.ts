import { configFor, dateKey, LEVELS, replay, SIM_VERSION, validateLog, type InputLog, type Mode } from '@booster/sim';

/** What a client sends. Everything here is untrusted. */
export interface Submission {
  simVersion: unknown;
  mode: unknown;
  name: unknown;
  inputs: unknown;
  claimedScore: unknown;
}

export interface VerifiedRun {
  board: 'daily' | 'level';
  /** The date for daily runs, the level id for level runs. */
  key: string;
  name: string;
  score: number;
  grade: string;
  seed: number;
  ticks: number;
  inputs: InputLog;
}

export type Verdict = { ok: true; run: VerifiedRun } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): Verdict => ({ ok: false, status, error });

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  return /^[\w\- .]{1,16}$/.test(name) ? name : null;
}

/**
 * Decide whether a submitted run is real, and what it actually scored.
 *
 * The client's claimed score is never trusted: we rebuild the exact run from
 * the mode (which fixes the seed) and the input log, step the same simulation
 * code the browser ran, and take the score the sim produces. The claim is only
 * compared afterwards so honest clients get a clear error if their build is
 * out of date, and tampering is logged as a mismatch.
 */
export function verifySubmission(body: Submission, now: Date): Verdict {
  if (body.simVersion !== SIM_VERSION) return fail(409, `game version mismatch (server runs sim v${SIM_VERSION}); please reload`);

  const name = sanitizeName(body.name);
  if (!name) return fail(400, 'callsign must be 1-16 letters, digits, spaces, dots or dashes');

  // Only modes with a server-known seed are ranked. Free play lets the client
  // pick the seed, so someone could search for an easy one: unranked.
  const mode = body.mode as Mode | null;
  let board: VerifiedRun['board'];
  let key: string;
  if (mode?.kind === 'daily' && typeof mode.date === 'string') {
    // The daily seed is derived from the date. Accept today and yesterday
    // (UTC) so a run started before midnight can still be submitted after it.
    const today = dateKey(now);
    const yesterday = dateKey(new Date(now.getTime() - 86_400_000));
    if (mode.date !== today && mode.date !== yesterday) return fail(400, 'that daily challenge is closed');
    board = 'daily';
    key = mode.date;
  } else if (mode?.kind === 'level' && typeof mode.id === 'string' && LEVELS.some((l) => l.id === mode.id)) {
    board = 'level';
    key = mode.id;
  } else {
    return fail(400, 'only daily and level runs are ranked');
  }

  const check = validateLog(body.inputs);
  if (!check.ok) return fail(422, `impossible inputs: ${check.error}`);
  const inputs = body.inputs as InputLog;

  // Re-simulate. Build a clean Mode object so nothing extra from the request
  // can leak into the config.
  const cfg = configFor(board === 'daily' ? { kind: 'daily', date: key } : { kind: 'level', id: key });
  const end = replay(cfg, inputs);
  const outcome = end.outcome;
  if (!outcome || outcome.score <= 0) return fail(422, 'that run did not end in a catch');
  const last = inputs[inputs.length - 1];
  if (last && last[0] > outcome.tick + 1) return fail(422, 'inputs continue after the run ended');
  if (body.claimedScore !== outcome.score) return fail(422, `score mismatch: claimed ${String(body.claimedScore)}, replay scored ${outcome.score}`);

  return {
    ok: true,
    run: { board, key, name, score: outcome.score, grade: outcome.grade, seed: cfg.seed, ticks: outcome.tick, inputs },
  };
}
