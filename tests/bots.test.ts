import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CELL, SHELL_SPEED } from '../src/engine.ts';
import {
  Bot,
  EasyBot,
  MediumBot,
  HardBot,
  createBot,
  registerBot,
  getBotTypes,
  hasBot,
  getBotType,
} from '../src/bots/index.ts';
import type { BotContext, BotDecision } from '../src/bots/index.ts';

test('Bot is abstract and registered subclasses must implement decide', () => {
  // @ts-expect-error Abstract construction is intentionally tested at runtime.
  assert.throws(() => new Bot(), /abstract/);
  // @ts-expect-error Missing abstract method is intentionally tested at runtime.
  class MissingDecision extends Bot {}
  assert.throws(() => new MissingDecision(), /implement decide/);
  assert.throws(() => registerBot('missing-decision', MissingDecision), /implement decide/);
  // @ts-expect-error Non-controller classes are intentionally rejected.
  assert.throws(() => registerBot('not-a-bot', class {}), /extend Bot/);
  assert.throws(() => registerBot('Bad ID', EasyBot), /Bot IDs/);
  assert.throws(() => registerBot('easy', EasyBot), /already registered/);
  assert.throws(() => createBot('unknown'), /Unknown bot/);
});

test('built-in difficulties have distinct classes and retain their movement profiles', () => {
  for (const [id, Class, speed] of [
    ['easy', EasyBot, 78],
    ['medium', MediumBot, 96],
    ['hard', HardBot, 108],
  ] as const) {
    const bot = createBot(id);
    assert.ok(bot instanceof Bot);
    assert.ok(bot instanceof Class);
    assert.ok(Object.hasOwn(Class.prototype, 'decide'));
    assert.equal(bot.profile.speed, speed);
    assert.ok(Object.isFrozen(bot.profile));
    assert.throws(() => {
      // @ts-expect-error Profiles must be read-only at compile time and runtime.
      bot.profile = {};
    }, TypeError);
  }
});

test('bot observations include detached, deeply read-only world and match data', () => {
  const game = new Game({}, 'observation');
  const tank = game.tanks[1];
  game.powerups.push({ x: 100, y: 200, type: 'shield', life: 10 });
  const context = game.getBotContext(tank);
  assert.equal(context.self.id, tank.id);
  assert.equal(
    context.self,
    context.tanks.find((t) => t.id === tank.id),
  );
  assert.ok(context.enemies.some((t) => t.id === 0));
  assert.ok(context.enemies.every((t) => t.alive && t.id !== tank.id));
  assert.equal(context.rules.cellSize, CELL);
  assert.equal(context.rules.shellSpeed, SHELL_SPEED);
  assert.equal(context.match.target, game.config.target);
  assert.equal(context.powerups[0].type, 'shield');
  assert.throws(() => {
    // @ts-expect-error Observation fields must remain read-only.
    context.self.x = 0;
  }, TypeError);
  assert.throws(() => {
    // @ts-expect-error Nested observation arrays must remain read-only.
    context.map.cells[0].walls[0] = false;
  }, TypeError);
  assert.throws(() => {
    // @ts-expect-error Observation arrays cannot be changed by a strategy.
    context.enemies.pop();
  }, TypeError);
  assert.throws(() => {
    // @ts-expect-error Match scores are an immutable observation.
    context.match.scores[0] = 99;
  }, TypeError);
  assert.throws(() => {
    // @ts-expect-error Pickup observations are read-only.
    context.powerups[0].life = 0;
  }, TypeError);
  assert.throws(() => {
    // @ts-expect-error Query functions are also part of the read-only context.
    context.random = () => 0;
  }, TypeError);
  const oldX = context.self.x;
  tank.x += 1;
  assert.equal(context.self.x, oldX);
  assert.equal(game.scores[0], 0);
});

test('query helpers and their observations keep a consistent snapshot after the game changes', () => {
  const game = new Game({ opponents: 1 }, 'queries');
  game.map.walls = game.map.walls.filter((w) => w.border);
  Object.assign(game.tanks[1], { x: 100, y: 100, angle: 0 });
  Object.assign(game.tanks[0], { x: 350, y: 100, angle: 0 });
  const context = game.getBotContext(game.tanks[1]);
  assert.equal(context.cellAt(100, 100), game.map.cols + 1);
  const path = context.findPath(0, game.map.cells.length - 1);
  assert.equal(path[0], 0);
  assert.equal(path.at(-1), game.map.cells.length - 1);
  assert.equal(context.lineOfSight(context.self, context.enemies[0]), true);
  const prediction = context.predictShot(0);
  assert.ok(prediction);
  assert.equal(prediction.id, 0);
  game.tanks[0].alive = false;
  game.map.walls.push({ x1: 200, y1: 0, x2: 200, y2: 512 });
  assert.equal(game.shotTarget(game.tanks[1], 0), null);
  assert.deepEqual(context.predictShot(0), prediction);
  assert.equal(context.lineOfSight(context.self, context.enemies[0]), true);
});

test('a newly registered class controls the game and keeps independent per-tank state', () => {
  class ForwardBot extends Bot {
    decisions = 0;
    lastContext: BotContext | null = null;
    constructor() {
      super({ reaction: 0.05, error: 0 });
      this.decisions = 0;
    }
    override decide(context: BotContext): BotDecision {
      this.decisions++;
      this.lastContext = context;
      return { steer: 0, throttle: 1, fire: true };
    }
  }
  registerBot('test-forward', ForwardBot, { label: 'Forward' });
  assert.equal(hasBot('test-forward'), true);
  assert.ok(getBotTypes().some((t) => t.id === 'test-forward' && t.label === 'Forward'));
  const game = new Game(
    { opponents: 2, difficulties: ['test-forward', 'test-forward'] },
    'extension',
  );
  assert.deepEqual(game.config.difficulties, ['test-forward', 'test-forward']);
  const first = game.bots.get(1),
    second = game.bots.get(2);
  assert.ok(first instanceof ForwardBot);
  assert.ok(second instanceof ForwardBot);
  assert.notEqual(first, second);
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((w) => w.border);
  Object.assign(game.tanks[1], { x: 100, y: 100, angle: 0, think: 0, cooldown: 0 });
  Object.assign(game.tanks[2], { x: 500, y: 400, angle: 0, think: 0, cooldown: 999 });
  game.update(1 / 120);
  assert.ok(game.tanks[1].x > 100);
  assert.ok(game.bullets.some((b) => b.owner === 1));
  assert.equal(first.decisions, 1);
  assert.equal(second.decisions, 1);
  assert.equal(first.lastContext?.self.id, 1);
  assert.equal(second.lastContext?.self.id, 2);
  game.prepareRound('new-round');
  assert.notEqual(game.bots.get(1), first);
  const next = game.bots.get(1);
  assert.ok(next instanceof ForwardBot);
  assert.equal(next.decisions, 0);
});

test('invalid controls are bounded and unknown saved types fall back to medium', () => {
  class BadControlsBot extends Bot {
    // @ts-expect-error Invalid firing controls are intentionally tested at runtime.
    override decide() {
      return { steer: 99, throttle: NaN, fire: 'yes' };
    }
  }
  // @ts-expect-error This malformed implementation exercises control sanitization.
  registerBot('test-controls', BadControlsBot);
  const game = new Game({ opponents: 1, difficulties: ['test-controls'] }, 'controls');
  game.think(game.tanks[1]);
  assert.equal(game.tanks[1].steer, 1);
  assert.equal(game.tanks[1].throttle, 0);
  assert.equal(game.tanks[1].fire, false);
  assert.deepEqual(new Game({ difficulties: ['removed-custom-type'] }).config.difficulties, [
    'medium',
    'medium',
  ]);
  assert.equal(getBotType('easy')?.label, 'Easy');
});

test('invalid custom movement profiles fail before entering the simulation', () => {
  class InvalidProfile extends Bot {
    constructor() {
      super({ reaction: 0 });
    }
    override decide(): BotDecision {
      return {};
    }
  }
  assert.throws(() => new InvalidProfile(), /profile.reaction/);
});

test('asynchronous bot decisions fail with an explicit contract error', () => {
  class AsyncBot extends Bot {
    // @ts-expect-error Promise-returning decisions are intentionally rejected.
    override async decide() {
      return {};
    }
  }
  // @ts-expect-error This controller tests the runtime JavaScript boundary.
  registerBot('test-async', AsyncBot);
  const game = new Game({ opponents: 1, difficulties: ['test-async'] });
  assert.throws(() => game.think(game.tanks[1]), /synchronous movement decision/);
});

test('built-in controller decisions remain deterministic for a seeded game', () => {
  const a = new Game(
    { opponents: 3, difficulties: ['easy', 'medium', 'hard'] },
    'deterministic-bots',
  );
  const b = new Game(
    { opponents: 3, difficulties: ['easy', 'medium', 'hard'] },
    'deterministic-bots',
  );
  a.start();
  b.start();
  for (let i = 0; i < 120 * 12; i++) {
    a.update(1 / 120);
    b.update(1 / 120);
    a.drainEvents();
    b.drainEvents();
  }
  assert.deepEqual(a.tanks, b.tanks);
  assert.deepEqual(a.bullets, b.bullets);
  assert.deepEqual(a.scores, b.scores);
});
