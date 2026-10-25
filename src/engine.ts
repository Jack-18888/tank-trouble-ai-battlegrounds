// Pure simulation: no DOM, canvas, audio, or frame-rate dependent movement.
import {
  tankWall,
  tankWallContact,
  tankWallContacts,
  TRACK_SPACING,
  TANK_BOUND_RADIUS,
  tanksOverlap,
  sweepTank,
  muzzlePosition,
} from './geometry.ts';
import { clamp, distance } from './math.ts';
import { hasBot } from './bots/index.ts';
import { observeWorld } from './players/observation.ts';
import { validateProfile } from './players/profile.ts';
import { randomGenerator } from './random.ts';
import { CELL, SHELL_SPEED, SHELL_LIFETIME, RULES } from './rules.ts';
import { firstWall, lineOfSight, predictShot } from './queries.ts';
import type {
  ControlStamp,
  DecisionEnvelope,
  PlayerState,
  WorldFrame,
} from './players/connection.ts';
import type { PlayerProfile } from './players/types.ts';
import { HUMAN_PROFILE } from './players/player.ts';
import type { BotContext } from './bots/types.ts';
import type {
  Bullet,
  Cell,
  GameConfig,
  GameEvent,
  GameMap,
  GameState,
  MapSize,
  MazeDensity,
  Particle,
  PlayerSlot,
  Point,
  Powerup,
  ReadonlyGameMap,
  Seed,
  ShotPrediction,
  ShotScene,
  ShotTank,
  Tank,
  Track,
  Wall,
} from './types.ts';

export { clamp, angleDiff, distance } from './math.ts';
export { CELL, PLAYER_SPEED, SHELL_SPEED, SHELL_LIFETIME } from './rules.ts';
export { randomGenerator } from './random.ts';
export { cellAt, neighbors, findPath, firstWall } from './queries.ts';
export const COLORS = ['#376b48', '#d17a4d', '#b39b40', '#5e889e', '#9680ad', '#bd6877'];
export const NAMES = ['Moss', 'Rusty', 'Brass', 'Cobalt', 'Violet', 'Blush'];
export const DEFAULT_CONFIG: GameConfig = {
  players: [{ kind: 'human' }, { kind: 'bot', botId: 'medium' }, { kind: 'bot', botId: 'medium' }],
  size: 'classic',
  density: 'balanced',
  target: 5,
  powerups: true,
};

export function validateGameConfig(value: unknown): GameConfig {
  const source: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {};
  const raw: Record<string, unknown> = {
    ...DEFAULT_CONFIG,
    ...source,
  };
  let slots: unknown[] = DEFAULT_CONFIG.players;
  if ('players' in source) {
    slots = Array.isArray(source.players) ? source.players : DEFAULT_CONFIG.players;
  } else if ('opponents' in source || 'difficulties' in source) {
    // Read v1 preferences, then persist only the normalized roster representation.
    const count = clamp(
      Math.round(Number('opponents' in source ? source.opponents : 2) || 1),
      1,
      5,
    );
    const ids: unknown[] = Array.isArray(raw.difficulties) ? raw.difficulties : [];
    slots = [
      { kind: 'human' },
      ...Array.from({ length: count }, (_, i) => ({ kind: 'bot', botId: ids[i] })),
    ];
  }
  let hasHuman = false;
  const players = Array.from({ length: clamp(slots.length, 2, 6) }, (_, i): PlayerSlot => {
    const slot = slots[i];
    if (typeof slot === 'object' && slot !== null && 'kind' in slot) {
      if (slot.kind === 'human' && !hasHuman) {
        hasHuman = true;
        return { kind: 'human' };
      }
      if (slot.kind === 'bot' && 'botId' in slot && hasBot(slot.botId)) {
        return { kind: 'bot', botId: slot.botId };
      }
    }
    return { kind: 'bot', botId: 'medium' };
  });
  const target = Number(raw.target);
  return {
    players,
    target: target === 0 || target === 3 || target === 5 || target === 10 ? target : 5,
    size:
      raw.size === 'compact' || raw.size === 'classic' || raw.size === 'large'
        ? raw.size
        : 'classic',
    density:
      raw.density === 'open' || raw.density === 'balanced' || raw.density === 'dense'
        ? raw.density
        : 'balanced',
    powerups: Boolean(raw.powerups),
  };
}

export function generateMap(
  size: MapSize = 'classic',
  density: MazeDensity = 'balanced',
  seed: Seed = String(Date.now()),
): GameMap {
  seed = String(seed).toUpperCase();
  const [cols, rows] = { compact: [10, 7], classic: [12, 8], large: [15, 10] }[size] || [12, 8];
  const rng = randomGenerator(seed);
  const cells: Cell[] = Array.from({ length: cols * rows }, (_, id) => ({
    id,
    x: id % cols,
    y: Math.floor(id / cols),
    walls: [true, true, true, true],
  }));
  const around = (cell: Cell) =>
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
    const current = stack[stack.length - 1];
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
  const walls: Wall[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number, border = false) =>
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

export class Game {
  events: GameEvent[] = [];
  config: GameConfig;
  rng: () => number;
  scores: number[];
  kills: number[];
  round = 0;
  state: GameState = 'ready';
  resumeState: GameState = 'playing';
  particles: Particle[] = [];
  tracks: Track[] = [];
  shake = 0;
  // prepareRound initializes the map before the constructor returns.
  map!: GameMap;
  tanks: Tank[] = [];
  players = new Map<number, PlayerState>();
  generation = 0;
  epoch = 0;
  tick = 0;
  private readonly pendingDecisions = new Map<number, DecisionEnvelope>();
  private readonly observationRandom = new Map<number, () => number>();
  bullets: Bullet[] = [];
  powerups: Powerup[] = [];
  elapsed = 0;
  powerTimer = 5;
  settleTimer: number | null = null;
  winner: Tank | null = null;
  timer = 0;
  lastCount = -1;

  constructor(config: Partial<GameConfig> = DEFAULT_CONFIG, seed?: Seed) {
    this.events = [];
    this.config = this.validateConfig(config);
    this.rng = randomGenerator(seed ?? Date.now());
    this.scores = Array(this.config.players.length).fill(0);
    this.kills = Array(this.config.players.length).fill(0);
    this.round = 0;
    this.state = 'ready';
    this.particles = [];
    this.tracks = [];
    this.shake = 0;
    this.prepareRound(seed);
  }
  validateConfig(config: unknown): GameConfig {
    return validateGameConfig(config);
  }
  get humanId(): number | null {
    const id = this.config.players.findIndex((slot) => slot.kind === 'human');
    return id === -1 ? null : id;
  }
  emit(event: GameEvent) {
    this.events.push(event);
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
  prepareRound(seed?: Seed) {
    this.generation++;
    this.invalidateControls();
    this.tick = 0;
    this.observationRandom.clear();
    this.players = new Map();
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
    while (spawnCells.length < this.config.players.length) {
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
        name: this.config.players[i].kind === 'human' ? 'You' : NAMES[i],
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
        leftTread: 0,
        rightTread: 0,
        steer: 0,
        throttle: 0,
        fire: false,
        stuck: 0,
        previousX: 0,
        previousY: 0,
        kills: 0,
        controller: { ...this.config.players[i] },
      };
    });
    for (const tank of this.tanks) {
      this.players.set(tank.id, {
        status: 'connecting',
        profile: tank.controller.kind === 'human' ? HUMAN_PROFILE : null,
        sequence: 0,
        observationTick: -1,
      });
    }
    this.emit({ type: 'map' });
  }
  start() {
    if (this.state !== 'ready') this.prepareRound();
    this.scores.fill(0);
    this.kills.fill(0);
    for (const tank of this.tanks) tank.kills = 0;
    this.round = 1;
    this.beginCountdown();
    this.emit({ type: 'score' });
  }
  beginCountdown() {
    this.invalidateControls();
    this.state = 'countdown';
    this.timer = 2.4;
    this.lastCount = -1;
    this.emit({ type: 'state' });
  }
  pause() {
    this.invalidateControls();
    if (this.state === 'paused') {
      this.state = this.resumeState;
      this.emit({ type: 'state' });
      return;
    }
    if (['playing', 'countdown', 'roundOver'].includes(this.state)) {
      this.resumeState = this.state;
      this.state = 'paused';
      this.emit({ type: 'state' });
    }
  }
  update(dt: number) {
    dt = clamp(dt, 0, 0.04);
    if (dt === 0) return;
    if (this.state === 'ready' || this.state === 'paused' || this.state === 'matchOver') return;
    this.updateEffects(dt);
    if (this.state === 'countdown') {
      this.timer -= dt;
      const count = Math.ceil(this.timer / 0.8);
      if (count !== this.lastCount) {
        this.lastCount = count;
        this.emit({ type: 'countdown', ...{ count } });
      }
      if (this.timer <= 0) {
        this.state = 'playing';
        this.emit({ type: 'state' });
        this.emit({ type: 'go' });
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
    this.applyPendingDecisions();
    this.tick++;
    this.elapsed += dt;
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      tank.cooldown = Math.max(0, tank.cooldown - dt);
      if (tank.powerTime > 0) {
        tank.powerTime -= dt;
        if (tank.powerTime <= 0) tank.power = null;
      }
      const oldX = tank.x,
        oldY = tank.y,
        oldAngle = tank.angle;
      const profile = this.players.get(tank.id)?.profile;
      if (!profile) {
        tank.vx = 0;
        tank.vy = 0;
        continue;
      }
      const rotated = this.turnTank(tank, tank.steer * profile.turn * dt);
      const driveX = tank.x,
        driveY = tank.y;
      this.moveTank(
        tank,
        Math.cos(tank.angle) * tank.throttle * profile.speed * dt,
        Math.sin(tank.angle) * tank.throttle * profile.speed * dt,
      );
      tank.vx = (tank.x - oldX) / dt;
      tank.vy = (tank.y - oldY) / dt;
      const moved = Math.hypot(tank.x - oldX, tank.y - oldY);
      const rotation = tank.angle - oldAngle;
      const heading = oldAngle + rotation / 2;
      const forward = (tank.x - oldX) * Math.cos(heading) + (tank.y - oldY) * Math.sin(heading);
      tank.leftTread = (tank.leftTread + forward + (rotation * TRACK_SPACING) / 2) % 5;
      tank.rightTread = (tank.rightTread + forward - (rotation * TRACK_SPACING) / 2) % 5;
      tank.tread += moved;
      if (tank.tread >= 8) {
        tank.tread = 0;
        this.tracks.push({ x: tank.x, y: tank.y, angle: tank.angle, life: 9 });
      }
      const driven = Math.hypot(tank.x - driveX, tank.y - driveY);
      if ((tank.throttle && driven < 0.1) || (tank.steer && !rotated)) tank.stuck += dt;
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
  canPlaceTank(tank: Readonly<Tank>): boolean {
    return (
      !this.map.walls.some((w) => tankWall(tank, w)) &&
      !this.tanks.some((t) => t.id !== tank.id && t.alive && tanksOverlap(t, tank))
    );
  }
  turnTank(tank: Tank, angle: number): boolean {
    if (!angle) return true;
    const steps = Math.ceil(Math.abs(angle) / 0.04);
    const step = angle / steps;
    for (let i = 0; i < steps; i++) {
      const pose = { ...tank, angle: tank.angle + step };
      if (!this.canPlaceTank(pose)) {
        // Resolve only the small overlap created by this rotation. This lets
        // a tank pivot away from wall contact without clipping or teleporting
        // through a wall, or displacing another tank.
        const maxShift = TANK_BOUND_RADIUS * Math.abs(step) * 2 + 0.01;
        if (!this.separateFromWalls(pose, tank, maxShift)) return false;
      }
      tank.x = pose.x;
      tank.y = pose.y;
      tank.angle = pose.angle;
    }
    return true;
  }
  private separateFromWalls(pose: Tank, origin: Readonly<Point>, maxShift: number): boolean {
    for (let pass = 0; pass < 6; pass++) {
      let corrected = false;
      for (const wall of this.map.walls) {
        const contact = tankWallContact(pose, wall);
        if (!contact) continue;
        pose.x += contact.nx * (contact.depth + 0.001);
        pose.y += contact.ny * (contact.depth + 0.001);
        corrected = true;
        if (distance(pose, origin) > maxShift) return false;
      }
      if (!corrected) break;
    }
    return this.canPlaceTank(pose);
  }
  moveTank(tank: Tank, dx: number, dy: number): void {
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const drive = dx * Math.cos(tank.angle) + dy * Math.sin(tank.angle);
    const alongTracks = Math.abs(dx * Math.sin(tank.angle) - dy * Math.cos(tank.angle)) < 1e-7;
    // Small steps bound contact pivots as well as preventing tunneling.
    const steps = Math.max(1, Math.ceil(length / 0.8));
    for (let i = 0; i < steps; i++) {
      const sx = alongTracks ? (Math.cos(tank.angle) * drive) / steps : dx / steps;
      const sy = alongTracks ? (Math.sin(tank.angle) * drive) / steps : dy / steps;
      const pose = { ...tank, x: tank.x + sx, y: tank.y + sy };
      if (this.canPlaceTank(pose)) {
        tank.x = pose.x;
        tank.y = pose.y;
        continue;
      }
      if (alongTracks && this.pivotOnTrack(tank, pose, drive / steps)) continue;
      if (this.canPlaceTank({ ...tank, x: tank.x + sx })) tank.x += sx;
      if (this.canPlaceTank({ ...tank, y: tank.y + sy })) tank.y += sy;
    }
  }
  private pivotOnTrack(tank: Tank, blocked: Tank, travel: number): boolean {
    const contacts = this.map.walls.flatMap((wall) => tankWallContacts(blocked, wall));
    const left = contacts.some((c) => c.part === 'leftTrack');
    const right = contacts.some((c) => c.part === 'rightTrack');
    if (left === right || contacts.some((c) => c.part === 'barrel' || c.part === 'hull'))
      return false;
    const contact = contacts.find((c) => c.part === (left ? 'leftTrack' : 'rightTrack'))!;
    // One track stalls at contact; the other keeps driving. Rotate around
    // the wall's actual surface, then validate the entire visible silhouette.
    const turn = ((left ? -1 : 1) * travel) / TRACK_SPACING;
    const c = Math.cos(turn),
      s = Math.sin(turn);
    const rx = tank.x - contact.point.x,
      ry = tank.y - contact.point.y;
    const pose = {
      ...tank,
      angle: tank.angle + turn,
      x: contact.point.x + rx * c - ry * s,
      y: contact.point.y + rx * s + ry * c,
    };
    if (
      !this.canPlaceTank(pose) &&
      !this.separateFromWalls(pose, { ...pose }, Math.abs(travel) * 0.5 + 0.001)
    )
      return false;
    tank.x = pose.x;
    tank.y = pose.y;
    tank.angle = pose.angle;
    return true;
  }
  fire(tank: Tank): boolean {
    const active = this.bullets.filter((b) => b.owner === tank.id).length;
    if (tank.cooldown > 0 || active >= 5 || !tank.alive) return false;
    const muzzle = muzzlePosition(tank);
    // Never clamp a shell back into its own hull. A blocked muzzle cannot fire.
    if (firstWall(this.map, tank.x, tank.y, muzzle.x - tank.x, muzzle.y - tank.y)) return false;
    const spread = tank.power === 'scatter' ? [-0.17, 0, 0.17] : [0];
    const profile = this.players.get(tank.id)?.profile;
    if (!profile) return false;
    const error = profile.error ? (this.rng() - 0.5) * 2 * profile.error : 0;
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
    tank.cooldown = tank.power === 'rapid' ? 0.13 : profile.cooldown;
    this.burst(muzzle.x, muzzle.y, '#f2d980', 4, 35, 0.18);
    this.emit({ type: 'fire', ...{ id: tank.id } });
    return true;
  }
  updateBullets(dt: number) {
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
        let target: Tank | null = null,
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
            this.emit({ type: 'shield', ...{ id: target.id } });
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
          this.emit({ type: 'bounce' });
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
  destroyTank(tank: Tank, owner: number) {
    if (!tank.alive) return;
    this.playerClosed(tank.id);
    tank.alive = false;
    if (owner !== tank.id && this.tanks[owner]) {
      this.tanks[owner].kills++;
      this.kills[owner]++;
    }
    this.burst(tank.x, tank.y, tank.color, 28, 125, 0.8);
    this.burst(tank.x, tank.y, '#f4d384', 16, 150, 0.6);
    this.shake = 5;
    this.emit({ type: 'destroy', ...{ id: tank.id, owner } });
    this.emit({ type: 'score' });
  }
  finishRound(winner: Tank | null) {
    this.invalidateControls();
    if (winner) this.scores[winner.id]++;
    this.winner = winner;
    this.state =
      winner && this.config.target > 0 && this.scores[winner.id] >= this.config.target
        ? 'matchOver'
        : 'roundOver';
    this.timer = 3.2;
    this.emit({
      type: 'roundEnd',
      ...{ winner: winner?.id ?? null, match: this.state === 'matchOver' },
    });
    this.emit({ type: 'score' });
    this.emit({ type: 'state' });
  }
  lineOfSight(a: Readonly<Point>, b: Readonly<Point>, map: ReadonlyGameMap = this.map): boolean {
    return lineOfSight(a, b, map);
  }
  shotTarget(
    tank: Readonly<ShotTank>,
    angle: number,
    maxBounces = 0,
    scene: ShotScene = this,
  ): ShotPrediction | null {
    return predictShot(tank, angle, maxBounces, scene);
  }
  controlStamp(): ControlStamp {
    return { generation: this.generation, round: this.round, epoch: this.epoch, tick: this.tick };
  }
  snapshot(): WorldFrame {
    return structuredClone({
      ...this.controlStamp(),
      tanks: this.tanks,
      bullets: this.bullets.map(({ x, y, vx, vy, owner, life, age, bounces }) => ({
        x,
        y,
        vx,
        vy,
        owner,
        life,
        age,
        bounces,
      })),
      powerups: this.powerups,
      match: {
        round: this.round,
        elapsed: this.elapsed,
        scores: this.scores,
        kills: this.kills,
        target: this.config.target,
        state: this.state,
      },
    });
  }
  getBotContext(tank: Tank): BotContext {
    let random = this.observationRandom.get(tank.id);
    if (!random) {
      random = randomGenerator(this.map.seed + ':' + this.round + ':' + tank.id);
      this.observationRandom.set(tank.id, random);
    }
    return observeWorld(
      {
        generation: this.generation,
        round: this.round,
        playerId: tank.id,
        botId: '',
        seed: '',
        map: this.map,
        rules: RULES,
      },
      this.snapshot(),
      random,
    );
  }
  playerReady(id: number, profile: Readonly<PlayerProfile>) {
    const state = this.players.get(id);
    if (!state || state.status === 'failed' || state.status === 'closed') return;
    state.profile = validateProfile(profile);
    state.status = 'ready';
    this.emit({ type: 'playerStatus', id, status: 'ready' });
  }
  playerFailed(id: number, reason: string) {
    const state = this.players.get(id);
    if (!state || state.status === 'failed' || state.status === 'closed') return;
    state.status = 'failed';
    state.failure = reason;
    this.clearPlayerControls(id);
    this.emit({ type: 'playerStatus', id, status: 'failed' });
  }
  playerClosed(id: number) {
    const state = this.players.get(id);
    if (state && state.status !== 'failed') state.status = 'closed';
    this.clearPlayerControls(id);
  }
  submitDecision(id: number, envelope: DecisionEnvelope): boolean {
    const state = this.players.get(id);
    if (
      !state ||
      state.status !== 'ready' ||
      !this.tanks[id]?.alive ||
      this.state !== 'playing' ||
      envelope.generation !== this.generation ||
      envelope.round !== this.round ||
      envelope.epoch !== this.epoch ||
      !Number.isSafeInteger(envelope.sequence) ||
      envelope.sequence <= state.sequence ||
      !Number.isSafeInteger(envelope.tick) ||
      envelope.tick < state.observationTick ||
      envelope.tick > this.tick
    )
      return false;
    state.sequence = envelope.sequence;
    state.observationTick = envelope.tick;
    const value = envelope.decision;
    this.pendingDecisions.set(id, {
      ...envelope,
      decision: {
        steer:
          typeof value?.steer === 'number' && Number.isFinite(value.steer)
            ? clamp(value.steer, -1, 1)
            : 0,
        throttle:
          typeof value?.throttle === 'number' && Number.isFinite(value.throttle)
            ? clamp(value.throttle, -1, 1)
            : 0,
        fire: value?.fire === true,
      },
    });
    return true;
  }
  private applyPendingDecisions() {
    for (const [id, envelope] of this.pendingDecisions) {
      if (
        envelope.epoch !== this.epoch ||
        envelope.generation !== this.generation ||
        !this.tanks[id]?.alive ||
        this.players.get(id)?.status !== 'ready'
      )
        continue;
      Object.assign(this.tanks[id], envelope.decision);
    }
    this.pendingDecisions.clear();
    for (const tank of this.tanks) if (tank.stuck > 1.5) tank.stuck = 0;
  }
  private clearPlayerControls(id: number) {
    this.pendingDecisions.delete(id);
    const tank = this.tanks[id];
    if (tank) {
      tank.steer = 0;
      tank.throttle = 0;
      tank.fire = false;
    }
  }
  private invalidateControls() {
    this.epoch++;
    this.pendingDecisions.clear();
    for (const tank of this.tanks) this.clearPlayerControls(tank.id);
  }
  updatePowerups(dt: number) {
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
          type: (['shield', 'rapid', 'scatter'] as const)[Math.floor(this.rng() * 3)],
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
      this.emit({ type: 'pickup', ...{ id: tank.id, power: p.type } });
    }
    this.powerups = this.powerups.filter((p) => p.life > 0);
  }
  burst(x: number, y: number, color: string, count: number, speed: number, life: number) {
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
  updateEffects(dt: number) {
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
