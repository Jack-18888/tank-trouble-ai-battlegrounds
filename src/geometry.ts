// Shared by the renderer and physics. Coordinates are local to the tank,
// with the barrel pointing along +x. Each shape is a rounded rectangle.
import type {
  CollisionHit,
  Rect,
  RoundedRect,
  TankPose,
  Wall,
  WallContact,
  TankWallContact,
} from './types.ts';

export const TANK_SHAPES = [
  { x: -16, y: -14, w: 31, h: 7, r: 2 },
  { x: -16, y: 7, w: 31, h: 7, r: 2 },
  { x: -13, y: -9, w: 26, h: 18, r: 3 },
  { x: 0, y: -3, w: 25, h: 6, r: 1.3 },
] as const satisfies readonly RoundedRect[];
export const BARREL_LENGTH = TANK_SHAPES[3].x + TANK_SHAPES[3].w;
export const WALL_RADIUS = 3;
export const SHELL_RADIUS = 2.7;
export const TANK_BOUND_RADIUS = 26;
export const TRACK_SPACING = 21;
const PARTS = ['leftTrack', 'rightTrack', 'hull', 'barrel'] as const;
const EPS = 1e-8;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const core = (s: RoundedRect): Rect => ({
  x: s.x + s.r,
  y: s.y + s.r,
  w: s.w - 2 * s.r,
  h: s.h - 2 * s.r,
});
const cores = TANK_SHAPES.map(core);

function pointSegmentDistanceSq(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}
function pointBoxDistanceSq(x: number, y: number, box: Rect): number {
  return (x - clamp(x, box.x, box.x + box.w)) ** 2 + (y - clamp(y, box.y, box.y + box.h)) ** 2;
}
function corners(box: Rect): [number, number][] {
  return [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
}

function sweepBox(
  x: number,
  y: number,
  dx: number,
  dy: number,
  box: Rect,
  inside = false,
): CollisionHit | null {
  if (inside && pointBoxDistanceSq(x, y, box) === 0) return { t: 0, nx: 0, ny: 0 };
  let enter = -Infinity,
    leave = Infinity,
    nx = 0,
    ny = 0;
  for (const axis of ['x', 'y'] as const) {
    const p = axis === 'x' ? x : y,
      d = axis === 'x' ? dx : dy;
    const min = box[axis],
      max = min + box[axis === 'x' ? 'w' : 'h'];
    if (Math.abs(d) < EPS) {
      if (p < min || p > max) return null;
      continue;
    }
    const a = (min - p) / d,
      b = (max - p) / d,
      near = Math.min(a, b);
    if (near > enter) {
      enter = near;
      nx = axis === 'x' ? -Math.sign(d) : 0;
      ny = axis === 'y' ? -Math.sign(d) : 0;
    }
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave && enter >= -EPS && enter <= 1 ? { t: Math.max(0, enter), nx, ny } : null;
}
function sweepCircle(
  x: number,
  y: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  radius: number,
  inside = false,
): CollisionHit | null {
  const ox = x - cx,
    oy = y - cy,
    a = dx * dx + dy * dy;
  const c = ox * ox + oy * oy - radius * radius;
  if (inside && c <= 0) return { t: 0, nx: 0, ny: 0 };
  if (a < EPS) return null;
  const b = ox * dx + oy * dy,
    disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < -EPS || t > 1) return null;
  const nx = (ox + dx * t) / radius,
    ny = (oy + dy * t) / radius;
  return dx * nx + dy * ny < -EPS || inside ? { t: Math.max(0, t), nx, ny } : null;
}
function earliest(hits: (CollisionHit | null)[]): CollisionHit | null {
  return hits
    .filter((hit): hit is CollisionHit => hit !== null)
    .reduce<CollisionHit | null>((best, hit) => (!best || hit.t < best.t ? hit : best), null);
}

// A rendered wall is a capsule: a line segment with round end caps.
export function sweepWall(
  x: number,
  y: number,
  dx: number,
  dy: number,
  wall: Readonly<Wall>,
  radius = SHELL_RADIUS,
): CollisionHit | null {
  const r = WALL_RADIUS + radius;
  const minX = Math.min(wall.x1, wall.x2),
    minY = Math.min(wall.y1, wall.y2);
  const w = Math.abs(wall.x2 - wall.x1),
    h = Math.abs(wall.y2 - wall.y1);
  const box = w ? { x: minX, y: minY - r, w, h: 2 * r } : { x: minX - r, y: minY, w: 2 * r, h };
  return earliest([
    sweepBox(x, y, dx, dy, box),
    sweepCircle(x, y, dx, dy, wall.x1, wall.y1, r),
    sweepCircle(x, y, dx, dy, wall.x2, wall.y2, r),
  ]);
}
function segmentBoxDistanceSq(ax: number, ay: number, bx: number, by: number, box: Rect): number {
  if (sweepBox(ax, ay, bx - ax, by - ay, box, true)) return 0;
  return Math.min(
    pointBoxDistanceSq(ax, ay, box),
    pointBoxDistanceSq(bx, by, box),
    ...corners(box).map(([x, y]) => pointSegmentDistanceSq(x, y, ax, ay, bx, by)),
  );
}
interface ClosestPoints {
  distance: number;
  wallX: number;
  wallY: number;
  bodyX: number;
  bodyY: number;
}
function closestSegmentBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: Rect,
): ClosestPoints {
  const crossing = sweepBox(ax, ay, bx - ax, by - ay, box, true);
  if (crossing) return { distance: 0, wallX: ax, wallY: ay, bodyX: ax, bodyY: ay };
  const initialX = clamp(ax, box.x, box.x + box.w),
    initialY = clamp(ay, box.y, box.y + box.h);
  let closest: ClosestPoints = {
    wallX: ax,
    wallY: ay,
    bodyX: initialX,
    bodyY: initialY,
    distance: Math.hypot(initialX - ax, initialY - ay),
  };
  const consider = (wallX: number, wallY: number, bodyX: number, bodyY: number) => {
    const distance = Math.hypot(bodyX - wallX, bodyY - wallY);
    if (!closest || distance < closest.distance) closest = { wallX, wallY, bodyX, bodyY, distance };
  };
  for (const [x, y] of [
    [ax, ay],
    [bx, by],
  ]) {
    consider(x, y, clamp(x, box.x, box.x + box.w), clamp(y, box.y, box.y + box.h));
  }
  const dx = bx - ax,
    dy = by - ay;
  for (const [x, y] of corners(box)) {
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    consider(ax + t * dx, ay + t * dy, x, y);
  }
  return closest;
}
function localPoint(tank: Readonly<TankPose>, x: number, y: number): [number, number] {
  const c = Math.cos(tank.angle),
    s = Math.sin(tank.angle),
    dx = x - tank.x,
    dy = y - tank.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}
function worldPoint(tank: Readonly<TankPose>, x: number, y: number): [number, number] {
  const c = Math.cos(tank.angle),
    s = Math.sin(tank.angle);
  return [tank.x + x * c - y * s, tank.y + x * s + y * c];
}

export function tankWall(tank: Readonly<TankPose>, wall: Readonly<Wall>): boolean {
  if (
    pointSegmentDistanceSq(tank.x, tank.y, wall.x1, wall.y1, wall.x2, wall.y2) >
    (TANK_BOUND_RADIUS + WALL_RADIUS) ** 2
  )
    return false;
  const [ax, ay] = localPoint(tank, wall.x1, wall.y1),
    [bx, by] = localPoint(tank, wall.x2, wall.y2);
  return cores.some(
    (box, i) =>
      segmentBoxDistanceSq(ax, ay, bx, by, box) < (WALL_RADIUS + TANK_SHAPES[i].r) ** 2 - EPS,
  );
}

// Small rotations can sweep a track corner or barrel into a wall even though
// the starting pose is clear. Return the exact separation needed for that
// contact; the simulation limits and validates any resulting displacement.
export function tankWallContact(
  tank: Readonly<TankPose>,
  wall: Readonly<Wall>,
): WallContact | null {
  return tankWallContacts(tank, wall).reduce<WallContact | null>(
    (deepest, contact) => (!deepest || contact.depth > deepest.depth ? contact : deepest),
    null,
  );
}

export function tankWallContacts(
  tank: Readonly<TankPose>,
  wall: Readonly<Wall>,
): TankWallContact[] {
  if (!tankWall(tank, wall)) return [];
  const [ax, ay] = localPoint(tank, wall.x1, wall.y1),
    [bx, by] = localPoint(tank, wall.x2, wall.y2);
  const c = Math.cos(tank.angle),
    s = Math.sin(tank.angle);
  const contacts: TankWallContact[] = [];
  for (let i = 0; i < cores.length; i++) {
    const closest = closestSegmentBox(ax, ay, bx, by, cores[i]);
    const depth = WALL_RADIUS + TANK_SHAPES[i].r - closest.distance;
    // Starting from a valid pose and rotating in small increments keeps the
    // cores apart. Leave deep/ambiguous overlap to the caller to reject.
    if (depth <= EPS || closest.distance <= EPS) continue;
    const nx = (closest.bodyX - closest.wallX) / closest.distance;
    const ny = (closest.bodyY - closest.wallY) / closest.distance;
    const [x, y] = worldPoint(
      tank,
      closest.wallX + nx * WALL_RADIUS,
      closest.wallY + ny * WALL_RADIUS,
    );
    contacts.push({
      nx: nx * c - ny * s,
      ny: nx * s + ny * c,
      depth,
      part: PARTS[i],
      point: { x, y },
    });
  }
  return contacts;
}

export function tanksOverlap(a: Readonly<TankPose>, b: Readonly<TankPose>): boolean {
  if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= (TANK_BOUND_RADIUS * 2) ** 2) return false;
  for (let i = 0; i < cores.length; i++) {
    const box = cores[i];
    const polygon = corners(box)
      .map(([x, y]) => worldPoint(a, x, y))
      .map(([x, y]) => localPoint(b, x, y));
    for (let j = 0; j < cores.length; j++) {
      const other = cores[j],
        r = TANK_SHAPES[i].r + TANK_SHAPES[j].r;
      const [cx, cy] = localPoint(
        a,
        ...worldPoint(b, other.x + other.w / 2, other.y + other.h / 2),
      );
      if (pointBoxDistanceSq(cx, cy, box) === 0) return true;
      for (let k = 0; k < 4; k++) {
        const [ax, ay] = polygon[k],
          [bx, by] = polygon[(k + 1) % 4];
        if (segmentBoxDistanceSq(ax, ay, bx, by, other) < r * r - EPS) return true;
      }
    }
  }
  return false;
}

// Sweep a shell against the same rounded tracks, hull, and barrel we draw.
export function sweepTank(
  x: number,
  y: number,
  dx: number,
  dy: number,
  tank: Readonly<TankPose>,
  radius = SHELL_RADIUS,
): number | null {
  const [lx, ly] = localPoint(tank, x, y);
  const c = Math.cos(tank.angle),
    s = Math.sin(tank.angle);
  const vx = dx * c + dy * s,
    vy = -dx * s + dy * c;
  let first: number | null = null;
  for (let i = 0; i < cores.length; i++) {
    const box = cores[i],
      r = TANK_SHAPES[i].r + radius;
    const hit = earliest([
      sweepBox(lx, ly, vx, vy, { x: box.x - r, y: box.y, w: box.w + 2 * r, h: box.h }, true),
      sweepBox(lx, ly, vx, vy, { x: box.x, y: box.y - r, w: box.w, h: box.h + 2 * r }, true),
      ...corners(box).map(([x, y]) => sweepCircle(lx, ly, vx, vy, x, y, r, true)),
    ]);
    if (hit && (first === null || hit.t < first)) first = hit.t;
  }
  return first;
}

export function muzzlePosition(
  tank: Readonly<TankPose>,
  angle = tank.angle,
): { x: number; y: number } {
  const length = BARREL_LENGTH + SHELL_RADIUS + 0.05;
  return { x: tank.x + Math.cos(angle) * length, y: tank.y + Math.sin(angle) * length };
}
