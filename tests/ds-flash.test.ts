import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from './helpers/game.ts';
import { CELL } from '../src/engine.ts';
import { createBot, getBotType, hasBot } from '../src/bots/index.ts';
import { DsV41FlashBot } from '../src/bots/ds-v41-flash.ts';
import { AbstractPlayer } from '../src/players/index.ts';
import type { Game } from '../src/engine.ts';
import type { PlayerInput } from '../src/types.ts';

const ID = 'ds-v41-flash';

/** Open arena with the border walls only, so tests do not depend on maze generation. */
function openGame(seed: string): Game {
  const game = createTestGame(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: ID }],
      size: 'classic',
      density: 'open',
      powerups: false,
    },
    seed,
  );
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  game.state = 'playing';
  game.runtime.sync();
  return game;
}

function step(game: Game, seconds: number, onTick?: () => void): void {
  const steps = Math.round(seconds * 120);
  for (let i = 0; i < steps; i++) {
    game.update(1 / 120);
    onTick?.();
  }
}

test('the Flash bot is registered with the human-equivalent profile and native plans', () => {
  assert.equal(hasBot(ID), true);
  assert.equal(getBotType(ID)?.label, 'DS V4.1 Flash');
  const bot = createBot(ID);
  assert.ok(bot instanceof DsV41FlashBot);
  assert.ok(bot instanceof AbstractPlayer);
  assert.deepEqual(
    { ...bot.profile },
    {
      speed: 114,
      turn: 3.7,
      reaction: 0,
      error: 0,
      cooldown: 0.32,
    },
  );
  assert.ok(Object.isFrozen(bot.profile));
});

test('every decision is a finite native plan within the engine limits', () => {
  const game = openGame('plan-shape');
  const bot = game.tanks[1];
  const enemy = game.tanks[0];
  Object.assign(bot, { x: 150, y: 200, angle: 0, cooldown: 0 });
  Object.assign(enemy, { x: 330, y: 200, angle: Math.PI });
  const controller = createBot(ID);
  for (let decision = 0; decision < 8; decision++) {
    const result = controller.decide({
      tick: game.tick,
      tickRate: 120,
      input: {},
      observe: () => game.getBotContext(bot),
    });
    assert.ok('segments' in result && Array.isArray(result.segments));
    assert.ok(result.segments.length >= 1 && result.segments.length <= 256);
    let total = 0;
    for (const segment of result.segments) {
      assert.ok(Number.isSafeInteger(segment.ticks) && segment.ticks > 0);
      total += segment.ticks;
      for (const control of [segment.steer, segment.throttle]) {
        if (control === undefined) continue;
        assert.ok(Number.isFinite(control) && Math.abs(control) <= 1);
      }
      assert.ok(segment.fire === undefined || segment.fire === 'once' || segment.fire === 'held');
    }
    assert.ok(total <= 10_800);
    game.tick += 12; // advance the observation clock without running physics
  }
});

test('the bot turns onto a visible target and opens fire', () => {
  const game = openGame('engage-target');
  const bot = game.tanks[1];
  const target = game.tanks[0];
  // Target off to the side: the tank must rotate before it can shoot.
  Object.assign(bot, { x: 150, y: 256, angle: Math.PI / 2, cooldown: 0 });
  Object.assign(target, { x: 400, y: 250, angle: -Math.PI / 2 });
  let fired = false;
  step(game, 3, () => {
    if (game.bullets.some((bullet) => bullet.owner === bot.id)) fired = true;
  });
  assert.equal(fired, true, 'expected the controller to fire at a visible stationary tank');
  assert.ok(bot.kills >= 1, 'a stationary target at 250 px should be converted');
});

test('the bot evades a shell aimed at its hull while it is otherwise idle', () => {
  const game = openGame('evade-shell');
  const bot = game.tanks[1];
  const shooter = game.tanks[0];
  Object.assign(bot, { x: 200, y: 256, angle: 0, cooldown: 5, ammo: 0 });
  Object.assign(shooter, { x: 520, y: 256, angle: Math.PI });
  // A shell already in flight, aimed straight at the hull from the front.
  game.bullets.push({
    x: bot.x + 210,
    y: bot.y,
    vx: -140,
    vy: 0,
    owner: shooter.id,
    life: 7.5,
    age: 0,
    bounces: 0,
    trail: [],
    dead: false,
  });
  const start = { x: bot.x, y: bot.y };
  step(game, 2.2);
  const moved = Math.hypot(bot.x - start.x, bot.y - start.y);
  assert.equal(bot.alive, true, 'the hull should not be hit by a shell it can see coming');
  assert.ok(moved > 8, `expected evasive movement, moved ${moved.toFixed(1)} px`);
});

test('an empty reserve keeps the trigger released until ammunition returns', () => {
  const game = openGame('empty-ammo');
  const bot = game.tanks[1];
  Object.assign(bot, { x: 150, y: 200, angle: 0, cooldown: 0, ammo: 0 });
  Object.assign(game.tanks[0], { x: 360, y: 200, angle: Math.PI, cooldown: 999 });
  step(game, 1.6, () => {
    assert.equal(
      game.bullets.some((bullet) => bullet.owner === bot.id),
      false,
    );
  });
  assert.ok(bot.ammoProgress > 0, 'the engine refill should be in progress');
  assert.equal(bot.ammo, 0);
});

test('a tank nose-first into a wall backs out instead of stalling forever', () => {
  const game = createTestGame(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: ID }],
      size: 'compact',
      density: 'dense',
      powerups: false,
    },
    'wall-recovery',
  );
  game.state = 'playing';
  game.runtime.sync();
  const bot = game.tanks[1];
  const target = game.tanks[0];
  // Find a cell with an east wall and park the hull in its centre, barrel almost touching it.
  const cell = game.map.cells.find(
    (candidate) =>
      candidate.walls[1] && candidate.x < game.map.cols - 1 && candidate.y < game.map.rows,
  );
  assert.ok(cell, 'expected at least one interior east wall');
  Object.assign(bot, {
    x: (cell.x + 0.5) * CELL,
    y: (cell.y + 0.5) * CELL,
    angle: 0,
    cooldown: 0,
    ammo: 10,
  });
  // Put the opponent in a far corner without a firing line so the controller must navigate.
  const far = game.map.cells[game.map.cells.length - 1];
  Object.assign(target, {
    x: (far.x + 0.5) * CELL,
    y: (far.y + 0.5) * CELL,
    cooldown: 999,
    ammo: 0,
  });
  const start = { x: bot.x, y: bot.y };
  step(game, 2.5);
  const moved = Math.hypot(bot.x - start.x, bot.y - start.y);
  assert.ok(
    moved > 10,
    `expected the controller to recover from the wall, moved ${moved.toFixed(1)} px`,
  );
});

test('two instances on the same observation make the same first decision', () => {
  const game = openGame('instance-independence');
  Object.assign(game.tanks[1], { x: 150, y: 200, angle: 0 });
  Object.assign(game.tanks[0], { x: 400, y: 200, angle: Math.PI });
  const first = createBot(ID);
  const second = createBot(ID);
  const makeContext = (): Parameters<AbstractPlayer['decide']>[0] => ({
    tick: game.tick,
    tickRate: 120,
    input: {} as PlayerInput,
    observe: () => game.getBotContext(game.tanks[1]),
  });
  const opening = first.decide(makeContext());
  assert.deepEqual(opening, second.decide(makeContext()));
  // Advancing one instance must not change the round-start state of another instance.
  first.decide(makeContext());
  const fresh = createBot(ID);
  assert.deepEqual(fresh.decide(makeContext()), opening);
});

test('the cell size used by the planner matches the engine', () => {
  const game = openGame('cell-size');
  assert.equal(game.getBotContext(game.tanks[1]).rules.cellSize, CELL);
});
