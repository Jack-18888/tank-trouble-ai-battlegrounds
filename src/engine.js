// Pure simulation: no DOM, canvas, audio, or frame-rate dependent movement.
import {
  tankWall,
  tanksOverlap,
  sweepWall,
  sweepTank,
  muzzlePosition,
  SHELL_RADIUS,
} from './geometry.js';
export const CELL = 64;
export const PLAYER_SPEED = 114;
export const SHELL_SPEED = 140;
export const SHELL_LIFETIME = 7.5;
export const COLORS = ['#376b48', '#d17a4d', '#b39b40', '#5e889e', '#9680ad', '#bd6877'];
export const NAMES = ['You', 'Rusty', 'Brass', 'Cobalt', 'Violet', 'Blush'];
export const LEVELS = {
  easy: {
    speed: 78,
    turn: 2.4,
    reaction: 0.55,
    error: 0.16,
    cooldown: 1.15,
    dodge: false,
    bank: false,
  },
  medium: {
    speed: 96,
    turn: 3.15,
    reaction: 0.24,
    error: 0.045,
    cooldown: 0.72,
    dodge: true,
    bank: false,
  },
  hard: {
    speed: 108,
    turn: 3.9,
    reaction: 0.11,
    error: 0.012,
    cooldown: 0.46,
    dodge: true,
    bank: true,
  },
};
export const DEFAULT_CONFIG = {
  opponents: 2,
  difficulties: ['medium', 'medium'],
  size: 'classic',
  density: 'balanced',
  target: 5,
  powerups: true,
};
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function randomGenerator(seed) {
  let value = 2166136261;
  for (const c of String(seed)) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(size = 'classic', density = 'balanced', seed = String(Date.now())) {
  seed = String(seed).toUpperCase();
  const [cols, rows] = { compact: [10, 7], classic: [12, 8], large: [15, 10] }[size] || [12, 8];
  const rng = randomGenerator(seed);
  const cells = Array.from({ length: cols * rows }, (_, id) => ({
    id,
    x: id % cols,
    y: Math.floor(id / cols),
    walls: [true, true, true, true],
  }));
  const around = (cell) =>
    [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]
      .map(([dx, dy], d) => ({ d, cell: cells[(cell.y + dy) * cols + cell.x + dx] }))
      .filter(({ cell: c }) => c && Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) === 1);
  const visited = new Set([0]);
  const stack = [cells[0]];
  while (stack.length) {
    const current = stack.at(-1);
    const options = around(current).filter((o) => !visited.has(o.cell.id));
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[Math.floor(rng() * options.length)];
    current.walls[next.d] = false;
    next.cell.walls[(next.d + 2) % 4] = false;
    visited.add(next.cell.id);
    stack.push(next.cell);
  }
  const openness = { open: 0.65, balanced: 0.3, dense: 0.08 }[density] ?? 0.3;
  for (const cell of cells) {
    for (const { d, cell: next } of around(cell)) {
      if ((d === 1 || d === 2) && cell.walls[d] && rng() < openness) {
        cell.walls[d] = false;
        next.walls[(d + 2) % 4] = false;
      }
    }
  }
  const walls = [];
  const add = (x1, y1, x2, y2, border = false) =>
    walls.push({
      x1,
      y1,
      x2,
      y2,
      x: Math.min(x1, x2) - 3,
      y: Math.min(y1, y2) - 3,
      w: Math.abs(x2 - x1) + 6,
      h: Math.abs(y2 - y1) + 6,
      border,
    });
  for (const c of cells) {
    if (c.walls[0]) add(c.x * CELL, c.y * CELL, (c.x + 1) * CELL, c.y * CELL, c.y === 0);
    if (c.walls[3]) add(c.x * CELL, c.y * CELL, c.x * CELL, (c.y + 1) * CELL, c.x === 0);
    if (c.x === cols - 1) add(cols * CELL, c.y * CELL, cols * CELL, (c.y + 1) * CELL, true);
    if (c.y === rows - 1) add(c.x * CELL, rows * CELL, (c.x + 1) * CELL, rows * CELL, true);
  }
  return {
    cols,
    rows,
    width: cols * CELL,
    height: rows * CELL,
    cells,
    walls,
    seed: String(seed).toUpperCase(),
  };
}

export function cellAt(map, x, y) {
  return (
    clamp(Math.floor(y / CELL), 0, map.rows - 1) * map.cols +
    clamp(Math.floor(x / CELL), 0, map.cols - 1)
  );
}
export function neighbors(map, id) {
  const c = map.cells[id];
  return [id - map.cols, id + 1, id + map.cols, id - 1].filter(
    (next, i) => !c.walls[i] && next >= 0 && next < map.cells.length,
  );
}
export function findPath(map, start, end) {
  if (start === end) return [start];
  const previous = new Int32Array(map.cells.length).fill(-1);
  previous[start] = start;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors(map, queue[i])) {
      if (previous[next] !== -1) continue;
      previous[next] = queue[i];
      if (next === end) {
        const path = [end];
        while (path.at(-1) !== start) path.push(previous[path.at(-1)]);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

export function firstWall(map, x, y, dx, dy, radius = SHELL_RADIUS) {
  let result = null;
  for (const wall of map.walls) {
    const hit = sweepWall(x, y, dx, dy, wall, radius);
    if (hit && (!result || hit.t < result.t)) result = { ...hit, wall };
  }
  return result;
}

export class Game {
  constructor(config = DEFAULT_CONFIG, seed) {
    this.events = [];
    this.config = this.validateConfig(config);
    this.rng = randomGenerator(seed ?? Date.now());
    this.scores = Array(this.config.opponents + 1).fill(0);
    this.round = 0;
    this.state = 'ready';
    this.particles = [];
    this.tracks = [];
    this.shake = 0;
    this.prepareRound(seed);
  }
  validateConfig(config) {
    const c = { ...DEFAULT_CONFIG, ...config };
    c.opponents = clamp(Math.round(Number(c.opponents) || 1), 1, 5);
    c.difficulties = Array.from({ length: c.opponents }, (_, i) =>
      LEVELS[c.difficulties?.[i]] ? c.difficulties[i] : 'medium',
    );
    c.target = [0, 3, 5, 10].includes(Number(c.target)) ? Number(c.target) : 5;
    c.size = ['compact', 'classic', 'large'].includes(c.size) ? c.size : 'classic';
    c.density = ['open', 'balanced', 'dense'].includes(c.density) ? c.density : 'balanced';
    c.powerups = Boolean(c.powerups);
    return c;
  }
  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
  seed() {
    return Math.floor(this.rng() * 2176782336)
      .toString(36)
      .padStart(6, '0')
      .toUpperCase();
  }
  prepareRound(seed) {
    this.map = generateMap(this.config.size, this.config.density, seed ?? this.seed());
    this.bullets = [];
    this.powerups = [];
    this.particles = [];
    this.tracks = [];
    this.elapsed = 0;
    this.powerTimer = 5;
    this.settleTimer = null;
    this.shake = 0;
    const spawnCells = [];
    const first = Math.floor(this.rng() * this.map.cells.length);
    spawnCells.push(first);
    while (spawnCells.length < this.config.opponents + 1) {
      let best = -1,
        score = -1;
      for (let id = 0; id < this.map.cells.length; id++) {
        if (spawnCells.includes(id)) continue;
        const cell = this.map.cells[id];
        const separation = Math.min(
          ...spawnCells.map((s) => {
            const c = this.map.cells[s];
            return Math.hypot(cell.x - c.x, cell.y - c.y);
          }),
        );
        const value = separation + this.rng() * 0.4;
        if (value > score) {
          best = id;
          score = value;
        }
      }
      spawnCells.push(best);
    }
    this.tanks = spawnCells.map((id, i) => {
      const c = this.map.cells[id];
      return {
        id: i,
        name: NAMES[i],
        color: COLORS[i],
        x: (c.x + 0.5) * CELL,
        y: (c.y + 0.5) * CELL,
        angle: -Math.PI / 2 + this.rng() * Math.PI * 2,
        alive: true,
        cooldown: 0.4,
        shield: false,
        power: null,
        powerTime: 0,
        vx: 0,
        vy: 0,
        tread: 0,
        think: this.rng() * 0.4,
        steer: 0,
        throttle: 0,
        fire: false,
        stuck: 0,
        previousX: 0,
        previousY: 0,
        kills: 0,
        difficulty: i ? this.config.difficulties[i - 1] : null,
      };
    });
    this.emit('map');
  }
  start() {
    if (this.state !== 'ready') this.prepareRound();
    this.scores.fill(0);
    this.round = 1;
    this.beginCountdown();
    this.emit('score');
  }
  beginCountdown() {
    this.state = 'countdown';
    this.timer = 2.4;
    this.lastCount = -1;
    this.emit('state');
  }
  pause() {
    if (this.state === 'paused') {
      this.state = this.resumeState;
      this.emit('state');
      return;
    }
    if (['playing', 'countdown', 'roundOver'].includes(this.state)) {
      this.resumeState = this.state;
      this.state = 'paused';
      this.emit('state');
    }
  }
  update(dt, input = {}) {
    dt = clamp(dt, 0, 0.04);
    if (dt === 0) return;
    if (this.state === 'ready' || this.state === 'paused' || this.state === 'matchOver') return;
    this.updateEffects(dt);
    if (this.state === 'countdown') {
      this.timer -= dt;
      const count = Math.ceil(this.timer / 0.8);
      if (count !== this.lastCount) {
        this.lastCount = count;
        this.emit('countdown', { count });
      }
      if (this.timer <= 0) {
        this.state = 'playing';
        this.emit('state');
        this.emit('go');
      }
      return;
    }
    if (this.state === 'roundOver') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.round++;
        this.prepareRound();
        this.beginCountdown();
      }
      return;
    }
    this.elapsed += dt;
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      tank.cooldown = Math.max(0, tank.cooldown - dt);
      if (tank.powerTime > 0) {
        tank.powerTime -= dt;
        if (tank.powerTime <= 0) tank.power = null;
      }
      const oldX = tank.x,
        oldY = tank.y;
      if (tank.id === 0) {
        tank.steer = Number(Boolean(input.right)) - Number(Boolean(input.left));
        tank.throttle = Number(Boolean(input.forward)) - Number(Boolean(input.backward));
        tank.fire = Boolean(input.fire);
      } else {
        tank.think -= dt;
        if (tank.think <= 0) {
          this.think(tank);
          tank.think = LEVELS[tank.difficulty].reaction * (0.85 + this.rng() * 0.3);
        }
      }
      const profile = tank.id ? LEVELS[tank.difficulty] : { speed: PLAYER_SPEED, turn: 3.7 };
      const rotated = this.turnTank(tank, tank.steer * profile.turn * dt);
      this.moveTank(
        tank,
        Math.cos(tank.angle) * tank.throttle * profile.speed * dt,
        Math.sin(tank.angle) * tank.throttle * profile.speed * dt,
      );
      tank.vx = (tank.x - oldX) / dt;
      tank.vy = (tank.y - oldY) / dt;
      const moved = Math.hypot(tank.x - oldX, tank.y - oldY);
      tank.tread += moved;
      if (tank.tread >= 8) {
        tank.tread = 0;
        this.tracks.push({ x: tank.x, y: tank.y, angle: tank.angle, life: 9 });
      }
      if (tank.id && ((tank.throttle && moved < 0.1) || (tank.steer && !rotated))) tank.stuck += dt;
      else tank.stuck = Math.max(0, tank.stuck - dt);
      if (tank.fire) this.fire(tank);
    }
    this.updateBullets(dt);
    if (this.config.powerups) this.updatePowerups(dt);
    const alive = this.tanks.filter((t) => t.alive);
    if (alive.length <= 1 || this.elapsed >= 90) {
      if (this.settleTimer === null) this.settleTimer = 0.65;
      this.settleTimer -= dt;
      if (this.settleTimer <= 0)
        this.finishRound(this.elapsed >= 90 && alive.length > 1 ? null : alive[0] || null);
    }
  }
  canPlaceTank(tank) {
    return (
      !this.map.walls.some((w) => tankWall(tank, w)) &&
      !this.tanks.some((t) => t.id !== tank.id && t.alive && tanksOverlap(t, tank))
    );
  }
  turnTank(tank, angle) {
    if (!angle) return true;
    const steps = Math.ceil(Math.abs(angle) / 0.04);
    for (let i = 0; i < steps; i++) {
      const pose = { ...tank, angle: tank.angle + angle / steps };
      if (!this.canPlaceTank(pose)) return false;
      tank.angle = pose.angle;
    }
    return true;
  }
  moveTank(tank, dx, dy) {
    // Subdivide long moves as well as checking both axes, so the full hull
    // slides along walls without tunneling through them.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    for (let i = 0; i < steps; i++) {
      if (this.canPlaceTank({ ...tank, x: tank.x + dx / steps })) tank.x += dx / steps;
      if (this.canPlaceTank({ ...tank, y: tank.y + dy / steps })) tank.y += dy / steps;
    }
  }
  fire(tank) {
    const active = this.bullets.filter((b) => b.owner === tank.id).length;
    if (tank.cooldown > 0 || active >= 5 || !tank.alive) return false;
    const muzzle = muzzlePosition(tank);
    // Never clamp a shell back into its own hull. A blocked muzzle cannot fire.
    if (firstWall(this.map, tank.x, tank.y, muzzle.x - tank.x, muzzle.y - tank.y)) return false;
    const spread = tank.power === 'scatter' ? [-0.17, 0, 0.17] : [0];
    const error = tank.id ? (this.rng() - 0.5) * 2 * LEVELS[tank.difficulty].error : 0;
    for (const offset of spread.slice(0, 5 - active)) {
      const angle = tank.angle + offset + error;
      const dx = Math.cos(angle),
        dy = Math.sin(angle);
      this.bullets.push({
        ...muzzle,
        vx: dx * SHELL_SPEED,
        vy: dy * SHELL_SPEED,
        owner: tank.id,
        life: SHELL_LIFETIME,
        age: 0,
        bounces: 0,
        trail: [],
        dead: false,
      });
    }
    tank.cooldown =
      tank.power === 'rapid' ? 0.13 : tank.id ? LEVELS[tank.difficulty].cooldown : 0.32;
    this.burst(muzzle.x, muzzle.y, '#f2d980', 4, 35, 0.18);
    this.emit('fire', { id: tank.id });
    return true;
  }
  updateBullets(dt) {
    for (const shell of this.bullets) {
      shell.age += dt;
      shell.life -= dt;
      shell.trail.push({ x: shell.x, y: shell.y });
      if (shell.trail.length > 7) shell.trail.shift();
      let remaining = dt;
      for (let bounce = 0; bounce < 5 && remaining > 1e-6 && !shell.dead; bounce++) {
        const dx = shell.vx * remaining,
          dy = shell.vy * remaining;
        const wall = firstWall(this.map, shell.x, shell.y, dx, dy);
        let target = null,
          hitTime = wall ? wall.t : 1.01;
        for (const tank of this.tanks) {
          if (!tank.alive || (tank.id === shell.owner && shell.bounces === 0)) continue;
          const t = sweepTank(shell.x, shell.y, dx, dy, tank);
          if (t !== null && t < hitTime) {
            target = tank;
            hitTime = t;
          }
        }
        if (target) {
          shell.x += dx * hitTime;
          shell.y += dy * hitTime;
          shell.dead = true;
          if (target.shield) {
            target.shield = false;
            this.burst(target.x, target.y, '#b7d5d9', 17, 95, 0.5);
            this.emit('shield', { id: target.id });
          } else this.destroyTank(target, shell.owner);
        } else if (wall) {
          shell.x += dx * wall.t + wall.nx * 0.02;
          shell.y += dy * wall.t + wall.ny * 0.02;
          const normalSpeed = shell.vx * wall.nx + shell.vy * wall.ny;
          shell.vx -= 2 * normalSpeed * wall.nx;
          shell.vy -= 2 * normalSpeed * wall.ny;
          shell.bounces++;
          remaining *= 1 - wall.t;
          if (shell.bounces > 18) shell.dead = true;
          this.burst(shell.x, shell.y, '#f5e4a1', 2, 36, 0.17);
          this.emit('bounce');
        } else {
          shell.x += dx;
          shell.y += dy;
          remaining = 0;
        }
      }
      if (
        shell.life <= 0 ||
        shell.x < -5 ||
        shell.y < -5 ||
        shell.x > this.map.width + 5 ||
        shell.y > this.map.height + 5
      )
        shell.dead = true;
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }
  destroyTank(tank, owner) {
    tank.alive = false;
    if (owner !== tank.id && this.tanks[owner]) this.tanks[owner].kills++;
    this.burst(tank.x, tank.y, tank.color, 28, 125, 0.8);
    this.burst(tank.x, tank.y, '#f4d384', 16, 150, 0.6);
    this.shake = 5;
    this.emit('destroy', { id: tank.id, owner });
    this.emit('score');
  }
  finishRound(winner) {
    if (winner) this.scores[winner.id]++;
    this.winner = winner;
    this.state =
      winner && this.config.target > 0 && this.scores[winner.id] >= this.config.target
        ? 'matchOver'
        : 'roundOver';
    this.timer = 3.2;
    this.emit('roundEnd', { winner: winner?.id ?? null, match: this.state === 'matchOver' });
    this.emit('score');
    this.emit('state');
  }
  lineOfSight(a, b) {
    return !firstWall(this.map, a.x, a.y, b.x - a.x, b.y - a.y, 5);
  }
  // Predict the first tank a shot meets, including optional ricochets.
  shotTarget(tank, angle, maxBounces = 0) {
    const muzzle = muzzlePosition(tank, angle);
    if (firstWall(this.map, tank.x, tank.y, muzzle.x - tank.x, muzzle.y - tank.y)) return null;
    let { x, y } = muzzle;
    let vx = Math.cos(angle),
      vy = Math.sin(angle),
      traveled = 0;
    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      const range = SHELL_SPEED * SHELL_LIFETIME - traveled;
      const dx = vx * range,
        dy = vy * range;
      const wall = firstWall(this.map, x, y, dx, dy);
      let first = wall ? wall.t : 1;
      let target = null;
      for (const other of this.tanks) {
        if (!other.alive || (other.id === tank.id && bounce === 0)) continue;
        const t = sweepTank(x, y, dx, dy, other);
        if (t !== null && t < first) {
          first = t;
          target = other.id;
        }
      }
      traveled += first * range;
      if (target !== null) return { id: target, distance: traveled };
      if (!wall || traveled >= SHELL_SPEED * SHELL_LIFETIME) return null;
      x += dx * wall.t + wall.nx * 0.03;
      y += dy * wall.t + wall.ny * 0.03;
      const normalSpeed = vx * wall.nx + vy * wall.ny;
      vx -= 2 * normalSpeed * wall.nx;
      vy -= 2 * normalSpeed * wall.ny;
    }
    return null;
  }
  think(tank) {
    const profile = LEVELS[tank.difficulty];
    const enemies = this.tanks.filter((t) => t.alive && t.id !== tank.id);
    if (!enemies.length) {
      tank.fire = false;
      tank.throttle = 0;
      tank.steer = 0;
      return;
    }
    enemies.sort((a, b) => distance(a, tank) - distance(b, tank));
    const visible = enemies.find((t) => this.lineOfSight(tank, t));
    const target = visible || enemies[0];
    let desired,
      throttle = 1;
    if (visible) {
      const lead = profile.bank ? Math.min(0.22, distance(tank, target) / SHELL_SPEED) : 0;
      const predicted = { x: target.x + target.vx * lead, y: target.y + target.vy * lead };
      desired = Math.atan2(predicted.y - tank.y, predicted.x - tank.x);
      throttle = distance(tank, target) > 125 ? 0.85 : distance(tank, target) < 65 ? -0.55 : 0.2;
    } else {
      const from = cellAt(this.map, tank.x, tank.y),
        to = cellAt(this.map, target.x, target.y);
      const path = findPath(this.map, from, to);
      let next = this.map.cells[path[1] ?? from];
      // Center before a turn to keep the tracks and barrel clear of corners.
      const current = this.map.cells[from];
      const cx = (current.x + 0.5) * CELL,
        cy = (current.y + 0.5) * CELL;
      if (
        (next.x !== current.x && Math.abs(tank.y - cy) > 4) ||
        (next.y !== current.y && Math.abs(tank.x - cx) > 4)
      )
        next = current;
      desired = Math.atan2((next.y + 0.5) * CELL - tank.y, (next.x + 0.5) * CELL - tank.x);
    }
    let difference = angleDiff(desired, tank.angle);
    if (profile.bank && !visible && tank.cooldown <= 0 && this.rng() < 0.65) {
      for (let i = 0; i < 13; i++) {
        const candidate = tank.angle + (i - 6) * 0.19;
        const hit = this.shotTarget(tank, candidate, 1);
        if (hit && hit.id !== tank.id && hit.distance < 750) {
          desired = candidate;
          difference = angleDiff(desired, tank.angle);
          throttle = 0.1;
          break;
        }
      }
    }
    if (profile.dodge) {
      let danger = null,
        minThreat = 65;
      for (const b of this.bullets) {
        if (b.owner === tank.id && b.bounces === 0) continue;
        const time = clamp(
          ((tank.x - b.x) * b.vx + (tank.y - b.y) * b.vy) / SHELL_SPEED ** 2,
          0,
          profile.bank ? 0.65 : 0.38,
        );
        const miss = Math.hypot(b.x + b.vx * time - tank.x, b.y + b.vy * time - tank.y);
        if (miss < 27 && distance(b, tank) < 200 && miss < minThreat) {
          danger = b;
          minThreat = miss;
        }
      }
      if (danger) {
        const projection = (tank.x - danger.x) * -danger.vy + (tank.y - danger.y) * danger.vx;
        const dodgeAngle =
          Math.atan2(danger.vy, danger.vx) + (projection >= 0 ? Math.PI / 2 : -Math.PI / 2);
        if (profile.bank || !visible) {
          difference = angleDiff(dodgeAngle, tank.angle);
          throttle = 1;
        }
      }
    }
    tank.steer =
      Math.abs(difference) < 0.045
        ? 0
        : clamp(difference / (profile.turn * profile.reaction), -1, 1);
    tank.throttle = Math.abs(difference) > 1 ? 0 : throttle;
    if (tank.stuck > 0.7) {
      tank.throttle = -0.65;
      tank.steer = 1;
      if (tank.stuck > 1.5) tank.stuck = 0;
    }
    const hit = this.shotTarget(tank, tank.angle, profile.bank ? 1 : 0);
    tank.fire = Boolean(hit && hit.id !== tank.id && hit.distance < (profile.bank ? 900 : 650));
    if (tank.difficulty === 'easy' && this.rng() < 0.3) tank.fire = false;
  }
  updatePowerups(dt) {
    this.powerTimer -= dt;
    if (this.powerTimer <= 0 && this.powerups.length < 3) {
      const candidates = this.map.cells.filter((c) =>
        this.tanks.every(
          (t) => !t.alive || Math.hypot(t.x - (c.x + 0.5) * CELL, t.y - (c.y + 0.5) * CELL) > 55,
        ),
      );
      const c = candidates[Math.floor(this.rng() * candidates.length)];
      if (c)
        this.powerups.push({
          x: (c.x + 0.5) * CELL,
          y: (c.y + 0.5) * CELL,
          type: ['shield', 'rapid', 'scatter'][Math.floor(this.rng() * 3)],
          life: 18,
        });
      this.powerTimer = 7 + this.rng() * 3;
    }
    for (const p of this.powerups) {
      p.life -= dt;
      const tank = this.tanks.find((t) => t.alive && distance(t, p) < 26);
      if (!tank) continue;
      if (p.type === 'shield') tank.shield = true;
      else {
        tank.power = p.type;
        tank.powerTime = 7;
      }
      p.life = 0;
      this.burst(p.x, p.y, '#e4c56f', 10, 70, 0.4);
      this.emit('pickup', { id: tank.id, power: p.type });
    }
    this.powerups = this.powerups.filter((p) => p.life > 0);
  }
  burst(x, y, color, count, speed, life) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2,
        s = speed * (0.25 + this.rng() * 0.75);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.5 + this.rng() * 0.5),
        maxLife: life,
        color,
        size: 1.5 + this.rng() * 3,
      });
    }
  }
  updateEffects(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3;
      p.vy *= 1 - dt * 3;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.tracks) t.life -= dt;
    this.tracks = this.tracks.filter((t) => t.life > 0).slice(-700);
    this.shake = Math.max(0, this.shake - dt * 18);
  }
}
