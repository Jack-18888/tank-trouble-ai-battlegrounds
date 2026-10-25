import { angleDiff, clamp, distance } from '../math.ts';
import type { BotContext, BotDecision, BotProfile } from './types.ts';
import { MazeNavigator } from './navigation.ts';

// Each controller owns its strategy and route memory; custom Bot subclasses
// can compose this strategy or provide their own decision implementation.
export class CombatStrategy {
  private readonly navigator = new MazeNavigator();

  constructor(
    private readonly profile: Readonly<BotProfile>,
    private readonly options: { dodge?: boolean; bank?: boolean } = {},
  ) {}

  decide(context: BotContext): BotDecision {
    const { self: tank, rules } = context;
    const { profile } = this;
    const { dodge = false, bank = false } = this.options;
    const enemies = [...context.enemies].sort((a, b) => distance(a, tank) - distance(b, tank));
    if (!enemies.length) return { steer: 0, throttle: 0, fire: false };
    const visible = enemies.find((target) => context.lineOfSight(tank, target));
    const target = visible || enemies[0];
    let desired: number, throttle: number;
    if (visible) {
      const lead = bank ? Math.min(0.22, distance(tank, target) / rules.shellSpeed) : 0;
      const predicted = { x: target.x + target.vx * lead, y: target.y + target.vy * lead };
      desired = Math.atan2(predicted.y - tank.y, predicted.x - tank.x);
      throttle = distance(tank, target) > 125 ? 0.85 : distance(tank, target) < 65 ? -0.55 : 0.2;
    } else {
      const next = this.navigator.waypoint(context, target);
      desired = Math.atan2(next.y - tank.y, next.x - tank.x);
      // Controls remain active until the next decision. Brake near a waypoint
      // so smoother wall turns do not make the tank overshoot and orbit it.
      const waypointDistance = distance(next, tank);
      throttle = Math.min(1, waypointDistance / (profile.speed * profile.reaction * 1.15));
    }
    let difference = angleDiff(desired, tank.angle);
    // Bank shots are opportunistic while following the route. Randomly replacing
    // the travel heading with a new firing angle each decision caused circling.
    if (dodge) {
      let danger: BotContext['bullets'][number] | null = null,
        minThreat = 65;
      for (const bullet of context.bullets) {
        if (bullet.owner === tank.id && bullet.bounces === 0) continue;
        const time = clamp(
          ((tank.x - bullet.x) * bullet.vx + (tank.y - bullet.y) * bullet.vy) /
            rules.shellSpeed ** 2,
          0,
          bank ? 0.65 : 0.38,
        );
        const miss = Math.hypot(
          bullet.x + bullet.vx * time - tank.x,
          bullet.y + bullet.vy * time - tank.y,
        );
        if (miss < 27 && distance(bullet, tank) < 200 && miss < minThreat) {
          danger = bullet;
          minThreat = miss;
        }
      }
      if (danger) {
        const projection = (tank.x - danger.x) * -danger.vy + (tank.y - danger.y) * danger.vx;
        const dodgeAngle =
          Math.atan2(danger.vy, danger.vx) + (projection >= 0 ? Math.PI / 2 : -Math.PI / 2);
        if (bank || !visible) {
          difference = angleDiff(dodgeAngle, tank.angle);
          throttle = 1;
        }
      }
    }
    let steer =
      Math.abs(difference) < 0.025
        ? 0
        : clamp(difference / (profile.turn * profile.reaction * 1.15), -1, 1);
    throttle = Math.abs(difference) > (visible ? 0.7 : 0.35) ? 0 : throttle;
    if (tank.stuck > 0.7) {
      throttle = -0.65;
      steer = 1;
    }
    const hit = context.predictShot(tank.angle, bank ? 1 : 0);
    return {
      steer,
      throttle,
      fire: Boolean(hit && hit.id !== tank.id && hit.distance < (bank ? 900 : 650)),
    };
  }
}
