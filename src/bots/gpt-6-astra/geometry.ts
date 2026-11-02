import { TANK_SHAPES, WALL_RADIUS, TANK_BOUND_RADIUS } from '../../geometry.ts';
import type { TankPose, Wall } from '../../types.ts';

const cores = TANK_SHAPES.map((shape) => ({
  left: shape.x + shape.r,
  right: shape.x + shape.w - shape.r,
  top: shape.y + shape.r,
  bottom: shape.y + shape.h - shape.r,
  radiusSquared: (WALL_RADIUS + shape.r) ** 2 - 1e-8,
}));

/** Same rounded silhouettes as tankWall, without per-wall arrays or repeated trigonometry. */
export function astraTouchesWall(
  pose: Readonly<TankPose>,
  walls: readonly Readonly<Wall>[],
): boolean {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  const bound = TANK_BOUND_RADIUS + WALL_RADIUS;
  for (const wall of walls) {
    const nearX = Math.max(
      Math.min(wall.x1, wall.x2),
      Math.min(pose.x, Math.max(wall.x1, wall.x2)),
    );
    const nearY = Math.max(
      Math.min(wall.y1, wall.y2),
      Math.min(pose.y, Math.max(wall.y1, wall.y2)),
    );
    if ((pose.x - nearX) ** 2 + (pose.y - nearY) ** 2 > bound * bound) continue;
    const wx = wall.x1 - pose.x;
    const wy = wall.y1 - pose.y;
    const ax = wx * c + wy * s;
    const ay = wy * c - wx * s;
    const dx = (wall.x2 - wall.x1) * c + (wall.y2 - wall.y1) * s;
    const dy = (wall.y2 - wall.y1) * c - (wall.x2 - wall.x1) * s;
    const bx = ax + dx;
    const by = ay + dy;
    const lengthSquared = dx * dx + dy * dy || 1;
    for (const box of cores) {
      // Segment against the inset rectangular core, then endpoints and four corners.
      let enter = 0;
      let leave = 1;
      if (Math.abs(dx) < 1e-8) {
        if (ax < box.left || ax > box.right) leave = -1;
      } else {
        const t1 = (box.left - ax) / dx;
        const t2 = (box.right - ax) / dx;
        enter = Math.max(enter, Math.min(t1, t2));
        leave = Math.min(leave, Math.max(t1, t2));
      }
      if (Math.abs(dy) < 1e-8) {
        if (ay < box.top || ay > box.bottom) leave = -1;
      } else {
        const t1 = (box.top - ay) / dy;
        const t2 = (box.bottom - ay) / dy;
        enter = Math.max(enter, Math.min(t1, t2));
        leave = Math.min(leave, Math.max(t1, t2));
      }
      if (enter <= leave) return true;
      const adx = Math.max(box.left - ax, 0, ax - box.right);
      const ady = Math.max(box.top - ay, 0, ay - box.bottom);
      const bdx = Math.max(box.left - bx, 0, bx - box.right);
      const bdy = Math.max(box.top - by, 0, by - box.bottom);
      if (Math.min(adx * adx + ady * ady, bdx * bdx + bdy * bdy) < box.radiusSquared) return true;
      for (let corner = 0; corner < 4; corner++) {
        const x = corner & 1 ? box.right : box.left;
        const y = corner & 2 ? box.bottom : box.top;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
        if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 < box.radiusSquared) return true;
      }
    }
  }
  return false;
}
