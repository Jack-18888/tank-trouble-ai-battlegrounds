import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.ts';
import { AbstractPlayer } from '../src/players/abstract-player.ts';
import { InProcessConnection } from '../src/players/in-process-connection.ts';
import { PlayerRuntime } from '../src/players/runtime.ts';
import { DecisionExecutor, MAX_DECISION_TICKS, validateDecision } from '../src/players/decision.ts';
import type { Decision, PlayerContext } from '../src/players/types.ts';

test('validation rejects incomplete programs atomically and detaches sanitized controls', () => {
  for (const value of [
    null,
    {},
    { segments: [] },
    { segments: new Array(1) },
    { segments: Array.from({ length: 257 }, () => ({ ticks: 1 })) },
    ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER].map((ticks) => ({
      segments: [{ ticks }],
    })),
    { segments: [{ ticks: MAX_DECISION_TICKS }, { ticks: 1 }] },
    { segments: [{ ticks: 1, fire: true }] },
  ])
    assert.throws(() => validateDecision(value));
  const source = { segments: [{ ticks: 2, steer: 99, throttle: NaN }] };
  const accepted = validateDecision(source);
  source.segments[0].ticks = 8;
  assert.deepEqual(accepted.segments[0], { ticks: 2, steer: 1, throttle: 0 });
  assert.ok(Object.isFrozen(accepted.segments[0]));
  assert.doesNotThrow(() => validateDecision({ segments: [{ ticks: MAX_DECISION_TICKS }] }));
});

test('segments compose simultaneous controls, exact expiry, and single-tick firing', () => {
  const executor = new DecisionExecutor();
  executor.accept(
    3,
    validateDecision({
      segments: [
        { ticks: 12, steer: 1, throttle: 1 },
        { ticks: 24, throttle: 1, fire: 'once' },
      ],
    }),
    100,
  );
  for (let completed = 100; completed < 136; completed++) {
    const controls = executor.controls(3, completed);
    assert.equal(controls.throttle, 1);
    assert.equal(controls.steer, completed < 112 ? 1 : 0);
    assert.equal(controls.fire, completed === 112);
    assert.equal(executor.due(3, completed), false);
  }
  assert.equal(executor.due(3, 136), true);
  assert.deepEqual(executor.controls(3, 136), {});
});

function fixture(t: test.TestContext, decision: Decision) {
  const observed: number[] = [];
  class Planned extends AbstractPlayer {
    constructor() {
      super({ error: 0, cooldown: 0.32 });
    }
    override decide(context: PlayerContext): Decision {
      observed.push(context.tick);
      return decision;
    }
  }
  class Idle extends AbstractPlayer {
    override decide(): Decision {
      return { segments: [{ ticks: MAX_DECISION_TICKS }] };
    }
  }
  const game = new Game(
    {
      players: [
        { kind: 'bot', botId: 'medium' },
        { kind: 'bot', botId: 'medium' },
      ],
      powerups: false,
    },
    'plans',
  );
  const runtime = new PlayerRuntime(
    game,
    (init, events) =>
      new InProcessConnection(init, events, () =>
        init.playerId === 0 ? new Planned() : new Idle(),
      ),
    () => 0,
  );
  game.start();
  game.state = 'playing';
  runtime.sync();
  game.map.walls = game.map.walls.filter((w) => w.border);
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0 });
  t.after(() => runtime.dispose());
  return { game, runtime, observed };
}

test('real physics executes plans and requests exactly at their expiry ticks', (t) => {
  const { game, runtime, observed } = fixture(t, {
    segments: [
      { ticks: 12, steer: 0.5, throttle: 1 },
      { ticks: 24, throttle: 1 },
    ],
  });
  game.tick = 100;
  for (let i = 0; i < 36; i++) assert.equal(runtime.step(), true);
  assert.equal(game.tick, 136);
  assert.deepEqual(observed, [100]);
  assert.ok(game.tanks[0].x > 100);
  assert.equal(game.tanks[0].steer, 0);
  runtime.step();
  assert.deepEqual(observed, [100, 136]);
});

test('once attempts one volley; held retains cooldown and ammunition rules', (t) => {
  for (const mode of ['once', 'held'] as const) {
    const { game, runtime } = fixture(t, { segments: [{ ticks: 100, fire: mode }] });
    let shots = 0;
    for (let i = 0; i < 80; i++) {
      runtime.step();
      shots += game.drainEvents().filter((e) => e.type === 'fire').length;
    }
    assert.equal(shots, mode === 'once' ? 1 : 3);
  }
  const { game, runtime } = fixture(t, { segments: [{ ticks: 100, fire: 'once' }] });
  game.tanks[0].cooldown = 0.1;
  for (let i = 0; i < 30; i++) runtime.step();
  assert.equal(game.bullets.length, 0, 'a blocked once attempt is not deferred or retried');
});

test('wall contact does not end a plan early', (t) => {
  const { game, runtime, observed } = fixture(t, { segments: [{ ticks: 20, throttle: -1 }] });
  game.tanks[0].x = 23;
  for (let i = 0; i < 20; i++) runtime.step();
  assert.deepEqual(observed, [0]);
  runtime.step();
  assert.deepEqual(observed, [0, 20]);
});
