/**
 * Tuning sweep: fly the autopilot through many seeds of every mode and print
 * the outcome mix. Used while tuning constants.ts; see README "Tuning".
 *   npm run sim:sweep -- [runs-per-mode]
 */
import { Autopilot, configFor, createSim, dateKey, DT, LEVELS, step, type Mode } from '../src/index.ts';

const runs = Number(process.argv[2] ?? 200);
const modes: [string, (i: number) => Mode][] = [
  ['free', (i) => ({ kind: 'free', seed: i * 7919 + 1 })],
  ...LEVELS.map((l) => [l.id, () => ({ kind: 'level', id: l.id })] as [string, (i: number) => Mode]),
  ['daily', (i) => ({ kind: 'daily', date: dateKey(new Date(Date.UTC(2026, 0, 1 + i))) })],
];

for (const [name, mk] of modes) {
  const counts: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  let scoreSum = 0;
  let caught = 0;
  let secs = 0;
  const n = name === 'free' || name === 'daily' ? runs : 1;
  for (let i = 0; i < n; i++) {
    const s = createSim(configFor(mk(i)));
    const ap = new Autopilot();
    while (!s.outcome) step(s, ap.next(s));
    const o = s.outcome!;
    counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    reasons[o.reason] = (reasons[o.reason] ?? 0) + 1;
    secs += o.tick * DT;
    if (o.score > 0) {
      caught++;
      scoreSum += o.score;
    }
  }
  console.log(
    name.padEnd(6),
    JSON.stringify(counts),
    `avg ${(secs / n).toFixed(1)}s`,
    caught ? `avgScore ${Math.round(scoreSum / caught)}` : '',
    JSON.stringify(reasons),
  );
}
