import { Game } from './engine.ts';
import { CELL } from './rules.ts';
import type { PlayerState } from './players/connection.ts';
import type { Bullet, GameConfig, GameEvent, GameMap, GameState, Powerup, Tank } from './types.ts';

export const REPLAY_FORMAT = 'tank-trouble-round';
export const REPLAY_VERSION = 1;
export const MAX_REPLAY_BYTES = 32 * 1024 * 1024;
const MAX_DURATION = 96;
const MAX_FRAMES = 3000;
type RecordedState = Exclude<GameState, 'ready' | 'paused'>;

export interface ReplayFrame {
  time: number;
  tick: number;
  elapsed: number;
  timer: number;
  state: RecordedState;
  tanks: Tank[];
  bullets: Bullet[];
  powerups: Powerup[];
  scores: number[];
  kills: number[];
  statuses: PlayerState['status'][];
}

/** Public, versioned JSON interchange format. Times are seconds; positions are world pixels. */
export interface RoundReplay {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  recordedAt: string;
  snapshotHz: 30;
  config: GameConfig;
  map: GameMap;
  round: number;
  duration: number;
  winner: number | null;
  frames: ReplayFrame[];
  events: { time: number; tick: number; event: GameEvent }[];
}

function capture(game: Game, time: number): ReplayFrame {
  return structuredClone({
    time,
    tick: game.tick,
    elapsed: game.elapsed,
    timer: game.timer,
    state: game.state as RecordedState,
    tanks: game.tanks,
    bullets: game.bullets,
    powerups: game.powerups,
    scores: game.scores,
    kills: game.kills,
    statuses: game.tanks.map((tank) => game.players.get(tank.id)?.status ?? 'closed'),
  });
}

/** Optional observer of completed physics steps. Never consumes events or advances controllers. */
export class ReplayRecorder {
  enabled = false;
  private game: Game | null = null;
  private round = 0;
  private recording: RoundReplay | null = null;
  private time = 0;
  private nextSample = 0;

  get active(): boolean {
    return this.recording !== null;
  }

  discard() {
    this.recording = null;
    this.game = null;
    this.round = 0;
  }

  /** Returns a completed round once; changing enabled takes effect at the next round boundary. */
  observe(game: Game, dt: number, events: readonly GameEvent[]): RoundReplay | null {
    if (game.state === 'ready') return null;
    if (this.game !== game || this.round !== game.round) {
      this.game = game;
      this.round = game.round;
      this.time = 0;
      this.nextSample = 1 / 30;
      this.recording =
        this.enabled && game.state === 'countdown'
          ? {
              format: REPLAY_FORMAT,
              version: REPLAY_VERSION,
              recordedAt: new Date().toISOString(),
              snapshotHz: 30,
              config: structuredClone(game.config),
              map: structuredClone(game.map),
              round: game.round,
              duration: 0,
              winner: null,
              frames: [capture(game, 0)],
              events: [],
            }
          : null;
      dt = 0;
    }
    const replay = this.recording;
    if (!replay) return null;
    if (game.state !== 'paused') this.time += dt;
    for (const event of events)
      replay.events.push({ time: this.time, tick: game.tick, event: structuredClone(event) });
    if (game.state === 'paused') return null;
    const finished = game.state === 'roundOver' || game.state === 'matchOver';
    const last = replay.frames[replay.frames.length - 1];
    if (this.time + 1e-9 >= this.nextSample || game.state !== last.state || finished) {
      const frame = capture(game, this.time);
      if (last.time === frame.time) replay.frames[replay.frames.length - 1] = frame;
      else replay.frames.push(frame);
      this.nextSample = this.time + 1 / 30;
    }
    if (!finished) return null;
    replay.duration = this.time;
    replay.winner = game.winner?.id ?? null;
    this.recording = null;
    return replay;
  }
}

type Validator = (value: unknown) => boolean;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const number: Validator = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7;
const integer: Validator = (v) => number(v) && Number.isInteger(v) && (v as number) >= 0;
const boolean: Validator = (v) => typeof v === 'boolean';
const text: Validator = (v) => typeof v === 'string' && v.length <= 128;
const color: Validator = (v) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
const oneOf =
  (...values: unknown[]): Validator =>
  (v) =>
    values.includes(v);
const array =
  (check: Validator, max: number): Validator =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check);
const fields =
  (schema: Record<string, Validator>): Validator =>
  (v) =>
    object(v) && Object.entries(schema).every(([key, check]) => check(v[key]));
const nullable =
  (check: Validator): Validator =>
  (v) =>
    v === null || check(v);
const point = { x: number, y: number };
const slot: Validator = (v) =>
  object(v) && (v.kind === 'human' || (v.kind === 'bot' && text(v.botId)));
const power = oneOf('shield', 'rapid', 'scatter');
const tank = fields({
  ...point,
  id: integer,
  name: text,
  color,
  angle: number,
  alive: boolean,
  controller: slot,
  cooldown: number,
  ammo: integer,
  ammoProgress: number,
  shield: boolean,
  power: oneOf(null, 'rapid', 'scatter'),
  powerTime: number,
  vx: number,
  vy: number,
  tread: number,
  leftTread: number,
  rightTread: number,
  steer: number,
  throttle: number,
  fire: boolean,
  stuck: number,
  previousX: number,
  previousY: number,
  kills: integer,
});
const bullet = fields({
  ...point,
  vx: number,
  vy: number,
  owner: integer,
  life: number,
  age: number,
  bounces: integer,
  trail: array(fields(point), 16),
  dead: boolean,
});
const event: Validator = (v) => {
  if (!object(v)) return false;
  switch (v.type) {
    case 'map':
    case 'score':
    case 'state':
    case 'go':
    case 'bounce':
      return true;
    case 'fire':
    case 'shield':
      return integer(v.id);
    case 'playerStatus':
      return integer(v.id) && oneOf('ready', 'failed')(v.status);
    case 'countdown':
      return integer(v.count) && (v.count as number) <= 3;
    case 'destroy':
      return integer(v.id) && integer(v.owner);
    case 'roundEnd':
      return nullable(integer)(v.winner) && boolean(v.match);
    case 'pickup':
      return integer(v.id) && power(v.power);
    default:
      return false;
  }
};
const replaySchema = fields({
  format: oneOf(REPLAY_FORMAT),
  version: oneOf(REPLAY_VERSION),
  recordedAt: (v) => text(v) && Number.isFinite(Date.parse(v as string)),
  snapshotHz: oneOf(30),
  round: integer,
  duration: number,
  winner: nullable(integer),
  config: fields({
    players: array(slot, 6),
    size: oneOf('compact', 'classic', 'large'),
    density: oneOf('open', 'balanced', 'dense'),
    target: oneOf(0, 3, 5, 10),
    powerups: boolean,
  }),
  map: fields({
    cols: integer,
    rows: integer,
    width: integer,
    height: integer,
    seed: text,
    cells: array(
      fields({
        id: integer,
        x: integer,
        y: integer,
        walls: (v) => array(boolean, 4)(v) && (v as unknown[]).length === 4,
      }),
      150,
    ),
    walls: array(fields({ x1: number, y1: number, x2: number, y2: number }), 400),
  }),
  frames: array(
    fields({
      time: number,
      tick: integer,
      elapsed: number,
      timer: number,
      state: oneOf('countdown', 'playing', 'roundOver', 'matchOver'),
      tanks: array(tank, 6),
      bullets: array(bullet, 256),
      powerups: array(fields({ ...point, type: power, life: number }), 16),
      scores: array(integer, 6),
      kills: array(integer, 6),
      statuses: array(oneOf('connecting', 'ready', 'failed', 'closed'), 6),
    }),
    MAX_FRAMES,
  ),
  events: array(fields({ time: number, tick: integer, event }), 100000),
});

/** Validate structure, finite values, resource limits, and roster/timeline references before use. */
export function parseReplay(source: string): RoundReplay {
  if (
    source.length > MAX_REPLAY_BYTES ||
    new TextEncoder().encode(source).byteLength > MAX_REPLAY_BYTES
  )
    throw new Error('Replay files must be 32 MB or smaller.');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid replay JSON.');
  }
  if (!object(value) || value.format !== REPLAY_FORMAT)
    throw new Error('Choose a Tank Trouble round replay (.ttr.json).');
  if (value.version !== REPLAY_VERSION) throw new Error('This replay version is not supported.');
  if (!replaySchema(value))
    throw new Error('The replay is incomplete or contains invalid game data.');
  const replay = value as unknown as RoundReplay;
  const { map, frames, config, duration } = replay;
  const count = config.players.length;
  const first = frames[0],
    last = frames[frames.length - 1];
  const validId = (id: number | null) => id === null || id < count;
  let previous = -1;
  const validFrames = frames.every((frame) => {
    const valid =
      frame.time > previous &&
      frame.time >= 0 &&
      frame.time <= duration &&
      frame.elapsed >= 0 &&
      frame.elapsed <= MAX_DURATION &&
      frame.tanks.length === count &&
      frame.scores.length === count &&
      frame.kills.length === count &&
      frame.statuses.length === count &&
      frame.tanks.every((t, i) => {
        const slot = config.players[i];
        return (
          t.id === i &&
          t.controller.kind === slot.kind &&
          (t.controller.kind !== 'bot' ||
            (slot.kind === 'bot' && t.controller.botId === slot.botId))
        );
      }) &&
      frame.bullets.every((b) => validId(b.owner));
    previous = frame.time;
    return valid;
  });
  previous = -1;
  const validEvents = replay.events.every(({ time, event }) => {
    const valid =
      time >= previous &&
      time >= 0 &&
      time <= duration &&
      (!('id' in event) || validId(event.id)) &&
      (!('owner' in event) || validId(event.owner)) &&
      (!('winner' in event) || validId(event.winner));
    previous = time;
    return valid;
  });
  if (
    count < 2 ||
    config.players.filter((s) => s.kind === 'human').length > 1 ||
    replay.round < 1 ||
    duration <= 0 ||
    duration > MAX_DURATION ||
    !validId(replay.winner) ||
    map.cols < 1 ||
    map.cols > 15 ||
    map.rows < 1 ||
    map.rows > 10 ||
    map.width !== map.cols * CELL ||
    map.height !== map.rows * CELL ||
    map.cells.length !== map.cols * map.rows ||
    !map.cells.every(
      (c, i) => c.id === i && c.x === i % map.cols && c.y === Math.floor(i / map.cols),
    ) ||
    !first ||
    first.time !== 0 ||
    first.state !== 'countdown' ||
    !last ||
    Math.abs(last.time - duration) > 1e-6 ||
    !['roundOver', 'matchOver'].includes(last.state) ||
    !validFrames ||
    !validEvents
  )
    throw new Error('The replay has an invalid round, map, roster, or timeline.');
  return replay;
}

export function serializeReplay(replay: RoundReplay): string {
  const source = JSON.stringify(replay);
  if (new TextEncoder().encode(source).byteLength > MAX_REPLAY_BYTES)
    throw new Error('This replay exceeds the 32 MB file limit.');
  return source;
}

/** Playback applies snapshots only. No physics, human commands, or bot workers run. */
export class ReplayPlayer {
  readonly game: Game;
  time = 0;
  speed = 1;
  paused = false;
  frameIndex = 0;

  constructor(readonly replay: RoundReplay) {
    this.game = new Game(replay.config, replay.map.seed);
    this.game.config = structuredClone(replay.config);
    this.game.map = structuredClone(replay.map);
    this.game.round = replay.round;
    this.game.events = [];
    this.seek(0);
  }

  seek(time: number) {
    const position = Math.max(0, Math.min(this.replay.duration, Number.isFinite(time) ? time : 0));
    // Range inputs can round the decimal max value; still land on the final snapshot.
    this.time = this.replay.duration - position < 1e-6 ? this.replay.duration : position;
    const frames = this.replay.frames;
    let low = 0,
      high = frames.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (frames[mid].time <= this.time) low = mid;
      else high = mid - 1;
    }
    this.frameIndex = low;
    const frame = frames[low],
      game = this.game;
    game.tick = frame.tick;
    game.elapsed = frame.elapsed;
    game.timer = frame.timer;
    game.state = frame.state;
    game.tanks = frame.tanks;
    game.bullets = frame.bullets;
    game.powerups = frame.powerups;
    game.scores = frame.scores;
    game.kills = frame.kills;
    game.players = new Map(
      frame.statuses.map((status, id) => [
        id,
        { status, profile: null, sequence: 0, observationTick: -1 },
      ]),
    );
    game.winner =
      this.time === this.replay.duration && this.replay.winner !== null
        ? game.tanks[this.replay.winner]
        : null;
    if (this.time === this.replay.duration) this.paused = true;
  }

  advance(dt: number) {
    if (!this.paused) this.seek(this.time + Math.max(0, dt) * this.speed);
  }
}
