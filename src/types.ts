export interface Point {
  x: number;
  y: number;
}
export interface TankPose extends Point {
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
  t: number;
  nx: number;
  ny: number;
}
export interface WallContact {
  nx: number;
  ny: number;
  depth: number;
}
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
  x: number;
  y: number;
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
export type WinTarget = 0 | 3 | 5 | 10;
export type Seed = string | number;
export type PowerupType = 'shield' | 'rapid' | 'scatter';
export type OffensivePower = Exclude<PowerupType, 'shield'>;
export type GameState = 'ready' | 'countdown' | 'playing' | 'paused' | 'roundOver' | 'matchOver';
export interface GameConfig {
  opponents: number;
  difficulties: string[];
  size: MapSize;
  density: MazeDensity;
  target: WinTarget;
  powerups: boolean;
}
export interface PlayerInput {
  left?: boolean;
  right?: boolean;
  forward?: boolean;
  backward?: boolean;
  fire?: boolean;
}
export interface Tank extends TankPose {
  id: number;
  name: string;
  color: string;
  alive: boolean;
  difficulty: string | null;
  cooldown: number;
  shield: boolean;
  power: OffensivePower | null;
  powerTime: number;
  vx: number;
  vy: number;
  tread: number;
  think: number;
  steer: number;
  throttle: number;
  fire: boolean;
  stuck: number;
  previousX: number;
  previousY: number;
  kills: number;
}
export interface Bullet extends Point {
  vx: number;
  vy: number;
  owner: number;
  life: number;
  age: number;
  bounces: number;
  trail: Point[];
  dead: boolean;
}
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
  distance: number;
}
export type ShotTank = Pick<Tank, 'id' | 'x' | 'y' | 'angle'>;
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type ReadonlyGameMap = DeepReadonly<GameMap>;
export interface ShotScene {
  map: ReadonlyGameMap;
  tanks: readonly DeepReadonly<Tank>[];
}
export type GameEvent =
  | { type: 'map' | 'score' | 'state' | 'go' | 'bounce' }
  | { type: 'fire' | 'shield'; id: number }
  | { type: 'countdown'; count: number }
  | { type: 'destroy'; id: number; owner: number }
  | { type: 'roundEnd'; winner: number | null; match: boolean }
  | { type: 'pickup'; id: number; power: PowerupType };
