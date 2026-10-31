import { createTestGame } from './helpers/game.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateGameConfig } from '../src/engine.ts';
import { AbstractPlayer, Player, assignController } from '../src/players/index.ts';
import type { PlayerContext, PlayerDecision } from '../src/players/index.ts';
import { HardBot, registerBot } from '../src/bots/index.ts';
import type { PlayerSlot } from '../src/types.ts';

const human: PlayerSlot = { kind: 'human' };
const bot = (botId = 'medium'): PlayerSlot => ({ kind: 'bot', botId });

test('Player directly inherits AbstractPlayer and translates input without observing the world', () => {
  const player = new Player();
  assert.ok(player instanceof AbstractPlayer);
  assert.equal(Object.getPrototypeOf(Player.prototype), AbstractPlayer.prototype);
  const observe = (): never => {
    throw new Error('Human input must not build a world snapshot');
  };
  assert.deepEqual(player.decide({ tick: 0, tickRate: 120, input: {}, observe }), {
    steer: 0,
    throttle: 0,
    fire: false,
  });
  assert.deepEqual(
    player.decide({
      tick: 0,
      tickRate: 120,
      input: { left: true, backward: true, fire: true },
      observe,
    }),
    {
      steer: -1,
      throttle: -1,
      fire: true,
    },
  );
  assert.deepEqual(
    player.decide({
      tick: 0,
      tickRate: 120,
      input: { left: true, right: true, forward: true, backward: true },
      observe,
    }),
    { steer: 0, throttle: 0, fire: false },
  );
});

test('the human can occupy another slot while slot zero keeps its bot profile', () => {
  const game = createTestGame({ players: [bot('hard'), human] }, 'human-second');
  assert.equal(game.humanId, 1);
  game.state = 'playing';
  game.runtime.sync();
  assert.ok(game.controllers.get(0) instanceof HardBot);
  assert.equal(game.players.get(1)?.profile?.reaction, 0);
  assert.equal(game.tanks[0].name, 'Moss');
  assert.equal(game.tanks[1].name, 'You');
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  Object.assign(game.tanks[0], { x: 500, y: 400, angle: 0, think: 999, cooldown: 0 });
  const tank = game.tanks[1];
  Object.assign(tank, { x: 100, y: 100, angle: 0, think: 999, cooldown: 0 });
  game.getBotContext = () => {
    throw new Error('Input must not request observations');
  };
  game.update(1 / 120, { forward: true, fire: true });
  assert.ok(Math.abs(tank.x - (100 + 114 / 120)) < 1e-8);
  assert.equal(game.tanks[0].x, 500);
  assert.equal(game.bullets[0].owner, 1);
  assert.equal(game.bullets[0].vy, 0);
  assert.equal(tank.cooldown, 0.32);
  game.update(1 / 120);
  assert.equal(tank.vx, 0, 'released movement stops on the next tick');
  assert.equal(tank.fire, false);
  const x = tank.x;
  game.update(1 / 120, { forward: true, backward: true, left: true, right: true });
  assert.equal(tank.x, x);
  assert.equal(tank.angle, 0);
  game.fire(game.tanks[0]);
  assert.equal(game.tanks[0].cooldown, 0.46, 'slot zero uses the Hard firing profile');
});

test('assigning Human swaps the displaced bot without mutating the previous roster', () => {
  const original = [human, bot('hard'), bot('easy')];
  const next = assignController(original, 1, human);
  assert.deepEqual(next, [bot('hard'), human, bot('easy')]);
  assert.deepEqual(original, [human, bot('hard'), bot('easy')]);
  assert.deepEqual(assignController(next, 1, bot('easy')), [bot('hard'), bot('easy'), bot('easy')]);
  assert.deepEqual(assignController([bot('easy'), bot('hard')], 1, human), [bot('easy'), human]);
  assert.deepEqual(assignController(next, 1, human), next);
});

test('roster validation enforces bounds and one human, with fresh configuration objects', () => {
  assert.deepEqual(validateGameConfig({ players: [] }).players, [bot(), bot()]);
  assert.deepEqual(validateGameConfig({ players: [human] }).players, [human, bot()]);
  assert.deepEqual(
    validateGameConfig({
      players: [
        null,
        human,
        human,
        { kind: 'bot', botId: 'removed' },
        {},
        bot('easy'),
        bot('hard'),
      ],
    }).players,
    [bot(), human, bot(), bot(), bot(), bot('easy')],
  );
  assert.deepEqual(validateGameConfig({ players: null }).players, DEFAULT_CONFIG.players);
  const first = validateGameConfig(undefined);
  const second = validateGameConfig(undefined);
  first.players[0] = bot('hard');
  assert.deepEqual(second.players, DEFAULT_CONFIG.players);
});

test('legacy preferences migrate while an explicit roster takes precedence', () => {
  const legacy = {
    opponents: 2,
    difficulties: ['hard', 'easy'],
    size: 'large',
    density: 'dense',
    target: 10,
    powerups: false,
  };
  assert.deepEqual(validateGameConfig(legacy), {
    players: [human, bot('hard'), bot('easy')],
    size: 'large',
    density: 'dense',
    target: 10,
    powerups: false,
  });
  assert.deepEqual(validateGameConfig({ ...legacy, players: [bot('easy'), bot('hard')] }).players, [
    bot('easy'),
    bot('hard'),
  ]);
  assert.deepEqual(validateGameConfig({ ...legacy, players: [] }).players, [bot(), bot()]);
  assert.deepEqual(validateGameConfig({ difficulties: ['hard'] }).players, [
    human,
    bot('hard'),
    bot(),
  ]);
});

test('bot decisions retain their reaction delay and never receive human input', () => {
  class DelayedBot extends AbstractPlayer {
    decisions = 0;
    override decide(context: PlayerContext): PlayerDecision {
      this.decisions++;
      assert.deepEqual(context.input, {});
      assert.ok(Object.isFrozen(context));
      assert.ok(Object.isFrozen(context.input));
      assert.throws(() => {
        // @ts-expect-error Input cannot be changed by a controller.
        context.input.forward = true;
      }, TypeError);
      return {};
    }
  }
  registerBot('test-delayed-player', DelayedBot);
  const game = createTestGame({ players: [bot('test-delayed-player'), human] }, 'reaction');
  game.state = 'playing';
  game.runtime.sync();
  const controller = game.controllers.get(0);
  assert.ok(controller instanceof DelayedBot);
  game.state = 'playing';
  game.update(1 / 120, { forward: true, fire: true });
  assert.equal(controller.decisions, 1);
  for (let i = 0; i < 10; i++) game.update(1 / 120);
  assert.equal(controller.decisions, 1);
  for (let i = 0; i < 25; i++) game.update(1 / 120);
  assert.equal(controller.decisions, 2);
  for (const state of ['paused', 'countdown', 'roundOver', 'matchOver'] as const) {
    game.state = state;
    game.timer = 10;
    game.update(1 / 120);
    assert.equal(controller.decisions, 2);
  }
  game.state = 'playing';
  game.tanks[0].alive = false;
  game.update(1 / 120);
  assert.equal(controller.decisions, 2);
});

test('bot-only matches ignore input, score actual hits, and recreate controllers next round', () => {
  class Shooter extends AbstractPlayer {
    constructor() {
      super({ reaction: 0, error: 0 });
    }
    override decide({ input }: PlayerContext): PlayerDecision {
      assert.deepEqual(input, {});
      return { fire: true };
    }
  }
  class Idle extends AbstractPlayer {
    constructor() {
      super({ reaction: 0 });
    }
    override decide(): PlayerDecision {
      return {};
    }
  }
  registerBot('test-shooter-player', Shooter);
  registerBot('test-idle-player', Idle);
  const game = createTestGame(
    { players: [bot('test-shooter-player'), bot('test-idle-player')], target: 3, powerups: false },
    'spectator',
  );
  assert.equal(game.humanId, null);
  assert.ok(game.tanks.every((tank) => tank.name !== 'You'));
  game.start();
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[1], { x: 220, y: 100, angle: Math.PI });
  game.runtime.sync();
  const first = game.controllers.get(0);
  for (let i = 0; i < 120 * 3 && game.state === 'playing'; i++) {
    game.update(1 / 120, { backward: true, left: true, fire: true });
  }
  assert.equal(game.tanks[0].x, 100);
  assert.equal(game.tanks[0].angle, 0);
  assert.equal(game.tanks[1].alive, false);
  assert.equal(game.state, 'roundOver');
  assert.deepEqual(game.scores, [1, 0]);
  for (let i = 0; i < 120 * 4 && game.round === 1; i++) game.update(1 / 120);
  assert.equal(game.round, 2);
  assert.equal(game.state, 'countdown');
  assert.notEqual(game.controllers.get(0), first);
  assert.deepEqual(game.scores, [1, 0]);
});
