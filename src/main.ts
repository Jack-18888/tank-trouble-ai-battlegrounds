import { Game, DEFAULT_CONFIG, COLORS, NAMES, validateGameConfig } from './engine.ts';
import { getBotType, getBotTypes, hasBot } from './bots/index.ts';
import { Renderer, tankIcon } from './renderer.ts';
import { Sound } from './audio.ts';

interface Controls {
  arena: HTMLCanvasElement;
  'map-size': HTMLSelectElement;
  'maze-density': HTMLSelectElement;
  'win-target': HTMLSelectElement;
  powerups: HTMLInputElement;
  'pause-button': HTMLButtonElement;
  'opponent-minus': HTMLButtonElement;
  'opponent-plus': HTMLButtonElement;
  'help-dialog': HTMLDialogElement;
}
function $<K extends keyof Controls>(id: K): Controls[K];
function $(id: string): HTMLElement;
function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing game element #${id}`);
  return element;
}
const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (char) => entities[char]);
const storageKey = 'tank-trouble.preferences.v1';
let saved = { config: DEFAULT_CONFIG, sound: true };
try {
  const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}');
  if (raw && typeof raw === 'object') {
    saved = {
      config: validateGameConfig('config' in raw ? raw.config : undefined),
      sound: !('sound' in raw && raw.sound === false),
    };
  }
} catch {
  /* Private browsing can disable storage. */
}
const config = new Game({ ...DEFAULT_CONFIG, ...saved.config }).config;
let game = new Game(config);
const renderer = new Renderer($('arena'));
const sound = new Sound(saved.sound !== false);
const keys = new Set<string>();
let accumulator = 0,
  previousTime = 0,
  toastUntil = 0,
  lastClock = '',
  helpPaused = false;
let defaultDifficulty = config.difficulties[0];
const icons = {
  sound:
    '<svg viewBox="0 0 20 20"><path d="M8 5 4 8H2v4h2l4 3V5Zm4 2a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/></svg>',
  muted: '<svg viewBox="0 0 20 20"><path d="M8 5 4 8H2v4h2l4 3V5Zm5 3 5 5m0-5-5 5"/></svg>',
  pause: '<svg viewBox="0 0 20 20"><path d="M6 4v12m8-12v12" stroke-width="3"/></svg>',
  play: '<svg viewBox="0 0 20 20"><path d="m6 4 10 6-10 6V4Z"/></svg>',
  fullscreen: '<svg viewBox="0 0 20 20"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m6 0h4v-4"/></svg>',
};
$('fullscreen-button').innerHTML = icons.fullscreen;

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ config, sound: sound.enabled }));
  } catch {
    /* Preferences are a convenience. */
  }
}
function soundUI() {
  $('sound-button').innerHTML = icons[sound.enabled ? 'sound' : 'muted'];
  $('sound-button').setAttribute('aria-label', sound.enabled ? 'Turn sound off' : 'Turn sound on');
  $('sound-button').setAttribute('aria-pressed', String(sound.enabled));
}
function scoreboard() {
  $('scoreboard').classList.toggle('many', game.tanks.length > 4);
  $('scoreboard').innerHTML = game.tanks
    .map(
      (t) =>
        `<div class="score-card ${t.alive ? '' : 'eliminated'}" style="color:${t.color}">${tankIcon(t.color, 'score-tank')}<span class="score-info"><span class="score-name">${t.name}${t.id === 0 ? ' <span style="opacity:.5">/ P1</span>' : ''}</span><span class="score-sub">${t.id === 0 ? 'THE HUMAN' : escapeHTML(getBotType(t.difficulty)?.label ?? t.difficulty ?? 'Bot') + ' BOT'}</span></span><span class="score-number">${game.scores[t.id]}</span></div>`,
    )
    .join('');
}
function settingsUI() {
  $('difficulty').replaceChildren(
    ...getBotTypes().map((type) => {
      const button = document.createElement('button');
      button.dataset.value = type.id;
      button.textContent = type.label;
      return button;
    }),
  );
  $('opponent-count').textContent = String(config.opponents);
  $('opponent-minus').disabled = config.opponents <= 1;
  $('opponent-plus').disabled = config.opponents >= 5;
  $('map-size').value = config.size;
  $('maze-density').value = config.density;
  $('win-target').value = String(config.target);
  $('powerups').checked = config.powerups;
  const mixed = new Set(config.difficulties).size > 1;
  for (const button of $('difficulty').querySelectorAll('button')) {
    const selected = !mixed && button.dataset.value === defaultDifficulty;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const type = getBotType(defaultDifficulty);
  if (!type) throw new Error(`Missing bot metadata for ${defaultDifficulty}`);
  const [label, description] = mixed
    ? ['MIXED COMPANY', 'A handpicked mix. Something for every opponent.']
    : [type.tagline, type.description];
  $('difficulty-status').textContent = label;
  $('difficulty-description').textContent = description;
  $('bot-roster').innerHTML = config.difficulties
    .map(
      (d, i) =>
        `<div class="bot-row"><span class="bot-swatch" style="background:${COLORS[i + 1]}"></span><span>${NAMES[i + 1]}</span><select data-bot="${i}" aria-label="${NAMES[i + 1]} difficulty">${getBotTypes()
          .map(
            (type) =>
              `<option value="${type.id}" ${type.id === d ? 'selected' : ''}>${escapeHTML(type.label)}</option>`,
          )
          .join('')}</select></div>`,
    )
    .join('');
  $('start-caption').textContent =
    `YOU + ${config.opponents} BOT${config.opponents > 1 ? 'S' : ''}. ONE TANK LEFT STANDING.`;
  persist();
}
function setupChanged() {
  settingsUI();
  if (game.state === 'ready' || game.state === 'matchOver') {
    game = new Game(config);
    scoreboard();
    stateUI();
    mapUI();
  } else {
    $('start-label').textContent = 'Start new match';
    $('start-caption').textContent = 'NEW SETTINGS APPLY TO YOUR NEXT MATCH.';
  }
}
function mapUI() {
  $('map-seed').textContent = game.map.seed;
  $('canvas-wrap').style.aspectRatio = `${game.map.cols} / ${game.map.rows}`;
}
function toast(message: string, duration = 2200) {
  $('round-toast').textContent = message;
  $('round-toast').classList.add('visible');
  toastUntil = performance.now() + duration;
}
function showOverlay(html: string, countdown = false) {
  $('overlay-content').classList.toggle('countdown', countdown);
  $('overlay-content').innerHTML = html;
  $('overlay').classList.remove('hidden');
}
function stateUI() {
  const state = game.state;
  const live = ['playing', 'countdown', 'roundOver', 'paused'].includes(state);
  $('pause-button').disabled = !live;
  $('pause-button').innerHTML = icons[state === 'paused' ? 'play' : 'pause'];
  $('pause-button').setAttribute('aria-label', state === 'paused' ? 'Resume game' : 'Pause game');
  $('arena-state').textContent = {
    ready: 'STANDING BY',
    countdown: 'GET READY',
    playing: 'LIVE MATCH',
    paused: 'PAUSED',
    roundOver: 'ROUND OVER',
    matchOver: 'MATCH COMPLETE',
  }[state];
  $('arena-state').classList.toggle('playing', state === 'playing');
  $('start-label').textContent = live
    ? 'Start new match'
    : state === 'matchOver'
      ? 'Play again'
      : 'Let’s battle';
  $('round-label').textContent = game.round
    ? `ROUND ${String(game.round).padStart(2, '0')}`
    : 'FREE-FOR-ALL';
  $('match-clock').textContent = game.config.target
    ? `FIRST TO ${game.config.target}`
    : 'ENDLESS MATCH';
  if (state === 'ready')
    showOverlay(
      `<div class="overlay-emblem">${tankIcon(COLORS[0])}</div><h2>Ready to roll?</h2><p>A fresh maze. A few bad bots.<br>One very good reason to keep moving.</p><button class="start-button" data-action="start">Enter the arena <span>↗</span></button><span class="overlay-footnote">LAST TANK STANDING WINS.</span>`,
    );
  if (state === 'playing') $('overlay').classList.add('hidden');
  if (state === 'paused')
    showOverlay(
      '<div class="overlay-emblem">Ⅱ</div><h2>Taking cover.</h2><p>Your trouble can wait a minute.</p><button class="start-button" data-action="resume">Back to battle <span>↗</span></button><button class="secondary-button" data-action="quit">End match & return to setup</button><span class="overlay-footnote">ESC TO RESUME</span>',
    );
  if (state === 'roundOver' || state === 'matchOver') {
    const winner = game.winner;
    const you = winner?.id === 0;
    const heading = !winner
      ? 'Mutual destruction.'
      : state === 'matchOver'
        ? you
          ? 'Trouble, conquered.'
          : `${winner.name} takes it.`
        : you
          ? 'That’s your round.'
          : `${winner.name} wins the round.`;
    const copy = !winner
      ? 'No tank left standing. No points awarded.'
      : state === 'matchOver'
        ? you
          ? 'A little aim. A little chaos. A well-earned crown.'
          : 'The bots had their moment. Time for a rematch?'
        : you
          ? 'Nicely done. A new maze is coming right up.'
          : 'Dust yourself off. A fresh maze, a fresh chance.';
    showOverlay(
      `<div class="overlay-emblem" style="color:${winner?.color || COLORS[0]}">${winner ? tankIcon(winner.color) : '×'}</div><h2>${heading}</h2><p>${copy}</p>${state === 'matchOver' ? '<button class="start-button" data-action="start">One more match <span>↗</span></button><button class="secondary-button" data-action="quit">Back to setup</button>' : '<span class="overlay-footnote">NEXT ROUND IN A MOMENT…</span>'}`,
    );
  }
}
function start() {
  sound.unlock();
  keys.clear();
  if (game.state !== 'ready') game = new Game(config);
  game.start();
  scoreboard();
  mapUI();
  stateUI();
  $('arena').focus({ preventScroll: true });
  $('round-toast').classList.remove('visible');
  lastClock = '';
}
function quit() {
  keys.clear();
  toastUntil = 0;
  $('round-toast').classList.remove('visible');
  game = new Game(config);
  scoreboard();
  mapUI();
  stateUI();
  settingsUI();
}
function pause() {
  keys.clear();
  game.pause();
  stateUI();
}

$('start-button').addEventListener('click', start);
$('overlay').addEventListener('click', (e) => {
  const action =
    e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-action]')?.dataset.action
      : undefined;
  if (action === 'start') start();
  if (action === 'resume') {
    sound.unlock();
    pause();
    $('arena').focus({ preventScroll: true });
  }
  if (action === 'quit') quit();
});
$('pause-button').addEventListener('click', pause);
$('sound-button').addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  sound.unlock();
  soundUI();
  persist();
});
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('arena-shell').requestFullscreen();
  } catch {
    toast('Fullscreen is unavailable in this browser.');
  }
});
$('opponent-minus').addEventListener('click', () => {
  config.opponents = Math.max(1, config.opponents - 1);
  config.difficulties.length = config.opponents;
  setupChanged();
});
$('opponent-plus').addEventListener('click', () => {
  if (config.opponents < 5) {
    config.opponents++;
    config.difficulties.push(defaultDifficulty);
    setupChanged();
  }
});
$('difficulty').addEventListener('click', (e) => {
  const level = e.target instanceof HTMLElement ? e.target.dataset.value : undefined;
  if (!hasBot(level)) return;
  defaultDifficulty = level;
  config.difficulties.fill(level);
  setupChanged();
});
$('bot-roster').addEventListener('change', (e) => {
  if (!(e.target instanceof HTMLSelectElement)) return;
  if (!hasBot(e.target.value)) return;
  config.difficulties[Number(e.target.dataset.bot)] = e.target.value;
  defaultDifficulty = config.difficulties[0];
  setupChanged();
});
for (const [id, field] of [
  ['map-size', 'size'],
  ['maze-density', 'density'],
  ['win-target', 'target'],
  ['powerups', 'powerups'],
] as const) {
  $(id).addEventListener('change', () => {
    const value =
      field === 'powerups'
        ? $('powerups').checked
        : field === 'target'
          ? Number($(id).value)
          : $(id).value;
    Object.assign(config, validateGameConfig({ ...config, [field]: value }));
    setupChanged();
  });
}
$('shuffle-button').addEventListener('click', () => {
  if (game.state === 'ready' || game.state === 'matchOver') {
    game = new Game(config);
    mapUI();
    scoreboard();
    stateUI();
    toast('Fresh maze. Fresh trouble.');
  } else {
    toast('A fresh maze is generated every round.');
  }
});

function openHelp() {
  helpPaused = ['playing', 'countdown', 'roundOver'].includes(game.state);
  if (helpPaused) pause();
  $('help-dialog').showModal();
}
$('help-button').addEventListener('click', openHelp);
for (const id of ['close-help', 'got-it'])
  $(id).addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', (e) => {
  const dialog = $('help-dialog');
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  }
});
$('help-dialog').addEventListener('close', () => {
  if (helpPaused && game.state === 'paused') pause();
  helpPaused = false;
});

const gameKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
]);
window.addEventListener('keydown', (e) => {
  if (
    $('help-dialog').open ||
    (e.target instanceof Element && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))
  )
    return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (!e.repeat) pause();
    e.preventDefault();
    return;
  }
  if (gameKeys.has(e.code) && ['playing', 'countdown'].includes(game.state)) {
    e.preventDefault();
    keys.add(e.code);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (['playing', 'countdown', 'roundOver'].includes(game.state)) pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.clear();
    if (['playing', 'countdown', 'roundOver'].includes(game.state)) pause();
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-key]')) {
  const key = button.dataset.key;
  if (!key) continue;
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.unlock();
    button.setPointerCapture(e.pointerId);
    keys.add(key);
    button.classList.add('active');
  });
  const release = () => {
    keys.delete(key);
    button.classList.remove('active');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

const notes = [
  'Walls are a suggestion. Bounce your shots around corners to catch a tank off guard.',
  'Five shells in flight. Make them count — your ammo returns when a shell disappears.',
  'A shield blocks one hit. The bravest route to a power-up might be the best route.',
  'Hard bots know their angles. Keep moving when you hear a shell hit the wall.',
];
function handleEvents() {
  for (const event of game.drainEvents()) {
    sound.play(event);
    if (event.type === 'state') stateUI();
    if (event.type === 'score') scoreboard();
    if (event.type === 'map') {
      mapUI();
      scoreboard();
      $('field-note').textContent = notes[Math.max(0, game.round - 1) % notes.length];
    }
    if (event.type === 'countdown')
      showOverlay(
        `<span class="countdown-number">${event.count || 'GO'}</span><p>ROUND ${String(game.round).padStart(2, '0')} · GET READY</p>`,
        true,
      );
    if (event.type === 'go') {
      $('overlay').classList.add('hidden');
      toast('ROLL OUT.', 1100);
    }
    if (event.type === 'pickup' && event.id === 0)
      toast(
        {
          shield: 'SHIELD UP · ONE HIT BLOCKED',
          rapid: 'RAPID FIRE · 7 SECONDS',
          scatter: 'TRIPLE SHOT · 7 SECONDS',
        }[event.power],
      );
    if (event.type === 'destroy' && event.id === 0)
      toast(
        event.owner === 0 ? 'YOUR OWN RICOCHET. IT HAPPENS.' : 'YOU’RE OUT. REVENGE NEXT ROUND.',
        2500,
      );
  }
}
function frame(time: number) {
  const elapsed = Math.min((time - (previousTime || time)) / 1000, 0.1);
  previousTime = time;
  accumulator += elapsed;
  const input = {
    forward: keys.has('KeyW') || keys.has('ArrowUp'),
    backward: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    fire: keys.has('Space'),
  };
  while (accumulator >= 1 / 120) {
    game.update(1 / 120, input);
    accumulator -= 1 / 120;
  }
  handleEvents();
  renderer.draw(game, time / 1000);
  if (time > toastUntil) $('round-toast').classList.remove('visible');
  if (game.state === 'playing') {
    const clock = `${game.config.target ? 'FIRST TO ' + game.config.target : 'ENDLESS'} · ${Math.max(0, 90 - Math.floor(game.elapsed))}s`;
    if (clock !== lastClock) {
      $('match-clock').textContent = clock;
      lastClock = clock;
    }
  }
  requestAnimationFrame(frame);
}

settingsUI();
scoreboard();
soundUI();
mapUI();
stateUI();
requestAnimationFrame(frame);
