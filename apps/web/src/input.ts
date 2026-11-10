import { Input } from '@booster/sim';

/**
 * Turns keyboard and touch into the sim's 6-bit input mask.
 *
 * The sim samples input once per tick (120 Hz) but a quick tap can start and
 * end between two ticks. Taps are therefore latched: a key that went down
 * since the last sample counts as held for that sample, so no press is lost.
 */
export class Controls {
  private held = 0;
  private latched = 0;
  /** Non-sim actions (restart, menu, ...), consumed by the game each frame. */
  readonly actions: string[] = [];

  private static readonly KEYS: Record<string, number> = {
    KeyW: Input.ThrottleUp,
    ArrowUp: Input.ThrottleUp,
    KeyS: Input.ThrottleDown,
    ArrowDown: Input.ThrottleDown,
    KeyA: Input.Left,
    ArrowLeft: Input.Left,
    KeyD: Input.Right,
    ArrowRight: Input.Right,
    Space: Input.Engine,
    KeyC: Input.Clamp,
    KeyE: Input.Clamp,
  };

  private static readonly ACTIONS: Record<string, string> = {
    KeyR: 'restart',
    Enter: 'restart',
    Escape: 'menu',
    KeyM: 'mute',
    KeyG: 'ghost',
  };

  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('input')) return; // typing a callsign
      const bit = Controls.KEYS[e.code];
      if (bit !== undefined) {
        this.press(bit);
        e.preventDefault();
        return;
      }
      const action = Controls.ACTIONS[e.code];
      if (action && !e.repeat) {
        this.actions.push(e.shiftKey && action === 'restart' ? 'retry-same' : action);
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => {
      const bit = Controls.KEYS[e.code];
      if (bit !== undefined) this.release(bit);
    });
    // Losing focus with a key down would otherwise leave it stuck "held".
    target.addEventListener('blur', () => (this.held = 0));
  }

  /** Wire an on-screen button (touch or mouse) to an input bit, multi-touch safe. */
  bindButton(el: HTMLElement, bit: number): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      this.press(bit);
    };
    const up = (e: PointerEvent) => {
      e.preventDefault();
      el.classList.remove('active');
      this.release(bit);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  press(bit: number): void {
    this.held |= bit;
    this.latched |= bit;
  }

  release(bit: number): void {
    this.held &= ~bit;
  }

  /** The mask for the next tick: everything held now plus anything tapped since the last sample. */
  sample(): number {
    const mask = this.held | this.latched;
    this.latched = 0;
    return mask;
  }

  reset(): void {
    this.held = 0;
    this.latched = 0;
  }
}
