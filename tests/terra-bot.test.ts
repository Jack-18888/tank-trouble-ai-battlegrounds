import test from 'node:test';
import assert from 'node:assert/strict';
import { TerraBot } from '../src/bots/terra-bot.ts';
import { createBot } from '../src/bots/index.ts';
import type { BotContext } from '../src/bots/types.ts';
import { createTestGame } from './helpers/game.ts';

function fixture(): BotContext {
  const game = createTestGame({}, 'terra-fixture');
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  Object.assign(game.tanks[1], { x: 180, y: 180, angle: 0, ammo: 10 });
  Object.assign(game.tanks[0], { x: 380, y: 180, angle: 0, vx: 0, vy: 0 });
  game.tanks[2].alive = false;
  return game.getBotContext(game.tanks[1]);
}

function decide(world: BotContext) {
  return new TerraBot().decide({ tick: 0, tickRate: 120, input: {}, observe: () => world })
    .segments[0];
}

test('Terra is registered with the documented profile and shoots a clear target', () => {
  const bot = createBot('gpt-6-1-terra');
  assert.ok(bot instanceof TerraBot);
  assert.deepEqual(bot.profile, {
    speed: 108,
    turn: 3.9,
    reaction: 0.11,
    error: 0.012,
    cooldown: 0.46,
  });
  const action = decide(fixture());
  assert.equal(action.ticks, 12);
  assert.equal(action.fire, 'held');
  assert.ok((action.throttle ?? 0) > 0);
});

test('Terra does not fire when out of ammunition or the snapshot predicts a self hit', () => {
  const world = fixture();
  assert.equal(decide({ ...world, self: { ...world.self, ammo: 0 } }).fire, undefined);
  assert.equal(
    decide({ ...world, predictShot: () => ({ id: world.self.id, distance: 100 }) }).fire,
    undefined,
  );
  assert.equal(
    decide({ ...world, self: { ...world.self, ammo: 0 }, match: { ...world.match, elapsed: 71 } })
      .fire,
    'held',
  );
});

test('Terra does not shoot at a moving target that will leave the current firing lane', () => {
  const world = fixture();
  const enemy = { ...world.enemies[0], vy: 100 };
  const action = decide({ ...world, enemies: [enemy] });
  assert.ok(Math.abs(action.steer ?? 0) >= 0.15);
  assert.equal(action.fire, undefined);
});

test('Terra fires along an intercept even when the snapshot target is outside the lane', () => {
  const world = fixture();
  const enemy = { ...world.enemies[0], vy: 50 };
  const moving = {
    ...world,
    self: { ...world.self, angle: Math.atan2(65, 200) },
    enemies: [enemy],
    predictShot: () => null,
  };
  assert.ok(decide(moving).fire);
  const wall = { x1: 270, y1: 100, x2: 270, y2: 300 };
  assert.equal(decide({ ...moving, map: { ...world.map, walls: [wall] } }).fire, undefined);
});

test('Terra foresees its own shell returning after a bounce', () => {
  const world = fixture();
  const wall = { x1: 280, y1: 100, x2: 280, y2: 260 };
  const scene = { ...world, map: { ...world.map, walls: [wall] } };
  const bullet = {
    x: 240,
    y: 180,
    vx: 140,
    vy: 0,
    owner: world.self.id,
    life: 4,
    age: 0.1,
    bounces: 0,
  };
  const normal = decide(scene);
  const threatened = decide({ ...scene, bullets: [bullet] });
  assert.notDeepEqual([threatened.steer, threatened.throttle], [normal.steer, normal.throttle]);
});

test('Terra changes its planned motion for an approaching shell', () => {
  const world = fixture();
  const bullet = {
    x: 260,
    y: 180,
    vx: -140,
    vy: 0,
    owner: world.enemies[0].id,
    life: 4,
    age: 1,
    bounces: 0,
  };
  const normal = decide(world);
  const threatened = decide({ ...world, bullets: [bullet] });
  assert.notDeepEqual([threatened.steer, threatened.throttle], [normal.steer, normal.throttle]);
});
