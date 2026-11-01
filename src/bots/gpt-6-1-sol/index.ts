import { AbstractPlayer } from '../../players/abstract-player.ts';
import type { Decision, PlayerContext } from '../../players/types.ts';
import type { BotContext } from '../types.ts';
import type { Point, TankPose, Wall, WallCollision } from '../../types.ts';
import { muzzlePosition, sweepTank, sweepWall, tankWall, tanksOverlap } from '../../geometry.ts';

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const diff = (a: number, b: number) => ((((a - b + Math.PI * 3) % TAU) + TAU) % TAU) - Math.PI;
const distance = (a: Readonly<Point>, b: Readonly<Point>) => Math.hypot(a.x - b.x, a.y - b.y);

/** Segment versus a conservative local rectangle; allocation-free rollout broad geometry. */
function crossesBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  left: number,
  right: number,
  halfHeight: number,
): boolean {
  let enter = 0,
    exit = 1;
  const dx = bx - ax,
    dy = by - ay;
  if (Math.abs(dx) < 1e-9) {
    if (ax < left || ax > right) return false;
  } else {
    const a = (left - ax) / dx,
      b = (right - ax) / dx;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  if (Math.abs(dy) < 1e-9) {
    if (ay < -halfHeight || ay > halfHeight) return false;
  } else {
    const a = (-halfHeight - ay) / dy,
      b = (halfHeight - ay) / dy;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit;
}
type Enemy = BotContext['self'];
interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  start: number;
  end: number;
  owner: number;
  bounced: boolean;
  weight: number;
}
interface Aim {
  angle: number;
  quality: number;
  time: number;
}
interface Policy {
  angle: number;
  throttle: number;
  steer?: number;
  route?: boolean;
  offset?: number;
  free?: boolean;
}
interface Motion {
  steer: number;
  throttle: number;
  score: number;
}

/** Original, bounded-work receding-horizon controller; no platform APIs or shared mutable state. */
export class Gpt61SolBot extends AbstractPlayer {
  private route: number[] = [];
  private cursor = 0;
  private goal = -1;
  private target = -1;
  private lastProgress: Point = { x: -1000, y: -1000 };
  private progressAt = 0;
  private recoveryUntil = 0;
  private recoveryTurn = 1;
  private previousThrottle = 0;
  private previousSteer = 0;
  private walls: readonly Readonly<Wall>[] = [];
  private forecasts = new Map<number, TankPose[]>();

  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  override decide({ observe }: PlayerContext): Decision {
    const world = observe();
    const { self, match } = world;
    this.walls = world.map.walls;
    this.forecasts.clear();
    if (!world.enemies.length) {
      // The settling interval is not a ceasefire: surviving shells still count.
      const flights = this.threats(world);
      const motion = this.move(world, self, null, flights, true);
      return { segments: [{ ticks: 8, steer: motion.steer, throttle: motion.throttle }] };
    }
    const enemy = this.chooseTarget(world);
    const visible = world.lineOfSight(self, enemy);
    const aim = this.aim(world, enemy, visible);
    let goal: Readonly<Point> = enemy;
    let pickup = false;
    let pickupValue = Infinity;
    for (const power of world.powerups) {
      if (power.type === 'shield' && self.shield) continue;
      if (power.type !== 'shield' && (self.ammo < 3 || self.power)) continue;
      const path = world.findPath(world.cellAt(self.x, self.y), world.cellAt(power.x, power.y));
      const cost = (path.length - 1) * 64 + distance(self, power) * 0.25;
      const value = cost / (power.type === 'shield' ? 2.4 : 1);
      if (cost < power.life * this.profile.speed * 0.7 && value < pickupValue && value < 180) {
        pickupValue = value;
        goal = power;
        pickup = true;
      }
    }
    let waypoint: Readonly<Point>;
    if (!pickup && visible) {
      const d = distance(self, enemy);
      const angle = Math.atan2(enemy.y - self.y, enemy.x - self.x);
      // Keep space to react, but close before ammunition becomes scarce.
      const desiredRange = self.shield ? 85 : self.ammo < 2 ? 190 : 145;
      waypoint = {
        x: enemy.x - Math.cos(angle) * desiredRange,
        y: enemy.y - Math.sin(angle) * desiredRange,
      };
      if (d < 70) waypoint = { x: self.x - Math.cos(angle) * 80, y: self.y - Math.sin(angle) * 80 };
    } else {
      waypoint = this.waypoint(world, goal);
    }
    if (distance(self, this.lastProgress) > 12) {
      this.lastProgress = { x: self.x, y: self.y };
      this.progressAt = match.elapsed;
    } else if (match.elapsed - this.progressAt > 2.3 && (!visible || self.stuck > 0.35)) {
      this.recoveryUntil = match.elapsed + 0.55;
      this.recoveryTurn = world.random() < 0.5 ? -1 : 1;
      this.progressAt = match.elapsed;
      this.route = [];
    }
    const flights = this.threats(world);
    const urgent = flights.some((f) => f.start < 0.7 && distance(self, f) < 150);
    const bankWindow =
      aim !== null && aim.quality > 1.35 && Math.abs(diff(aim.angle, self.angle)) < 1.1;
    const motion = this.move(world, waypoint, aim, flights, !pickup && (visible || bankWindow));
    let ticks = urgent ? 6 : 10;
    // Reobserve just before the next eligible volley instead of losing a firing window
    // to a long movement plan. The engine still enforces the unchanged cooldown.
    if (aim && (self.ammo > 0 || match.elapsed >= 70) && self.cooldown > 1 / 120)
      ticks = Math.min(ticks, Math.max(1, Math.ceil(self.cooldown * 120) - 1));
    const fire = this.shouldFire(world, motion);
    this.previousSteer = motion.steer;
    this.previousThrottle = motion.throttle;
    return {
      segments: [
        { ticks, steer: motion.steer, throttle: motion.throttle, fire: fire ? 'once' : undefined },
      ],
    };
  }

  private chooseTarget(world: BotContext): Enemy {
    const from = world.cellAt(world.self.x, world.self.y);
    let best = world.enemies[0];
    let score = Infinity;
    for (const enemy of world.enemies) {
      const visible = world.lineOfSight(world.self, enemy);
      const cost =
        (visible
          ? distance(world.self, enemy) * 0.6
          : world.findPath(from, world.cellAt(enemy.x, enemy.y)).length * 64) +
        (enemy.shield ? 40 : 0) -
        (enemy.id === this.target ? 45 : 0);
      if (cost < score) {
        score = cost;
        best = enemy;
      }
    }
    this.target = best.id;
    return best;
  }

  private waypoint(world: BotContext, target: Readonly<Point>): Point {
    const { self, map } = world;
    const start = world.cellAt(self.x, self.y);
    const goal = world.cellAt(target.x, target.y);
    if (
      goal !== this.goal ||
      !this.route.length ||
      !this.route.slice(Math.max(0, this.cursor - 1), this.cursor + 2).includes(start)
    ) {
      this.route = world.findPath(start, goal);
      this.cursor = 0;
      this.goal = goal;
    }
    const center = (id: number) => ({
      x: (map.cells[id].x + 0.5) * 64,
      y: (map.cells[id].y + 0.5) * 64,
    });
    let next = center(this.route[this.cursor] ?? start);
    while (this.cursor < this.route.length - 1 && distance(self, next) < 9)
      next = center(this.route[++this.cursor]);
    // Skip a redundant center only when the *whole* corridor is clear, not just a center ray.
    if (this.cursor < this.route.length - 1) {
      const further = center(this.route[this.cursor + 1]);
      if (!this.wall(self.x, self.y, further.x - self.x, further.y - self.y, 23)) {
        next = further;
        this.cursor++;
      }
    }
    return this.cursor === this.route.length - 1 && distance(self, next) < 10
      ? { x: target.x, y: target.y }
      : next;
  }

  /** Broad-phase rejection avoids constructing exact capsule intersections for distant walls. */
  private wall(x: number, y: number, dx: number, dy: number, radius = 2.7): WallCollision | null {
    let best: WallCollision | null = null;
    const r = radius + 3;
    const x0 = Math.min(x, x + dx) - r,
      x1 = Math.max(x, x + dx) + r;
    const y0 = Math.min(y, y + dy) - r,
      y1 = Math.max(y, y + dy) + r;
    for (const wall of this.walls) {
      if (
        Math.max(wall.x1, wall.x2) < x0 ||
        Math.min(wall.x1, wall.x2) > x1 ||
        Math.max(wall.y1, wall.y2) < y0 ||
        Math.min(wall.y1, wall.y2) > y1
      )
        continue;
      const hit = sweepWall(x, y, dx, dy, wall, radius);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, wall };
    }
    return best;
  }

  private trace(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    owner: number,
    bounced: boolean,
    weight = 1,
    delay = 0,
    maxBounces = 7,
  ): Flight[] {
    const result: Flight[] = [];
    let time = delay;
    const end = delay + life;
    for (let i = 0; i <= maxBounces && time < end - 1e-5; i++) {
      const remaining = end - time;
      const hit = this.wall(x, y, vx * remaining, vy * remaining);
      const duration = remaining * (hit?.t ?? 1);
      result.push({ x, y, vx, vy, start: time, end: time + duration, owner, bounced, weight });
      if (!hit) break;
      time += duration;
      x += vx * duration + hit.nx * 0.025;
      y += vy * duration + hit.ny * 0.025;
      const normal = vx * hit.nx + vy * hit.ny;
      vx -= 2 * normal * hit.nx;
      vy -= 2 * normal * hit.ny;
      bounced = true;
    }
    return result;
  }

  private threats(world: BotContext): Flight[] {
    const result: Flight[] = [];
    const bullets = [...world.bullets].sort(
      (a, b) => distance(a, world.self) - distance(b, world.self),
    );
    for (const bullet of bullets.slice(0, 32)) {
      if (distance(bullet, world.self) > 350) continue;
      result.push(
        ...this.trace(
          bullet.x,
          bullet.y,
          bullet.vx,
          bullet.vy,
          Math.min(1.25, bullet.life),
          bullet.owner,
          bullet.bounces > 0,
        ),
      );
    }
    // Anticipate an eligible opponent's muzzle, not only projectiles already in flight.
    for (const enemy of world.enemies) {
      if (
        enemy.cooldown > 0.45 ||
        (enemy.ammo <= 0 && world.match.elapsed < 70) ||
        distance(enemy, world.self) > 260
      )
        continue;
      const muzzle = muzzlePosition(enemy);
      if (this.wall(enemy.x, enemy.y, muzzle.x - enemy.x, muzzle.y - enemy.y)) continue;
      result.push(
        ...this.trace(
          muzzle.x,
          muzzle.y,
          Math.cos(enemy.angle) * 140,
          Math.sin(enemy.angle) * 140,
          0.95,
          enemy.id,
          false,
          0.45,
          Math.max(0.08, enemy.cooldown),
          3,
        ),
      );
    }
    return result;
  }

  private predicted(enemy: Enemy, time: number, world: BotContext): TankPose {
    // Cache each bounded forecast once per observation; shot proposals share it.
    let forecast = this.forecasts.get(enemy.id);
    if (!forecast) {
      forecast = [];
      for (let i = 0; i <= 13; i++) {
        const t = Math.min(i * 0.1, 1.25);
        const dx = enemy.vx * t,
          dy = enemy.vy * t;
        const wall = this.wall(enemy.x, enemy.y, dx, dy, 19);
        const f = wall ? Math.max(0, wall.t - 0.015) : 1;
        forecast.push({
          x: clamp(enemy.x + dx * f, 19, world.map.width - 19),
          y: clamp(enemy.y + dy * f, 19, world.map.height - 19),
          angle: enemy.angle,
        });
      }
      this.forecasts.set(enemy.id, forecast);
    }
    const t = clamp(time * 10, 0, 13);
    const a = forecast[Math.floor(t)],
      b = forecast[Math.min(13, Math.ceil(t))];
    const f = t % 1;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: enemy.angle };
  }

  private aim(world: BotContext, enemy: Enemy, visible: boolean): Aim | null {
    const self = world.self;
    const candidates: number[] = [];
    const direct = Math.atan2(enemy.y - self.y, enemy.x - self.x);
    if (visible) {
      candidates.push(direct);
      for (const scale of [0.5, 1]) {
        let angle = direct;
        let time = Math.max(0, (distance(self, enemy) - 28) / 140);
        for (let i = 0; i < 3; i++) {
          const turn = Math.abs(diff(angle, self.angle)) / this.profile.turn;
          const point = this.predicted(enemy, (time + turn) * scale, world);
          angle = Math.atan2(point.y - self.y, point.x - self.x);
          time = Math.max(0, (distance(self, point) - 28) / 140);
        }
        candidates.push(angle);
      }
    }
    const directCount = candidates.length;
    // Reflect target proposals in nearby wall *surfaces*, including the shell radius.
    const walls = this.walls
      .map((wall) => {
        const center = { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
        return { wall, cost: distance(self, center) + distance(enemy, center) };
      })
      .sort((a, b) => a.cost - b.cost)
      .slice(0, visible ? 4 : 9)
      .map((entry) => entry.wall);
    for (const wall of walls) {
      const vertical = wall.x1 === wall.x2;
      const coordinate = vertical
        ? wall.x1 + Math.sign(self.x - wall.x1) * 5.7
        : wall.y1 + Math.sign(self.y - wall.y1) * 5.7;
      for (const lead of [0, 0.8]) {
        let point: Readonly<Point> = enemy;
        let angle = direct;
        for (let i = 0; i < 2; i++) {
          const reflected = vertical
            ? { x: 2 * coordinate - point.x, y: point.y }
            : { x: point.x, y: 2 * coordinate - point.y };
          angle = Math.atan2(reflected.y - self.y, reflected.x - self.x);
          const t =
            (distance(self, reflected) - 28) / 140 +
            Math.abs(diff(angle, self.angle)) / this.profile.turn;
          point = this.predicted(enemy, Math.max(0, t) * lead, world);
        }
        candidates.push(angle);
      }
    }
    let best: Aim | null = null;
    const checked = new Set<number>();
    for (const [index, angle] of candidates.entries()) {
      // Validate every direct lead, but spend bank-shot work only when direct fire is weak.
      if (index >= directCount && directCount > 0 && best && best.quality > 1.7) break;
      const key = Math.round(angle * 400);
      if (checked.has(key)) continue;
      checked.add(key);
      const turn = Math.abs(diff(angle, self.angle)) / this.profile.turn;
      const result = this.shot(world, self, angle, turn, angle, [enemy]);
      if (!result) continue;
      const quality = result.quality - turn * 0.35;
      if (!best || quality > best.quality) best = { ...result, quality, angle };
    }
    return best;
  }

  /** Check swept relative motion, using the same silhouettes and rounded caps as the engine. */
  private shot(
    world: BotContext,
    pose: TankPose,
    angle: number,
    delay = 0,
    muzzleAngle = angle,
    enemies = world.enemies,
  ): Aim | null {
    const muzzle = muzzlePosition(pose, muzzleAngle);
    if (this.wall(pose.x, pose.y, muzzle.x - pose.x, muzzle.y - pose.y)) return null;
    const path = this.trace(
      muzzle.x,
      muzzle.y,
      Math.cos(angle) * 140,
      Math.sin(angle) * 140,
      3.4,
      world.self.id,
      false,
      1,
      0,
      4,
    );
    let best: Aim | null = null;
    let selfHit = Infinity;
    for (const segment of path) {
      if (segment.start > Math.min(best?.time ?? Infinity, selfHit)) break;
      if (segment.bounced) {
        const own = {
          x: pose.x + world.self.vx * Math.min(segment.start, 0.4),
          y: pose.y + world.self.vy * Math.min(segment.start, 0.4),
          angle: pose.angle,
        };
        const t = sweepTank(
          segment.x,
          segment.y,
          segment.vx * (segment.end - segment.start),
          segment.vy * (segment.end - segment.start),
          own,
        );
        if (t !== null)
          selfHit = Math.min(selfHit, segment.start + t * (segment.end - segment.start));
      }
      for (const enemy of enemies) {
        for (let start = segment.start; start < segment.end - 1e-5; start += 0.16) {
          const end = Math.min(segment.end, start + 0.16);
          const a = this.predicted(enemy, start + delay, world);
          const b = this.predicted(enemy, end + delay, world);
          const x = segment.x + segment.vx * (start - segment.start);
          const y = segment.y + segment.vy * (start - segment.start);
          // Most segment/target pairs cannot possibly intersect the 26px bound.
          const dx = segment.vx * (end - start) - (b.x - a.x);
          const dy = segment.vy * (end - start) - (b.y - a.y);
          const u = clamp(((a.x - x) * dx + (a.y - y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          if (Math.hypot(x + u * dx - a.x, y + u * dy - a.y) > 29) continue;
          const hit = sweepTank(x, y, dx, dy, a);
          if (hit === null) continue;
          const time = start + hit * (end - start);
          const moving = Math.hypot(enemy.vx, enemy.vy) > 20;
          const quality =
            2.4 -
            time * (moving ? 0.55 : 0.24) -
            (segment.bounced ? 0.18 : 0) -
            (enemy.shield ? 0.12 : 0);
          if (!best || time < best.time) best = { angle, time, quality };
          break;
        }
      }
    }
    return best && best.time < selfHit && best.quality > 0.35 ? best : null;
  }

  private canPlace(pose: TankPose, walls: readonly Readonly<Wall>[], world: BotContext): boolean {
    const c = Math.cos(pose.angle),
      s = Math.sin(pose.angle);
    for (const wall of walls) {
      const nearX = clamp(pose.x, Math.min(wall.x1, wall.x2), Math.max(wall.x1, wall.x2));
      const nearY = clamp(pose.y, Math.min(wall.y1, wall.y2), Math.max(wall.y1, wall.y2));
      if ((nearX - pose.x) ** 2 + (nearY - pose.y) ** 2 > 30 ** 2) continue;
      const x1 = wall.x1 - pose.x,
        y1 = wall.y1 - pose.y;
      const x2 = wall.x2 - pose.x,
        y2 = wall.y2 - pose.y;
      const ax = x1 * c + y1 * s,
        ay = -x1 * s + y1 * c;
      const bx = x2 * c + y2 * s,
        by = -x2 * s + y2 * c;
      // Enclose tracks/hull and barrel separately, expanded by the wall capsule.
      if (
        (crossesBox(ax, ay, bx, by, -19, 18, 17) || crossesBox(ax, ay, bx, by, -3, 28, 6)) &&
        tankWall(pose, wall)
      )
        return false;
    }
    return !world.enemies.some((enemy) => tanksOverlap(pose, enemy));
  }

  private move(
    world: BotContext,
    waypoint: Readonly<Point>,
    aim: Aim | null,
    flights: Flight[],
    combat: boolean,
  ): Motion {
    const { self } = world;
    const nav = Math.atan2(waypoint.y - self.y, waypoint.x - self.x);
    const primary = combat && aim ? aim.angle : nav;
    const policies: Policy[] = [];
    const danger = flights.some((f) => f.start < 0.8 && distance(self, f) < 170);
    const directions: Omit<Policy, 'throttle'>[] = [
      { angle: primary, route: !combat },
      { angle: nav, route: true },
      { angle: self.angle, free: danger },
      { angle: self.angle + Math.PI / 2, free: danger },
      { angle: self.angle - Math.PI / 2, free: danger },
      { angle: nav + 0.65, route: true, offset: 0.65 },
      { angle: nav - 0.65, route: true, offset: -0.65 },
    ];
    // Spend the extra lateral search only when a nearby trajectory warrants it.
    for (const policy of danger ? directions : directions.slice(0, 2))
      policies.push({ ...policy, throttle: 1 }, { ...policy, throttle: -1 });
    policies.push({ angle: primary, throttle: 0 });
    if (this.recoveryUntil > world.match.elapsed)
      policies.unshift({ angle: self.angle, throttle: -1, steer: this.recoveryTurn, free: true });
    const nearby = this.walls.filter(
      (w) =>
        Math.max(w.x1, w.x2) > self.x - 150 &&
        Math.min(w.x1, w.x2) < self.x + 150 &&
        Math.max(w.y1, w.y2) > self.y - 150 &&
        Math.min(w.y1, w.y2) < self.y + 150,
    );
    let best: Motion = { steer: 0, throttle: 0, score: -Infinity };
    const step = 1 / 15;
    const startDistance = distance(self, waypoint);
    for (const policy of policies) {
      const pose: TankPose = { x: self.x, y: self.y, angle: self.angle };
      let score = 0,
        firstSteer = 0,
        firstThrottle = 0,
        risk = 0;
      for (let i = 0; i < 15; i++) {
        const time = i * step;
        const old = { ...pose };
        const travelHeading = policy.route
          ? Math.atan2(waypoint.y - pose.y, waypoint.x - pose.x) + (policy.offset ?? 0)
          : policy.angle;
        const heading =
          travelHeading + (policy.throttle < 0 && !combat && !policy.free ? Math.PI : 0);
        const steer =
          policy.steer ?? clamp(diff(heading, pose.angle) / (this.profile.turn * 0.1), -1, 1);
        const error = Math.abs(diff(heading, pose.angle));
        let throttle = policy.throttle;
        if (!combat && !policy.free && error > 0.55) throttle *= 0.1;
        if (policy.route && !policy.free)
          throttle *= clamp((distance(pose, waypoint) - 3) / 18, 0, 1);
        if (i === 0) {
          firstSteer = steer;
          firstThrottle = throttle;
        }
        // Conservative coarse rollout; the engine alone performs contact pivots.
        const rotated = { ...pose, angle: pose.angle + steer * this.profile.turn * step };
        if (this.canPlace(rotated, nearby, world)) pose.angle = rotated.angle;
        else score -= 0.035;
        const dx = Math.cos(pose.angle) * throttle * this.profile.speed * step;
        const dy = Math.sin(pose.angle) * throttle * this.profile.speed * step;
        const moved = { ...pose, x: pose.x + dx, y: pose.y + dy };
        if (this.canPlace(moved, nearby, world)) {
          pose.x = moved.x;
          pose.y = moved.y;
        } else {
          if (this.canPlace({ ...pose, x: pose.x + dx }, nearby, world)) pose.x += dx;
          if (this.canPlace({ ...pose, y: pose.y + dy }, nearby, world)) pose.y += dy;
          score -= 0.1;
        }
        const discount = 1 - time * 0.55;
        for (const f of flights) {
          if (f.end < time || f.start > time + step || (f.owner === self.id && !f.bounced))
            continue;
          const begin = Math.max(time, f.start),
            end = Math.min(time + step, f.end);
          const x = f.x + f.vx * (begin - f.start),
            y = f.y + f.vy * (begin - f.start);
          const a = (begin - time) / step;
          const tank = {
            x: old.x + (pose.x - old.x) * a,
            y: old.y + (pose.y - old.y) * a,
            angle: (old.angle + pose.angle) / 2,
          };
          const dx = (f.vx - (pose.x - old.x) / step) * (end - begin);
          const dy = (f.vy - (pose.y - old.y) / step) * (end - begin);
          const u = clamp(((tank.x - x) * dx + (tank.y - y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          const miss = Math.hypot(x + dx * u - tank.x, y + dy * u - tank.y);
          if (miss > 44) continue;
          const hit = miss < 29 && sweepTank(x, y, dx, dy, tank, 4) !== null;
          risk += f.weight * discount * (hit ? 85 : Math.max(0, 36 - miss) * 0.08);
        }
        if (aim) score -= Math.abs(diff(aim.angle, pose.angle)) * (combat ? 0.8 : 0.067) * discount;
        if (!combat) score += (startDistance - distance(pose, waypoint)) * 0.004 * discount;
      }
      score += (startDistance - distance(pose, waypoint)) * (combat ? 0.025 : 0.075);
      score -= risk * (self.shield ? 0.6 : 1);
      score -=
        Math.abs(firstSteer - this.previousSteer) * 0.03 +
        Math.abs(firstThrottle - this.previousThrottle) * 0.06;
      if (this.recoveryUntil > world.match.elapsed && policy.steer) score += 5;
      if (score > best.score) best = { steer: firstSteer, throttle: firstThrottle, score };
    }
    return best;
  }

  private shouldFire(world: BotContext, motion: Motion): boolean {
    const { self } = world;
    if (self.cooldown > 1 / 120 || (self.ammo <= 0 && world.match.elapsed < 70)) return false;
    const angle = self.angle + (motion.steer * this.profile.turn) / 120;
    const pose = {
      x: self.x + (Math.cos(angle) * motion.throttle * this.profile.speed) / 120,
      y: self.y + (Math.sin(angle) * motion.throttle * this.profile.speed) / 120,
      angle,
    };
    // Scatter starts at the left shell when reserves cannot supply a complete volley.
    const offsets =
      self.power === 'scatter'
        ? [-0.17, 0, 0.17].slice(0, world.match.elapsed >= 70 ? 3 : self.ammo)
        : [0];
    let best = 0;
    for (const offset of offsets) {
      const hit = this.shot(world, pose, angle + offset, 0, angle);
      if (hit) best = Math.max(best, hit.quality);
      const unsafe = world.predictShot(angle + offset, 2);
      if (unsafe?.id === self.id && unsafe.distance < 180) return false;
    }
    return best > (self.ammo < 3 && world.match.elapsed < 70 ? 1.45 : 0.8);
  }
}
