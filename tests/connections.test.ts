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
import type { Decision, PlayerContext, PlayerDecision } from '../src/players/types.ts';
import { stampOf } from '../src/players/connection.ts';
import { RULES } from '../src/rules.ts';
import { serveBotWorker } from '../src/players/worker-host.ts';

class Port implements WorkerPort {
  sent: WorkerRequest[] = [];
  terminated = 0;
  sequence = 0;
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
  result(decision: Decision, frame = this.observation()) {
    this.receive({ type: 'result', stamp: stampOf(frame), sequence: ++this.sequence, decision });
  }
}
function setup(t: test.TestContext, botsOnly = false) {
  const game = new Game(
    {
      players: [
        botsOnly ? { kind: 'bot', botId: 'medium' } : { kind: 'human' },
        { kind: 'bot', botId: 'medium' },
      ],
      powerups: false,
    },
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
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((w) => w.border);
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0 });
  runtime.sync();
  t.after(() => runtime.dispose());
  return {
    game,
    runtime,
    ports,
    setClock: (value: number) => {
      clock = value;
    },
  };
}
const plan = (ticks = 2, throttle = 1): Decision => ({ segments: [{ ticks, throttle }] });

test('readiness gates the countdown/physics; human controls use the shared executor', (t) => {
  const { game, runtime, ports } = setup(t);
  runtime.setInput({ forward: true });
  assert.equal(runtime.step(), false);
  assert.equal(game.tick, 0);
  ports[0].ready();
  assert.equal(runtime.step(), false);
  assert.equal(ports[0].observation().tick, 0);
  ports[0].result(plan());
  assert.equal(runtime.step(), true);
  assert.equal(game.tick, 1);
  assert.ok(game.tanks[0].x > 100);
  assert.ok(game.tanks[1].x > 500);
  runtime.setInput({});
  runtime.step();
  assert.equal(game.tanks[0].throttle, 0);
});

test('plans run for exact ticks, then request one shared completed-state observation', (t) => {
  const { game, runtime, ports } = setup(t, true);
  ports.forEach((p) => p.ready());
  assert.equal(runtime.step(), false);
  assert.deepEqual(
    ports.map((p) => p.observation().tick),
    [0, 0],
  );
  ports[1].result(plan());
  assert.equal(runtime.step(), false, 'one reply cannot advance the world');
  ports[0].result(plan());
  assert.equal(runtime.step(), true);
  assert.equal(runtime.step(), true);
  assert.equal(game.tick, 2);
  assert.equal(runtime.step(), false);
  assert.deepEqual(
    ports.map((p) => p.observation().tick),
    [2, 2],
  );
  assert.equal(ports[0].sent.filter((m) => m.type === 'init').length, 1);
});

test('reply arrival order does not change gameplay', (t) => {
  const run = (reverse: boolean) => {
    const { game, runtime, ports } = setup(t, true);
    ports.forEach((p) => p.ready());
    for (let tick = 0; tick < 20; tick += 2) {
      runtime.step();
      for (const id of reverse ? [1, 0] : [0, 1])
        ports[id].result({ segments: [{ ticks: 2, throttle: 0.3, steer: id ? -0.2 : 0.2 }] });
      runtime.step();
      runtime.step();
    }
    return game.snapshot();
  };
  assert.deepEqual(run(false), run(true));
});

test('receipt before 10ms is accepted; at or after 10ms becomes four neutral ticks', (t) => {
  for (const duration of [9.999, 10, 11]) {
    const { game, runtime, ports, setClock } = setup(t);
    ports[0].ready();
    runtime.step();
    setClock(duration);
    ports[0].result(plan());
    assert.equal(runtime.step(), true);
    assert.equal(game.tanks[1].throttle, duration < 10 ? 1 : 0);
    assert.equal(runtime.statistics.get(1)?.deadlineMisses, duration < 10 ? 0 : 1);
  }
});

test('busy workers get neutral retry plans without overlapping or queued requests', (t) => {
  const { game, runtime, ports, setClock } = setup(t);
  const port = ports[0];
  port.ready();
  runtime.step();
  const old = port.observation();
  setClock(10);
  assert.equal(runtime.step(), true);
  for (let i = 0; i < 3; i++) runtime.step();
  assert.equal(game.tick, 4);
  runtime.step();
  assert.equal(port.sent.length, 2, 'no second observation while the worker is busy');
  assert.equal(runtime.statistics.get(1)?.busySkips, 1);
  port.result(plan(), old);
  assert.equal(game.tanks[1].throttle, 0, 'late plan is discarded');
  for (let i = 0; i < 3; i++) runtime.step();
  assert.equal(game.tick, 8);
  assert.equal(runtime.step(), false);
  port.result(plan());
  runtime.step();
  assert.equal(game.tanks[1].throttle, 1);
});

test('invalid plans are rejected atomically and retried without failing the controller', (t) => {
  const { game, runtime, ports } = setup(t);
  ports[0].ready();
  runtime.step();
  ports[0].result({
    segments: [
      { ticks: 1, throttle: 1 },
      { ticks: 0, fire: 'held' },
    ],
  });
  runtime.step();
  assert.equal(game.tanks[1].throttle, 0);
  assert.equal(game.players.get(1)?.status, 'ready');
  assert.equal(runtime.statistics.get(1)?.invalidPlans, 1);
  for (let i = 0; i < 3; i++) runtime.step();
  assert.equal(runtime.step(), false);
  assert.equal(ports[0].observation().tick, 4);
});

test('pause preserves plans and buffers outstanding outcomes until resume', (t) => {
  const { game, runtime, ports } = setup(t);
  ports[0].ready();
  runtime.step();
  game.pause();
  runtime.sync();
  ports[0].result(plan(3));
  assert.equal(runtime.step(), false);
  assert.equal(game.tick, 0);
  assert.equal(game.tanks[1].throttle, 0);
  game.pause();
  runtime.step();
  assert.equal(game.tanks[1].throttle, 1);
  game.pause();
  runtime.sync();
  for (let i = 0; i < 5; i++) runtime.step();
  game.pause();
  runtime.step();
  runtime.step();
  assert.equal(game.tick, 3);
  assert.equal(ports[0].sent.length, 2);
  assert.equal(runtime.step(), false);
  assert.equal(ports[0].observation().tick, 3);
});

test('round replacement, elimination, and disposal reject obsolete callbacks', async (t) => {
  const { game, runtime, ports } = setup(t);
  const old = ports[0];
  old.ready();
  runtime.step();
  const cancelled = runtime.whenUnblocked();
  game.prepareRound('replacement');
  runtime.sync();
  await cancelled;
  old.result(plan());
  assert.equal(ports.length, 2);
  assert.equal(old.terminated, 1);
  assert.equal(game.players.get(1)?.status, 'connecting');
  ports[1].ready();
  runtime.step();
  const waiting = runtime.whenUnblocked();
  runtime.dispose();
  await waiting;
  assert.equal(ports[1].terminated, 1);
  assert.equal(runtime.step(), false);
});

test('startup and stuck-operation watchdogs exclude paused wall time', (t) => {
  for (const ready of [false, true]) {
    const { game, runtime, ports, setClock } = setup(t);
    if (ready) {
      ports[0].ready();
      runtime.step();
    }
    setClock(5000);
    runtime.step();
    assert.notEqual(game.players.get(1)?.status, 'failed');
    game.pause();
    runtime.sync();
    setClock(100000);
    runtime.step();
    assert.notEqual(game.players.get(1)?.status, 'failed');
    game.pause();
    runtime.sync();
    setClock(105001);
    runtime.step();
    assert.equal(game.players.get(1)?.status, 'failed');
    assert.equal(ports[0].terminated, 1);
  }
});

test('malformed replies and worker errors fail only their own controller', (t) => {
  for (const malformed of [true, false]) {
    const { game, runtime, ports } = setup(t);
    if (malformed) ports[0].receive({ type: 'unexpected' });
    else ports[0].fail('Expected crash');
    assert.equal(game.players.get(1)?.status, 'failed');
    runtime.setInput({ forward: true });
    assert.equal(runtime.step(), true);
    assert.ok(game.tanks[0].x > 100);
    ports[0].fail('Repeated error');
    assert.equal(ports[0].terminated, 1);
  }
});

test('each bot RNG is independent and contexts expose universal ticks', () => {
  class RandomBot extends AbstractPlayer {
    override decide(context: PlayerContext): PlayerDecision {
      assert.equal(context.tickRate, 120);
      assert.equal(context.tick, 17);
      return { steer: context.observe().random() };
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
  const other = new BotBrain({ ...init, seed: 'other' }, () => new RandomBot());
  const frame = { ...game.snapshot(), tick: 17 };
  for (let i = 0; i < 10; i++) {
    other.decide(frame);
    assert.deepEqual(first.decide(frame), same.decide(frame));
  }
  assert.equal(game.rng(), baseline.rng());
});

test('worker host preserves native plans and reports rejected async strategies', async () => {
  class PlanBot extends AbstractPlayer {
    override async decide(): Promise<Decision> {
      return plan(7);
    }
  }
  class RejectingBot extends AbstractPlayer {
    override async decide(): Promise<Decision> {
      throw new Error('Expected async failure');
    }
  }
  for (const failing of [false, true]) {
    let receive: (message: WorkerRequest) => void = () => {};
    const replies: WorkerReply[] = [];
    serveBotWorker(
      (handler) => {
        receive = handler;
      },
      (reply) => replies.push(reply),
      () => (failing ? new RejectingBot() : new PlanBot()),
    );
    const game = new Game({}, 'host');
    receive({
      type: 'init',
      init: {
        generation: game.generation,
        round: game.round,
        playerId: 1,
        botId: 'fixture',
        seed: 'host',
        map: game.map,
        rules: RULES,
      },
    });
    receive({ type: 'observe', frame: game.snapshot() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (failing)
      assert.deepEqual(replies[1], { type: 'failure', reason: 'Expected async failure' });
    else {
      const reply = replies[1];
      assert.equal(reply.type, 'result');
      if (reply.type === 'result') assert.deepEqual(reply.decision, plan(7));
    }
  }
});

test('null or missing decision payloads produce neutral retries instead of OFFLINE', (t) => {
  for (const missing of [false, true]) {
    const { game, runtime, ports } = setup(t);
    ports[0].ready();
    runtime.step();
    ports[0].receive({
      type: 'result',
      stamp: stampOf(ports[0].observation()),
      sequence: 1,
      ...(missing ? {} : { decision: null }),
    });
    assert.equal(runtime.step(), true);
    assert.equal(game.players.get(1)?.status, 'ready');
    assert.equal(game.tanks[1].throttle, 0);
    assert.equal(runtime.statistics.get(1)?.invalidPlans, 1);
  }
});

test('elimination cancels an outstanding boundary and discards its reply', async (t) => {
  const { game, runtime, ports } = setup(t);
  ports[0].ready();
  runtime.step();
  const waiting = runtime.whenUnblocked();
  game.destroyTank(game.tanks[1], 0);
  runtime.sync();
  await waiting;
  assert.equal(ports[0].terminated, 1);
  ports[0].result(plan());
  assert.equal(game.players.get(1)?.status, 'closed');
  assert.equal(game.tanks[1].throttle, 0);
});

test('async waiters remain suspended during pause until resume', async (t) => {
  const { game, runtime, ports } = setup(t);
  ports[0].ready();
  runtime.step();
  let resolved = false;
  const waiting = runtime.whenUnblocked().then(() => {
    resolved = true;
  });
  game.pause();
  runtime.sync();
  ports[0].result(plan());
  await Promise.resolve();
  assert.equal(resolved, false);
  game.pause();
  runtime.sync();
  await waiting;
  assert.equal(game.tick, 0);
  assert.equal(runtime.step(), true);
});

test('mismatched observation stamps cannot submit plans', (t) => {
  const { game, runtime, ports } = setup(t);
  ports[0].ready();
  runtime.step();
  const frame = ports[0].observation();
  ports[0].result(plan(), { ...frame, tick: frame.tick + 1 });
  assert.equal(game.players.get(1)?.status, 'failed');
  assert.equal(game.tanks[1].throttle, 0);
});
