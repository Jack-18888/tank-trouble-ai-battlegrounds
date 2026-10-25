/** Shared data shapes. Distances use world pixels and durations use seconds unless noted. */
export interface Point {
  x: number;
  y: number;
}
export interface TankPose extends Point {
  /** Radians clockwise from +x (right), matching canvas coordinates. */
  angle: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}
export interface RoundedRect extends Rect {
  r: number;
}
export interface CollisionHit {
  /** Fraction of the attempted displacement at first contact, from 0 to 1. */
  t: number;
  nx: number;
  ny: number;
}
export interface WallContact {
  nx: number;
  ny: number;
  /** Pixels of separation needed along the world-space normal (nx, ny). */
  depth: number;
}
export interface TankWallContact extends WallContact {
  part: 'leftTrack' | 'rightTrack' | 'hull' | 'barrel';
  /** World-space point on the wall surface, used when one track pivots around contact. */
  point: Point;
}
/** Axis-aligned wall centerline; optional rectangle fields cache its rendered capsule bounds. */
export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  border?: boolean;
}
export interface WallCollision extends CollisionHit {
  wall: Wall;
}
export interface Cell {
  id: number;
  /** Grid column/row indices, not world-pixel positions. */
  x: number;
  y: number;
  /** Blocked edges in north, east, south, west order. */
  walls: [boolean, boolean, boolean, boolean];
}
export interface GameMap {
  cols: number;
  rows: number;
  width: number;
  height: number;
  cells: Cell[];
  walls: Wall[];
  seed: string;
}
export type MapSize = 'compact' | 'classic' | 'large';
export type MazeDensity = 'open' | 'balanced' | 'dense';
/** Zero selects endless play; other values are round wins needed to finish a match. */
export type WinTarget = 0 | 3 | 5 | 10;
export type Seed = string | number;
export type PowerupType = 'shield' | 'rapid' | 'scatter';
export type OffensivePower = Exclude<PowerupType, 'shield'>;
export type GameState = 'ready' | 'countdown' | 'playing' | 'paused' | 'roundOver' | 'matchOver';
export type PlayerSlot = { kind: 'human' } | { kind: 'bot'; botId: string };
/** Normalized configuration; Game validates unknown input and migrates legacy saved rosters. */
export interface GameConfig {
  players: PlayerSlot[];
  size: MapSize;
  density: MazeDensity;
  target: WinTarget;
  powerups: boolean;
}
/** Current held keyboard/touch actions; omitted actions are released, not unchanged. */
export interface PlayerInput {
  left?: boolean;
  right?: boolean;
  forward?: boolean;
  backward?: boolean;
  fire?: boolean;
}
export interface Tank extends TankPose {
  /** Stable roster index used by score arrays and projectile ownership throughout the match. */
  id: number;
  name: string;
  color: string;
  alive: boolean;
  controller: PlayerSlot;
  /** Seconds until another volley is eligible. */
  cooldown: number;
  shield: boolean;
  power: OffensivePower | null;
  powerTime: number;
  vx: number;
  vy: number;
  tread: number;
  leftTread: number;
  rightTread: number;
  /** Controls applied at the last physics boundary, held until replaced or invalidated. */
  steer: number;
  throttle: number;
  fire: boolean;
  /** Short-lived movement/rotation blockage sensor used by bot escape strategies. */
  stuck: number;
  previousX: number;
  previousY: number;
  /** Kills in this round; Game.kills and observation.match.kills retain match-long totals. */
  kills: number;
}
export interface Bullet extends Point {
  vx: number;
  vy: number;
  /** Firing tank ID; shells remain active and can earn kills after their owner is eliminated. */
  owner: number;
  life: number;
  age: number;
  bounces: number;
  trail: Point[];
  dead: boolean;
}
/** Controller-visible ballistics omit rendering trails and the simulation's cleanup flag. */
export type BulletObservation = Omit<Bullet, 'trail' | 'dead'>;
export interface Powerup extends Point {
  type: PowerupType;
  life: number;
}
export interface Track extends TankPose {
  life: number;
}
export interface Particle extends Point {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}
export interface ShotPrediction {
  id: number;
  /** Total path length in pixels, including travel before any ricochets. */
  distance: number;
}
export type ShotTank = Pick<Tank, 'id' | 'x' | 'y' | 'angle'>;
/** Compile-time immutability; observation builders also clone and freeze data at runtime. */
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type ReadonlyGameMap = DeepReadonly<GameMap>;
export interface ShotScene {
  map: ReadonlyGameMap;
  tanks: readonly DeepReadonly<Tank>[];
}
/** Transient notifications drained by the browser after simulation steps; not a replay log. */
export type GameEvent =
  | { type: 'map' | 'score' | 'state' | 'go' | 'bounce' }
  | { type: 'fire' | 'shield'; id: number }
  | { type: 'playerStatus'; id: number; status: 'ready' | 'failed' }
  | { type: 'countdown'; count: number }
  | { type: 'destroy'; id: number; owner: number }
  | { type: 'roundEnd'; winner: number | null; match: boolean }
  | { type: 'pickup'; id: number; power: PowerupType };
