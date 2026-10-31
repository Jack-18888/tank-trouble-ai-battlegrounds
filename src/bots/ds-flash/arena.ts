import { WALL_RADIUS, muzzlePosition, SHELL_RADIUS } from '../../geometry.ts';
import { findPath } from '../../queries.ts';
import type { Point, ReadonlyGameMap, Wall } from '../../types.ts';

// Fast static map index for the DS V4.1 Flash controller.
//
// Shell tracing and ego rollouts run many thousands of wall tests per decision, so the map is
// indexed once per round: walls are bucketed per maze cell for ray casting, and a coarse clearance
// field answers "does a tank-sized body fit here" in constant time.

export const TICK_DT = 1 / 120;
/** Barrel tip plus shell radius: distance from a tank centre to a shell's spawn point. */
export const MUZZLE_OFFSET = muzzlePosition({ x: 0, y: 0, angle: 0 }).x;
/** Hull circle used by rollouts; the visible silhouette is about 32x28 px. */
export const HULL_RADIUS = 14.5;
/** Rotation needs a little more room because the barrel sweeps a longer arc. */
export const TURN_RADIUS = 16.5;

const EPS = 1e-8;
/** Wall assignment padding; covers shell radius plus wall radius (both casts and traces). */
const CELL_PAD = 6;
const MAX_CELL_STEPS = 256;
const CLEAR_STEP = 8;
/** Distances beyond this are all equally "roomy"; the field is clamped to keep math cheap. */
const CLEAR_MAX = 44;

export interface CastHit {
  t: number;
  nx: number;
  ny: number;
}
export interface PathSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  d0: number;
  d1: number;
}

const scratchHit: CastHit = { t: 0, nx: 0, ny: 0 };
const probeHit: CastHit = { t: 0, nx: 0, ny: 0 };

const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

function sweepBox(
  x: number,
  y: number,
  dx: number,
  dy: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  out: CastHit,
): boolean {
  let enter = -Infinity;
  let leave = Infinity;
  let nx = 0;
  let ny = 0;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis === 0 ? x : y;
    const d = axis === 0 ? dx : dy;
    const min = axis === 0 ? bx : by;
    const max = min + (axis === 0 ? bw : bh);
    if (Math.abs(d) < EPS) {
      if (p < min || p > max) return false;
      continue;
    }
    const a = (min - p) / d;
    const b = (max - p) / d;
    const near = Math.min(a, b);
    if (near > enter) {
      enter = near;
      nx = axis === 0 ? -sign(d) : 0;
      ny = axis === 1 ? -sign(d) : 0;
    }
    leave = Math.min(leave, Math.max(a, b));
  }
  if (enter > leave || enter < -EPS || enter > 1) return false;
  out.t = Math.max(0, enter);
  out.nx = nx;
  out.ny = ny;
  return true;
}

function sweepCircle(
  x: number,
  y: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  radius: number,
  out: CastHit,
): boolean {
  const ox = x - cx;
  const oy = y - cy;
  const a = dx * dx + dy * dy;
  if (a < EPS) return false;
  const c = ox * ox + oy * oy - radius * radius;
  const b = ox * dx + oy * dy;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < -EPS || t > 1) return false;
  const nx = (ox + dx * t) / radius;
  const ny = (oy + dy * t) / radius;
  if (dx * nx + dy * ny < -EPS) {
    out.t = Math.max(0, t);
    out.nx = nx;
    out.ny = ny;
    return true;
  }
  return false;
}

/** Sweep a circle against one axis-aligned capsule wall, matching `geometry.sweepWall`. */
function sweepWall(
  x: number,
  y: number,
  dx: number,
  dy: number,
  wall: Readonly<Wall>,
  radius: number,
  out: CastHit,
): boolean {
  const r = WALL_RADIUS + radius;
  const minX = Math.min(wall.x1, wall.x2);
  const minY = Math.min(wall.y1, wall.y2);
  const w = Math.abs(wall.x2 - wall.x1);
  const h = Math.abs(wall.y2 - wall.y1);
  let best = Infinity;
  let bnx = 0;
  let bny = 0;
  let found = false;
  const consider = (hit: boolean) => {
    if (!hit || probeHit.t >= best) return;
    best = probeHit.t;
    bnx = probeHit.nx;
    bny = probeHit.ny;
    found = true;
  };
  consider(sweepBox(x, y, dx, dy, minX, minY - r, w, 2 * r, probeHit));
  consider(sweepBox(x, y, dx, dy, minX - r, minY, 2 * r, h, probeHit));
  consider(sweepCircle(x, y, dx, dy, wall.x1, wall.y1, r, probeHit));
  consider(sweepCircle(x, y, dx, dy, wall.x2, wall.y2, r, probeHit));
  if (!found) return false;
  out.t = best;
  out.nx = bnx;
  out.ny = bny;
  return true;
}

function wallDistance(x: number, y: number, wall: Readonly<Wall>): number {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const t = Math.max(
    0,
    Math.min(1, ((x - wall.x1) * dx + (y - wall.y1) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - (wall.x1 + t * dx), y - (wall.y1 + t * dy));
}

/** Immutable-per-round maze index shared by every decision. */
export class Arena {
  readonly map: ReadonlyGameMap;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private readonly walls: readonly Readonly<Wall>[];
  private readonly cellWalls: number[][];
  private readonly seen: Int32Array;
  private stamp = 0;
  private readonly clearGrid: Float32Array;
  private readonly clearCols: number;
  private readonly clearRows: number;

  constructor(map: ReadonlyGameMap) {
    this.map = map;
    this.walls = map.walls;
    this.cellSize = map.width / map.cols;
    this.cols = map.cols;
    this.rows = map.rows;
    this.cellWalls = Array.from({ length: this.cols * this.rows }, () => []);
    this.seen = new Int32Array(map.walls.length);
    for (let i = 0; i < map.walls.length; i++) {
      const wall = map.walls[i];
      const minX = Math.min(wall.x1, wall.x2) - CELL_PAD;
      const maxX = Math.max(wall.x1, wall.x2) + CELL_PAD;
      const minY = Math.min(wall.y1, wall.y2) - CELL_PAD;
      const maxY = Math.max(wall.y1, wall.y2) + CELL_PAD;
      const x0 = Math.max(0, Math.floor(minX / this.cellSize));
      const x1 = Math.min(this.cols - 1, Math.floor(maxX / this.cellSize));
      const y0 = Math.max(0, Math.floor(minY / this.cellSize));
      const y1 = Math.min(this.rows - 1, Math.floor(maxY / this.cellSize));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) this.cellWalls[y * this.cols + x].push(i);
    }
    this.clearCols = Math.ceil(map.width / CLEAR_STEP) + 2;
    this.clearRows = Math.ceil(map.height / CLEAR_STEP) + 2;
    this.clearGrid = new Float32Array(this.clearCols * this.clearRows).fill(CLEAR_MAX);
    // Splat each wall onto nearby clearance samples: distance to the wall centreline minus radius.
    for (const wall of map.walls) {
      const minX = Math.min(wall.x1, wall.x2) - CLEAR_MAX;
      const maxX = Math.max(wall.x1, wall.x2) + CLEAR_MAX;
      const minY = Math.min(wall.y1, wall.y2) - CLEAR_MAX;
      const maxY = Math.max(wall.y1, wall.y2) + CLEAR_MAX;
      const gx0 = Math.max(0, Math.floor(minX / CLEAR_STEP));
      const gx1 = Math.min(this.clearCols - 1, Math.ceil(maxX / CLEAR_STEP));
      const gy0 = Math.max(0, Math.floor(minY / CLEAR_STEP));
      const gy1 = Math.min(this.clearRows - 1, Math.ceil(maxY / CLEAR_STEP));
      for (let gy = gy0; gy <= gy1; gy++) {
        const py = gy * CLEAR_STEP;
        for (let gx = gx0; gx <= gx1; gx++) {
          const d = wallDistance(gx * CLEAR_STEP, py, wall) - WALL_RADIUS;
          const index = gy * this.clearCols + gx;
          if (d < this.clearGrid[index]) this.clearGrid[index] = d;
        }
      }
    }
  }

  center(id: number): Point {
    const cell = this.map.cells[id];
    return { x: (cell.x + 0.5) * this.cellSize, y: (cell.y + 0.5) * this.cellSize };
  }

  route(from: number, to: number): number[] {
    return findPath(this.map, from, to);
  }

  /** Cast a ray against nearby wall buckets; `t` is a fraction of the displacement. */
  cast(
    x: number,
    y: number,
    ux: number,
    uy: number,
    maxDist: number,
    radius: number,
  ): CastHit | null {
    if (!(maxDist > EPS)) return null;
    const dx = ux * maxDist;
    const dy = uy * maxDist;
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return null;
    const size = this.cellSize;
    let cx = Math.floor(x / size);
    let cy = Math.floor(y / size);
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return null;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    let tMaxX = dx !== 0 ? ((dx > 0 ? cx + 1 : cx) * size - x) / dx : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? cy + 1 : cy) * size - y) / dy : Infinity;
    const tDeltaX = dx !== 0 ? size / Math.abs(dx) : Infinity;
    const tDeltaY = dy !== 0 ? size / Math.abs(dy) : Infinity;
    const stamp = ++this.stamp;
    let bestT = Infinity;
    let bestNx = 0;
    let bestNy = 0;
    for (let guard = 0; guard < MAX_CELL_STEPS; guard++) {
      const bucket = this.cellWalls[cy * this.cols + cx];
      for (let i = 0; i < bucket.length; i++) {
        const index = bucket[i];
        if (this.seen[index] === stamp) continue;
        this.seen[index] = stamp;
        if (sweepWall(x, y, dx, dy, this.walls[index], radius, probeHit) && probeHit.t < bestT) {
          bestT = probeHit.t;
          bestNx = probeHit.nx;
          bestNy = probeHit.ny;
        }
      }
      const exitT = tMaxX < tMaxY ? tMaxX : tMaxY;
      if (bestT <= exitT + EPS) break;
      if (exitT > 1) break;
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
        if (cx < 0 || cx >= this.cols) break;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
        if (cy < 0 || cy >= this.rows) break;
      }
    }
    if (bestT > 1 + EPS) return null;
    scratchHit.t = Math.max(0, bestT);
    scratchHit.nx = bestNx;
    scratchHit.ny = bestNy;
    return scratchHit;
  }

  /** Trace a shell through reflections. Distances are cumulative pixels along the path. */
  trace(
    x: number,
    y: number,
    angle: number,
    maxBounces: number,
    maxDistance: number,
    radius = SHELL_RADIUS,
  ): PathSegment[] {
    const segments: PathSegment[] = [];
    let px = x;
    let py = y;
    let vx = Math.cos(angle);
    let vy = Math.sin(angle);
    let traveled = 0;
    let bounces = 0;
    while (traveled < maxDistance) {
      const remaining = maxDistance - traveled;
      const hit = this.cast(px, py, vx, vy, remaining, radius);
      const length = hit ? Math.max(0, hit.t * remaining) : remaining;
      segments.push({
        x0: px,
        y0: py,
        x1: px + vx * length,
        y1: py + vy * length,
        d0: traveled,
        d1: traveled + length,
      });
      if (!hit) break;
      px += vx * length + hit.nx * 0.03;
      py += vy * length + hit.ny * 0.03;
      const dot = vx * hit.nx + vy * hit.ny;
      vx -= 2 * dot * hit.nx;
      vy -= 2 * dot * hit.ny;
      traveled += length;
      if (++bounces > maxBounces) break;
    }
    return segments;
  }

  /** Clearance lookup from the precomputed field, bilinearly interpolated. */
  clearance(x: number, y: number): number {
    const gx = x / CLEAR_STEP;
    const gy = y / CLEAR_STEP;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= this.clearCols || y0 + 1 >= this.clearRows) return 0;
    const fx = gx - x0;
    const fy = gy - y0;
    const index = y0 * this.clearCols + x0;
    const a = this.clearGrid[index];
    const b = this.clearGrid[index + 1];
    const c = this.clearGrid[index + this.clearCols];
    const d = this.clearGrid[index + this.clearCols + 1];
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }

  /** True when the path is clear at the given shell radius. */
  lineClear(x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 1) return true;
    const hit = this.cast(x0, y0, dx / length, dy / length, length, radius);
    return !hit || hit.t * length >= length - 0.5;
  }
}
