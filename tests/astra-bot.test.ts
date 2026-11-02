import test from 'node:test';
import assert from 'node:assert/strict';
import { AstraBot } from '../src/bots/astra-bot.ts';
import { createBot } from '../src/bots/index.ts';
import { createTestGame } from './helpers/game.ts';
import { astraTouchesWall } from '../src/bots/astra-geometry.ts';
import { tankWall } from '../src/geometry.ts';
import { randomGenerator } from '../src/random.ts';

test('Astra wall forecasting agrees with shared geometry around rounded ends and rotated hulls', () => {
  const random = randomGenerator('astra-wall-equivalence');
  for (let i = 0; i < 12000; i++) {
    const wall =
      i % 2 ? { x1: 100, y1: 100, x2: 164, y2: 100 } : { x1: 100, y1: 100, x2: 100, y2: 164 };
    const pose = { x: 65 + random() * 135, y: 65 + random() * 135, angle: random() * Math.PI * 2 };
    assert.equal(
      astraTouchesWall(pose, [wall]),
      tankWall(pose, wall),
      JSON.stringify({ pose, wall }),
    );
  }
});

function arena() {
  const game = createTestGame(
    { players: [{ kind: 'human' }, { kind: 'bot', botId: 'gpt-6-astra' }], powerups: false },
    'astra-fixture',
  );
  game.map.walls = game.map.walls.filter((w) => w.border);
  for (const c of game.map.cells)
    c.walls = [c.y === 0, c.x === game.map.cols - 1, c.y === game.map.rows - 1, c.x === 0];
  game.state = 'playing';
  Object.assign(game.tanks[0], { x: 500, y: 350, angle: Math.PI, cooldown: 999 });
  Object.assign(game.tanks[1], { x: 160, y: 160, angle: 0, cooldown: 0 });
  return game;
}

test('Astra is registered with the unchanged Hard comparison profile', () => {
  const bot = createBot('gpt-6-astra');
  assert.ok(bot instanceof AstraBot);
  assert.deepEqual(bot.profile, {
    speed: 108,
    turn: 3.9,
    reaction: 0.11,
    error: 0.012,
    cooldown: 0.46,
  });
});

test('Astra fires on an exposed stationary target and respects empty ammunition', () => {
  const game = arena();
  Object.assign(game.tanks[0], { x: 290, y: 160 });
  const bot = new AstraBot();
  const decide = () =>
    bot.decide({
      tick: 0,
      tickRate: 120,
      input: {},
      observe: () => game.getBotContext(game.tanks[1]),
    });
  assert.equal(decide().segments[0].fire, 'once');
  game.tanks[1].ammo = 0;
  assert.equal(decide().segments[0].fire, undefined);
  game.runtime.dispose();
});

test('Astra survives a crossing shell that would hit a stationary tank', () => {
  const game = arena();
  game.tanks[1].cooldown = 999;
  game.bullets.push({
    x: 160,
    y: 70,
    vx: 0,
    vy: 140,
    owner: 0,
    life: 3,
    age: 0,
    bounces: 0,
    trail: [],
    dead: false,
  });
  for (let i = 0; i < 150; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  assert.ok(Math.hypot(game.tanks[1].x - 160, game.tanks[1].y - 160) > 25);
  game.runtime.dispose();
});

test('Astra treats its own returning ricochet as dangerous', () => {
  const game = arena();
  game.tanks[1].cooldown = 999;
  game.bullets.push({
    x: 160,
    y: 70,
    vx: 0,
    vy: 140,
    owner: 1,
    life: 3,
    age: 1,
    bounces: 1,
    trail: [],
    dead: false,
  });
  for (let i = 0; i < 150; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  game.runtime.dispose();
});

test('Astra sustains its escape from two converging shells', () => {
  const game = arena();
  Object.assign(game.tanks[1], { angle: 3.173579146732766, cooldown: 999 });
  for (const bullet of [
    { x: 240.05932166438353, y: 128.46669941015034, vx: -120.1496494689278, vy: 71.86140641884056 },
    {
      x: 233.57024003246363,
      y: 299.21176139639175,
      vx: -55.37786401156946,
      vy: -128.58185010924413,
    },
  ]) {
    game.bullets.push({ ...bullet, owner: 0, life: 3, age: 0, bounces: 0, trail: [], dead: false });
  }
  for (let i = 0; i < 180; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  game.runtime.dispose();
});

test('Astra reaches and eliminates an idle opponent in an open arena', () => {
  const game = arena();
  for (let i = 0; i < 120 * 15 && game.tanks[0].alive && game.tanks[1].alive; i++)
    game.update(1 / 120);
  assert.equal(game.tanks[0].alive, false);
  assert.equal(game.tanks[1].alive, true);
  game.runtime.dispose();
});

test('Astra forecasts the first bounce of its own shell before it becomes dangerous', () => {
  const game = arena();
  Object.assign(game.tanks[1], { x: 160, y: 64, cooldown: 999 });
  game.bullets.push({
    x: 160,
    y: 20,
    vx: 0,
    vy: -140,
    owner: 1,
    life: 3,
    age: 0,
    bounces: 0,
    trail: [],
    dead: false,
  });
  for (let i = 0; i < 150; i++) game.update(1 / 120);
  assert.equal(game.tanks[1].alive, true);
  assert.ok(game.bullets.some((b) => b.bounces > 0));
  game.runtime.dispose();
});

test('Astra navigates generated mazes to eliminate an idle opponent', () => {
  for (const seed of [0, 2, 4]) {
    const game = createTestGame(
      { players: [{ kind: 'human' }, { kind: 'bot', botId: 'gpt-6-astra' }], powerups: false },
      `astra-route-${seed}`,
    );
    game.state = 'playing';
    game.tanks[0].cooldown = 999;
    for (let i = 0; i < 120 * 45 && game.tanks[0].alive && game.tanks[1].alive; i++)
      game.update(1 / 120);
    assert.equal(game.tanks[0].alive, false, `idle target should be reached on seed ${seed}`);
    assert.equal(game.tanks[1].alive, true);
    game.runtime.dispose();
  }
});
