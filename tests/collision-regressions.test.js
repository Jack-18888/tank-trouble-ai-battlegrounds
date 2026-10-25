import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PLAYER_SPEED, SHELL_SPEED, firstWall, distance } from '../src/engine.js';
import { tankWall, tanksOverlap, sweepTank, muzzlePosition, BARREL_LENGTH, SHELL_RADIUS } from '../src/geometry.js';

const wall = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
function arena() {
  const game = new Game({ opponents: 1, powerups: false }, 'collision-regression');
  game.map.walls = game.map.walls.filter(w => w.border);
  game.state = 'playing';
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0, cooldown: 999 });
  return game;
}

test('tracks stop at a wall endpoint while the clear barrel can fire safely', () => {
  const game = arena(), tank = game.tanks[0];
  const edge = wall(32, 100, 100, 100); game.map.walls.push(edge);
  Object.assign(tank, { x: 140, y: 106, angle: -3 * Math.PI / 4 });
  for (let i = 0; i < 40; i++) game.moveTank(tank, -1, 0);
  assert.ok(tank.x >= 119 && tank.x <= 121, 'tracks should stop before clipping the wall');
  assert.equal(tankWall(tank, edge), false);
  assert.equal(tankWall({ ...tank, x: tank.x - 1 }, edge), true, 'the track, rather than the barrel, should be blocking movement');
  const muzzle = muzzlePosition(tank);
  assert.ok(distance(tank, muzzle) > BARREL_LENGTH + SHELL_RADIUS);
  assert.equal(game.fire(tank), true, 'the clear barrel should fire');
  for (let i = 0; i < 60; i++) game.updateBullets(1 / 120);
  assert.equal(tank.alive, true, 'a shot past the corner must not bounce back inside the tank');
  assert.equal(game.bullets[0]?.bounces, 0);
});

test('a genuinely blocked muzzle does not spawn a shell inside its own tank', () => {
  const game = arena(), tank = game.tanks[0];
  game.map.walls.push(wall(130, 40, 130, 160));
  assert.equal(game.canPlaceTank(tank), true);
  assert.equal(game.fire(tank), false);
  assert.equal(game.bullets.length, 0);
  assert.equal(tank.alive, true);
  assert.equal(tank.cooldown, 0, 'blocked firing should not consume a shot');
});

test('shells hit visible track corners and the gun barrel, and miss empty space', () => {
  const tank = { x: 100, y: 100, angle: 0 };
  assert.notEqual(sweepTank(60, 87, 28, 0, tank), null, 'upper track must have a hitbox');
  assert.notEqual(sweepTank(140, 100, -15, 0, tank), null, 'barrel must have a hitbox');
  assert.equal(sweepTank(60, 80, 80, 0, tank), null, 'shot above the silhouette should miss');
  const rotated = { ...tank, angle: Math.PI / 2 };
  assert.notEqual(sweepTank(113, 60, 0, 28, rotated), null, 'track hitbox must rotate with artwork');
  assert.notEqual(sweepTank(100, 140, 0, -15, rotated), null, 'barrel hitbox must rotate with artwork');
});

test('rotation cannot put the barrel or tracks inside a wall or another tank', () => {
  const game = arena(), tank = game.tanks[0];
  game.map.walls.push(wall(122, 40, 122, 160));
  tank.angle = -Math.PI / 2;
  assert.equal(game.canPlaceTank(tank), true);
  assert.equal(game.turnTank(tank, Math.PI / 2), false);
  assert.equal(game.canPlaceTank(tank), true);
  const other = { ...tank, id: 1, x: 125, y: 100, angle: Math.PI };
  assert.equal(tanksOverlap({ ...tank, angle: 0 }, other), true, 'barrel overlap must count between tanks');
});

test('shots can graze the empty space beside a rounded wall cap', () => {
  const map = { walls: [wall(0, 0, 100, 0)] };
  assert.equal(firstWall(map, 104.8, 10, 0, -5.2), null);
  const hit = firstWall(map, 103, 10, 0, -20);
  assert.ok(hit && hit.nx > 0 && hit.ny > 0, 'round cap needs its actual surface normal');
  assert.ok(Math.abs(Math.hypot(hit.nx, hit.ny) - 1) < 1e-7);
});

test('shell travel is about 23 percent faster than a moving player', () => {
  const game = arena(), tank = game.tanks[0];
  const startX = tank.x;
  game.fire(tank);
  const shell = game.bullets[0], shellStart = shell.x;
  for (let i = 0; i < 120; i++) game.update(1 / 120, { forward: true });
  const tankTravel = tank.x - startX, shellTravel = shell.x - shellStart;
  assert.ok(Math.abs(tankTravel - PLAYER_SPEED) < 1e-6);
  assert.ok(Math.abs(shellTravel - SHELL_SPEED) < 1e-6);
  assert.ok(shellTravel / tankTravel > 1.15 && shellTravel / tankTravel < 1.3);
  assert.equal(tank.alive, true);
});
