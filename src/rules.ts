import { HUMAN_PROFILE } from './players/player.ts';

// Geometry, physics, and worker queries share these values: pixels, pixels/second, and seconds.
export const CELL = 64;
export const PLAYER_SPEED = HUMAN_PROFILE.speed;
export const SHELL_SPEED = 140;
export const SHELL_LIFETIME = 7.5;
export const RULES = Object.freeze({
  cellSize: CELL,
  playerSpeed: PLAYER_SPEED,
  shellSpeed: SHELL_SPEED,
  shellLifetime: SHELL_LIFETIME,
  maxAmmo: 10,
  roundDuration: 90,
  infiniteAmmoDuration: 20,
});

/** One bullet every 2 / 1.5 / 1 / 0.5 seconds as each 20-second round stage begins. */
export function ammoRefillInterval(elapsed: number): number {
  return Math.max(0.5, 2 - Math.floor(elapsed / 20) * 0.5);
}
