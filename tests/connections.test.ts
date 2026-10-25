import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.ts';
import { PlayerRuntime } from '../src/players/runtime.ts';
import { WorkerConnection } from '../src/players/worker-connection.ts';
import type { WorkerPort } from '../src/players/worker-connection.ts';
import { AbstractPlayer } from '../src/players/abstract-player.ts';
import { BotBrain } from '../src/players/bot-brain.ts';
import { MediumBot } from '../src/bots/index.ts';
import type {
  RoundInit,
  WorkerReply,
  WorkerRequest,
  WorldFrame,
} from '../src/players/connection.ts';
import type { PlayerContext, PlayerDecision } from '../src/players/types.ts';
import { stampOf } from '../src/players/connection.ts';
import { RULES } from '../src/rules.ts';
import { serveBotWorker } from '../src/players/worker-host.ts';

class Port implements WorkerPort {
  sent: WorkerRequest[] = [];
  terminated = 0;
  receive: (value: unknown) => void = () => {};
  fail: (reason: string) => void = () => {};
  listen(receive: (value: unknown) => void, fail: (reason: string) => void) {
    this.receive = receive;
    this.fail = fail;
  }
  post(message: WorkerRequest) {
    this.sent.push(structuredClone(message));
  }
  terminate() {
    this.terminated++;
  }
  ready() {
    const message = this.sent[0];
    assert.equal(message.type, 'init');
    if (message.type !== 'init') throw new Error('Expected initialization.');
    this.receive({
      type: 'ready',
      generation: message.init.generation,
      round: message.init.round,
      profile: new MediumBot().profile,
    });
  }
  observation(): WorldFrame {
    const message = this.sent.at(-1);
    if (message?.type !== 'observe') throw new Error('Expected observation.');
    return message.frame;
  }
  result(sequence: number, decision?: PlayerDecision, frame = this.observation()) {
    const reply: WorkerReply = {
      type: 'result',
      stamp: stampOf(frame),
      sequence,
      ...(decision ? { decision } : {}),
    };
    this.receive(reply);
  }
}

function setup() {
  const game = new Game(
    { players: [{ kind: 'human' }, { kind: 'bot', botId: 'medium' }], powerups: false },
    'connections',
  );
  let clock = 0;
  const ports: Port[] = [];
  const runtime = new PlayerRuntime(
    game,
    (init, events) => {
      const port = new Port();
      ports.push(port);
      return new WorkerConnection(init, events, port);
    },
    () => clock,
  );
  game.start();
  runtime.sync();
  return {
    game,
    runtime,
    ports,
    setClock: (value: number) => {
      clock = value;
    },
  };
}

test('physics never constructs bots and runtime waits for readiness without blocking humans', () => {
  const { game, runtime, ports } = setup();
  assert.equal(ports.length, 1);
  assert.equal(game.players.get(1)?.status, 'connecting');
  assert.equal(game.players.get(1)?.profile, null);
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0 });
  runtime.setInput({ forward: true });
  assert.equal(game.tanks[0].throttle, 0);
  runtime.step(1 / 120);
  assert.ok(game.tanks[0].x > 100);
  assert.equal(game.tanks[1].x, 500);
  assert.equal(game.tick, 1);
  ports[0].ready();
  assert.equal(game.players.get(1)?.status, 'ready');
  runtime.dispose();
});

test('commands apply on the next tick, remain active, and reject stale or future envelopes', () => {
  const { game, runtime, ports } = setup();
  ports[0].ready();
  game.state = 'playing';
  runtime.step(1 / 120);
  const frame = ports[0].observation();
  ports[0].result(1, { steer: 99, throttle: 0.5, fire: true });
  assert.equal(game.tanks[1].steer, 0);
  runtime.step(1 / 120);
  assert.equal(game.tanks[1].steer, 1);
  assert.equal(game.tanks[1].throttle, 0.5);
  runtime.step(1 / 120);
  assert.equal(game.tanks[1].throttle, 0.5);
  assert.equal(game.submitDecision(1, { ...stampOf(frame), sequence: 1, decision: {} }), false);
  assert.equal(
    game.submitDecision(1, {
      ...game.controlStamp(),
      tick: game.tick + 1,
      sequence: 2,
      decision: {},
    }),
    false,
  );
  assert.equal(
    game.submitDecision(1, {
      ...game.controlStamp(),
      generation: game.generation - 1,
      sequence: 2,
      decision: {},
    }),
    false,
  );
  runtime.dispose();
});

test('busy workers receive only the newest pending snapshot and static map is sent once', () => {
  const { game, runtime, ports } = setup();
  const port = ports[0];
  port.ready();
  game.state = 'playing';
  for (let i = 0; i < 13; i++) runtime.step(1 / 120);
  assert.equal(port.sent.filter((message) => message.type === 'observe').length, 1);
  const first = port.observation();
  port.result(0);
  assert.equal(port.sent.filter((message) => message.type === 'observe').length, 2);
  assert.ok(port.observation().tick >= 12);
  assert.ok(port.observation().tick > first.tick);
  assert.equal('map' in port.observation(), false);
  assert.equal(port.sent.filter((message) => message.type === 'init').length, 1);
  runtime.dispose();
});

test('pause clears controls, rejects old work, and resumes with fresh observations in the same worker', () => {
  const { game, runtime, ports } = setup();
  const port = ports[0];
  port.ready();
  game.state = 'playing';
  runtime.step(1 / 120);
  const old = port.observation();
  runtime.setInput({ fire: true });
  runtime.step(1 / 120);
  assert.equal(game.tanks[0].fire, true);
  game.pause();
  runtime.sync();
  assert.equal(game.tanks[0].fire, false);
  const count = port.sent.length;
  for (let i = 0; i < 10; i++) runtime.step(1 / 120);
  assert.equal(port.sent.length, count);
  game.pause();
  runtime.sync();
  runtime.step(1 / 120);
  port.result(1, { throttle: 1, fire: true }, old);
  assert.equal(game.tanks[1].fire, false);
  const fresh = port.observation();
  assert.notEqual(fresh.epoch, old.epoch);
  port.result(2, { throttle: 1 }, fresh);
  runtime.step(1 / 120);
  assert.equal(game.tanks[1].throttle, 1);
  assert.equal(ports.length, 1);
  runtime.dispose();
});

test('round changes, elimination, and disposal terminate workers and discard their late replies', () => {
  const { game, runtime, ports } = setup();
  const old = ports[0];
  old.ready();
  game.state = 'playing';
  runtime.step(1 / 120);
  const frame = old.observation();
  game.finishRound(game.tanks[0]);
  runtime.sync();
  assert.equal(old.terminated, 1);
  game.timer = 0;
  runtime.step(1 / 120);
  assert.equal(ports.length, 2);
  assert.equal(game.round, 2);
  old.result(100, { fire: true }, frame);
  assert.equal(game.tanks[1].fire, false);
  ports[1].ready();
  game.destroyTank(game.tanks[1], 0);
  runtime.sync();
  assert.equal(ports[1].terminated, 1);
  runtime.dispose();
  runtime.dispose();
  assert.equal(ports[1].terminated, 1);
});

test('worker errors stop only that tank and produce one failure event', () => {
  const { game, runtime, ports } = setup();
  ports[0].ready();
  game.state = 'playing';
  runtime.step(1 / 120);
  ports[0].result(1, { fire: true, throttle: 1 });
  runtime.step(1 / 120);
  ports[0].fail('Fixture crash');
  ports[0].fail('Duplicate error');
  assert.equal(game.players.get(1)?.status, 'failed');
  assert.equal(game.tanks[1].fire, false);
  assert.equal(game.tanks[1].throttle, 0);
  assert.equal(game.tanks[1].alive, true);
  const elapsed = game.elapsed;
  runtime.step(1 / 120);
  assert.ok(game.elapsed > elapsed);
  assert.equal(
    game.drainEvents().filter((event) => event.type === 'playerStatus' && event.status === 'failed')
      .length,
    1,
  );
  assert.equal(ports[0].terminated, 1);
});

test('startup and outstanding work time out after ten unpaused seconds', () => {
  for (const ready of [false, true]) {
    const { game, runtime, ports, setClock } = setup();
    if (ready) {
      ports[0].ready();
      game.state = 'playing';
      runtime.step(1 / 120);
    }
    setClock(5000);
    runtime.step(1 / 120);
    assert.notEqual(game.players.get(1)?.status, 'failed');
    game.pause();
    runtime.sync();
    setClock(100000);
    runtime.step(1 / 120);
    assert.notEqual(game.players.get(1)?.status, 'failed');
    game.pause();
    runtime.sync();
    setClock(105001);
    runtime.step(1 / 120);
    assert.equal(game.players.get(1)?.status, 'failed');
    assert.equal(ports[0].terminated, 1);
    runtime.dispose();
  }
});

test('malformed replies and invalid readiness profiles fail the connection', () => {
  for (const payload of [
    { type: 'unexpected' },
    { type: 'ready', generation: 1, round: 1, profile: { speed: NaN } },
  ]) {
    const { game, runtime, ports } = setup();
    ports[0].receive(payload);
    assert.equal(game.players.get(1)?.status, 'failed');
    runtime.dispose();
  }
});

test('worker observations are shared completed-tick snapshots detached from live tanks', () => {
  const game = new Game(
    {
      players: [
        { kind: 'bot', botId: 'medium' },
        { kind: 'bot', botId: 'hard' },
      ],
    },
    'snapshots',
  );
  const seen: WorldFrame[] = [];
  const runtime = new PlayerRuntime(game, (_init, events) => {
    events.ready(new MediumBot().profile);
    return { observe: (frame) => seen.push(frame), invalidate() {}, advance() {}, dispose() {} };
  });
  game.state = 'playing';
  runtime.step(1 / 120);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[0].tick, game.tick);
  assert.ok(Object.isFrozen(seen[0].tanks[0]));
  const x = seen[0].tanks[0].x;
  game.tanks[0].x += 10;
  assert.equal(seen[0].tanks[0].x, x);
  runtime.dispose();
});

test('each bot has an independent random stream that never advances physics randomness', () => {
  class RandomBot extends AbstractPlayer {
    constructor() {
      super({ reaction: 0 });
    }
    override decide({ observe }: PlayerContext): PlayerDecision {
      return { steer: observe().random() };
    }
  }
  const game = new Game({}, 'random-streams');
  const baseline = new Game({}, 'random-streams');
  const init: RoundInit = {
    generation: game.generation,
    round: game.round,
    playerId: 1,
    botId: 'fixture',
    seed: 'bot-one',
    map: game.map,
    rules: RULES,
  };
  const first = new BotBrain(init, () => new RandomBot());
  const same = new BotBrain(init, () => new RandomBot());
  const other = new BotBrain({ ...init, playerId: 0, seed: 'bot-two' }, () => new RandomBot());
  for (let i = 0; i < 10; i++) {
    const frame = { ...game.snapshot(), tick: i };
    for (let n = 0; n < 20; n++) other.decide(frame);
    assert.deepEqual(first.decide(frame), same.decide(frame));
  }
  assert.equal(game.rng(), baseline.rng());
});

test('late startup and error callbacks cannot mark a replacement round ready or failed', () => {
  const { game, runtime, ports } = setup();
  const old = ports[0];
  game.prepareRound('replacement');
  old.ready();
  assert.equal(game.players.get(1)?.status, 'connecting');
  old.fail('Late old-round error');
  assert.equal(game.players.get(1)?.status, 'connecting');
  runtime.sync();
  assert.equal(ports.length, 2);
  ports[1].ready();
  assert.equal(game.players.get(1)?.status, 'ready');
  runtime.dispose();
});

test('the real worker host reports a rejected asynchronous decision as a controller failure', async () => {
  class RejectingBot extends AbstractPlayer {
    override async decide(): Promise<PlayerDecision> {
      throw new Error('Expected async failure');
    }
  }
  let receive: (message: WorkerRequest) => void = () => {};
  const replies: WorkerReply[] = [];
  serveBotWorker(
    (handler) => {
      receive = handler;
    },
    (reply) => replies.push(reply),
    () => new RejectingBot(),
  );
  const game = new Game({}, 'worker-host');
  receive({
    type: 'init',
    init: {
      generation: game.generation,
      round: game.round,
      playerId: 1,
      botId: 'reject',
      seed: 'seed',
      map: game.map,
      rules: RULES,
    },
  });
  assert.equal(replies[0].type, 'ready');
  receive({ type: 'observe', frame: game.snapshot() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(replies[1], { type: 'failure', reason: 'Expected async failure' });
});
