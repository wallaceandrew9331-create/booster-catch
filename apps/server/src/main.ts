import { buildApp } from './app.ts';
import { Store } from './db.ts';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? './booster-catch.db';
// Comma-separated list of allowed origins, e.g. "https://you.github.io".
const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? '*';

const store = new Store(dbPath);
const app = await buildApp({
  store,
  corsOrigin,
  logger: true,
  trustProxy: process.env.TRUST_PROXY === '1',
  submitPerMinute: Number(process.env.SUBMIT_PER_MINUTE ?? 12),
});

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });
