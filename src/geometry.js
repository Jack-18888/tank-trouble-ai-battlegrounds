// Shared by the renderer and physics. Coordinates are local to the tank,
// with the barrel pointing along +x. Each shape is a rounded rectangle.
export const TANK_SHAPES = [
  { x: -16, y: -14, w: 31, h: 7, r: 2 },
  { x: -16, y: 7, w: 31, h: 7, r: 2 },
  { x: -13, y: -9, w: 26, h: 18, r: 3 },
  { x: 0, y: -3, w: 25, h: 6, r: 1.3 },
];
export const BARREL_LENGTH = TANK_SHAPES[3].x + TANK_SHAPES[3].w;
export const WALL_RADIUS = 3;
export const SHELL_RADIUS = 2.7;
const TANK_BOUND = 26;
const EPS = 1e-8;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const core = s => ({ x: s.x + s.r, y: s.y + s.r, w: s.w - 2 * s.r, h: s.h - 2 * s.r });
const cores = TANK_SHAPES.map(core);

function pointSegmentDistanceSq(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
}
function pointBoxDistanceSq(x, y, box) {
  return (x - clamp(x, box.x, box.x + box.w)) ** 2 + (y - clamp(y, box.y, box.y + box.h)) ** 2;
}
function corners(box) { return [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]; }

function sweepBox(x, y, dx, dy, box, inside = false) {
  if (inside && pointBoxDistanceSq(x, y, box) === 0) return { t: 0, nx: 0, ny: 0 };
  let enter = -Infinity, leave = Infinity, nx = 0, ny = 0;
  for (const axis of ['x', 'y']) {
    const p = axis === 'x' ? x : y, d = axis === 'x' ? dx : dy;
    const min = box[axis], max = min + box[axis === 'x' ? 'w' : 'h'];
    if (Math.abs(d) < EPS) { if (p < min || p > max) return null; continue; }
    const a = (min - p) / d, b = (max - p) / d, near = Math.min(a, b);
    if (near > enter) { enter = near; nx = axis === 'x' ? -Math.sign(d) : 0; ny = axis === 'y' ? -Math.sign(d) : 0; }
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave && enter >= -EPS && enter <= 1 ? { t: Math.max(0, enter), nx, ny } : null;
}
function sweepCircle(x, y, dx, dy, cx, cy, radius, inside = false) {
  const ox = x - cx, oy = y - cy, a = dx * dx + dy * dy;
  const c = ox * ox + oy * oy - radius * radius;
  if (inside && c <= 0) return { t: 0, nx: 0, ny: 0 };
  if (a < EPS) return null;
  const b = ox * dx + oy * dy, disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < -EPS || t > 1) return null;
  const nx = (ox + dx * t) / radius, ny = (oy + dy * t) / radius;
  return dx * nx + dy * ny < -EPS || inside ? { t: Math.max(0, t), nx, ny } : null;
}
function earliest(hits) { return hits.filter(Boolean).reduce((best, hit) => !best || hit.t < best.t ? hit : best, null); }

// A rendered wall is a capsule: a line segment with round end caps.
export function sweepWall(x, y, dx, dy, wall, radius = SHELL_RADIUS) {
  const r = WALL_RADIUS + radius;
  const minX = Math.min(wall.x1, wall.x2), minY = Math.min(wall.y1, wall.y2);
  const w = Math.abs(wall.x2 - wall.x1), h = Math.abs(wall.y2 - wall.y1);
  const box = w ? { x: minX, y: minY - r, w, h: 2 * r } : { x: minX - r, y: minY, w: 2 * r, h };
  return earliest([
    sweepBox(x, y, dx, dy, box),
    sweepCircle(x, y, dx, dy, wall.x1, wall.y1, r),
    sweepCircle(x, y, dx, dy, wall.x2, wall.y2, r),
  ]);
}
function segmentBoxDistanceSq(ax, ay, bx, by, box) {
  if (sweepBox(ax, ay, bx - ax, by - ay, box, true)) return 0;
  return Math.min(pointBoxDistanceSq(ax, ay, box), pointBoxDistanceSq(bx, by, box), ...corners(box).map(([x, y]) => pointSegmentDistanceSq(x, y, ax, ay, bx, by)));
}
function localPoint(tank, x, y) {
  const c = Math.cos(tank.angle), s = Math.sin(tank.angle), dx = x - tank.x, dy = y - tank.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}
function worldPoint(tank, x, y) {
  const c = Math.cos(tank.angle), s = Math.sin(tank.angle);
  return [tank.x + x * c - y * s, tank.y + x * s + y * c];
}

export function tankWall(tank, wall) {
  if (pointSegmentDistanceSq(tank.x, tank.y, wall.x1, wall.y1, wall.x2, wall.y2) > (TANK_BOUND + WALL_RADIUS) ** 2) return false;
  const [ax, ay] = localPoint(tank, wall.x1, wall.y1), [bx, by] = localPoint(tank, wall.x2, wall.y2);
  return cores.some((box, i) => segmentBoxDistanceSq(ax, ay, bx, by, box) < (WALL_RADIUS + TANK_SHAPES[i].r) ** 2 - EPS);
}

export function tanksOverlap(a, b) {
  if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= (TANK_BOUND * 2) ** 2) return false;
  for (let i = 0; i < cores.length; i++) {
    const box = cores[i];
    const polygon = corners(box).map(([x, y]) => worldPoint(a, x, y)).map(([x, y]) => localPoint(b, x, y));
    for (let j = 0; j < cores.length; j++) {
      const other = cores[j], r = TANK_SHAPES[i].r + TANK_SHAPES[j].r;
      const [cx, cy] = localPoint(a, ...worldPoint(b, other.x + other.w / 2, other.y + other.h / 2));
      if (pointBoxDistanceSq(cx, cy, box) === 0) return true;
      for (let k = 0; k < 4; k++) {
        const [ax, ay] = polygon[k], [bx, by] = polygon[(k + 1) % 4];
        if (segmentBoxDistanceSq(ax, ay, bx, by, other) < r * r - EPS) return true;
      }
    }
  }
  return false;
}

// Sweep a shell against the same rounded tracks, hull, and barrel we draw.
export function sweepTank(x, y, dx, dy, tank, radius = SHELL_RADIUS) {
  const [lx, ly] = localPoint(tank, x, y);
  const c = Math.cos(tank.angle), s = Math.sin(tank.angle);
  const vx = dx * c + dy * s, vy = -dx * s + dy * c;
  let first = null;
  for (let i = 0; i < cores.length; i++) {
    const box = cores[i], r = TANK_SHAPES[i].r + radius;
    const hit = earliest([
      sweepBox(lx, ly, vx, vy, { x: box.x - r, y: box.y, w: box.w + 2 * r, h: box.h }, true),
      sweepBox(lx, ly, vx, vy, { x: box.x, y: box.y - r, w: box.w, h: box.h + 2 * r }, true),
      ...corners(box).map(([x, y]) => sweepCircle(lx, ly, vx, vy, x, y, r, true)),
    ]);
    if (hit && (first === null || hit.t < first)) first = hit.t;
  }
  return first;
}

export function muzzlePosition(tank, angle = tank.angle) {
  const length = BARREL_LENGTH + SHELL_RADIUS + .05;
  return { x: tank.x + Math.cos(angle) * length, y: tank.y + Math.sin(angle) * length };
}
