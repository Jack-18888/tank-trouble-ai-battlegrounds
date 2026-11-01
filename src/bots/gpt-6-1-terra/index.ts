import { tankWall } from '../../geometry.ts';
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
      const lead = Math.min(0.22, distance(self, target) / rules.shellSpeed);
      desired = Math.atan2(
        target.y + target.vy * lead - self.y,
        target.x + target.vx * lead - self.x,
      );
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
    const hit =
      self.ammo > 0 || world.match.elapsed >= rules.roundDuration - rules.infiniteAmmoDuration
        ? world.predictShot(self.angle, 1)
        : null;
    const fire = hit && hit.id !== self.id && hit.distance < 900;
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

  /** Compare a small set of feasible motions against near-term projectile trajectories. */
  private avoid(world: BotContext, preferred: PlayerDecision): PlayerDecision | null {
    const { self, map } = world;
    const threats = world.bullets
      .filter((b) => {
        if (b.owner === self.id && b.bounces === 0) return false;
        if (distance(b, self) > 210) return false;
        const t = clamp(
          ((self.x - b.x) * b.vx + (self.y - b.y) * b.vy) / (b.vx ** 2 + b.vy ** 2 || 1),
          0,
          1.1,
        );
        return Math.hypot(b.x + b.vx * t - self.x, b.y + b.vy * t - self.y) < 100;
      })
      .slice(0, 12);
    if (!threats.length) return null;

    // Stop a straight-line prediction at its first wall: do not dodge phantom shells
    // passing through walls. The next observation will see any actual bounce.
    const bullets = threats.map((b) => {
      const wall = firstWall(map, b.x, b.y, b.vx * 1.1, b.vy * 1.1);
      return { b, end: Math.min(b.life, wall ? wall.t * 1.1 : 1.1) };
    });
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
        for (const { b, end } of bullets) {
          if (t > end + 0.05) continue;
          const d = Math.hypot(b.x + b.vx * t - x, b.y + b.vy * t - y);
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
