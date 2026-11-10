import { SIM_VERSION, type InputLog } from '@booster/sim';

/** A saved run: enough to replay it as a ghost or resubmit it. */
export interface SavedRun {
  simVersion: number;
  seed: number;
  score: number;
  grade: string;
  inputs: InputLog;
  name?: string;
}

/**
 * localStorage wrapper. Every access is guarded: private windows and some
 * embedded browsers throw on storage, and the game must still run.
 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: bests just won't persist */
  }
}

const PREFIX = 'booster-catch:';

export const store = {
  best(modeKey: string): SavedRun | null {
    const run = read<SavedRun | null>(`${PREFIX}best:${modeKey}`, null);
    // A best from an older physics version can't be replayed faithfully.
    return run && run.simVersion === SIM_VERSION ? run : null;
  },
  saveBestIfBetter(modeKey: string, run: SavedRun): boolean {
    const prev = this.best(modeKey);
    if (prev && prev.score >= run.score) return false;
    write(`${PREFIX}best:${modeKey}`, run);
    return true;
  },
  get callsign(): string {
    return read(`${PREFIX}callsign`, '');
  },
  set callsign(v: string) {
    write(`${PREFIX}callsign`, v);
  },
  get unlocked(): number {
    return read(`${PREFIX}unlocked`, 1);
  },
  set unlocked(v: number) {
    write(`${PREFIX}unlocked`, v);
  },
  get muted(): boolean {
    return read(`${PREFIX}muted`, false);
  },
  set muted(v: boolean) {
    write(`${PREFIX}muted`, v);
  },
  get ghosts(): boolean {
    return read(`${PREFIX}ghosts`, true);
  },
  set ghosts(v: boolean) {
    write(`${PREFIX}ghosts`, v);
  },
  get seenHelp(): boolean {
    return read(`${PREFIX}seenHelp`, false);
  },
  set seenHelp(v: boolean) {
    write(`${PREFIX}seenHelp`, v);
  },
};
