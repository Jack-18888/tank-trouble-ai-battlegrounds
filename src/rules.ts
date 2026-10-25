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
  maxShells: 5,
});
