// Browser entry point: owns DOM events, held input, worker lifetimes, rendering, and sound.
// Game remains DOM-free, and PlayerRuntime bridges input/worker messages to physics ticks.
import { Game, DEFAULT_CONFIG, COLORS, NAMES, validateGameConfig } from './engine.ts';
import { getBotType, getBotTypes, hasBot } from './bots/index.ts';
import { Renderer, tankIcon } from './renderer.ts';
import { Sound } from './audio.ts';
import { assignController, PlayerRuntime } from './players/index.ts';
import { browserBotConnection } from './players/browser-connection.ts';
import { scoreCards } from './scoreboard.ts';
import { RULES } from './rules.ts';
import {
  MAX_REPLAY_BYTES,
  parseReplay,
  ReplayPlayer,
  ReplayRecorder,
  serializeReplay,
} from './replay.ts';
import type { RoundReplay } from './replay.ts';
import type { GameEvent } from './types.ts';

interface Controls {
  arena: HTMLCanvasElement;
  'map-size': HTMLSelectElement;
  'maze-density': HTMLSelectElement;
  'win-target': HTMLSelectElement;
  powerups: HTMLInputElement;
  'pause-button': HTMLButtonElement;
  'tank-minus': HTMLButtonElement;
  'tank-plus': HTMLButtonElement;
  'help-dialog': HTMLDialogElement;
  'record-replays': HTMLInputElement;
  'saved-replays': HTMLSelectElement;
  'save-replay': HTMLButtonElement;
  'replay-file': HTMLInputElement;
  'replay-seek': HTMLInputElement;
  'replay-speed': HTMLSelectElement;
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
let saved = { config: DEFAULT_CONFIG, sound: true, recordReplays: false };
try {
  const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}');
  if (raw && typeof raw === 'object') {
    saved = {
      config: validateGameConfig('config' in raw ? raw.config : undefined),
      sound: !('sound' in raw && raw.sound === false),
      recordReplays: 'recordReplays' in raw && raw.recordReplays === true,
    };
  }
} catch {
  /* Private browsing can disable storage. */
}
const config = new Game({ ...DEFAULT_CONFIG, ...saved.config }).config;
let game = new Game(config);
let runtime = new PlayerRuntime(game, browserBotConnection);
const recorder = new ReplayRecorder();
recorder.enabled = saved.recordReplays;
const recordedRounds: RoundReplay[] = [];
let playback: ReplayPlayer | null = null;
let replayUIKey = '';
let uploadVersion = 0;
const renderer = new Renderer($('arena'));
const sound = new Sound(saved.sound !== false);
const keys = new Set<string>();
let controllerNoticeUntil = 0;
let accumulator = 0,
  previousTime = 0,
  toastUntil = 0,
  lastClock = '',
  helpPaused = false;
let defaultDifficulty = config.players.find((slot) => slot.kind === 'bot')?.botId ?? 'medium';
const icons = {
  sound:
    '<svg viewBox="0 0 20 20"><path d="M8 5 4 8H2v4h2l4 3V5Zm4 2a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/></svg>',
  muted: '<svg viewBox="0 0 20 20"><path d="M8 5 4 8H2v4h2l4 3V5Zm5 3 5 5m0-5-5 5"/></svg>',
  pause: '<svg viewBox="0 0 20 20"><path d="M6 4v12m8-12v12" stroke-width="3"/></svg>',
  play: '<svg viewBox="0 0 20 20"><path d="m6 4 10 6-10 6V4Z"/></svg>',
  fullscreen: '<svg viewBox="0 0 20 20"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m6 0h4v-4"/></svg>',
};
$('fullscreen-button').innerHTML = icons.fullscreen;

/** Close the old match's transports before creating controllers for the replacement. */
function replaceGame() {
  uploadVersion++;
  playback = null;
  recorder.discard();
  accumulator = 0;
  $('replay-controls').hidden = true;
  runtime.dispose();
  game = new Game(config);
  runtime = new PlayerRuntime(game, browserBotConnection);
}
function publishInput() {
  runtime.setInput({
    forward: keys.has('KeyW') || keys.has('ArrowUp'),
    backward: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    fire: keys.has('Space'),
  });
}
/** Publish releases as well as clearing UI state so a held command cannot survive focus loss. */
function clearInput() {
  keys.clear();
  for (const button of document.querySelectorAll('[data-key].active'))
    button.classList.remove('active');
  publishInput();
}
window.addEventListener('pagehide', () => runtime.dispose());
function persist() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ config, sound: sound.enabled, recordReplays: recorder.enabled }),
    );
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
  $('scoreboard').innerHTML = scoreCards(game);
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
  $('tank-count').textContent = String(config.players.length);
  $('tank-minus').disabled = config.players.length <= 2;
  $('tank-plus').disabled = config.players.length >= 6;
  $('map-size').value = config.size;
  $('maze-density').value = config.density;
  $('win-target').value = String(config.target);
  $('powerups').checked = config.powerups;
  $('record-replays').checked = recorder.enabled;
  const botIds = config.players.flatMap((slot) => (slot.kind === 'bot' ? [slot.botId] : []));
  const mixed = new Set(botIds).size > 1;
  if (!mixed && botIds.length) defaultDifficulty = botIds[0];
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
  $('player-roster').innerHTML = config.players
    .map(
      (slot, i) =>
        `<div class="player-row ${slot.kind === 'human' ? 'human-row' : ''}"><span class="player-swatch" style="background:${COLORS[i]}"></span><span>${NAMES[i]}${slot.kind === 'human' ? ' / You' : ''}</span><select data-player="${i}" aria-label="${NAMES[i]} controller"><option value="human" ${slot.kind === 'human' ? 'selected' : ''}>Human</option>${getBotTypes()
          .map(
            (type) =>
              `<option value="bot:${type.id}" ${slot.kind === 'bot' && type.id === slot.botId ? 'selected' : ''}>${escapeHTML(type.label)}</option>`,
          )
          .join('')}</select></div>`,
    )
    .join('');
  $('start-caption').textContent = config.players.some((slot) => slot.kind === 'human')
    ? `YOU + ${botIds.length} BOT${botIds.length > 1 ? 'S' : ''}. ONE TANK LEFT STANDING.`
    : `${botIds.length} BOTS. TAKE A SEAT. WATCH THE TROUBLE.`;
  persist();
}
/** Edit the next-match configuration; active matches keep their own validated config copy. */
function setupChanged() {
  settingsUI();
  if (!playback && (game.state === 'ready' || game.state === 'matchOver')) {
    replaceGame();
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
  const spectating = playback !== null || game.humanId === null;
  $('arena-shell').classList.toggle('spectating', spectating);
  $('below-arena').classList.toggle('spectating', spectating);
  $('help-dialog').classList.toggle('spectating', spectating);
  $('help-intro').textContent = spectating
    ? 'Watch the bots battle through the maze. The last tank standing wins the round. Choose Human in match setup whenever you want to join the next match.'
    : 'Drive the tank marked YOU through the maze. Eliminate the other tanks and be the last one standing to score a round win.';
  $('spectator-note').hidden = !spectating;
  $('arena').setAttribute(
    'aria-label',
    spectating
      ? 'Tank arena. Watching a bot-only match. Escape to pause.'
      : 'Tank arena. Use arrow keys or W A S D to move and turn. Space to fire. Escape to pause.',
  );
  if (playback) {
    $('help-intro').textContent =
      'Watch a saved round. Use the timeline to jump to any moment, change playback speed, or press Escape to pause. Back to setup returns to the game.';
    $('arena').setAttribute(
      'aria-label',
      'Recorded round replay. Escape to pause or resume playback.',
    );
    $('spectator-note').hidden = true;
    $('start-label').textContent = 'Start new match';
    $('start-caption').textContent = 'REPLAY MODE. START A MATCH TO PLAY.';
    replayUIKey = '';
    replayUI();
    return;
  }
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
      : spectating
        ? 'Watch the battle'
        : 'Let’s battle';
  $('round-label').textContent = game.round
    ? `ROUND ${String(game.round).padStart(2, '0')}`
    : 'FREE-FOR-ALL';
  $('match-clock').textContent = game.config.target
    ? `FIRST TO ${game.config.target}`
    : 'ENDLESS MATCH';
  if (state === 'ready')
    showOverlay(
      `<div class="overlay-emblem">${tankIcon(COLORS[game.humanId ?? 0])}</div><h2>${spectating ? 'Let them loose.' : 'Ready to roll?'}</h2><p>${spectating ? 'All bots. All trouble.<br>Pick a favorite and watch the ricochets.' : 'A fresh maze. A few bad bots.<br>One very good reason to keep moving.'}</p><button class="start-button" data-action="start">${spectating ? 'Watch the battle' : 'Enter the arena'} <span>↗</span></button><span class="overlay-footnote">LAST TANK STANDING WINS.</span>`,
    );
  if (state === 'playing') $('overlay').classList.add('hidden');
  if (state === 'paused')
    showOverlay(
      '<div class="overlay-emblem">Ⅱ</div><h2>Taking cover.</h2><p>Your trouble can wait a minute.</p><button class="start-button" data-action="resume">Back to battle <span>↗</span></button><button class="secondary-button" data-action="quit">End match & return to setup</button><span class="overlay-footnote">ESC TO RESUME</span>',
    );
  if (state === 'roundOver' || state === 'matchOver') {
    const winner = game.winner;
    const you = winner !== null && winner.id === game.humanId;
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
      : spectating
        ? state === 'matchOver'
          ? 'A champion emerges. Ready for another match?'
          : 'A new maze. Another round of trouble.'
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
  uploadVersion++;
  sound.unlock();
  clearInput();
  controllerNoticeUntil = 0;
  if (playback || game.state !== 'ready') replaceGame();
  game.start();
  runtime.sync();
  recorder.observe(game, 0, []);
  scoreboard();
  mapUI();
  stateUI();
  $('arena').focus({ preventScroll: true });
  $('round-toast').classList.remove('visible');
  lastClock = '';
}
function quit() {
  clearInput();
  toastUntil = 0;
  controllerNoticeUntil = 0;
  $('round-toast').classList.remove('visible');
  replaceGame();
  scoreboard();
  mapUI();
  stateUI();
  settingsUI();
}
function pause() {
  if (playback) {
    if (playback.time === playback.replay.duration) playback.seek(0);
    playback.paused = !playback.paused;
    replayUI();
    return;
  }
  clearInput();
  game.pause();
  runtime.sync();
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
$('tank-minus').addEventListener('click', () => {
  if (config.players.length <= 2) return;
  config.players.pop();
  setupChanged();
});
$('tank-plus').addEventListener('click', () => {
  if (config.players.length < 6) {
    config.players.push({ kind: 'bot', botId: defaultDifficulty });
    setupChanged();
  }
});
$('difficulty').addEventListener('click', (e) => {
  const level = e.target instanceof HTMLElement ? e.target.dataset.value : undefined;
  if (!hasBot(level)) return;
  defaultDifficulty = level;
  config.players = config.players.map((slot) =>
    slot.kind === 'bot' ? { kind: 'bot', botId: level } : slot,
  );
  setupChanged();
});
$('player-roster').addEventListener('change', (e) => {
  if (!(e.target instanceof HTMLSelectElement)) return;
  const value = e.target.value;
  const botId = value.startsWith('bot:') ? value.slice(4) : undefined;
  if (value !== 'human' && !hasBot(botId)) return;
  config.players = assignController(
    config.players,
    Number(e.target.dataset.player),
    value === 'human' ? { kind: 'human' } : { kind: 'bot', botId: botId! },
  );
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
  if (playback) {
    toast('Return to setup to shuffle the maze.');
    return;
  }
  if (game.state === 'ready' || game.state === 'matchOver') {
    replaceGame();
    mapUI();
    scoreboard();
    stateUI();
    toast('Fresh maze. Fresh trouble.');
  } else {
    toast('A fresh maze is generated every round.');
  }
});

function openHelp() {
  // Closing help resumes only a match that opening help paused, preserving an earlier manual pause.
  helpPaused = playback
    ? !playback.paused
    : ['playing', 'countdown', 'roundOver'].includes(game.state);
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
  if (helpPaused && (playback ? playback.paused : game.state === 'paused')) pause();
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
  if (
    !playback &&
    game.humanId !== null &&
    gameKeys.has(e.code) &&
    ['playing', 'countdown'].includes(game.state)
  ) {
    e.preventDefault();
    keys.add(e.code);
    publishInput();
  }
});
window.addEventListener('keyup', (e) => {
  if (keys.delete(e.code)) publishInput();
});
window.addEventListener('blur', () => {
  clearInput();
  if (playback ? !playback.paused : ['playing', 'countdown', 'roundOver'].includes(game.state))
    pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInput();
    if (playback ? !playback.paused : ['playing', 'countdown', 'roundOver'].includes(game.state))
      pause();
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-key]')) {
  const key = button.dataset.key;
  if (!key) continue;
  button.addEventListener('pointerdown', (e) => {
    if (playback || game.humanId === null || !['playing', 'countdown'].includes(game.state)) return;
    e.preventDefault();
    sound.unlock();
    button.setPointerCapture(e.pointerId);
    keys.add(key);
    publishInput();
    button.classList.add('active');
  });
  const release = () => {
    keys.delete(key);
    publishInput();
    button.classList.remove('active');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

function formatReplayTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function recordingUI() {
  const active = recorder.active && !playback;
  const indicator = active ? 'REC' : recorder.enabled ? 'ARMED' : 'OFF';
  if ($('recording-indicator').textContent !== indicator) {
    $('recording-indicator').textContent = indicator;
    $('recording-indicator').classList.toggle('active', active);
  }
  const status = active
    ? `Recording round ${game.round}. Save it here when the round ends.`
    : recorder.enabled
      ? 'Ready to record from the start of the next round.'
      : 'Recording is off.';
  if ($('recording-status').textContent !== status) $('recording-status').textContent = status;
}

function rememberReplay(replay: RoundReplay) {
  recordedRounds.unshift(replay);
  recordedRounds.splice(3);
  $('saved-replays').replaceChildren(
    ...recordedRounds.map((round, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `Round ${round.round} · ${round.map.seed} · ${formatReplayTime(round.duration)}`;
      return option;
    }),
  );
  $('saved-replays').disabled = false;
  $('save-replay').disabled = false;
  $('replay-message').textContent = `Round ${replay.round} recorded. Save the replay to keep it.`;
}

function replayUI() {
  if (!playback) return;
  const { replay, time, paused, frameIndex } = playback;
  const ended = time === replay.duration;
  $('replay-controls').hidden = false;
  $('replay-time').textContent = `${formatReplayTime(time)} / ${formatReplayTime(replay.duration)}`;
  $('replay-seek').max = String(replay.duration);
  $('replay-seek').value = String(time);
  $('replay-toggle').textContent = ended ? 'Play again' : paused ? 'Play replay' : 'Pause replay';
  $('replay-toggle').setAttribute('aria-pressed', String(!paused));
  $('pause-button').disabled = false;
  $('pause-button').innerHTML = icons[paused ? 'play' : 'pause'];
  $('pause-button').setAttribute('aria-label', paused ? 'Play replay' : 'Pause replay');
  $('arena-state').textContent = ended ? 'REPLAY COMPLETE' : paused ? 'REPLAY PAUSED' : 'REPLAY';
  $('arena-state').classList.toggle('playing', !paused);
  $('round-label').textContent = `ROUND ${String(replay.round).padStart(2, '0')} · REPLAY`;
  $('match-clock').textContent =
    `${Math.max(0, RULES.roundDuration - Math.floor(game.elapsed))}s · RECORDED`;
  const uiKey = `${frameIndex}:${paused}`;
  if (uiKey === replayUIKey) return;
  replayUIKey = uiKey;
  scoreboard();
  if (ended) {
    showOverlay(
      '<h2>Round replay complete.</h2><p id="replay-result"></p><button class="start-button" data-action="resume">Watch again <span>↻</span></button>',
    );
    $('replay-result').textContent = game.winner
      ? `${game.winner.name} won this round.`
      : 'The round ended in a draw.';
  } else if (game.state === 'countdown') {
    showOverlay(
      `<span class="countdown-number">${Math.max(1, Math.ceil(game.timer / 0.8))}</span><p>RECORDED ROUND ${replay.round}</p>`,
      true,
    );
  } else {
    $('overlay').classList.add('hidden');
  }
}

$('record-replays').addEventListener('change', () => {
  recorder.enabled = $('record-replays').checked;
  persist();
  recordingUI();
});
$('save-replay').addEventListener('click', () => {
  const replay = recordedRounds[Number($('saved-replays').value)];
  if (!replay) return;
  try {
    const source = serializeReplay(replay);
    const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tank-trouble-${replay.recordedAt.replace(/[:.]/g, '-')}-round-${replay.round}.ttr.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('replay-message').textContent = `Round ${replay.round} replay download started.`;
  } catch (error) {
    $('replay-message').textContent =
      error instanceof Error ? error.message : 'Unable to save this replay.';
  }
});
$('load-replay').addEventListener('click', () => {
  if (playback ? !playback.paused : ['playing', 'countdown', 'roundOver'].includes(game.state))
    pause();
  $('replay-file').click();
});
$('replay-file').addEventListener('change', async () => {
  const file = $('replay-file').files?.[0];
  $('replay-file').value = '';
  if (!file) return;
  const version = ++uploadVersion;
  try {
    if (file.size > MAX_REPLAY_BYTES) throw new Error('Replay files must be 32 MB or smaller.');
    const replay = parseReplay(await file.text());
    if (version !== uploadVersion) return;
    const player = new ReplayPlayer(replay);
    clearInput();
    runtime.dispose();
    recorder.discard();
    playback = player;
    game = player.game;
    accumulator = 0;
    helpPaused = false;
    toastUntil = 0;
    $('round-toast').classList.remove('visible');
    $('replay-speed').value = '1';
    const volleys = replay.events.filter(({ event }) => event.type === 'fire').length;
    const eliminations = replay.events.filter(({ event }) => event.type === 'destroy').length;
    $('replay-summary').textContent =
      `${replay.frames.length} snapshots · ${volleys} volleys · ${eliminations} eliminations · ${replay.events.length} events`;
    $('replay-message').textContent = `Loaded round ${replay.round} replay.`;
    mapUI();
    stateUI();
    recordingUI();
  } catch (error) {
    if (version === uploadVersion)
      $('replay-message').textContent =
        error instanceof Error ? error.message : 'Unable to open this replay.';
  }
});
$('replay-toggle').addEventListener('click', pause);
$('replay-exit').addEventListener('click', quit);
$('replay-seek').addEventListener('input', () => {
  if (!playback) return;
  playback.seek(Number($('replay-seek').value));
  replayUI();
});
$('replay-speed').addEventListener('change', () => {
  if (playback) playback.speed = Number($('replay-speed').value);
});

const notes = [
  'Walls are a suggestion. Bounce your shots around corners to catch a tank off guard.',
  'Ten bullets to start. Ammo refills faster as the round goes on — unlimited in the final 20 seconds.',
  'A shield blocks one hit. The bravest route to a power-up might be the best route.',
  'Hard bots know their angles. Keep moving when you hear a shell hit the wall.',
];
function handleEvents(events: readonly GameEvent[]) {
  for (const event of events) {
    sound.play(event, game.humanId);
    if (event.type === 'state') stateUI();
    if (event.type === 'score') scoreboard();
    if (event.type === 'playerStatus') {
      scoreboard();
      if (event.status === 'failed') {
        toast(game.tanks[event.id].name + '’s controller stopped. The match continues.', 4000);
        controllerNoticeUntil = toastUntil;
      }
    }
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
      // Keep a startup failure visible instead of immediately replacing it with the round greeting.
      if (performance.now() >= controllerNoticeUntil) toast('ROLL OUT.', 1100);
    }
    if (event.type === 'pickup' && event.id === game.humanId)
      toast(
        {
          shield: 'SHIELD UP · ONE HIT BLOCKED',
          rapid: 'RAPID FIRE · 7 SECONDS',
          scatter: 'TRIPLE SHOT · 7 SECONDS',
        }[event.power],
      );
    if (event.type === 'destroy' && event.id === game.humanId)
      toast(
        event.owner === game.humanId
          ? 'YOUR OWN RICOCHET. IT HAPPENS.'
          : 'YOU’RE OUT. REVENGE NEXT ROUND.',
        2500,
      );
  }
}
function frame(time: number) {
  // RAF timestamps are milliseconds. Limit catch-up after stalls, then simulate fixed 120 Hz ticks
  // independently of rendering; PlayerRuntime requests plans at their expiry boundaries.
  const elapsed = Math.min((time - (previousTime || time)) / 1000, 0.1);
  previousTime = time;
  if (playback) {
    playback.advance(elapsed);
    replayUI();
    renderer.draw(game, playback.time);
    if (time > toastUntil) $('round-toast').classList.remove('visible');
    requestAnimationFrame(frame);
    return;
  }
  accumulator += elapsed;
  while (accumulator >= 1 / 120) {
    const advanced = runtime.step(1 / 120);
    const events = game.drainEvents();
    const completed = recorder.observe(game, advanced ? 1 / 120 : 0, events);
    if (completed) rememberReplay(completed);
    handleEvents(events);
    if (!advanced) {
      accumulator = Math.min(accumulator, 1 / 120);
      break;
    }
    accumulator -= 1 / 120;
  }
  recordingUI();
  renderer.draw(game, time / 1000);
  if (time > toastUntil) $('round-toast').classList.remove('visible');
  if (game.state === 'playing') {
    const clock = `${game.config.target ? 'FIRST TO ' + game.config.target : 'ENDLESS'} · ${Math.max(0, RULES.roundDuration - Math.floor(game.elapsed))}s`;
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
