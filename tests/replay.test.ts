import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../src/engine.ts';
import {
  MAX_REPLAY_BYTES,
  parseReplay,
  ReplayPlayer,
  ReplayRecorder,
  serializeReplay,
} from '../src/replay.ts';
import { recordedRound } from './helpers/replay.ts';

test('recorded rounds survive JSON export/import with snapshots, events, and scores intact', () => {
  const replay = recordedRound();
  const loaded = parseReplay(serializeReplay(replay));
  assert.equal(serializeReplay(loaded), serializeReplay(replay));
  assert.equal(loaded.winner, 0);
  assert.deepEqual(loaded.frames.at(-1)?.scores, [1, 0]);
  assert.ok(loaded.frames.length > 100);
  assert.ok(loaded.events.some(({ event }) => event.type === 'fire'));
  assert.ok(loaded.events.some(({ event }) => event.type === 'roundEnd'));
  assert.notDeepEqual(loaded.frames[0].tanks, loaded.frames.at(-1)?.tanks);
});

test('recording is opt-in and enabling mid-round waits for the next round', () => {
  const game = new Game({}, 'optional');
  const recorder = new ReplayRecorder();
  game.start();
  recorder.observe(game, 0, []);
  assert.equal(recorder.active, false);
  recorder.enabled = true;
  recorder.observe(game, 1 / 120, []);
  assert.equal(recorder.active, false);
  game.finishRound(null);
  assert.equal(recorder.observe(game, 0, game.drainEvents()), null);
  game.round++;
  game.prepareRound();
  game.beginCountdown();
  recorder.observe(game, 0, game.drainEvents());
  assert.equal(recorder.active, true);
});

test('paused wall time is excluded, disabling does not truncate the current recording', () => {
  const game = new Game({}, 'pause-recording');
  const recorder = new ReplayRecorder();
  recorder.enabled = true;
  game.start();
  recorder.observe(game, 0, game.drainEvents());
  game.update(1 / 120);
  recorder.observe(game, 1 / 120, game.drainEvents());
  game.pause();
  recorder.observe(game, 60, game.drainEvents());
  game.pause();
  recorder.enabled = false;
  game.finishRound(game.tanks[0]);
  const replay = recorder.observe(game, 0, game.drainEvents());
  assert.ok(replay);
  assert.equal(replay.duration, 1 / 120);
  assert.equal(recorder.active, false);
  assert.equal(recorder.observe(game, 1 / 120, []), null, 'round is emitted only once');
});

test('observing does not consume UI events or retain mutable simulation references', () => {
  const game = new Game({}, 'observer');
  const recorder = new ReplayRecorder();
  recorder.enabled = true;
  game.start();
  const events = structuredClone(game.events);
  const initialX = game.tanks[0].x;
  recorder.observe(game, 0, game.events);
  assert.deepEqual(game.events, events);
  game.tanks[0].x++;
  game.finishRound(game.tanks[0]);
  const replay = recorder.observe(game, 1 / 120, game.drainEvents());
  assert.ok(replay);
  assert.equal(replay.frames[0].tanks[0].x, initialX);
  assert.equal(replay.frames.at(-1)?.tanks[0].x, initialX + 1);
  game.tanks[0].x++;
  assert.equal(replay.frames.at(-1)?.tanks[0].x, initialX + 1);
});

test('discarding an incomplete round permits recording a replacement game', () => {
  const recorder = new ReplayRecorder();
  recorder.enabled = true;
  const first = new Game();
  first.start();
  recorder.observe(first, 0, []);
  recorder.discard();
  assert.equal(recorder.active, false);
  const next = new Game();
  next.start();
  recorder.observe(next, 0, []);
  assert.equal(recorder.active, true);
});

test('playback reproduces sampled state when seeking forward and backward without simulation', () => {
  const replay = parseReplay(serializeReplay(recordedRound()));
  const player = new ReplayPlayer(replay);
  player.game.update = () => assert.fail('Playback must not run physics or controllers');
  for (const index of [0, 50, replay.frames.length - 1, 25, 0]) {
    const frame = replay.frames[index];
    player.seek(frame.time);
    assert.equal(player.frameIndex, index);
    assert.deepEqual(player.game.tanks, frame.tanks);
    assert.deepEqual(player.game.bullets, frame.bullets);
    assert.deepEqual(player.game.scores, frame.scores);
    assert.equal(player.game.tick, frame.tick);
  }
  assert.deepEqual(player.game.map, replay.map);
  assert.equal(player.game.winner, null);
});

test('playback respects pause, speed, bounds, and stops at the recorded result', () => {
  const replay = recordedRound();
  const player = new ReplayPlayer(replay);
  player.paused = true;
  player.advance(1);
  assert.equal(player.time, 0);
  player.paused = false;
  player.speed = 2;
  player.advance(0.25);
  assert.equal(player.time, 0.5);
  player.advance(100);
  assert.equal(player.time, replay.duration);
  assert.equal(player.paused, true);
  assert.equal(player.game.winner?.id, 0);
  player.seek(-100);
  assert.equal(player.time, 0);
  player.seek(NaN);
  assert.equal(player.time, 0);
  player.seek(Number(replay.duration.toPrecision(15)));
  assert.equal(
    player.time,
    replay.duration,
    'range input rounding must still reach the final result',
  );
  assert.equal(player.game.winner?.id, 0);
});

test('invalid JSON, unrelated files, unsupported versions, and oversized files are rejected', () => {
  assert.throws(() => parseReplay('{'), /JSON/);
  assert.throws(() => parseReplay('{}'), /Tank Trouble/);
  const replay = recordedRound();
  assert.throws(() => parseReplay(JSON.stringify({ ...replay, version: 2 })), /version/);
  assert.throws(() => parseReplay(' '.repeat(MAX_REPLAY_BYTES + 1)), /32 MB/);
});

test('a full-length six-bot round fits the supported format and retains its final draw', () => {
  const game = new Game(
    {
      players: Array.from({ length: 6 }, () => ({ kind: 'bot', botId: 'medium' })),
      size: 'large',
      target: 0,
    },
    'FULL-ROUND',
  );
  const recorder = new ReplayRecorder();
  recorder.enabled = true;
  game.start();
  recorder.observe(game, 0, game.drainEvents());
  let replay: ReturnType<typeof recorder.observe> = null;
  for (let i = 0; i < 12000 && !replay; i++) {
    game.update(1 / 120);
    replay = recorder.observe(game, 1 / 120, game.drainEvents());
  }
  assert.ok(replay);
  assert.ok(replay.duration > 92);
  assert.ok(replay.frames.length > 2700);
  const loaded = parseReplay(serializeReplay(replay));
  const player = new ReplayPlayer(loaded);
  player.seek(loaded.duration);
  assert.equal(player.game.winner, null);
  assert.equal(player.game.state, 'roundOver');
  assert.equal(player.game.humanId, null);
});

test('uploaded replays can show custom bots that are not installed locally', () => {
  const replay = recordedRound();
  replay.config.players[1] = { kind: 'bot', botId: 'external-strategy' };
  for (const frame of replay.frames)
    frame.tanks[1].controller = { botId: 'external-strategy', kind: 'bot' };
  const player = new ReplayPlayer(parseReplay(serializeReplay(replay)));
  assert.deepEqual(player.game.config.players[1], { kind: 'bot', botId: 'external-strategy' });
  assert.deepEqual(player.game.tanks[1].controller, { kind: 'bot', botId: 'external-strategy' });
});

test('malformed maps, frames, colors, roster references, and event timelines are rejected', () => {
  const original = recordedRound();
  const mutations = [
    (r: typeof original) => {
      r.map.width = 10000000;
    },
    (r: typeof original) => {
      r.frames = [];
    },
    (r: typeof original) => {
      r.frames[1].time = -1;
    },
    (r: typeof original) => {
      r.frames[1].time = r.frames[0].time;
    },
    (r: typeof original) => {
      r.frames[0].tanks[0].color = 'red" onload="alert(1)';
    },
    (r: typeof original) => {
      r.frames[0].tanks[0].x = Infinity;
    },
    (r: typeof original) => {
      r.frames[0].tanks[0].id = 99;
    },
    (r: typeof original) => {
      r.frames[0].statuses = [];
    },
    (r: typeof original) => {
      r.winner = 99;
    },
    (r: typeof original) => {
      r.events[0].time = r.duration + 1;
    },
    (r: typeof original) => {
      r.events[0].event = { type: 'destroy', id: 99, owner: 0 };
    },
    (r: typeof original) => {
      r.frames.pop();
    },
    (r: typeof original) => {
      r.duration = 10000;
    },
  ];
  for (const mutate of mutations) {
    const replay = structuredClone(original);
    mutate(replay);
    assert.throws(() => parseReplay(JSON.stringify(replay)));
  }
});
