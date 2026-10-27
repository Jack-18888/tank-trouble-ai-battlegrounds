import { createTestGame } from './helpers/game.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMap,
  neighbors,
  findPath,
  firstWall,
  distance,
  SHELL_SPEED,
  DEFAULT_CONFIG,
  validateGameConfig,
} from '../src/engine.ts';
import { tankWall, tanksOverlap } from '../src/geometry.ts';

test('untyped saved settings are validated before entering the typed simulation', () => {
  for (const value of [undefined, null, [], 42, 'invalid']) {
    assert.deepEqual(validateGameConfig(value), DEFAULT_CONFIG);
  }
  const raw: unknown = {
    opponents: '5',
    difficulties: [null, 'hard', 42, 'easy', {}],
    target: '3',
    size: 'unsupported',
    density: false,
    powerups: 0,
  };
  const config = validateGameConfig(raw);
  assert.deepEqual(config, {
    players: [
      { kind: 'human' },
      ...['medium', 'hard', 'medium', 'easy', 'medium'].map((botId) => ({
        kind: 'bot' as const,
        botId,
      })),
    ],
    target: 3,
    size: 'classic',
    density: 'balanced',
    powerups: false,
  });
  const game = createTestGame(config, 'validated-settings');
  assert.equal(game.players.size, 6);
});

test('procedural mazes stay connected across 270 seeds, sizes, and densities', () => {
  for (const size of ['compact', 'classic', 'large'] as const)
    for (const density of ['open', 'balanced', 'dense'] as const)
      for (let seed = 0; seed < 30; seed++) {
        const map = generateMap(size, density, `connect-${seed}`),
          visited = new Set([0]),
          queue = [0];
        for (let i = 0; i < queue.length; i++)
          for (const next of neighbors(map, queue[i]))
            if (!visited.has(next)) {
              visited.add(next);
              queue.push(next);
            }
        assert.equal(visited.size, map.cells.length, `${size}/${density}/${seed} is disconnected`);
        assert.ok(findPath(map, 0, map.cells.length - 1).length > 1);
      }
});
test('map seeds are reproducible and maze density changes the layout', () => {
  assert.deepEqual(
    generateMap('classic', 'balanced', 'hello'),
    generateMap('classic', 'balanced', 'hello'),
  );
  assert.notDeepEqual(
    generateMap('classic', 'balanced', 'hello').walls,
    generateMap('classic', 'balanced', 'world').walls,
  );
  assert.ok(
    generateMap('classic', 'dense', 'same').walls.length >
      generateMap('classic', 'open', 'same').walls.length,
  );
  const map = generateMap('classic', 'balanced', 'MixedCase');
  assert.deepEqual(map, generateMap('classic', 'balanced', map.seed));
});
test('starting a match uses the maze shown in the setup preview', () => {
  const game = createTestGame({}, 'preview');
  const map = game.map,
    positions = game.tanks.map((t) => [t.x, t.y]);
  game.start();
  assert.equal(game.map, map);
  assert.deepEqual(
    game.tanks.map((t) => [t.x, t.y]),
    positions,
  );
});
test('all six tanks spawn clear of walls and one another', () => {
  for (let seed = 0; seed < 50; seed++) {
    const game = createTestGame(
      {
        players: [
          { kind: 'human' },
          ...Array.from({ length: 5 }, () => ({ kind: 'bot' as const, botId: 'medium' })),
        ],
        size: 'compact',
        density: 'dense',
      },
      seed,
    );
    for (const tank of game.tanks) {
      assert.ok(game.map.walls.every((w) => !tankWall(tank, w)));
      assert.ok(game.tanks.every((t) => tank.id === t.id || !tanksOverlap(t, tank)));
    }
  }
});
function emptyArena() {
  const game = createTestGame(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: 'medium' }],
      target: 3,
      powerups: false,
    },
    'physics',
  );
  game.map.walls = game.map.walls.filter((w) => w.border);
  game.state = 'playing';
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0, cooldown: 999 });
  return game;
}
test('tank hulls cannot pass through walls or through another tank', () => {
  const game = emptyArena(),
    tank = game.tanks[0];
  for (let i = 0; i < 200; i++) game.moveTank(tank, -2, 0);
  assert.ok(game.map.walls.every((w) => !tankWall(tank, w)));
  tank.x = 100;
  game.tanks[1].x = 140;
  game.tanks[1].y = 100;
  for (let i = 0; i < 80; i++) game.moveTank(tank, 2, 0);
  assert.equal(tanksOverlap(tank, game.tanks[1]), false);
});
test('swept wall collisions detect a wall even across a long movement', () => {
  const game = emptyArena();
  const hit = firstWall(game.map, 100, 100, -1000, 0);
  assert.ok(hit && hit.t > 0 && hit.t < 1);
  assert.equal(hit.nx, 1);
});
test('shells ricochet and a returning shell can eliminate its owner', () => {
  const game = emptyArena();
  assert.equal(game.fire(game.tanks[0]), true);
  const bullet = game.bullets[0];
  bullet.x = game.map.width - 8;
  bullet.y = 100;
  game.updateBullets(0.04);
  assert.ok(bullet.vx < 0);
  assert.equal(bullet.bounces, 1);
  bullet.x = 125;
  bullet.y = 100;
  game.updateBullets(0.08);
  assert.equal(game.tanks[0].alive, false);
});
test('bank-shot prediction and actual shell physics agree', () => {
  const game = emptyArena();
  const tank = game.tanks[0],
    target = game.tanks[1];
  target.x = 350;
  target.y = 100;
  const angle = Math.atan2(-2 * (100 - 5.7), 250);
  tank.angle = angle;
  assert.equal(game.shotTarget(tank, angle, 0), null);
  assert.equal(game.shotTarget(tank, angle, 1)?.id, 1);
  game.fire(tank);
  for (let i = 0; i < 200 && target.alive; i++) game.updateBullets(0.02);
  assert.equal(target.alive, false);
});
test('triple-shot and rapid-fire pickups apply and expire', () => {
  const game = emptyArena(),
    tank = game.tanks[0];
  game.powerups.push({ x: tank.x, y: tank.y, type: 'scatter', life: 8 });
  game.updatePowerups(0.01);
  assert.equal(tank.power, 'scatter');
  game.fire(tank);
  assert.equal(game.bullets.length, 3);
  game.powerups.push({ x: tank.x, y: tank.y, type: 'rapid', life: 8 });
  game.updatePowerups(0.01);
  tank.cooldown = 0;
  game.fire(tank);
  assert.equal(tank.cooldown, 0.13);
  tank.powerTime = 0.001;
  game.update(0.01);
  assert.equal(tank.power, null);
});
test('shield absorbs exactly one hit and the next hit eliminates the tank', () => {
  const game = emptyArena(),
    tank = game.tanks[0];
  tank.shield = true;
  const shot = () => {
    game.bullets.push({
      x: 65,
      y: 100,
      vx: SHELL_SPEED,
      vy: 0,
      owner: 1,
      life: 7,
      age: 0,
      bounces: 0,
      trail: [],
      dead: false,
    });
    game.updateBullets(0.2);
  };
  shot();
  assert.equal(tank.alive, true);
  assert.equal(tank.shield, false);
  assert.deepEqual(game.kills, [0, 0], 'a shield hit is not a kill');
  shot();
  assert.equal(tank.alive, false);
  assert.deepEqual(game.kills, [0, 1], 'an actual shell elimination credits its owner');
});
test('ten-bullet reserve, power-up expiry, and paused simulation behave correctly', () => {
  const game = emptyArena(),
    tank = game.tanks[0];
  for (let i = 0; i < 12; i++) {
    tank.cooldown = 0;
    game.fire(tank);
  }
  assert.equal(game.bullets.length, 10);
  assert.equal(tank.ammo, 0);
  tank.power = 'rapid';
  tank.powerTime = 0.01;
  game.update(0.02);
  assert.equal(tank.power, null);
  game.pause();
  const snapshot = JSON.stringify({
    tanks: game.tanks,
    bullets: game.bullets,
    elapsed: game.elapsed,
  });
  game.update(0.04, { forward: true, fire: true });
  assert.equal(
    JSON.stringify({ tanks: game.tanks, bullets: game.bullets, elapsed: game.elapsed }),
    snapshot,
  );
  game.pause();
  assert.equal(game.state, 'playing');
});
test('rounds award scores, finish matches, and handle draws', () => {
  const game = emptyArena();
  game.scores[0] = 2;
  game.finishRound(game.tanks[0]);
  assert.equal(game.scores[0], 3);
  assert.equal(game.state, 'matchOver');
  const draw = emptyArena();
  draw.finishRound(null);
  assert.deepEqual(draw.scores, [0, 0]);
  assert.equal(draw.state, 'roundOver');
});

test('match kills persist across rounds, stay separate from wins, and reset for a new match', () => {
  const game = createTestGame({}, 'match-kills');
  game.start();
  game.destroyTank(game.tanks[1], 0);
  game.finishRound(game.tanks[0]);
  assert.deepEqual(game.scores, [1, 0, 0]);
  assert.deepEqual(game.kills, [1, 0, 0]);
  game.prepareRound('next-maze');
  assert.deepEqual(game.kills, [1, 0, 0]);
  assert.equal(game.tanks[0].kills, 0, 'per-round kills reset with the tanks');
  game.destroyTank(game.tanks[2], 0);
  assert.equal(game.tanks[0].kills, 1);
  assert.deepEqual(game.kills, [2, 0, 0]);
  assert.deepEqual(game.scores, [1, 0, 0], 'kills do not add round wins');
  const context = game.getBotContext(game.tanks[0]);
  assert.deepEqual(context.match.kills, [2, 0, 0]);
  assert.throws(() => {
    // @ts-expect-error Match kill totals are immutable observations.
    context.match.kills[0] = 99;
  }, TypeError);
  game.start();
  assert.deepEqual(game.kills, [0, 0, 0]);
  assert.deepEqual(game.scores, [0, 0, 0]);
  assert.ok(game.tanks.every((tank) => tank.kills === 0));
  assert.deepEqual(context.match.kills, [2, 0, 0], 'retained snapshots remain detached');
});

test('kill credit excludes suicides and unknown owners, allows posthumous hits, and counts each victim once', () => {
  const game = createTestGame({}, 'kill-credit');
  game.destroyTank(game.tanks[0], 0);
  assert.deepEqual(game.kills, [0, 0, 0]);
  game.destroyTank(game.tanks[1], 0);
  assert.deepEqual(game.kills, [1, 0, 0], 'an eliminated owner can still earn a kill');
  game.destroyTank(game.tanks[1], 2);
  assert.deepEqual(game.kills, [1, 0, 0], 'the same victim cannot award another kill');
  game.destroyTank(game.tanks[2], -1);
  assert.deepEqual(game.kills, [1, 0, 0]);
  assert.equal(game.drainEvents().filter((event) => event.type === 'destroy').length, 3);
});
for (const difficulty of ['easy', 'medium', 'hard'])
  test(`${difficulty} bots navigate a maze and engage enemies`, () => {
    const game = createTestGame(
      {
        players: [
          { kind: 'human' },
          ...[difficulty, difficulty, difficulty].map((botId) => ({ kind: 'bot' as const, botId })),
        ],
        powerups: false,
        target: 3,
      },
      `bot-${difficulty}`,
    );
    game.start();
    let traveled = 0,
      shots = 0,
      kills = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const before = { x: game.tanks[1].x, y: game.tanks[1].y };
      game.update(1 / 60);
      traveled += distance(before, game.tanks[1]);
      for (const e of game.drainEvents()) {
        if (e.type === 'fire') shots++;
        if (e.type === 'destroy') kills++;
      }
      if (game.state === 'matchOver') break;
      for (const tank of game.tanks.filter((t) => t.alive))
        assert.ok(
          game.map.walls.every((w) => !tankWall(tank, w)),
          'bot crossed a wall',
        );
    }
    assert.ok(traveled > 100, `bot moved only ${traveled}`);
    assert.ok(shots > 0, 'bots never fired');
    assert.ok(kills > 0, 'bots never landed a shot');
  });
