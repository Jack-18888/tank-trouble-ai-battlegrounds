import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, generateMap, neighbors, findPath, circleWall, firstWall, distance, SHELL_SPEED, TANK_RADIUS } from '../src/engine.js';

test('procedural mazes stay connected across 270 seeds, sizes, and densities', () => {
  for (const size of ['compact', 'classic', 'large']) for (const density of ['open', 'balanced', 'dense']) for (let seed = 0; seed < 30; seed++) {
    const map = generateMap(size, density, `connect-${seed}`), visited = new Set([0]), queue = [0];
    for (let i = 0; i < queue.length; i++) for (const next of neighbors(map, queue[i])) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    assert.equal(visited.size, map.cells.length, `${size}/${density}/${seed} is disconnected`);
    assert.ok(findPath(map, 0, map.cells.length - 1).length > 1);
  }
});
test('map seeds are reproducible and maze density changes the layout', () => {
  assert.deepEqual(generateMap('classic', 'balanced', 'hello'), generateMap('classic', 'balanced', 'hello'));
  assert.notDeepEqual(generateMap('classic', 'balanced', 'hello').walls, generateMap('classic', 'balanced', 'world').walls);
  assert.ok(generateMap('classic', 'dense', 'same').walls.length > generateMap('classic', 'open', 'same').walls.length);
});
test('all six tanks spawn clear of walls and one another', () => {
  for (let seed = 0; seed < 50; seed++) {
    const game = new Game({ opponents: 5, size: 'compact', density: 'dense' }, seed);
    for (const tank of game.tanks) {
      assert.ok(game.map.walls.every(w => !circleWall(tank.x, tank.y, TANK_RADIUS, w)));
      assert.ok(game.tanks.every(t => tank.id === t.id || distance(t, tank) > TANK_RADIUS * 2));
    }
  }
});
function emptyArena() {
  const game = new Game({ opponents: 1, target: 3, powerups: false }, 'physics');
  game.map.walls = game.map.walls.filter(w => w.border);
  game.state = 'playing';
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0, cooldown: 999 });
  return game;
}
test('tank hulls cannot pass through walls or through another tank', () => {
  const game = emptyArena(), tank = game.tanks[0];
  for (let i = 0; i < 200; i++) game.moveTank(tank, -2, 0);
  assert.ok(tank.x >= TANK_RADIUS + 3);
  tank.x = 100; game.tanks[1].x = 140; game.tanks[1].y = 100;
  for (let i = 0; i < 80; i++) game.moveTank(tank, 2, 0);
  assert.ok(distance(tank, game.tanks[1]) >= TANK_RADIUS * 2);
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
  bullet.x = game.map.width - 8; bullet.y = 100;
  game.updateBullets(.04);
  assert.ok(bullet.vx < 0); assert.equal(bullet.bounces, 1);
  bullet.x = 125; bullet.y = 100;
  game.updateBullets(.08);
  assert.equal(game.tanks[0].alive, false);
});
test('shield absorbs exactly one hit and the next hit eliminates the tank', () => {
  const game = emptyArena(), tank = game.tanks[0]; tank.shield = true;
  const shot = () => { game.bullets.push({ x: 65, y: 100, vx: SHELL_SPEED, vy: 0, owner: 1, life: 7, age: 0, bounces: 0, trail: [] }); game.updateBullets(.1); };
  shot(); assert.equal(tank.alive, true); assert.equal(tank.shield, false);
  shot(); assert.equal(tank.alive, false);
});
test('five-shell limit, power-up expiry, and paused simulation behave correctly', () => {
  const game = emptyArena(), tank = game.tanks[0];
  for (let i = 0; i < 8; i++) { tank.cooldown = 0; game.fire(tank); }
  assert.equal(game.bullets.length, 5);
  tank.power = 'rapid'; tank.powerTime = .01;
  game.update(.02); assert.equal(tank.power, null);
  game.pause(); const snapshot = JSON.stringify({ tanks: game.tanks, bullets: game.bullets, elapsed: game.elapsed });
  game.update(.04, { forward: true, fire: true });
  assert.equal(JSON.stringify({ tanks: game.tanks, bullets: game.bullets, elapsed: game.elapsed }), snapshot);
  game.pause(); assert.equal(game.state, 'playing');
});
test('rounds award scores, finish matches, and handle draws', () => {
  const game = emptyArena();
  game.scores[0] = 2; game.finishRound(game.tanks[0]);
  assert.equal(game.scores[0], 3); assert.equal(game.state, 'matchOver');
  const draw = emptyArena(); draw.finishRound(null);
  assert.deepEqual(draw.scores, [0, 0]); assert.equal(draw.state, 'roundOver');
});
for (const difficulty of ['easy', 'medium', 'hard']) test(`${difficulty} bots navigate a maze and engage enemies`, () => {
  const game = new Game({ opponents: 3, difficulties: [difficulty, difficulty, difficulty], powerups: false, target: 3 }, `bot-${difficulty}`);
  game.start();
  const start = game.tanks.map(t => ({ x: t.x, y: t.y }));
  let traveled = 0, shots = 0, kills = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const before = { x: game.tanks[1].x, y: game.tanks[1].y };
    game.update(1 / 60);
    traveled += distance(before, game.tanks[1]);
    for (const e of game.drainEvents()) { if (e.type === 'fire') shots++; if (e.type === 'destroy') kills++; }
    if (game.state === 'matchOver') break;
    for (const tank of game.tanks.filter(t => t.alive)) assert.ok(game.map.walls.every(w => !circleWall(tank.x, tank.y, TANK_RADIUS - .1, w)), 'bot crossed a wall');
  }
  assert.ok(traveled > 100, `bot moved only ${traveled}`);
  assert.ok(shots > 0, 'bots never fired');
  assert.ok(kills > 0, 'bots never landed a shot');
});
