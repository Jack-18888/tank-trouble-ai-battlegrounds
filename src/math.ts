import type { Point } from './types.ts';

export const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));
/** Signed shortest rotation from b to a, in radians within [-PI, PI]. */
export const angleDiff = (a: number, b: number): number =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const distance = (a: Readonly<Point>, b: Readonly<Point>): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
