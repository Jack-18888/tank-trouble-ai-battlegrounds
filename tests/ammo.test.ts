import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.ts';
import { HUMAN_PROFILE } from '../src/players/player.ts';
import type { GameState, Tank } from '../src/types.ts';

/** Stationary human and bot tanks, with no controllers submitting commands or ricochets. */
function arena() {
  const game = new Game({ powerups: false }, 'ammo');
  game.state = 'playing';
  game.map.walls = [];
  for (const tank of game.tanks) {
    Object.assign(tank, { x: 100, y: 100 + tank.id * 100, angle: 0, cooldown: 0 });
    game.playerReady(tank.id, HUMAN_PROFILE);
  }
  return game;
}

function advance(game: Game, seconds: number, step = 1 / 120) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) {
    game.update(Math.min(step, seconds - elapsed));
  }
}

function shoot(game: Game, tank: Tank) {
  tank.cooldown = 0;
  return game.fire(tank);
}

test('every human and bot starts each round with ten bullets and no saved refill progress', () => {
  const game = arena();
  assert.deepEqual(
    game.tanks.map((tank) => tank.ammo),
    [10, 10, 10],
  );
  for (const tank of game.tanks) {
    assert.equal(shoot(game, tank), true);
  }
  advance(game, 1);
  game.elapsed = 80;
  assert.equal(game.infiniteAmmo, true);
  game.prepareRound('fresh-ammo');
  assert.equal(game.infiniteAmmo, false);
  assert.equal(game.elapsed, 0);
  assert.equal(game.bullets.length, 0);
  assert.ok(game.tanks.every((tank) => tank.ammo === 10 && tank.ammoProgress === 0));
});

test('each shell spends one bullet; empty reserves cannot fire and expired shells do not refund', () => {
  const game = arena();
  for (const tank of game.tanks) {
    for (let i = 0; i < 10; i++) {
      assert.equal(shoot(game, tank), true);
      assert.equal(tank.ammo, 9 - i);
    }
    assert.equal(shoot(game, tank), false);
    assert.equal(tank.cooldown, 0);
  }
  assert.equal(game.bullets.length, 30);
  for (const bullet of game.bullets) bullet.life = 0;
  game.updateBullets(0);
  assert.equal(game.bullets.length, 0);
  assert.ok(game.tanks.every((tank) => tank.ammo === 0));
  assert.equal(shoot(game, game.tanks[0]), false);
});

test('all tanks regenerate exactly one bullet every two seconds at different physics step sizes', () => {
  for (const step of [1 / 120, 0.04]) {
    const game = arena();
    for (const tank of game.tanks) tank.ammo = 0;
    advance(game, 1.96, step);
    assert.ok(game.tanks.every((tank) => tank.ammo === 0));
    advance(game, 0.04, step);
    assert.ok(game.tanks.every((tank) => tank.ammo === 1));
    advance(game, 2, step);
    assert.ok(game.tanks.every((tank) => tank.ammo === 2 && tank.ammoProgress >= 0));
  }
});

test('regenerated ammo can be fired while ten earlier shells remain in flight', () => {
  const game = arena(),
    tank = game.tanks[0];
  for (let i = 0; i < 10; i++) assert.equal(shoot(game, tank), true);
  advance(game, 2);
  assert.equal(game.bullets.length, 10);
  assert.equal(tank.ammo, 1);
  assert.equal(shoot(game, tank), true);
  assert.equal(game.bullets.length, 11);
  assert.equal(tank.ammo, 0);
});

test('reserves cap at ten and time spent full cannot be banked for an instant refill', () => {
  const game = arena(),
    tank = game.tanks[0];
  tank.ammo = 9;
  advance(game, 8);
  assert.equal(tank.ammo, 10);
  assert.equal(tank.ammoProgress, 0);
  assert.equal(shoot(game, tank), true);
  advance(game, 1.96);
  assert.equal(tank.ammo, 9);
  advance(game, 0.04);
  assert.equal(tank.ammo, 10);
  assert.equal(tank.ammoProgress, 0);
});

test('refills accelerate at the 20, 40, and 60 second round stages', () => {
  for (const [elapsed, interval] of [
    [0, 2],
    [20, 1.5],
    [40, 1],
    [60, 0.5],
  ]) {
    const game = arena();
    game.elapsed = elapsed;
    for (const tank of game.tanks) tank.ammo = 0;
    advance(game, interval - 0.01, 0.01);
    assert.ok(
      game.tanks.every((tank) => tank.ammo === 0),
      `refilled early at ${elapsed}s`,
    );
    advance(game, 0.01, 0.01);
    assert.ok(
      game.tanks.every((tank) => tank.ammo === 1),
      `missing refill at ${elapsed}s`,
    );
  }
});

test('partly completed refills carry through an acceleration boundary', () => {
  const game = arena(),
    tank = game.tanks[0];
  game.elapsed = 18.75;
  tank.ammo = 0;
  advance(game, 1);
  assert.equal(tank.ammo, 0);
  assert.ok(Math.abs(tank.ammoProgress - 0.5) < 1e-9);
  advance(game, 0.25);
  assert.equal(tank.ammo, 0);
  advance(game, 0.57);
  assert.equal(tank.ammo, 1, 'existing progress should benefit from the faster refill rate');
});

test('ready, countdown, pause, and finished rounds do not regenerate ammo or advance round time', () => {
  const states: GameState[] = ['ready', 'countdown', 'paused', 'roundOver', 'matchOver'];
  for (const state of states) {
    const game = arena(),
      tank = game.tanks[0];
    tank.ammo = 0;
    advance(game, 1);
    const elapsed = game.elapsed;
    game.state = state;
    game.timer = 3;
    advance(game, 0.5);
    assert.equal(game.elapsed, elapsed, state);
    assert.equal(tank.ammo, 0, state);
    assert.ok(Math.abs(tank.ammoProgress - 0.5) < 1e-9, state);
    game.state = 'playing';
    advance(game, 1);
    assert.equal(tank.ammo, 1, state);
  }
});

test('triple-shot consumes one bullet per shell and fires partial volleys when ammo is low', () => {
  const game = arena(),
    tank = game.tanks[0];
  tank.power = 'scatter';
  assert.equal(shoot(game, tank), true);
  assert.equal(tank.ammo, 7);
  assert.equal(game.bullets.length, 3);
  for (const remaining of [2, 1]) {
    tank.ammo = remaining;
    const before: number = game.bullets.length;
    assert.equal(shoot(game, tank), true);
    assert.equal(game.bullets.length - before, remaining);
    assert.equal(tank.ammo, 0);
  }
  assert.equal(shoot(game, tank), false);
});

test('unlimited ammo begins at 70 seconds even for empty tanks and removes any active-shell cap', () => {
  const game = arena();
  game.elapsed = 69.98;
  for (const tank of game.tanks) tank.ammo = 0;
  assert.equal(game.infiniteAmmo, false);
  assert.equal(shoot(game, game.tanks[0]), false);
  advance(game, 0.01);
  assert.equal(game.infiniteAmmo, false);
  advance(game, 0.01);
  assert.equal(game.infiniteAmmo, true);
  for (const tank of game.tanks) {
    tank.power = 'scatter';
    for (let i = 0; i < 12; i++) assert.equal(shoot(game, tank), true);
    assert.equal(tank.ammo, 10);
    assert.equal(tank.ammoProgress, 0);
    assert.equal(game.bullets.filter((bullet) => bullet.owner === tank.id).length, 36);
  }
  game.elapsed = 89.99;
  assert.equal(game.infiniteAmmo, true);
});

test('cooldown, muzzle clearance, living tanks, and controller readiness still restrict firing', () => {
  for (const elapsed of [0, 70]) {
    const game = arena(),
      tank = game.tanks[0];
    game.elapsed = elapsed;
    tank.power = 'rapid';
    assert.equal(game.fire(tank), true);
    assert.equal(tank.cooldown, 0.13);
    const ammo = tank.ammo;
    assert.equal(game.fire(tank), false, 'cooldown must still apply');
    assert.equal(tank.ammo, ammo);
    game.map.walls.push({ x1: 130, y1: 40, x2: 130, y2: 160 });
    assert.equal(shoot(game, tank), false, 'blocked muzzle must still apply');
    game.map.walls = [];
    tank.alive = false;
    assert.equal(shoot(game, tank), false, 'eliminated tanks cannot fire');
    tank.alive = true;
    game.players.get(tank.id)!.profile = null;
    assert.equal(shoot(game, tank), false, 'controllers without a profile cannot fire');
    assert.equal(tank.ammo, ammo);
    assert.equal(game.bullets.length, 1);
  }
});

test('bot observations expose detached ammo state and the shared capacity and round timing', () => {
  const game = arena(),
    tank = game.tanks[1];
  assert.equal(shoot(game, tank), true);
  const context = game.getBotContext(tank);
  assert.equal(context.self.ammo, 9);
  assert.equal(context.rules.maxAmmo, 10);
  assert.equal(context.rules.roundDuration, 90);
  assert.equal(context.rules.infiniteAmmoDuration, 20);
  advance(game, 2);
  assert.equal(tank.ammo, 10);
  assert.equal(context.self.ammo, 9);
});
