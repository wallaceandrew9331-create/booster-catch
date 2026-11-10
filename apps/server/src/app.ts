import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { dateKey, LEVELS, SIM_VERSION } from '@booster/sim';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Store } from './db.ts';
import { verifySubmission, type Submission } from './verify.ts';

export interface AppOptions {
  store: Store;
  /** Allowed browser origins; '*' for any. */
  corsOrigin?: string | string[];
  /** Injectable clock so tests can pin "today". */
  now?: () => Date;
  /** Submissions per minute per IP. */
  submitPerMinute?: number;
  logger?: boolean;
  trustProxy?: boolean;
}

type BoardQuery = { board?: string; date?: string; id?: string; limit?: string };

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  // A 90 s run is at most a few thousand input events: 256 KB is plenty.
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024, trustProxy: opts.trustProxy ?? false });

  await app.register(cors, { origin: opts.corsOrigin ?? '*', methods: ['GET', 'POST'] });
  // Global ceiling for reads; submissions get a much tighter per-route limit
  // because each one costs a full re-simulation.
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });

  app.get('/api/health', async () => ({ ok: true, simVersion: SIM_VERSION }));

  app.post<{ Body: Submission }>(
    '/api/runs',
    { config: { rateLimit: { max: opts.submitPerMinute ?? 12, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const started = performance.now();
      const verdict = verifySubmission(req.body ?? ({} as Submission), now());
      const ms = (performance.now() - started).toFixed(1);
      if (!verdict.ok) {
        req.log.info({ error: verdict.error, ms }, 'run rejected');
        return reply.code(verdict.status).send({ accepted: false, error: verdict.error });
      }
      const { improved, rank } = store.save(verdict.run, SIM_VERSION);
      req.log.info({ board: verdict.run.board, key: verdict.run.key, score: verdict.run.score, ms }, 'run verified');
      return { accepted: true, score: verdict.run.score, grade: verdict.run.grade, rank, improved };
    },
  );

  app.get<{ Querystring: BoardQuery }>('/api/leaderboard', async (req, reply) => {
    const q = parseBoard(req.query, now());
    if (!q) return reply.code(400).send({ error: 'board must be daily (with date), alltime, or level (with id)' });
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const entries = q.board === 'alltime' ? store.allTime(limit) : store.top(q.board, q.key, limit);
    return { entries };
  });

  app.get<{ Querystring: BoardQuery }>('/api/ghost', async (req, reply) => {
    const q = parseBoard(req.query, now());
    if (!q || q.board === 'alltime') return reply.code(400).send({ error: 'ghosts exist for daily and level boards' });
    return { run: store.leader(q.board, q.key, SIM_VERSION) };
  });

  return app;
}

function parseBoard(q: BoardQuery, now: Date): { board: 'daily' | 'level'; key: string } | { board: 'alltime' } | null {
  if (q.board === 'alltime') return { board: 'alltime' };
  if (q.board === 'daily') {
    const date = q.date ?? dateKey(now);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { board: 'daily', key: date } : null;
  }
  if (q.board === 'level' && LEVELS.some((l) => l.id === q.id)) return { board: 'level', key: q.id! };
  return null;
}
