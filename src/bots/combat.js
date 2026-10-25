import { angleDiff, clamp, distance } from '../math.js';

// Shared existing strategy. Subclasses can reuse this, compose it with another
// behavior, or implement decide() independently using the same observation API.
export function decideCombat(context, profile, { dodge = false, bank = false } = {}) {
  const { self: tank, map, rules } = context;
  const enemies = [...context.enemies].sort((a, b) => distance(a, tank) - distance(b, tank));
  if (!enemies.length) return { steer: 0, throttle: 0, fire: false };
  const visible = enemies.find((target) => context.lineOfSight(tank, target));
  const target = visible || enemies[0];
  let desired,
    throttle = 1;
  if (visible) {
    const lead = bank ? Math.min(0.22, distance(tank, target) / rules.shellSpeed) : 0;
    const predicted = { x: target.x + target.vx * lead, y: target.y + target.vy * lead };
    desired = Math.atan2(predicted.y - tank.y, predicted.x - tank.x);
    throttle = distance(tank, target) > 125 ? 0.85 : distance(tank, target) < 65 ? -0.55 : 0.2;
  } else {
    const from = context.cellAt(tank.x, tank.y),
      to = context.cellAt(target.x, target.y);
    const path = context.findPath(from, to);
    let next = map.cells[path[1] ?? from];
    const current = map.cells[from];
    const cx = (current.x + 0.5) * rules.cellSize,
      cy = (current.y + 0.5) * rules.cellSize;
    if (
      (next.x !== current.x && Math.abs(tank.y - cy) > 4) ||
      (next.y !== current.y && Math.abs(tank.x - cx) > 4)
    )
      next = current;
    desired = Math.atan2(
      (next.y + 0.5) * rules.cellSize - tank.y,
      (next.x + 0.5) * rules.cellSize - tank.x,
    );
  }
  let difference = angleDiff(desired, tank.angle);
  if (bank && !visible && tank.cooldown <= 0 && context.random() < 0.65) {
    for (let i = 0; i < 13; i++) {
      const candidate = tank.angle + (i - 6) * 0.19;
      const hit = context.predictShot(candidate, 1);
      if (hit && hit.id !== tank.id && hit.distance < 750) {
        desired = candidate;
        difference = angleDiff(desired, tank.angle);
        throttle = 0.1;
        break;
      }
    }
  }
  if (dodge) {
    let danger = null,
      minThreat = 65;
    for (const bullet of context.bullets) {
      if (bullet.owner === tank.id && bullet.bounces === 0) continue;
      const time = clamp(
        ((tank.x - bullet.x) * bullet.vx + (tank.y - bullet.y) * bullet.vy) / rules.shellSpeed ** 2,
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
    Math.abs(difference) < 0.045 ? 0 : clamp(difference / (profile.turn * profile.reaction), -1, 1);
  throttle = Math.abs(difference) > 1 ? 0 : throttle;
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
