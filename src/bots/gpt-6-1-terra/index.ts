import { muzzlePosition, sweepTank, tankWall } from '../../geometry.ts';
import { angleDiff, clamp, distance } from '../../math.ts';
import { firstWall } from '../../queries.ts';
import { AbstractPlayer } from '../../players/abstract-player.ts';
import type { Decision, PlayerContext, PlayerDecision } from '../../players/types.ts';
import type { BotContext } from '../types.ts';
import { MazeNavigator } from '../builtin/navigation.ts';

/** A compact, receding-horizon controller. One instance is used for one round. */
export class TerraBot extends AbstractPlayer {
  private readonly navigator = new MazeNavigator();

  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  override decide({ observe }: PlayerContext): Decision {
    const world = observe();
    const { self, rules } = world;
    if (!world.enemies.length) return { segments: [{ ticks: 12 }] };
    const enemies = [...world.enemies].sort((a, b) => distance(self, a) - distance(self, b));
    const visible = enemies.find((enemy) => world.lineOfSight(self, enemy));
    const target = visible ?? enemies[0];
    let desired: number;
    let throttle: number;
    if (visible) {
      // Approximate the travel time from the muzzle to the moving target.
      // Bound the forecast because targets can turn or hit a wall.
      let lead = 0;
      for (let i = 0; i < 3; i++) {
        lead = clamp(
          (Math.hypot(target.x + target.vx * lead - self.x, target.y + target.vy * lead - self.y) -
            28) /
            rules.shellSpeed,
          0,
          1.5,
        );
      }
      const intercept = { x: target.x + target.vx * lead, y: target.y + target.vy * lead };
      const aim = world.lineOfSight(self, intercept) ? intercept : target;
      desired = Math.atan2(aim.y - self.y, aim.x - self.x);
      const range = distance(self, target);
      throttle = range > 125 ? 0.85 : range < 65 ? -0.55 : 0.2;
    } else {
      const waypoint = this.navigator.waypoint(world, target);
      desired = Math.atan2(waypoint.y - self.y, waypoint.x - self.x);
      throttle = Math.min(1, distance(self, waypoint) / (this.profile.speed * 0.12));
    }
    const difference = angleDiff(desired, self.angle);
    let steer = clamp(difference / (this.profile.turn * 0.1), -1, 1);
    if (Math.abs(difference) > (visible ? 0.7 : 0.35)) throttle = 0;
    if (self.stuck > 0.7) {
      throttle = -0.65;
      steer = 1;
    }
    const dodge = this.avoid(world, { steer, throttle });
    if (dodge) ({ steer = 0, throttle = 0 } = dodge);

    // A shot query is for the current heading, not the heading after turning.
    // While turning, attempt only on the first tick instead of firing at an untested angle.
    const canFire =
      self.ammo > 0 || world.match.elapsed >= rules.roundDuration - rules.infiniteAmmoDuration;
    const hit = canFire ? world.predictShot(self.angle, 1) : null;
    const movingHit = canFire && visible && this.directMovingHit(world, visible);
    const fire =
      hit?.id !== self.id &&
      (movingHit ||
        (hit && hit.distance < 900 && (!visible || Math.hypot(visible.vx, visible.vy) < 10)));
    return {
      segments: [
        {
          ticks: 12,
          steer,
          throttle,
          fire: fire ? (Math.abs(steer) < 0.15 ? 'held' : 'once') : undefined,
        },
      ],
    };
  }

  /** Test a direct shot against the target's constant-velocity motion and current walls. */
  private directMovingHit(world: BotContext, target: BotContext['enemies'][number]): boolean {
    const { self, map, rules } = world;
    const muzzle = muzzlePosition(self);
    if (firstWall(map, self.x, self.y, muzzle.x - self.x, muzzle.y - self.y)) return false;
    const horizon = 1.5;
    const dx = Math.cos(self.angle) * rules.shellSpeed * horizon;
    const dy = Math.sin(self.angle) * rules.shellSpeed * horizon;
    const hit = sweepTank(
      muzzle.x,
      muzzle.y,
      dx - target.vx * horizon,
      dy - target.vy * horizon,
      target,
    );
    if (hit === null) return false;
    const wall = firstWall(map, muzzle.x, muzzle.y, dx * hit, dy * hit);
    if (wall) return false;
    // Another tank can intercept the shot, so do not treat it as a clear target.
    for (const other of world.enemies) {
      if (other.id === target.id) continue;
      const otherHit = sweepTank(
        muzzle.x,
        muzzle.y,
        dx - other.vx * horizon,
        dy - other.vy * horizon,
        other,
      );
      if (otherHit !== null && otherHit < hit) return false;
    }
    return true;
  }

  /** Compare a small set of feasible motions against near-term projectile trajectories. */
  private avoid(world: BotContext, preferred: PlayerDecision): PlayerDecision | null {
    const { self, map } = world;
    // Trace one bounce, including our own shells after their first wall contact.
    const bullets = world.bullets
      .filter((b) => distance(b, self) < 245)
      .slice(0, 12)
      .map((b) => {
        let end = Math.min(b.life, 1.1);
        const wall = firstWall(map, b.x, b.y, b.vx * end, b.vy * end);
        const bounceAt = wall ? wall.t * end : end;
        const normal = wall ? b.vx * wall.nx + b.vy * wall.ny : 0;
        const vx = wall ? b.vx - 2 * normal * wall.nx : b.vx;
        const vy = wall ? b.vy - 2 * normal * wall.ny : b.vy;
        if (wall) {
          const remaining = end - bounceAt;
          const secondWall = firstWall(
            map,
            b.x + b.vx * bounceAt + wall.nx * 0.03,
            b.y + b.vy * bounceAt + wall.ny * 0.03,
            vx * remaining,
            vy * remaining,
          );
          if (secondWall) end = bounceAt + secondWall.t * remaining;
        }
        return {
          b,
          end,
          bounceAt,
          vx,
          vy,
          bounced: !!wall,
        };
      });
    if (!bullets.length) return null;
    const walls = map.walls.filter(
      (w) =>
        Math.max(w.x1, w.x2) >= self.x - 150 &&
        Math.min(w.x1, w.x2) <= self.x + 150 &&
        Math.max(w.y1, w.y2) >= self.y - 150 &&
        Math.min(w.y1, w.y2) <= self.y + 150,
    );
    const options: PlayerDecision[] = [preferred];
    for (const turn of [-1, 0, 1])
      for (const drive of [-1, 0, 1]) options.push({ steer: turn, throttle: drive });
    const score = (control: PlayerDecision): number => {
      let x = self.x,
        y = self.y,
        angle = self.angle;
      let penalty = 0;
      const turn = control.steer ?? 0,
        drive = control.throttle ?? 0;
      for (let step = 1; step <= 8; step++) {
        const dt = 0.1;
        angle += turn * this.profile.turn * dt;
        const next = {
          x: x + Math.cos(angle) * drive * this.profile.speed * dt,
          y: y + Math.sin(angle) * drive * this.profile.speed * dt,
          angle,
        };
        if (walls.some((wall) => tankWall(next, wall))) {
          penalty += 12;
        } else {
          x = next.x;
          y = next.y;
        }
        const t = step * dt;
        for (const { b, end, bounceAt, vx, vy, bounced } of bullets) {
          if (t > end + 0.05) continue;
          if (b.owner === self.id && b.bounces === 0 && (!bounced || t < bounceAt)) continue;
          const after = Math.max(0, t - bounceAt);
          const d = Math.hypot(
            b.x + b.vx * Math.min(t, bounceAt) + vx * after - x,
            b.y + b.vy * Math.min(t, bounceAt) + vy * after - y,
          );
          if (d < 45) penalty += (45 - d) ** 2 / 20;
        }
      }
      return penalty;
    };
    const base = score(preferred);
    if (base < 25) return null;
    let best = preferred,
      bestScore = base;
    for (const option of options.slice(1)) {
      const value = score(option) + 12;
      if (value < bestScore) {
        best = option;
        bestScore = value;
      }
    }
    return best === preferred ? null : best;
  }
}
