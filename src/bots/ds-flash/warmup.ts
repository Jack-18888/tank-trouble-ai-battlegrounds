import type { BulletObservation, Cell, GameMap, Tank, Wall } from '../../types.ts';
import type { BotContext } from '../types.ts';
import { FlashBrain } from './brain.ts';

/**
 * Worker instances are created per round, so the first observations run against cold code and a
 * 10 ms dispatch deadline. This runs the planner on a synthetic skirmish during construction
 * (where no deadline applies) so the JIT has already seen the hot paths. It touches no live state:
 * the throwaway brain and world are discarded immediately.
 */
export function warmFlashBrain(speed: number, turn: number): void {
  const cells: Cell[] = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      cells.push({ id: y * 4 + x, x, y, walls: [y === 0, x === 3, y === 2, x === 0] });
    }
  }
  const walls: Wall[] = [
    { x1: 0, y1: 0, x2: 256, y2: 0 },
    { x1: 0, y1: 192, x2: 256, y2: 192 },
    { x1: 0, y1: 0, x2: 0, y2: 192 },
    { x1: 256, y1: 0, x2: 256, y2: 192 },
    { x1: 128, y1: 0, x2: 128, y2: 64 },
    { x1: 64, y1: 128, x2: 128, y2: 128 },
  ];
  const map: GameMap = { cols: 4, rows: 3, width: 256, height: 192, cells, walls, seed: 'WARMUP' };
  const tank = (id: number, x: number, y: number, angle: number): Tank => ({
    id,
    x,
    y,
    angle,
    name: `W${id}`,
    color: '#000',
    alive: true,
    controller: { kind: 'bot', botId: 'warmup' },
    cooldown: 0,
    ammo: 10,
    ammoProgress: 0,
    shield: false,
    power: null,
    powerTime: 0,
    vx: 0,
    vy: 0,
    tread: 0,
    leftTread: 0,
    rightTread: 0,
    steer: 0.4,
    throttle: 0.8,
    fire: false,
    stuck: 0,
    previousX: x,
    previousY: y,
    kills: 0,
  });
  const self = tank(0, 96, 96, 0.2);
  const enemy = tank(1, 30, 96, 0);
  const bullets: BulletObservation[] = [
    { x: 180, y: 40, vx: -140, vy: 40, owner: 1, life: 6, age: 1, bounces: 0 },
    { x: 40, y: 150, vx: 120, vy: -90, owner: 1, life: 5, age: 2, bounces: 2 },
  ];
  const context = (withEnemy: boolean, withBullets: boolean): BotContext => {
    const enemies = withEnemy ? [enemy] : [];
    return {
      self,
      tanks: withEnemy ? [self, enemy] : [self],
      enemies,
      bullets: withBullets ? bullets : [],
      powerups: [{ x: 96, y: 160, type: 'shield', life: 12 }],
      map,
      match: {
        round: 1,
        elapsed: 12,
        scores: [0, 0],
        kills: [0, 0],
        target: 0,
        state: 'playing',
      },
      rules: {
        cellSize: 64,
        playerSpeed: 114,
        shellSpeed: 140,
        shellLifetime: 7.5,
        maxAmmo: 10,
        roundDuration: 90,
        infiniteAmmoDuration: 20,
      },
      random: () => 0.5,
      cellAt: (x: number, y: number) =>
        Math.max(0, Math.min(2, Math.floor(y / 64))) * 4 +
        Math.max(0, Math.min(3, Math.floor(x / 64))),
      findPath: () => [0, 1, 2],
      lineOfSight: () => false,
      predictShot: () => ({ id: 1, distance: 100 }),
    } as unknown as BotContext;
  };
  try {
    const brain = new FlashBrain(speed, turn);
    brain.decide(context(true, true));
    brain.decide(context(true, false));
    brain.decide(context(false, true));
    brain.decide(context(true, true));
  } catch {
    // Calibration must never break a round; the planner simply starts cold as before.
  }
}
