/**
 * Player input is a 6-bit mask per tick. Keyboard and touch both produce the
 * same mask, which keeps the replay format tiny and makes every input the
 * server sees one of 64 possible values: there is no analog value to forge.
 */
export const Input = {
  ThrottleUp: 1 << 0,
  ThrottleDown: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  /** Rising edge toggles the engine: ignite (uses a relight) or shut down. */
  Engine: 1 << 4,
  /** Rising edge closes the arms. */
  Clamp: 1 << 5,
} as const;

export const INPUT_MASK_ALL = (1 << 6) - 1;

/**
 * A run's input log, run-length encoded: `[tick, mask]` means "from this tick
 * on, the mask is this". Ticks are strictly increasing. A 30 s run is
 * typically 100-300 events, a few KB as JSON.
 */
export type InputEvent = readonly [tick: number, mask: number];
export type InputLog = readonly InputEvent[];

/** Records per-tick masks into an InputLog, emitting only changes. */
export class InputRecorder {
  private readonly events: InputEvent[] = [];
  private last = 0;

  record(tick: number, mask: number): void {
    if (mask !== this.last) {
      this.events.push([tick, mask]);
      this.last = mask;
    }
  }

  get log(): InputLog {
    return this.events;
  }
}

/** Plays an InputLog back one tick at a time. */
export class InputPlayer {
  private i = 0;
  private mask = 0;

  constructor(private readonly log: InputLog) {}

  maskAt(tick: number): number {
    while (this.i < this.log.length && this.log[this.i]![0] <= tick) {
      this.mask = this.log[this.i]![1];
      this.i++;
    }
    return this.mask;
  }
}
