import { hashString, range } from './rng.ts';

/**
 * Everything that varies between modes. A run is fully defined by
 * (LevelDef, seed); the seed then picks the exact start state and wind.
 */
export interface LevelDef {
  id: string;
  name: string;
  blurb: string;
  /** Start altitude of the booster's centre of mass, m. */
  startAlt: number;
  /** Start horizontal offset magnitude range, m (side is random). */
  startOffset: [number, number];
  /** Start drift toward/away from the tower, m/s. */
  startDrift: [number, number];
  startVy: number;
  /** Max steady wind per altitude layer, m/s (wind shear). */
  shear: number;
  /** Max gust strength on top of the layer wind, m/s. */
  gust: number;
  /** Seconds between gust changes. */
  gustEvery: [number, number];
  fuel: number;
  /** Engine ignitions available (the booster starts with the engine off). */
  relights: number;
  /**
   * Flight-computer assistance, 0..1. At 1 the booster holds attitude and
   * springs back upright when you let go; at 0 steering commands angular
   * acceleration and you have to stop rotations yourself.
   */
  assist: number;
  /** Render-only: night sky, tower floodlights. Kept here so replays know. */
  night: boolean;
  /** Sea platform: the whole tower heaves with these waves. */
  sea: { amp: number; period: number } | null;
}

const base = {
  startAlt: 1500,
  startVy: -145,
  gustEvery: [1.2, 3] as [number, number],
  night: false,
  sea: null,
};

export const LEVELS: readonly LevelDef[] = [
  {
    ...base,
    id: 'calm',
    name: '1 · Calm',
    blurb: 'Light air, plenty of fuel. Learn the burn.',
    startOffset: [120, 180],
    startDrift: [-4, 4],
    shear: 2,
    gust: 0,
    fuel: 0.42,
    relights: 3,
    assist: 1,
  },
  {
    ...base,
    id: 'gusty',
    name: '2 · Gusty',
    blurb: 'Wind shear and gusts. Watch the wind arrow.',
    startOffset: [180, 260],
    startDrift: [-8, 8],
    shear: 8,
    gust: 6,
    fuel: 0.35,
    relights: 3,
    assist: 0.8,
  },
  {
    ...base,
    id: 'night',
    name: '3 · Night',
    blurb: 'Dark sky, two relights, less help from the computer.',
    startOffset: [200, 300],
    startDrift: [-10, 10],
    shear: 8,
    gust: 7,
    fuel: 0.33,
    relights: 2,
    assist: 0.45,
    night: true,
  },
  {
    ...base,
    id: 'sea',
    name: '4 · Sea Platform',
    blurb: 'The tower rides a heaving barge. Time the clamp.',
    startOffset: [200, 300],
    startDrift: [-10, 10],
    shear: 9,
    gust: 7,
    fuel: 0.35,
    relights: 2,
    assist: 0.35,
    sea: { amp: 2.2, period: 6.5 },
  },
];

/** Fixed seeds so a level plays the same every time (and ghosts line up). */
export const LEVEL_SEEDS: Record<string, number> = { calm: 101, gusty: 202, night: 303, sea: 404 };

export const FREE_PLAY: LevelDef = {
  ...base,
  id: 'free',
  name: 'Free Play',
  blurb: 'Random conditions every attempt. Moderate wind, full assist.',
  startOffset: [140, 240],
  startDrift: [-6, 6],
  shear: 5,
  gust: 3,
  fuel: 0.4,
  relights: 3,
  assist: 0.9,
};

/** UTC date key, e.g. "2026-11-09". Everyone on Earth shares one daily run. */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dailySeed(date: string): number {
  return hashString(`booster-catch:${date}`);
}

/**
 * The daily challenge's conditions come from the date too, not just the
 * wind: some days are at night, some at sea. Always harder than free play.
 */
export function dailyLevel(date: string): LevelDef {
  const r = { rng: hashString(`daily-level:${date}`) };
  const roll = range(r, 0, 1);
  const sea = roll < 0.3 ? { amp: range(r, 1.4, 2.4), period: range(r, 5.5, 8) } : null;
  return {
    ...base,
    id: 'daily',
    name: `Daily · ${date}`,
    blurb: 'Same wind for everyone today. One leaderboard.',
    startOffset: [200, 300],
    startDrift: [-10, 10],
    shear: range(r, 5, 10),
    gust: range(r, 3, 8),
    fuel: range(r, 0.32, 0.35),
    relights: 2,
    assist: range(r, 0.4, 0.7),
    night: range(r, 0, 1) < 0.35,
    sea,
  };
}

export type Mode =
  | { kind: 'free'; seed: number }
  | { kind: 'daily'; date: string }
  | { kind: 'level'; id: string };

export interface RunConfig {
  level: LevelDef;
  seed: number;
}

/** The one place a mode turns into concrete (level, seed). */
export function configFor(mode: Mode): RunConfig {
  switch (mode.kind) {
    case 'free':
      return { level: FREE_PLAY, seed: mode.seed >>> 0 };
    case 'daily':
      return { level: dailyLevel(mode.date), seed: dailySeed(mode.date) };
    case 'level': {
      const level = LEVELS.find((l) => l.id === mode.id);
      if (!level) throw new Error(`unknown level ${mode.id}`);
      return { level, seed: LEVEL_SEEDS[level.id]! };
    }
  }
}
