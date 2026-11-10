import { SIM_VERSION, type InputLog, type Mode } from '@booster/sim';

/**
 * Leaderboard client. The server is optional: if VITE_API_URL is unset or
 * the server doesn't answer within a few seconds, every call resolves to
 * null and the game carries on offline with local bests.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  grade: string;
  date?: string;
}

export interface SubmitResult {
  accepted: boolean;
  score?: number;
  rank?: number;
  error?: string;
}

export interface GhostRun {
  name: string;
  score: number;
  seed: number;
  inputs: InputLog;
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!BASE) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
    });
    const body = (await res.json()) as T;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type BoardQuery = { board: 'daily'; date: string } | { board: 'alltime' } | { board: 'level'; id: string };

function boardParams(q: BoardQuery): string {
  const p = new URLSearchParams({ board: q.board });
  if (q.board === 'daily') p.set('date', q.date);
  if (q.board === 'level') p.set('id', q.id);
  return p.toString();
}

export const api = {
  enabled: BASE !== '',

  async health(): Promise<boolean> {
    const r = await call<{ ok: boolean }>('/api/health');
    return r?.ok === true;
  },

  async leaderboard(q: BoardQuery): Promise<BoardEntry[] | null> {
    const r = await call<{ entries: BoardEntry[] }>(`/api/leaderboard?${boardParams(q)}`);
    return r?.entries ?? null;
  },

  async ghost(q: BoardQuery): Promise<GhostRun | null> {
    const r = await call<{ run: GhostRun | null }>(`/api/ghost?${boardParams(q)}`);
    return r?.run ?? null;
  },

  /** Submit (mode, inputs). The claimed score is only a cross-check; the server computes its own. */
  async submit(mode: Mode, name: string, inputs: InputLog, claimedScore: number): Promise<SubmitResult | null> {
    return call<SubmitResult>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ simVersion: SIM_VERSION, mode, name, inputs, claimedScore }),
    });
  },
};
