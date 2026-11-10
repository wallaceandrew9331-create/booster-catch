/**
 * All sound is synthesised with WebAudio: no audio files to download, and
 * every effect can follow the sim continuously (engine pitch tracks throttle,
 * wind roar tracks dynamic pressure).
 *
 * Browsers only allow audio after a user gesture, so the context is created
 * lazily by `unlock()` on the first key press or tap.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    // Two seconds of white noise, looped, is the raw material for engine,
    // wind, explosions and clanks.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine: low-passed noise plus a sub rumble.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.loopNoise().connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.value = 42;
    const subFilter = ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.value = 120;
    sub.connect(subFilter).connect(this.engineGain);
    sub.start();

    // Wind / re-entry roar: band-passed noise.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windFilter.frequency.value = 800;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  /** Called every frame with the current engine output (0..1) and dynamic pressure. */
  update(thrust: number, q: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(thrust * 0.55, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(220 + thrust * 900, t, 0.08);
    const roar = Math.min(1, q / 9000);
    this.windGain.gain.setTargetAtTime(roar * 0.35 + 0.015, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + roar * 1400, t, 0.15);
  }

  silence(): void {
    this.update(0, 0);
  }

  private burst(duration: number, filterFrom: number, filterTo: number, gain: number, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFrom, t);
    f.frequency.exponentialRampToValueAtTime(filterTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration);
  }

  private tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  ignite(): void {
    this.burst(0.5, 3000, 200, 0.7);
    this.tone(90, 0, 0.4, 0.4, 'triangle', 45);
  }

  shutdown(): void {
    this.burst(0.25, 1200, 150, 0.25);
  }

  denied(): void {
    this.tone(180, 0, 0.12, 0.2, 'square');
    this.tone(140, 0.13, 0.15, 0.2, 'square');
  }

  armsMoving(): void {
    this.tone(70, 0, 0.4, 0.2, 'sawtooth', 110);
  }

  clank(): void {
    this.burst(0.35, 5000, 400, 0.6, 'bandpass');
    this.tone(220, 0, 0.5, 0.35, 'square', 180);
    this.tone(331, 0, 0.6, 0.2, 'triangle');
  }

  miss(): void {
    this.tone(160, 0, 0.25, 0.25, 'square', 120);
  }

  explode(): void {
    this.burst(2.2, 2500, 40, 1.2);
    this.burst(0.6, 8000, 600, 0.5, 'highpass');
    this.tone(70, 0, 1.2, 0.9, 'sine', 25);
  }

  success(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.25 + i * 0.09, 0.5, 0.18, 'triangle'));
  }

  wobble(): void {
    this.tone(110, 0, 0.9, 0.3, 'sawtooth', 70);
  }

  beep(): void {
    this.tone(880, 0, 0.08, 0.12, 'square');
  }
}
