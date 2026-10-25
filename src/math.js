export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
