import test from 'node:test';
import assert from 'node:assert/strict';
import { Gpt61SolBot, createBot } from '../src/bots/index.ts';
import { createTestGame } from './helpers/game.ts';
import type { Decision, PlayerContext } from '../src/players/types.ts';

function arena(seed = 'sol-fixture') {
  const game = createTestGame(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: 'gpt-6-1-sol' }],
      powerups: false,
      target: 0,
    },
    seed,
  );
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  for (const cell of game.map.cells) {
    cell.walls = [
      cell.y === 0,
      cell.x === game.map.cols - 1,
      cell.y === game.map.rows - 1,
      cell.x === 0,
    ];
  }
  Object.assign(game.tanks[1], { x: 160, y: 160, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[0], { x: 380, y: 160, angle: Math.PI, cooldown: 99 });
  return game;
}

function decision(game: ReturnType<typeof arena>, bot = new Gpt61SolBot()): Decision {
  const context: PlayerContext = {
    tick: game.tick,
    tickRate: 120,
    input: {},
    observe: () => game.getBotContext(game.tanks[1]),
  };
  return bot.decide(context);
}

test('Sol is registered with unchanged Hard comparison stats and finite native plans', () => {
  const bot = createBot('gpt-6-1-sol');
  assert.ok(bot instanceof Gpt61SolBot);
  assert.deepEqual(bot.profile, {
    speed: 108,
    turn: 3.9,
    reaction: 0.11,
    error: 0.012,
    cooldown: 0.46,
  });
  const game = arena();
  const plan = decision(game, bot);
  assert.ok(plan.segments.length > 0);
  assert.ok(
    plan.segments.every((s) => Number.isSafeInteger(s.ticks) && s.ticks > 0 && s.ticks <= 10),
  );
  assert.ok(
    plan.segments.every((s) => Math.abs(s.steer ?? 0) <= 1 && Math.abs(s.throttle ?? 0) <= 1),
  );
  game.runtime.dispose();
});

test('Sol fires on an aligned idle opponent and never fires without reserve', () => {
  const game = arena();
  assert.equal(decision(game).segments[0].fire, 'once');
  game.tanks[1].ammo = 0;
  assert.equal(decision(game).segments[0].fire, undefined);
  game.elapsed = 71;
  assert.equal(decision(game).segments[0].fire, 'once');
  game.runtime.dispose();
});

test('Sol does not confuse a blocked muzzle with a clear center-to-target ray', () => {
  const game = arena();
  game.map.walls.push({ x1: 180, y1: 120, x2: 180, y2: 200 });
  assert.equal(decision(game).segments[0].fire, undefined);
  game.runtime.dispose();
});

test('Sol closes and eliminates an idle target through the real plan executor', () => {
  const game = arena();
  Object.assign(game.tanks[1], { x: 160, y: 160, angle: Math.PI / 2 });
  for (let i = 0; i < 120 * 12 && game.tanks[0].alive; i++) game.update(1 / 120);
  assert.equal(game.tanks[0].alive, false);
  assert.equal(game.tanks[1].alive, true);
  assert.equal(game.tanks[1].kills, 1);
  game.runtime.dispose();
});

test('Sol evades an incoming shell instead of remaining on the firing line', () => {
  const game = arena();
  Object.assign(game.tanks[0], { x: 600, y: 400 });
  game.bullets.push({
    x: 260,
    y: 160,
    vx: -140,
    vy: 0,
    owner: 0,
    life: 3,
    age: 0,
    bounces: 0,
    trail: [],
    dead: false,
  });
  for (let i = 0; i < 120; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  assert.ok(Math.abs(game.tanks[1].y - 160) > 20);
  game.runtime.dispose();
});

test('Sol treats its own returning ricochet as a threat, and still dodges during settling', () => {
  const game = arena();
  game.tanks[0].alive = false;
  game.bullets.push({
    x: 220,
    y: 160,
    vx: -140,
    vy: 0,
    owner: 1,
    life: 3,
    age: 1,
    bounces: 1,
    trail: [],
    dead: false,
  });
  for (let i = 0; i < 76 && game.state === 'playing'; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  game.runtime.dispose();
});

test('Sol leads a moving opponent rather than firing at its old position', () => {
  const game = arena();
  Object.assign(game.tanks[0], { vy: 80, vx: 0, angle: Math.PI / 2 });
  const plan = decision(game);
  assert.ok((plan.segments[0].steer ?? 0) > 0);
  assert.equal(plan.segments[0].fire, undefined);
  game.runtime.dispose();
});

test('Sol fires as cooldown expires rather than waiting for a full movement plan', () => {
  const game = arena('sol-cooldown-boundary');
  game.tanks[1].cooldown = 0.04;
  let firedAt: number | undefined;
  for (let i = 0; i < 12 && firedAt === undefined; i++) {
    game.update(1 / 120);
    if (game.drainEvents().some((event) => event.type === 'fire' && event.id === 1))
      firedAt = game.elapsed;
  }
  assert.ok(firedAt !== undefined && firedAt >= 0.04 && firedAt <= 0.05);
  game.runtime.dispose();
});

test('Sol anticipates a shell which is initially moving away but will ricochet back', () => {
  const game = arena();
  Object.assign(game.tanks[0], { x: 600, y: 400 });
  game.map.walls.push({ x1: 256, y1: 64, x2: 256, y2: 256 });
  game.bullets.push({
    x: 220,
    y: 160,
    vx: 140,
    vy: 0,
    owner: 1,
    life: 3,
    age: 0,
    bounces: 0,
    trail: [],
    dead: false,
  });
  for (let i = 0; i < 240; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  game.runtime.dispose();
});

test('Sol reaches an idle opponent in a generated maze without route-center oscillation', () => {
  const game = createTestGame(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: 'gpt-6-1-sol' }],
      powerups: false,
      target: 0,
    },
    'sol-maze-route',
  );
  game.state = 'playing';
  for (let i = 0; i < 120 * 45 && game.tanks[0].alive && game.tanks[1].alive; i++)
    game.update(1 / 120);
  assert.equal(game.tanks[0].alive, false);
  assert.equal(game.tanks[1].alive, true);
  game.runtime.dispose();
});

test('Sol state is independent and observation snapshots remain immutable', () => {
  const a = arena('sol-independent'),
    b = arena('sol-independent');
  const snapshot = a.getBotContext(a.tanks[1]);
  const before = JSON.stringify(snapshot);
  const first = new Gpt61SolBot(),
    second = new Gpt61SolBot();
  assert.deepEqual(decision(a, first), decision(b, second));
  Object.assign(a.tanks[1], { x: 250, y: 250, angle: 1.7 });
  decision(a, first);
  assert.deepEqual(decision(b, second), decision(b));
  assert.equal(JSON.stringify(snapshot), before);
  a.runtime.dispose();
  b.runtime.dispose();
});
