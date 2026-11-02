import { AbstractPlayer } from '../../players/abstract-player.ts';
import type { Decision, PlayerContext } from '../../players/types.ts';
import type { BotContext } from '../types.ts';
import type {
  Point,
  TankPose,
  Wall,
  BulletObservation,
  ReadonlyGameMap,
  WallCollision,
} from '../../types.ts';
import { neighbors } from '../../queries.ts';
import { muzzlePosition, sweepTank, sweepWall, tanksOverlap } from '../../geometry.ts';
import { astraTouchesWall } from './geometry.ts';

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const HORIZON = 1.05;
const STEP = 0.05;

// Exact shared narrow-phase geometry with a cheap swept-AABB broad phase. Most maze walls
// cannot intersect a short forecast segment; avoiding their temporary objects matters at 10 ms.
function firstWall(
  map: Pick<ReadonlyGameMap, 'walls'>,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius = 2.7,
): WallCollision | null {
  const pad = radius + 3;
  const minX = Math.min(x, x + dx) - pad;
  const maxX = Math.max(x, x + dx) + pad;
  const minY = Math.min(y, y + dy) - pad;
  const maxY = Math.max(y, y + dy) + pad;
  let best: WallCollision | null = null;
  for (const wall of map.walls) {
    if (
      Math.min(wall.x1, wall.x2) > maxX ||
      Math.max(wall.x1, wall.x2) < minX ||
      Math.min(wall.y1, wall.y2) > maxY ||
      Math.max(wall.y1, wall.y2) < minY
    )
      continue;
    const hit = sweepWall(x, y, dx, dy, wall, radius);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, wall };
  }
  return best;
}

interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  start: number;
  end: number;
  dangerous: boolean;
  weight?: number;
}
interface Control {
  steer: number;
  throttle: number;
}
interface Aim {
  angle: number;
  value: number;
  range: number;
}

/** Independent receding-horizon controller. All work limits are counts, never wall clocks. */
export class AstraBot extends AbstractPlayer {
  private route: number[] = [];
  private routeIndex = 0;
  private goal = -1;
  private nextRoute = 0;
  private targetId = -1;
  private lastCheck = 0;
  private lastPosition: Point | null = null;
  private recoveryUntil = 0;
  private recoveryTurn = 1;
  private nextBank = 0;
  private bank: Aim | null = null;

  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  override decide({ observe }: PlayerContext): Decision {
    const world = observe();
    const { self, match } = world;
    if (!self.alive) return { segments: [{ ticks: 12 }] };
    const waypoint = this.destination(world);
    const aim = this.aim(world);
    const nearby = world.bullets
      .filter((b) => distance(b, self) < 290 && b.life > 0)
      .sort((a, b) => distance(a, self) - distance(b, self))
      .slice(0, 16);
    const flights = nearby.flatMap((b) => this.trace(world, b, HORIZON));
    // Anticipate an aimed enemy's next volley, at reduced confidence. Observed shells
    // retain priority; profiles of opponents are deliberately neither read nor assumed.
    for (const enemy of world.enemies) {
      if (enemy.ammo <= 0 || enemy.cooldown > 0.35 || distance(enemy, self) > 260) continue;
      const bearing = Math.atan2(self.y - enemy.y, self.x - enemy.x);
      if (Math.abs(angleDiff(enemy.angle, bearing)) > 0.18 || !world.lineOfSight(self, enemy))
        continue;
      const delay = Math.max(0.08, enemy.cooldown);
      const muzzle = muzzlePosition(enemy);
      const projected = this.trace(
        world,
        {
          ...muzzle,
          vx: Math.cos(enemy.angle) * world.rules.shellSpeed,
          vy: Math.sin(enemy.angle) * world.rules.shellSpeed,
          owner: enemy.id,
          life: HORIZON,
          age: 0,
          bounces: 0,
        },
        HORIZON - delay,
      );
      for (const flight of projected)
        flights.push({
          ...flight,
          start: flight.start + delay,
          end: flight.end + delay,
          weight: 0.35,
        });
    }
    const walls = world.map.walls.filter(
      (w) =>
        self.x + 150 >= Math.min(w.x1, w.x2) &&
        self.x - 150 <= Math.max(w.x1, w.x2) &&
        self.y + 150 >= Math.min(w.y1, w.y2) &&
        self.y - 150 <= Math.max(w.y1, w.y2),
    );
    const fighting = aim !== null && aim.value > 0.35 && aim.range < 340;
    const desired = this.control(self, waypoint, fighting ? aim : null);
    if (match.elapsed > this.lastCheck + 1.1) {
      if (this.lastPosition && distance(self, this.lastPosition) < 6 && !fighting) {
        this.recoveryUntil = match.elapsed + 0.65;
        this.recoveryTurn = world.random() < 0.5 ? -1 : 1;
        this.nextRoute = 0;
      }
      this.lastPosition = { x: self.x, y: self.y };
      this.lastCheck = match.elapsed;
    }
    if (match.elapsed < this.recoveryUntil) {
      desired.throttle = -0.85;
      desired.steer = this.recoveryTurn * 0.6;
    }
    const candidates: Control[] = [desired];
    for (const throttle of [-1, 0, 1]) {
      for (const steer of [-1, 0, 1]) candidates.push({ throttle, steer });
      candidates.push({ throttle, steer: desired.steer });
    }
    let chosen = desired;
    let best = -Infinity;
    const unique = candidates.filter(
      (candidate, index) =>
        !candidates
          .slice(0, index)
          .some(
            (other) =>
              Math.abs(other.steer - candidate.steer) < 0.001 &&
              Math.abs(other.throttle - candidate.throttle) < 0.001,
          ),
    );
    for (const candidate of unique) {
      const score = this.evaluate(
        world,
        candidate,
        desired,
        waypoint,
        fighting ? aim : null,
        flights,
        walls,
      );
      if (score > best) {
        best = score;
        chosen = candidate;
      }
    }
    const ticks = nearby.length || fighting ? 8 : 12;
    // Fire only at the first physics tick: no blind trigger hold while turning.
    const shotAngle = self.angle + (chosen.steer * this.profile.turn) / 120;
    const fire = this.shouldFire(world, shotAngle, aim);
    return {
      segments: [
        { ticks: 1, ...chosen, fire: fire ? 'once' : undefined },
        { ticks: ticks - 1, ...chosen },
      ],
    };
  }

  private center(world: BotContext, id: number): Point {
    const cell = world.map.cells[id];
    return { x: (cell.x + 0.5) * world.rules.cellSize, y: (cell.y + 0.5) * world.rules.cellSize };
  }

  private destination(world: BotContext): Point {
    const { self, match } = world;
    const start = world.cellAt(self.x, self.y);
    if (match.elapsed >= this.nextRoute || !this.route.length) {
      // One BFS gives route costs for every opponent and pickup, even on labyrinth maps.
      const previous = new Int32Array(world.map.cells.length).fill(-1);
      const costs = new Int32Array(previous.length).fill(10000);
      const queue = [start];
      previous[start] = start;
      costs[start] = 0;
      for (let i = 0; i < queue.length; i++) {
        for (const next of neighbors(world.map, queue[i])) {
          if (previous[next] !== -1) continue;
          previous[next] = queue[i];
          costs[next] = costs[queue[i]] + 1;
          queue.push(next);
        }
      }
      let goal = start;
      let best = Infinity;
      for (const enemy of world.enemies) {
        const cell = world.cellAt(enemy.x, enemy.y);
        const cost =
          costs[cell] * 64 + distance(self, enemy) * 0.12 - (enemy.id === this.targetId ? 35 : 0);
        if (cost < best) {
          best = cost;
          goal = cell;
          this.targetId = enemy.id;
        }
      }
      for (const pickup of world.powerups) {
        if (pickup.type === 'shield' && self.shield) continue;
        if (pickup.type !== 'shield' && (self.power || self.ammo < 3)) continue;
        const cell = world.cellAt(pickup.x, pickup.y);
        const travel = costs[cell] * 64 + distance(self, pickup) * 0.12;
        if (travel > pickup.life * 60) continue;
        const value = pickup.type === 'shield' ? 210 : 100;
        if (travel - value < best) {
          best = travel - value;
          goal = cell;
        }
      }
      // Preserve a waypoint across cell boundaries. Rebuilding at every observation cuts corners.
      if (
        goal !== this.goal ||
        !this.route.length ||
        !this.route.slice(Math.max(0, this.routeIndex - 1)).includes(start)
      ) {
        const route = [goal];
        while (route[route.length - 1] !== start && route.length <= previous.length) {
          const next = previous[route[route.length - 1]];
          if (next < 0) break;
          route.push(next);
        }
        this.route = route.reverse();
        this.routeIndex = 0;
        this.goal = goal;
      }
      this.nextRoute = match.elapsed + 0.45;
    }
    while (this.routeIndex < this.route.length - 1) {
      const current = this.center(world, this.route[this.routeIndex]);
      const next = this.center(world, this.route[this.routeIndex + 1]);
      if (
        distance(self, current) > 9 &&
        firstWall(world.map, self.x, self.y, next.x - self.x, next.y - self.y, 24)
      )
        break;
      this.routeIndex++;
    }
    const point = this.center(world, this.route[this.routeIndex] ?? start);
    if (this.routeIndex === this.route.length - 1) {
      const pickup = world.powerups.find((p) => world.cellAt(p.x, p.y) === this.goal);
      if (pickup && distance(self, pickup) < 60) return pickup;
      const target = world.enemies.find((e) => e.id === this.targetId);
      if (target && world.lineOfSight(self, target)) return target;
    }
    return point;
  }

  private control(pose: TankPose, point: Point, aim: Aim | null): Control {
    const heading = aim?.angle ?? Math.atan2(point.y - pose.y, point.x - pose.x);
    const delta = angleDiff(heading, pose.angle);
    if (aim) {
      return {
        steer: clamp(delta / 0.3),
        throttle: aim.range < 115 ? -0.8 : aim.range > 200 && Math.abs(delta) < 0.3 ? 0.65 : 0,
      };
    }
    const reverse = Math.abs(delta) > Math.PI / 2 + 0.15;
    const turn = reverse ? angleDiff(heading + Math.PI, pose.angle) : delta;
    return {
      steer: clamp(turn / 0.3),
      throttle:
        (reverse ? -1 : 1) *
        clamp(((1 - Math.abs(turn) / 0.95) * distance(pose, point)) / 18, 0, 1),
    };
  }

  private aim(world: BotContext): Aim | null {
    const { self } = world;
    let best: Aim | null = null;
    for (const enemy of world.enemies) {
      const range = distance(self, enemy);
      if (range > 500 || !world.lineOfSight(self, enemy)) continue;
      // Interception is bounded by walls; do not lead a tank through the end of its corridor.
      let t = Math.max(0, range - 28) / world.rules.shellSpeed;
      let point: Point = enemy;
      for (let i = 0; i < 3; i++) {
        const lead = Math.min(t, 3);
        const dx = enemy.vx * lead;
        const dy = enemy.vy * lead;
        const wall = firstWall(world.map, enemy.x, enemy.y, dx, dy, 19);
        const fraction = wall ? Math.max(0, wall.t - 0.04) : 1;
        point = { x: enemy.x + dx * fraction, y: enemy.y + dy * fraction };
        t = Math.max(0, distance(self, point) - 28) / world.rules.shellSpeed;
      }
      if (!world.lineOfSight(self, point)) point = enemy;
      const angle = Math.atan2(point.y - self.y, point.x - self.x);
      const value = 1.5 - range / 550 - Math.abs(angleDiff(angle, self.angle)) * 0.1;
      if (!best || value > best.value) best = { angle, value, range };
    }
    if (best) return best;
    if (world.match.elapsed >= this.nextBank) {
      this.nextBank = world.match.elapsed + 0.3;
      this.bank = null;
      // Mirror targets in nearby wall planes, then validate against the actual rounded geometry.
      const candidates: { angle: number; range: number }[] = [];
      for (const enemy of world.enemies) {
        if (distance(self, enemy) > 330) continue;
        for (const wall of world.map.walls) {
          const horizontal = wall.y1 === wall.y2;
          const x = horizontal ? enemy.x : 2 * wall.x1 - enemy.x;
          const y = horizontal ? 2 * wall.y1 - enemy.y : enemy.y;
          const range = Math.hypot(x - self.x, y - self.y);
          if (range > 480 || range < 50) continue;
          const angle = Math.atan2(y - self.y, x - self.x);
          if (Math.abs(angleDiff(angle, self.angle)) > 1.3) continue;
          if (!candidates.some((c) => Math.abs(angleDiff(c.angle, angle)) < 0.025))
            candidates.push({ angle, range });
        }
      }
      candidates.sort((a, b) => a.range - b.range);
      for (const candidate of candidates.slice(0, 8)) {
        const hit = world.predictShot(candidate.angle, 1);
        if (hit && hit.id !== self.id) {
          const value = 0.85 - hit.distance / 850;
          if (!this.bank || value > this.bank.value)
            this.bank = { angle: candidate.angle, range: hit.distance, value };
        }
      }
    }
    return this.bank;
  }

  private shouldFire(world: BotContext, angle: number, aim: Aim | null): boolean {
    const { self } = world;
    if (self.cooldown > 1 / 120 || (self.ammo < 1 && world.match.elapsed < 70)) return false;
    const muzzle = muzzlePosition(self, angle);
    if (firstWall(world.map, self.x, self.y, muzzle.x - self.x, muzzle.y - self.y)) return false;
    const hit = world.predictShot(angle, 2);
    if (hit?.id === self.id) return false;
    if (hit && hit.distance < (self.ammo > 2 ? 420 : 230)) return true;
    // A lead shot may deliberately miss the target's frozen pose.
    return (
      aim !== null &&
      aim.value > 0.7 &&
      Math.abs(angleDiff(aim.angle, angle)) < Math.atan2(10, aim.range) &&
      (self.ammo > 2 || aim.range < 180 || world.match.elapsed >= 70)
    );
  }

  private trace(world: BotContext, bullet: Readonly<BulletObservation>, horizon: number): Flight[] {
    let { x, y, vx, vy, bounces } = bullet;
    const end = Math.min(horizon, bullet.life);
    let start = 0;
    const result: Flight[] = [];
    for (let i = 0; i < 8 && start < end && bounces <= 18; i++) {
      const duration = end - start;
      const wall = firstWall(world.map, x, y, vx * duration, vy * duration);
      const dt = duration * (wall?.t ?? 1);
      result.push({
        x,
        y,
        vx,
        vy,
        start,
        end: start + dt,
        dangerous: bullet.owner !== world.self.id || bounces > 0,
      });
      if (!wall) break;
      x += vx * dt + wall.nx * 0.03;
      y += vy * dt + wall.ny * 0.03;
      const dot = vx * wall.nx + vy * wall.ny;
      vx -= 2 * dot * wall.nx;
      vy -= 2 * dot * wall.ny;
      start += Math.max(dt, 0.00001);
      bounces++;
    }
    return result;
  }

  private evaluate(
    world: BotContext,
    candidate: Control,
    desired: Control,
    goal: Point,
    aim: Aim | null,
    flights: Flight[],
    walls: readonly Readonly<Wall>[],
  ): number {
    const { self } = world;
    const pose: TankPose = { x: self.x, y: self.y, angle: self.angle };
    let danger = 0;
    let blocked = 0;
    let progress = 0;
    const valid = (p: TankPose) =>
      !astraTouchesWall(p, walls) && !world.enemies.some((e) => tanksOverlap(p, e));
    const duration = flights.length ? HORIZON : 0.5;
    // Do not abandon an escape in the forecast before the incoming shell passes.
    // Quiet navigation still returns to waypoint feedback quickly to avoid corner stalls.
    const commitment = flights.some((flight) => flight.dangerous && flight.weight === undefined)
      ? 0.5
      : 0.25;
    for (let time = 0; time < duration - 0.001; time += STEP) {
      // The first action is committed; subsequent steps model feedback to the same intent.
      const action = time < commitment ? candidate : this.control(pose, goal, aim);
      const oldX = pose.x;
      const oldY = pose.y;
      const nextAngle = pose.angle + action.steer * this.profile.turn * STEP;
      if (valid({ ...pose, angle: nextAngle })) pose.angle = nextAngle;
      else blocked += 0.3;
      const dx = Math.cos(pose.angle) * action.throttle * this.profile.speed * STEP;
      const dy = Math.sin(pose.angle) * action.throttle * this.profile.speed * STEP;
      if (valid({ ...pose, x: pose.x + dx, y: pose.y + dy })) {
        pose.x += dx;
        pose.y += dy;
      } else {
        blocked += Math.abs(action.throttle);
        if (valid({ ...pose, x: pose.x + dx })) pose.x += dx;
        if (valid({ ...pose, y: pose.y + dy })) pose.y += dy;
      }
      progress += Math.hypot(pose.x - oldX, pose.y - oldY);
      for (const flight of flights) {
        if (!flight.dangerous || flight.end < time || flight.start > time + STEP) continue;
        const from = Math.max(time, flight.start);
        const to = Math.min(time + STEP, flight.end);
        const x = flight.x + flight.vx * (from - flight.start);
        const y = flight.y + flight.vy * (from - flight.start);
        if (Math.hypot(x - pose.x, y - pose.y) > 45) continue;
        const dt = to - from;
        const mx = (pose.x - oldX) / STEP;
        const my = (pose.y - oldY) / STEP;
        const relativePose = {
          x: oldX + mx * (from - time),
          y: oldY + my * (from - time),
          angle: pose.angle,
        };
        if (
          sweepTank(x, y, (flight.vx - mx) * dt, (flight.vy - my) * dt, relativePose, 4) !== null
        ) {
          danger += 900 * (1.25 - time * 0.6) * (flight.weight ?? 1);
        } else {
          const d = Math.hypot(x - pose.x, y - pose.y);
          danger += Math.max(0, 34 - d) * 0.35 * (1.1 - time * 0.5) * (flight.weight ?? 1);
        }
      }
    }
    let score = (distance(self, goal) - distance(pose, goal)) * 1.4;
    if (aim) {
      score = -Math.abs(angleDiff(aim.angle, pose.angle)) * 24;
      const range = distance(pose, goal);
      score -= Math.abs(range - 155) * 0.12;
    } else {
      const heading = Math.atan2(goal.y - pose.y, goal.x - pose.x);
      score -=
        Math.min(
          Math.abs(angleDiff(heading, pose.angle)),
          Math.abs(angleDiff(heading + Math.PI, pose.angle)),
        ) * 12;
    }
    if (world.match.elapsed < this.recoveryUntil) score += progress * 1.5;
    score -= danger * (self.shield ? 0.45 : 1) + blocked * 2;
    score -=
      Math.abs(candidate.steer - desired.steer) * 1.2 +
      Math.abs(candidate.throttle - desired.throttle) * 1.8;
    return score;
  }
}
