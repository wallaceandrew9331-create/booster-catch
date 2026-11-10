import './style.css';
import { configFor, dailyLevel, Input, LEVELS, MIN_THROTTLE, SIM_VERSION, type Mode } from '@booster/sim';
import { api, type BoardEntry, type BoardQuery, type GhostRun } from './api.ts';
import { Sound } from './audio.ts';
import { Game, type GhostSpec, type RunResult, type RunSpec } from './game.ts';
import { Controls } from './input.ts';
import { levelIndex, modeKey, modeLabel, nextLevel, randomSeed, today } from './modes.ts';
import { Renderer } from './render/scene.ts';
import { store } from './storage.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const touchUi = document.getElementById('touch')!;
const toastEl = document.getElementById('toast')!;

const renderer = new Renderer(canvas);
const sound = new Sound(store.muted);
const controls = new Controls();
controls.attach(window);

const isTouch = () => matchMedia('(pointer: coarse)').matches;
let screen: 'menu' | 'playing' | 'result' | 'help' | 'board' = 'menu';
let online = false;
let leaderGhost: { date: string; run: GhostRun } | null = null;
let currentMode: Mode = { kind: 'free', seed: randomSeed() };

if (!store.callsign) store.callsign = `Pilot-${Math.floor(1000 + Math.random() * 9000)}`;

const game = new Game(renderer, sound, controls, onRunEnd, isTouch);
game.showGhost = store.ghosts;

// ---- Touch buttons -------------------------------------------------------
const bits: Record<string, number> = {
  left: Input.Left,
  right: Input.Right,
  up: Input.ThrottleUp,
  down: Input.ThrottleDown,
  engine: Input.Engine,
  clamp: Input.Clamp,
};
touchUi.querySelectorAll<HTMLButtonElement>('button[data-bit]').forEach((b) => controls.bindButton(b, bits[b.dataset.bit!]!));
document.getElementById('touch-restart')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  restart(false);
});

// ---- Main loop -----------------------------------------------------------
let last = performance.now();
function loop(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  handleActions();
  game.frame(dt);
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => renderer.resize());
// Any first interaction unlocks audio (browser autoplay policy).
for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => sound.unlock(), { capture: true });

function handleActions() {
  while (controls.actions.length) {
    const a = controls.actions.shift()!;
    if (a === 'mute') toggleMute();
    else if (a === 'ghost') toggleGhost();
    else if (a === 'menu') {
      if (screen === 'playing' || screen === 'result' || screen === 'help' || screen === 'board') showMenu();
    } else if (a === 'restart' || a === 'retry-same') {
      if (screen === 'playing' || screen === 'result') restart(a === 'retry-same');
      else if (screen === 'help') {
        store.seenHelp = true;
        play(currentMode);
      }
    }
  }
}

// ---- Running modes -------------------------------------------------------
function ghostFor(mode: Mode): GhostSpec | null {
  const key = modeKey(mode);
  const mine = store.best(key);
  let ghost: GhostSpec | null = null;
  if (mine) {
    const ghostMode: Mode = mode.kind === 'free' ? { kind: 'free', seed: mine.seed } : mode;
    ghost = { cfg: configFor(ghostMode), log: mine.inputs, label: `YOUR BEST ${mine.score}` };
  }
  // On the daily, race the world leader instead if they're ahead of you.
  if (mode.kind === 'daily' && leaderGhost?.date === mode.date && (!mine || leaderGhost.run.score > mine.score)) {
    ghost = { cfg: configFor(mode), log: leaderGhost.run.inputs, label: `#1 ${leaderGhost.run.name} ${leaderGhost.run.score}` };
  }
  return ghost;
}

function play(mode: Mode, source: RunSpec['source'] = { kind: 'player' }) {
  currentMode = mode;
  if (!store.seenHelp && source.kind === 'player') {
    showHelp(true);
    return;
  }
  screen = 'playing';
  overlay.classList.remove('aside');
  overlay.innerHTML = '';
  const showTouch = isTouch() && source.kind === 'player';
  touchUi.classList.toggle('hidden', !showTouch);
  renderer.bottomInset = showTouch ? 150 : 0;
  const best = store.best(modeKey(mode));
  game.start({
    mode,
    modeLabel: modeLabel(mode),
    source,
    ghost: source.kind === 'player' ? ghostFor(mode) : null,
    best: best?.score ?? null,
  });
}

/** Instant restart. Free play rolls new conditions unless Shift is held. */
function restart(sameSeed: boolean) {
  let mode = currentMode;
  if (mode.kind === 'free' && !sameSeed) mode = { kind: 'free', seed: randomSeed() };
  play(mode);
}

function attract() {
  screen = 'menu';
  touchUi.classList.add('hidden');
  renderer.bottomInset = 0;
  game.start({
    mode: { kind: 'free', seed: randomSeed() },
    modeLabel: '',
    source: { kind: 'autopilot' },
    ghost: null,
    best: null,
    attract: true,
  });
}

function onRunEnd(r: RunResult) {
  if (r.spec.attract) {
    if (screen === 'menu') attract();
    return;
  }
  if (r.spec.source.kind !== 'player') {
    // Replays and autopilot demos never count as your runs.
    showResult(r, false, null);
    return;
  }
  const key = modeKey(r.spec.mode);
  let newBest = false;
  if (r.outcome.score > 0) {
    newBest = store.saveBestIfBetter(key, {
      simVersion: SIM_VERSION,
      seed: r.cfg.seed,
      score: r.outcome.score,
      grade: r.outcome.grade,
      inputs: r.log,
    });
    if (r.spec.mode.kind === 'level') {
      const next = levelIndex(r.spec.mode.id) + 2;
      if (next > store.unlocked) store.unlocked = Math.min(next, LEVELS.length);
    }
  }
  const ranked = r.spec.mode.kind !== 'free' && r.outcome.score > 0;
  showResult(r, newBest, ranked ? r : null);
}

// ---- Screens -------------------------------------------------------------
function showMenu() {
  screen = 'menu';
  overlay.classList.remove('aside');
  attract();
  const date = today();
  const daily = dailyLevel(date);
  const dailyBest = store.best(`daily:${date}`);
  const unlocked = store.unlocked;
  const freeBest = store.best('free');
  overlay.innerHTML = `
    <div class="card">
      <h1>BOOSTER <span>CATCH</span></h1>
      <p class="sub">A rocket booster is falling back to the launch site. Slow it down and steer it between the tower's arms. You get about 30 seconds.</p>
      <div class="menu-grid">
        <button class="primary" data-act="free"><span class="btn-title">Free Play <span>${freeBest ? `best ${freeBest.score}` : ''}</span></span><span class="btn-sub">Random wind every attempt. Start here.</span></button>
        <button data-act="daily"><span class="btn-title">Daily Challenge <span>${dailyBest ? `${dailyBest.grade} · ${dailyBest.score}` : ''}</span></span>
          <span class="btn-sub">${date} · same wind for everyone${daily.night ? ' · night' : ''}${daily.sea ? ' · sea platform' : ''} <span id="daily-leader"></span></span></button>
        <div class="levels">
          ${LEVELS.map((l, i) => {
            const b = store.best(`level:${l.id}`);
            const locked = i + 1 > unlocked;
            return `<button data-act="level" data-id="${l.id}" ${locked ? 'disabled' : ''}><span class="btn-title">${l.name} <span>${b ? b.grade : locked ? '🔒' : ''}</span></span><span class="btn-sub">${l.blurb}</span></button>`;
          }).join('')}
        </div>
        <div class="row">
          <button data-act="board">🏆 Leaderboards</button>
          <button data-act="help">How to play</button>
        </div>
      </div>
      <div class="footer">
        <label>Callsign <input id="callsign" maxlength="16" value="${escapeHtml(store.callsign)}" /></label>
        <button class="chip" data-act="mute">${store.muted ? '🔇' : '🔊'}</button>
        <button class="chip" data-act="ghost">${store.ghosts ? 'Ghost on' : 'Ghost off'}</button>
        <span><span class="dot ${online ? 'on' : 'off'}"></span>${online ? 'Leaderboard online' : api.enabled ? 'Offline · local bests only' : 'Offline build · local bests'}</span>
      </div>
    </div>`;
  const cs = overlay.querySelector<HTMLInputElement>('#callsign')!;
  cs.addEventListener('change', () => {
    const v = cs.value.trim().replace(/[^\w\- .]/g, '').slice(0, 16);
    store.callsign = v || store.callsign;
    cs.value = store.callsign;
  });
  overlay.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      switch (b.dataset.act) {
        case 'free':
          return play({ kind: 'free', seed: randomSeed() });
        case 'daily':
          return play({ kind: 'daily', date });
        case 'level':
          return play({ kind: 'level', id: b.dataset.id! });
        case 'board':
          return showBoard({ board: 'daily', date });
        case 'help':
          return showHelp(false);
        case 'mute':
          toggleMute();
          return showMenu();
        case 'ghost':
          toggleGhost();
          return showMenu();
      }
    }),
  );
  void refreshDailyLeader(date);
}

async function refreshDailyLeader(date: string) {
  if (!online) return;
  const run = await api.ghost({ board: 'daily', date });
  if (run) {
    leaderGhost = { date, run };
    const el = document.getElementById('daily-leader');
    if (el) el.textContent = `· leader ${run.name} ${run.score}`;
  }
}

function showHelp(thenPlay: boolean) {
  screen = 'help';
  overlay.classList.remove('aside');
  touchUi.classList.add('hidden');
  const touch = isTouch();
  overlay.innerHTML = `
    <div class="card">
      <h2>How to fly</h2>
      <p class="sub">You start high and falling fast with the engine off. Steer with the grid fins on the way down, light the engine to slow down, then ease into the arms. They close on their own when you're lined up and slow, or close them yourself for a <b>+1000 bonus</b>.</p>
      <div class="controls-list">
        ${touch ? `
          <span>◀ ▶</span><span>Steer (grid fins while falling, engine gimbal when lit)</span>
          <span>▲ ▼</span><span>Throttle (can't go below ${MIN_THROTTLE * 100}% once lit)</span>
          <span><b>ENG</b></span><span>Engine on / off (limited relights)</span>
          <span><b>CLAMP</b></span><span>Close the arms</span>
          <span>↻</span><span>Instant restart</span>` : `
          <span><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></span><span>Steer (grid fins while falling, engine gimbal when lit)</span>
          <span><kbd>W</kbd> <kbd>S</kbd> / <kbd>↑</kbd> <kbd>↓</kbd></span><span>Throttle (can't go below ${MIN_THROTTLE * 100}% once lit)</span>
          <span><kbd>Space</kbd></span><span>Engine on / off (limited relights)</span>
          <span><kbd>C</kbd></span><span>Close the arms</span>
          <span><kbd>R</kbd></span><span>Instant restart (<kbd>Shift</kbd>+<kbd>R</kbd>: same wind)</span>
          <span><kbd>G</kbd> <kbd>M</kbd> <kbd>Esc</kbd></span><span>Ghost · mute · menu</span>`}
      </div>
      <p class="sub">Tip: light the engine when the HUD says <b>LIGHT ENGINE</b> (around 700 m). The white tick on the throttle bar is hover. Keep the numbers in the top-left green on the way in.</p>
      <div class="row"><button class="primary" id="go">${thenPlay ? 'Fly' : 'Got it'}</button></div>
    </div>`;
  document.getElementById('go')!.addEventListener('click', () => {
    store.seenHelp = true;
    if (thenPlay) play(currentMode);
    else showMenu();
  });
}

function showResult(r: RunResult, newBest: boolean, submit: RunResult | null) {
  screen = 'result';
  touchUi.classList.add('hidden');
  const o = r.outcome;
  const caught = o.kind === 'catch' || o.kind === 'wobble';
  const title = o.kind === 'catch' ? 'CAUGHT!' : o.kind === 'wobble' ? 'WOBBLY CATCH' : o.kind === 'crash' ? 'RAPID UNSCHEDULED DISASSEMBLY' : o.kind === 'lost' ? 'LOST' : 'OUT OF TIME';
  const b = o.breakdown;
  const next = nextLevel(r.spec.mode);
  const nextUnlocked = next && next.kind === 'level' && levelIndex(next.id) + 1 <= store.unlocked;
  overlay.classList.add('aside');
  overlay.innerHTML = `
    <div class="card">
      <div class="result-head">
        <div>
          <h2 class="title-${caught ? (o.kind === 'wobble' ? 'wobble' : 'catch') : 'crash'}" style="${o.kind === 'crash' ? 'font-size:20px' : ''}">${title}</h2>
          <div class="sub" style="margin:4px 0 0">${escapeHtml(o.reason)}</div>
        </div>
        ${caught ? `<div class="grade ${o.grade}">${o.grade}</div>` : ''}
      </div>
      ${caught && b ? `
        <div class="score">${o.score}${newBest ? '<span class="badge">NEW BEST</span>' : ''}</div>
        <table>
          <tr><td>Soft touch (vertical speed)</td><td>${b.softness}</td></tr>
          <tr><td>No sideways slide</td><td>${b.drift}</td></tr>
          <tr><td>Upright</td><td>${b.attitude}</td></tr>
          <tr><td>Centred in the arms</td><td>${b.alignment}</td></tr>
          <tr><td>Fuel left</td><td>${b.fuel}</td></tr>
          ${b.manualBonus ? `<tr><td>Manual clamp bonus</td><td>+${b.manualBonus}</td></tr>` : ''}
          ${b.wobblePenalty ? `<tr><td>Wobble (tower absorbed it)</td><td>×½</td></tr>` : ''}
        </table>` : `<p class="sub">${crashTip(r)}</p>`}
      <div class="status" id="submit-status">${r.spec.source.kind === 'replay' ? 'Replay of your last run, re-simulated from its input log.' : r.spec.mode.kind === 'free' && caught ? 'Free play is unranked. Try the Daily Challenge for the leaderboard.' : ''}</div>
      <div class="row">
        <button class="primary" data-act="retry">Retry <kbd>R</kbd></button>
        ${nextUnlocked && caught ? '<button data-act="next">Next level</button>' : ''}
        <button data-act="replay">Watch replay</button>
        <button data-act="menu">Menu <kbd>Esc</kbd></button>
      </div>
    </div>`;
  overlay.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((btn) =>
    btn.addEventListener('click', () => {
      switch (btn.dataset.act) {
        case 'retry':
          return restart(false);
        case 'next':
          return play(next!);
        case 'replay':
          return play(r.spec.mode, { kind: 'replay', log: r.log });
        case 'menu':
          return showMenu();
      }
    }),
  );
  if (submit) void submitRun(submit);
}

function crashTip(r: RunResult): string {
  const reason = r.outcome.reason;
  if (reason.includes('mount') || reason.includes('ground') || reason.includes('Splash')) return 'Light the engine as soon as the HUD says LIGHT ENGINE, and keep the throttle up until you are slow.';
  if (reason.includes('tower')) return 'Arrive from the open side and kill your sideways speed before the last 50 m.';
  if (reason.includes('hold')) return 'The arms can take about 4.5 m/s down and 2.5 m/s sideways. Slow down more before they close.';
  if (reason.includes('Tumbled')) return "Small steering inputs. Don't let the tilt run away.";
  return 'Press R to try again.';
}

async function submitRun(r: RunResult) {
  const el = () => document.getElementById('submit-status');
  if (!online) {
    const e = el();
    if (e) e.textContent = 'Saved locally. Leaderboard is offline.';
    return;
  }
  const e0 = el();
  if (e0) e0.textContent = 'Submitting. The server re-simulates your run…';
  const res = await api.submit(r.spec.mode, store.callsign, r.log, r.outcome.score);
  const e = el();
  if (!e) return;
  if (res?.accepted) {
    e.className = 'status good';
    e.textContent = `Verified by the server ✓ · rank #${res.rank} on the ${r.spec.mode.kind === 'daily' ? "day's" : 'level'} board`;
    if (r.spec.mode.kind === 'daily') void refreshDailyLeader(r.spec.mode.date);
  } else {
    e.className = 'status bad';
    e.textContent = res?.error ? `Not accepted: ${res.error}` : 'Could not reach the leaderboard; saved locally.';
  }
}

async function showBoard(q: BoardQuery) {
  screen = 'board';
  overlay.classList.remove('aside');
  const tabs: [string, BoardQuery][] = [
    ['Today', { board: 'daily', date: today() }],
    ['All-time daily', { board: 'alltime' }],
    ...LEVELS.map((l) => [l.name.replace(/^\d · /, ''), { board: 'level', id: l.id }] as [string, BoardQuery]),
  ];
  const same = (a: BoardQuery, b: BoardQuery) => JSON.stringify(a) === JSON.stringify(b);
  overlay.innerHTML = `
    <div class="card wide">
      <h2>Leaderboards</h2>
      <p class="sub" style="margin:0">Every score here was recomputed by the server from the run's inputs.</p>
      <div class="tabs">${tabs.map(([n, t], i) => `<button data-tab="${i}" class="${same(t, q) ? 'on' : ''}">${n}</button>`).join('')}</div>
      <ol class="board" id="board"><li>Loading…</li></ol>
      <div class="row" style="margin-top:14px"><button data-act="menu">Back <kbd>Esc</kbd></button></div>
    </div>`;
  overlay.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach((b) => b.addEventListener('click', () => showBoard(tabs[Number(b.dataset.tab)]![1])));
  overlay.querySelector('[data-act="menu"]')!.addEventListener('click', showMenu);
  const entries: BoardEntry[] | null = online ? await api.leaderboard(q) : null;
  const list = document.getElementById('board');
  if (!list || screen !== 'board') return;
  if (!entries) {
    list.innerHTML = `<li><span></span><span>Leaderboard offline. Your local bests are on the menu.</span></li>`;
    return;
  }
  if (!entries.length) {
    list.innerHTML = `<li><span></span><span>No catches yet. Be the first.</span></li>`;
    return;
  }
  list.innerHTML = entries
    .map((e) => `<li class="${e.name === store.callsign ? 'me' : ''}"><span>#${e.rank}</span><span>${escapeHtml(e.name)}${e.date && q.board === 'alltime' ? ` <span class="btn-sub" style="display:inline">${e.date}</span>` : ''}</span><span>${e.score}</span><span>${e.grade}</span></li>`)
    .join('');
}

function toggleMute() {
  store.muted = !store.muted;
  sound.setMuted(store.muted);
  toast(store.muted ? 'Sound off' : 'Sound on');
}

function toggleGhost() {
  store.ghosts = !store.ghosts;
  game.showGhost = store.ghosts;
  toast(store.ghosts ? 'Ghost on' : 'Ghost off');
}

let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 1200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---- Boot ------------------------------------------------------------------
// Debug handle for playtesting from the devtools console (dev builds only).
if (import.meta.env.DEV) Object.assign(window, { __bc: { game, controls, play } });
showMenu();
requestAnimationFrame(loop);
void api.health().then((ok) => {
  online = ok;
  if (screen === 'menu') showMenu();
});
