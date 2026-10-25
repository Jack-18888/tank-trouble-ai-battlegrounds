import type {
  BulletObservation,
  DeepReadonly,
  GameMap,
  GameState,
  Point,
  Powerup,
  ReadonlyGameMap,
  ShotPrediction,
  ShotScene,
  ShotTank,
  Tank,
  WinTarget,
} from '../types.ts';
import type { AbstractPlayer } from '../players/abstract-player.ts';
/** Serializable world data; cell indices differ from pixel coordinates used by tanks and shells. */
export interface BotObservation {
  self: Tank;
  tanks: Tank[];
  enemies: Tank[];
  bullets: BulletObservation[];
  powerups: Powerup[];
  map: GameMap;
  match: {
    round: number;
    elapsed: number;
    scores: number[];
    kills: number[];
    target: WinTarget;
    state: GameState;
  };
  rules: {
    cellSize: number;
    playerSpeed: number;
    shellSpeed: number;
    shellLifetime: number;
    maxShells: number;
  };
}
/** Local, frozen strategy view. Query functions exist only in the controller's execution realm. */
export interface BotContext extends DeepReadonly<BotObservation> {
  /** Advance this bot's seeded stream, independently of physics and other players. */
  readonly random: () => number;
  readonly cellAt: (x: number, y: number) => number;
  readonly findPath: (start: number, goal: number) => number[];
  readonly lineOfSight: (from: Readonly<Point>, to: Readonly<Point>) => boolean;
  /** First predicted living target, possibly self after a ricochet, against the snapshot's poses. */
  readonly predictShot: (angle: number, maxBounces?: number) => ShotPrediction | null;
}
export interface BotQueries {
  random(): number;
  cellAt(map: ReadonlyGameMap, x: number, y: number): number;
  findPath(map: ReadonlyGameMap, start: number, goal: number): number[];
  lineOfSight(from: Readonly<Point>, to: Readonly<Point>, map: ReadonlyGameMap): boolean;
  predictShot(
    tank: Readonly<ShotTank>,
    angle: number,
    maxBounces: number,
    scene: ShotScene,
  ): ShotPrediction | null;
}
export interface BotMetadata {
  readonly id: string;
  readonly label: string;
  readonly tagline: string;
  readonly description: string;
}
export interface BotConstructor {
  new (): AbstractPlayer;
  readonly prototype: AbstractPlayer;
}
