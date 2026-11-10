import { configFor, dateKey, LEVELS, type Mode } from '@booster/sim';

/** Storage key for a mode's local best. Free play shares one key across seeds. */
export function modeKey(mode: Mode): string {
  switch (mode.kind) {
    case 'free':
      return 'free';
    case 'daily':
      return `daily:${mode.date}`;
    case 'level':
      return `level:${mode.id}`;
  }
}

export function modeLabel(mode: Mode): string {
  switch (mode.kind) {
    case 'free':
      return 'FREE PLAY';
    case 'daily':
      return `DAILY · ${mode.date}${configFor(mode).level.night ? ' · NIGHT' : ''}${configFor(mode).level.sea ? ' · SEA' : ''}`;
    case 'level':
      return `LEVEL ${configFor(mode).level.name.toUpperCase()}`;
  }
}

export function today(): string {
  return dateKey(new Date());
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function nextLevel(mode: Mode): Mode | null {
  if (mode.kind !== 'level') return null;
  const i = LEVELS.findIndex((l) => l.id === mode.id);
  const next = LEVELS[i + 1];
  return next ? { kind: 'level', id: next.id } : null;
}

export function levelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}
