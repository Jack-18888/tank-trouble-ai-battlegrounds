import { clamp } from './math.ts';
import { sweepWall, sweepTank, muzzlePosition, SHELL_RADIUS } from './geometry.ts';
import { CELL, SHELL_SPEED, SHELL_LIFETIME } from './rules.ts';
import type {
  ReadonlyGameMap,
  WallCollision,
  Point,
  ShotTank,
  ShotScene,
  ShotPrediction,
} from './types.ts';

/** Convert world-pixel coordinates to a row-major cell ID, clamping positions at map edges. */
export function cellAt(map: ReadonlyGameMap, x: number, y: number): number {
  return (
    clamp(Math.floor(y / CELL), 0, map.rows - 1) * map.cols +
    clamp(Math.floor(x / CELL), 0, map.cols - 1)
  );
}
/** Reachable adjacent cells in north/east/south/west order; id must name a valid map cell. */
export function neighbors(map: ReadonlyGameMap, id: number): number[] {
  const c = map.cells[id];
  return [id - map.cols, id + 1, id + map.cols, id - 1].filter(
    (next, i) => !c.walls[i] && next >= 0 && next < map.cells.length,
  );
}
/** Shortest unweighted cell route, including both endpoints, or [] when no route exists. */
export function findPath(map: ReadonlyGameMap, start: number, end: number): number[] {
  if (start === end) return [start];
  const previous = new Int32Array(map.cells.length).fill(-1);
  previous[start] = start;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors(map, queue[i])) {
      if (previous[next] !== -1) continue;
      previous[next] = queue[i];
      if (next === end) {
        const path = [end];
        while (path[path.length - 1] !== start) path.push(previous[path[path.length - 1]]);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

/** Earliest wall hit along a world-pixel displacement, expanded by the moving object's radius. */
export function firstWall(
  map: Pick<ReadonlyGameMap, 'walls'>,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius = SHELL_RADIUS,
): WallCollision | null {
  let result: WallCollision | null = null;
  for (const wall of map.walls) {
    const hit = sweepWall(x, y, dx, dy, wall, radius);
    if (hit && (!result || hit.t < result.t)) result = { ...hit, wall };
  }
  return result;
}

/** Test visibility with the bots' five-pixel clearance radius, rather than a zero-width ray. */
export function lineOfSight(
  from: Readonly<Point>,
  to: Readonly<Point>,
  map: ReadonlyGameMap,
): boolean {
  return !firstWall(map, from.x, from.y, to.x - from.x, to.y - from.y, 5);
}
/**
 * Trace a shot against frozen tank poses using the simulation's muzzle and collision geometry.
 * maxBounces=0 allows direct hits only; later ricochets may hit the shooter. Distance is total
 * world-pixel travel, bounded by shell speed and lifetime; no moving-target extrapolation occurs.
 */
export function predictShot(
  tank: Readonly<ShotTank>,
  angle: number,
  maxBounces = 0,
  scene: ShotScene,
): ShotPrediction | null {
  const muzzle = muzzlePosition(tank, angle);
  if (firstWall(scene.map, tank.x, tank.y, muzzle.x - tank.x, muzzle.y - tank.y)) return null;
  let { x, y } = muzzle;
  let vx = Math.cos(angle),
    vy = Math.sin(angle),
    traveled = 0;
  for (let bounce = 0; bounce <= maxBounces; bounce++) {
    const range = SHELL_SPEED * SHELL_LIFETIME - traveled;
    const dx = vx * range,
      dy = vy * range;
    const wall = firstWall(scene.map, x, y, dx, dy);
    let first = wall ? wall.t : 1;
    let target = null;
    for (const other of scene.tanks) {
      if (!other.alive || (other.id === tank.id && bounce === 0)) continue;
      const t = sweepTank(x, y, dx, dy, other);
      if (t !== null && t < first) {
        first = t;
        target = other.id;
      }
    }
    traveled += first * range;
    if (target !== null) return { id: target, distance: traveled };
    if (!wall || traveled >= SHELL_SPEED * SHELL_LIFETIME) return null;
    x += dx * wall.t + wall.nx * 0.03;
    y += dy * wall.t + wall.ny * 0.03;
    const normalSpeed = vx * wall.nx + vy * wall.ny;
    vx -= 2 * normalSpeed * wall.nx;
    vy -= 2 * normalSpeed * wall.ny;
  }
  return null;
}
