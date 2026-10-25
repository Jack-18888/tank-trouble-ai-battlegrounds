import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PLAYER_SPEED, SHELL_SPEED, firstWall, distance } from '../src/engine.ts';
import {
  tankWall,
  tanksOverlap,
  sweepTank,
  muzzlePosition,
  BARREL_LENGTH,
  SHELL_RADIUS,
} from '../src/geometry.ts';

const wall = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
function arena() {
  const game = new Game(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: 'medium' }],
      powerups: false,
    },
    'collision-regression',
  );
  game.map.walls = game.map.walls.filter((w) => w.border);
  game.state = 'playing';
  Object.assign(game.tanks[0], { x: 100, y: 100, angle: 0, cooldown: 0 });
  Object.assign(game.tanks[1], { x: 500, y: 400, angle: 0, cooldown: 999 });
  return game;
}

test('tracks stop at a wall endpoint while the clear barrel can fire safely', () => {
  const game = arena(),
    tank = game.tanks[0];
  const edge = wall(32, 100, 100, 100);
  game.map.walls.push(edge);
  Object.assign(tank, { x: 140, y: 106, angle: (-3 * Math.PI) / 4 });
  for (let i = 0; i < 40; i++) game.moveTank(tank, -1, 0);
  assert.ok(tank.x >= 119 && tank.x <= 121, 'tracks should stop before clipping the wall');
  assert.equal(tankWall(tank, edge), false);
  assert.equal(
    tankWall({ ...tank, x: tank.x - 1 }, edge),
    true,
    'the track, rather than the barrel, should be blocking movement',
  );
  const muzzle = muzzlePosition(tank);
  assert.ok(distance(tank, muzzle) > BARREL_LENGTH + SHELL_RADIUS);
  assert.equal(game.fire(tank), true, 'the clear barrel should fire');
  for (let i = 0; i < 60; i++) game.updateBullets(1 / 120);
  assert.equal(tank.alive, true, 'a shot past the corner must not bounce back inside the tank');
  assert.equal(game.bullets[0]?.bounces, 0);
});

test('a genuinely blocked muzzle does not spawn a shell inside its own tank', () => {
  const game = arena(),
    tank = game.tanks[0];
  game.map.walls.push(wall(130, 40, 130, 160));
  assert.equal(game.canPlaceTank(tank), true);
  assert.equal(game.fire(tank), false);
  assert.equal(game.bullets.length, 0);
  assert.equal(tank.alive, true);
  assert.equal(tank.cooldown, 0, 'blocked firing should not consume a shot');
});

test('a free track drives the tank around a wall endpoint in either direction', () => {
  for (const mirror of [-1, 1]) {
    for (const reverse of [false, true]) {
      const game = arena(),
        tank = game.tanks[0];
      game.map.walls = [wall(32, 100, 100, 100)];
      // The rounded front (or rear when reversing) of one track touches the
      // wall cap. The other track and barrel have clear space to move.
      const angle = mirror * ((-5 * Math.PI) / 6) + (reverse ? Math.PI : 0);
      const localX = reverse ? -19 : 18;
      const localY = -11.5 * mirror * (reverse ? -1 : 1);
      Object.assign(tank, {
        x: 100 - localX * Math.cos(angle) + localY * Math.sin(angle) + 0.002,
        y: 100 - localX * Math.sin(angle) - localY * Math.cos(angle),
        angle,
      });
      const start = { x: tank.x, y: tank.y, angle: tank.angle };
      assert.equal(game.canPlaceTank(tank), true);
      for (let i = 0; i < 30; i++) {
        const previous = { x: tank.x, y: tank.y };
        game.update(1 / 120, reverse ? { backward: true } : { forward: true });
        assert.equal(game.canPlaceTank(tank), true, 'pivot must preserve wall clearance');
        assert.ok(distance(tank, previous) < 1.5, 'wall contact must not teleport the tank');
      }
      assert.ok(distance(tank, start) > 5, 'the clear track must produce actual movement');
      assert.ok(
        (tank.angle - start.angle) * mirror < -0.1,
        'the free track must turn the tank away from contact',
      );
      assert.notEqual(tank.leftTread, tank.rightTread, 'tracks should animate independently');
    }
  }
});

test('driving into two blocked tracks or a blocked barrel cannot force a pivot', () => {
  for (const angle of [0, Math.PI]) {
    const game = arena(),
      tank = game.tanks[0];
    // Forward: barrel hits first. Reverse: both tracks hit the flat wall.
    game.map.walls = [wall(128, 40, 128, 160)];
    Object.assign(tank, { x: angle === 0 ? 99.99 : 108.99, angle });
    const start = { x: tank.x, y: tank.y };
    for (let i = 0; i < 120; i++)
      game.update(1 / 120, angle === 0 ? { forward: true } : { backward: true });
    assert.equal(tank.angle, angle);
    assert.ok(distance(tank, start) < 0.02);
    assert.equal(game.canPlaceTank(tank), true);
  }
});

test('shells hit visible track corners and the gun barrel, and miss empty space', () => {
  const tank = { x: 100, y: 100, angle: 0 };
  assert.notEqual(sweepTank(60, 87, 28, 0, tank), null, 'upper track must have a hitbox');
  assert.notEqual(sweepTank(140, 100, -15, 0, tank), null, 'barrel must have a hitbox');
  assert.equal(sweepTank(60, 80, 80, 0, tank), null, 'shot above the silhouette should miss');
  const rotated = { ...tank, angle: Math.PI / 2 };
  assert.notEqual(
    sweepTank(113, 60, 0, 28, rotated),
    null,
    'track hitbox must rotate with artwork',
  );
  assert.notEqual(
    sweepTank(100, 140, 0, -15, rotated),
    null,
    'barrel hitbox must rotate with artwork',
  );
});

test('rotation makes room for the barrel without putting tracks inside a wall', () => {
  const game = arena(),
    tank = game.tanks[0];
  game.map.walls.push(wall(122, 40, 122, 160));
  tank.angle = -Math.PI / 2;
  assert.equal(game.canPlaceTank(tank), true);
  assert.equal(game.turnTank(tank, Math.PI / 2), true);
  assert.ok(tank.x < 100, 'turning into contact should move the tank clear of the wall');
  assert.equal(game.canPlaceTank(tank), true);
  const other = { ...tank, id: 1, x: 125, y: 100, angle: Math.PI };
  assert.equal(
    tanksOverlap({ ...tank, angle: 0 }, other),
    true,
    'barrel overlap must count between tanks',
  );
});

test('holding right turns a tank whose track is touching the wall', () => {
  const game = arena(),
    tank = game.tanks[0];
  const edge = wall(122, 40, 122, 160);
  game.map.walls.push(edge);
  tank.angle = -Math.PI / 3;
  const startAngle = tank.angle;
  assert.equal(game.canPlaceTank(tank), true);
  for (let i = 0; i < 40; i++) {
    game.update(1 / 120, { right: true });
    assert.equal(
      tankWall(tank, edge),
      false,
      'turning must keep the full silhouette outside the wall',
    );
  }
  assert.ok(Math.abs(tank.angle - startAngle - 3.7 / 3) < 1e-8);
  assert.ok(tank.x < 99 && tank.x > 92, 'the tank should shift just enough to turn');
  assert.ok(Math.abs(tank.y - 100) < 1e-8, 'a straight wall should not cause sideways drift');
});

test('wall-contact turning works in either direction against all four wall orientations', () => {
  for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const direction of [-1, 1]) {
      const game = arena(),
        tank = game.tanks[0];
      const transform = (x: number, y: number): [number, number] => [
        100 + (x - 100) * Math.cos(rotation) - (y - 100) * Math.sin(rotation),
        100 + (x - 100) * Math.sin(rotation) + (y - 100) * Math.cos(rotation),
      ];
      const [x1, y1] = transform(122, 40),
        [x2, y2] = transform(122, 160);
      const edge = wall(x1, y1, x2, y2);
      game.map.walls = [edge];
      tank.angle = (-direction * Math.PI) / 3 + rotation;
      const start = tank.angle;
      for (let i = 0; i < 40; i++) {
        assert.equal(game.turnTank(tank, (direction * 3.7) / 120), true);
        assert.equal(tankWall(tank, edge), false);
      }
      assert.ok(Math.abs(tank.angle - start - (direction * 3.7) / 3) < 1e-8);
      assert.ok(distance(tank, { x: 100, y: 100 }) < 8);
    }
  }
});

test('turning in open space keeps the center fixed and turning away needs no correction', () => {
  const game = arena(),
    tank = game.tanks[0];
  tank.angle = -Math.PI / 3;
  assert.equal(game.turnTank(tank, Math.PI * 2), true);
  assert.equal(tank.x, 100);
  assert.equal(tank.y, 100);
  game.map.walls.push(wall(122, 40, 122, 160));
  tank.angle = -Math.PI / 3;
  assert.equal(game.turnTank(tank, -0.2), true);
  assert.equal(tank.x, 100);
  assert.equal(tank.y, 100);
});

test('turning remains blocked when a narrow corridor cannot fit the tank', () => {
  const game = arena(),
    tank = game.tanks[0];
  game.map.walls = [wall(80, 0, 80, 200), wall(122, 0, 122, 200)];
  tank.angle = -Math.PI / 2;
  assert.equal(game.canPlaceTank(tank), true);
  assert.equal(game.turnTank(tank, Math.PI / 2), false);
  assert.ok(tank.angle < -0.1);
  for (let i = 0; i < 120; i++) {
    game.turnTank(tank, 3.7 / 120);
    assert.equal(game.canPlaceTank(tank), true);
    assert.ok(tank.x > 80 && tank.x < 122);
  }
  assert.ok(tank.angle < -0.1, 'repeated steering must not squeeze through opposing walls');
});

test('wall-contact correction handles corners and does not push through thin walls', () => {
  const game = arena(),
    tank = game.tanks[0];
  game.map.walls = [wall(122, -1000, 122, 1000), wall(-1000, 122, 1000, 122)];
  tank.angle = -Math.PI / 3;
  for (let i = 0; i < 600; i++) {
    assert.equal(game.turnTank(tank, 3.7 / 120), true);
    assert.equal(game.canPlaceTank(tank), true);
    assert.ok(tank.x < 122 && tank.y < 122);
  }
  assert.ok(
    distance(tank, { x: 100, y: 100 }) < 12,
    'repeated turns must not accumulate large displacement',
  );
});

test('rotation cannot shove another tank out of the way', () => {
  const game = arena(),
    tank = game.tanks[0],
    other = game.tanks[1];
  tank.angle = -Math.PI / 2;
  Object.assign(other, { x: 141, y: 100, angle: Math.PI });
  assert.equal(game.canPlaceTank(tank), true);
  assert.equal(game.turnTank(tank, Math.PI / 2), false);
  assert.equal(tank.x, 100);
  assert.equal(tank.y, 100);
  assert.equal(other.x, 141);
  assert.equal(other.y, 100);
  assert.equal(tanksOverlap(tank, other), false);
});

test('shots can graze the empty space beside a rounded wall cap', () => {
  const map = { walls: [wall(0, 0, 100, 0)] };
  assert.equal(firstWall(map, 104.8, 10, 0, -5.2), null);
  const hit = firstWall(map, 103, 10, 0, -20);
  assert.ok(hit && hit.nx > 0 && hit.ny > 0, 'round cap needs its actual surface normal');
  assert.ok(Math.abs(Math.hypot(hit.nx, hit.ny) - 1) < 1e-7);
});

test('shell travel is about 23 percent faster than a moving player', () => {
  const game = arena(),
    tank = game.tanks[0];
  const startX = tank.x;
  game.fire(tank);
  const shell = game.bullets[0],
    shellStart = shell.x;
  for (let i = 0; i < 120; i++) game.update(1 / 120, { forward: true });
  const tankTravel = tank.x - startX,
    shellTravel = shell.x - shellStart;
  assert.ok(Math.abs(tankTravel - PLAYER_SPEED) < 1e-6);
  assert.ok(Math.abs(shellTravel - SHELL_SPEED) < 1e-6);
  assert.ok(shellTravel / tankTravel > 1.15 && shellTravel / tankTravel < 1.3);
  assert.equal(tank.alive, true);
});
