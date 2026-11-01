import { SHELL_RADIUS, sweepTank } from '../../geometry.ts';
import { angleDiff, clamp, distance } from '../../math.ts';
import type { Decision, DecisionSegment } from '../../players/types.ts';
import type { BotContext } from '../types.ts';
import type { Point } from '../../types.ts';
import {
  Arena,
  HULL_RADIUS,
  MUZZLE_OFFSET,
  TICK_DT,
  TURN_RADIUS,
  type PathSegment,
} from './arena.ts';

// DS V4.1 Flash planner.
//
// Observations arrive at plan expiry. Every decision simulates candidate control pairs on the real
// 120 Hz clock with a collision-aware tank model, traces every live shell through its ricochets,
// predicts enemy motion from the controls they are holding, and only commits the trigger when the
// traced shell and the predicted target meet. The plan is a native `Decision`, so the tank keeps
// executing (and can fire exactly on the tick its barrel crosses the intercept bearing) until the
// next observation.

/** Assumed turn rate when projecting opponents (their profile is not exposed). */
const ENEMY_TURN = 3.9;
/** Enemy track resolution in seconds. */
const TRACK_STEP = 0.05;
const TRACK_HORIZON = 2.4;
/** A traced shot within this centre distance of the predicted target counts as a connect. */
const HIT_RADIUS = 9.5;
/** Shells closer than this to our centre are treated as hits during rollouts. */
const DANGER_RADIUS = 16.5;
const PROXIMITY_RADIUS = 30;
/** Coarse ricochet scan step. */
const SCAN_STEP = Math.PI / 12;
const SCAN_REFRESH = 0.3;
/** Tick horizons for the returned plan. */
const MIN_PLAN_TICKS = 6;
const MAX_PLAN_TICKS = 20;
/** Longest look-ahead used while a shell is closing in. */
const MAX_EVAL_TICKS = 96;

interface TrackSample {
  t: number;
  x: number;
  y: number;
}

interface EnemyTrack {
  id: number;
  samples: TrackSample[];
  speed: number;
}

interface ShellPath {
  owner: number;
  bounces: number;
  /** Positions sampled at 120 Hz, index = ticks from now. */
  xs: Float32Array;
  ys: Float32Array;
  steps: number;
  /** Seconds until the shell reaches our current silhouette, if it ever does. */
  impact: number;
  /** Seconds until the shell comes anywhere near us, even if standing still would miss. */
  reach: number;
}

interface Aim {
  angle: number;
  targetId: number;
  bounces: number;
  /** Seconds from now until the shell reaches the target, or Infinity when unknown. */
  hitTime: number;
  miss: number;
  quality: number;
}

interface Maneuver {
  steer: number;
  throttle: number;
}

interface Rollout {
  xs: Float32Array;
  ys: Float32Array;
  angles: Float32Array;
  stalled: number;
}

interface Candidate {
  steer: number;
  throttle: number;
  score: number;
  fireTick: number;
}

function trackAt(track: EnemyTrack, time: number): TrackSample {
  const samples = track.samples;
  if (time <= 0) return samples[0];
  const last = samples[samples.length - 1];
  if (time >= last.t) return last;
  const index = Math.min(samples.length - 2, Math.max(0, Math.floor(time / TRACK_STEP)));
  const a = samples[index];
  const b = samples[index + 1];
  const span = b.t - a.t || 1;
  const u = clamp((time - a.t) / span, 0, 1);
  return { t: time, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** First positive root of |r + v t| = speed·t, or NaN when no intercept exists. */

/**
 * Closest approach between a shell path and an interpolated target track. Times are absolute:
 * `timeOffset` is when the shell is launched (the track's t=0 corresponds to the observation).
 */
function closestApproach(
  segments: PathSegment[],
  track: EnemyTrack,
  shellSpeed: number,
  timeOffset: number,
  maxTime: number,
): { time: number; miss: number } | null {
  let bestMiss = Infinity;
  let bestTime = Infinity;
  const samples = track.samples;
  for (const segment of segments) {
    const t0 = timeOffset + segment.d0 / shellSpeed;
    const t1 = timeOffset + segment.d1 / shellSpeed;
    if (t0 > timeOffset + maxTime) break;
    const span = t1 - t0;
    if (span <= 1e-9) continue;
    const vx = (segment.x1 - segment.x0) / span;
    const vy = (segment.y1 - segment.y0) / span;
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const lo = Math.max(a.t, t0);
      const hi = Math.min(b.t, t1);
      if (hi < lo) continue;
      if (a.t > t1) break;
      const overlap = b.t - a.t || 1;
      const ux = (b.x - a.x) / overlap;
      const uy = (b.y - a.y) / overlap;
      // Relative position at lo and relative velocity across the overlap.
      const s0 = segment.x0 + vx * (lo - t0) - (a.x + ux * (lo - a.t));
      const s1 = segment.y0 + vy * (lo - t0) - (a.y + uy * (lo - a.t));
      const rx = vx - ux;
      const ry = vy - uy;
      const denom = rx * rx + ry * ry;
      const u = denom > 1e-9 ? clamp(-(s0 * rx + s1 * ry) / denom, 0, hi - lo) : 0;
      const dx = s0 + rx * u;
      const dy = s1 + ry * u;
      const miss = Math.hypot(dx, dy);
      if (miss < bestMiss) {
        bestMiss = miss;
        bestTime = lo + u;
      }
    }
  }
  if (!Number.isFinite(bestMiss)) return null;
  return { time: bestTime, miss: bestMiss };
}

/** Route follower with waypoint persistence and line-of-sight shortcutting. */
class Navigator {
  private route: number[] = [];
  private cursor = 0;
  private goal = -1;
  private key = '';

  waypoint(arena: Arena, context: BotContext, goal: number): Point {
    const self = context.self;
    const from = context.cellAt(self.x, self.y);
    const key = `${context.map.seed}:${context.match.round}`;
    if (
      key !== this.key ||
      goal !== this.goal ||
      this.route.length === 0 ||
      (from !== this.route[this.cursor] &&
        from !== this.route[this.cursor - 1] &&
        from !== this.route[this.cursor + 1])
    ) {
      this.route = arena.route(from, goal);
      this.cursor = 0;
      this.goal = goal;
      this.key = key;
    }
    let next = arena.center(this.route[this.cursor] ?? from);
    let advanced = true;
    while (advanced) {
      advanced = false;
      if (this.cursor < this.route.length - 1 && distance(self, next) <= 9) {
        next = arena.center(this.route[++this.cursor]);
        advanced = true;
      } else if (this.cursor < this.route.length - 2) {
        const after = arena.center(this.route[this.cursor + 1]);
        if (arena.lineClear(self.x, self.y, after.x, after.y, 13)) {
          next = after;
          this.cursor++;
          advanced = true;
        }
      }
    }
    return next;
  }
}

/** The per-round controller; the bot instance is recreated every round. */
export class FlashBrain {
  private arena: Arena | null = null;
  private arenaKey = '';
  private readonly navigator = new Navigator();
  private readonly enemySpeed = new Map<number, number>();
  private targetId = -1;
  private targetUntil = 0;
  private lastSteer = 0;
  private lastThrottle = 0;
  private recoverUntil = -1;
  private bankScanAt = -10;
  private bankAim: Aim | null = null;
  private lastAim: { angle: number; at: number; targetId: number } | null = null;
  private jink: { until: number; dir: number } = { until: -1, dir: 1 };
  private warmed = false;
  private lastX = 0;
  private lastY = 0;
  private stalledAt = 0;
  private started = false;
  /** Wall-clock start of the current decision; used only as a safety valve, never for strategy. */
  private decisionStart = 0;
  private fullDecisions = 0;

  constructor(
    private readonly speed: number,
    private readonly turn: number,
  ) {}

  decide(context: BotContext): Decision {
    this.decisionStart = performance.now();
    // Workers are recreated every round, so the first decisions pay cold-code costs. Spread that
    // over a few observations instead of risking the 10 ms dispatch deadline on tick zero.
    if (!this.started) {
      this.started = true;
      return { segments: [{ ticks: 12, steer: 0.3, throttle: 0.6 }] };
    }
    this.sync(context);
    const arena = this.arena;
    if (!arena) return { segments: [{ ticks: MIN_PLAN_TICKS }] };
    if (!this.warmed) {
      this.warmed = true;
      const self = context.self;
      const enemy = context.enemies[0];
      const desired = enemy ? Math.atan2(enemy.y - self.y, enemy.x - self.x) : self.angle;
      const steer = clamp(angleDiff(desired, self.angle) / 0.9, -1, 1);
      return { segments: [{ ticks: 12, steer, throttle: 0.7 }] };
    }
    this.fullDecisions++;
    this.trackProgress(context);
    const shells = this.traceShells(context, arena);
    // Two different questions: how soon a shell actually reaches our frozen pose (danger), and how
    // far ahead the rollout must look (a nearby shell can be driven into even when standing still
    // would miss it).
    const impact = shells.reduce((min, shell) => Math.min(min, shell.impact), Infinity);
    let horizon = 0.3;
    for (const shell of shells) {
      if (Number.isFinite(shell.impact)) horizon = Math.max(horizon, shell.impact + 0.15);
      if (Number.isFinite(shell.reach)) horizon = Math.max(horizon, shell.reach + 0.45);
    }
    horizon = Math.min(horizon, 0.9);

    if (!context.enemies.length) return this.survive(context, shells, impact, horizon);

    const tracks = this.predictEnemies(context, arena);
    const target = this.chooseTarget(context, arena);
    const aim = this.solveAim(context, arena, tracks);
    return this.plan(context, arena, shells, impact, horizon, tracks, target, aim);
  }

  /** Detect real blockage from our own displacement, not only from the engine's stuck sensor. */
  private trackProgress(context: BotContext): void {
    const self = context.self;
    const elapsed = context.match.elapsed;
    const moved = Math.hypot(self.x - this.lastX, self.y - this.lastY);
    this.lastX = self.x;
    this.lastY = self.y;
    if (Math.abs(self.throttle) > 0.35 && moved < 1.2) this.stalledAt += 1 / 12;
    else this.stalledAt = 0;
    if (
      (self.stuck > 0.15 || this.stalledAt > 0.25) &&
      elapsed > this.recoverUntil &&
      elapsed > 0.5
    ) {
      this.recoverUntil = elapsed + 0.7;
      this.stalledAt = 0;
    }
  }

  /** Rebuild the maze index when the round changes and watch the blockage sensor. */
  private sync(context: BotContext): void {
    const key = `${context.map.seed}:${context.match.round}`;
    if (key !== this.arenaKey) {
      this.arenaKey = key;
      this.arena = new Arena(context.map);
      this.enemySpeed.clear();
      this.targetId = -1;
      this.targetUntil = 0;
      this.recoverUntil = -1;
      this.bankScanAt = -10;
      this.bankAim = null;
      this.warmed = false;
      this.lastX = context.self.x;
      this.lastY = context.self.y;
      this.stalledAt = 0;
      this.started = true;
      this.fullDecisions = 0;
    }
    if (context.self.stuck > 0.3 && context.match.elapsed > this.recoverUntil) {
      this.recoverUntil = context.match.elapsed + 0.55;
    }
  }

  private survive(
    context: BotContext,
    shells: ShellPath[],
    impact: number,
    horizon: number,
  ): Decision {
    const arena = this.arena!;
    const self = context.self;
    // No living opponents: keep dodging leftover shells, then hold a heading that can escape.
    let steer = 0;
    let throttle: number;
    if (shells.length) {
      const candidate = this.bestManeuver(context, arena, shells, horizon);
      steer = candidate.steer;
      throttle = candidate.throttle;
    } else {
      const ahead = arena.cast(
        self.x,
        self.y,
        Math.cos(self.angle),
        Math.sin(self.angle),
        90,
        HULL_RADIUS,
      );
      throttle = ahead ? -0.4 : 0.25;
    }
    const ticks = clamp(this.planTicks(impact, 0), MIN_PLAN_TICKS, MAX_PLAN_TICKS);
    this.lastSteer = steer;
    this.lastThrottle = throttle;
    return { segments: [{ ticks, steer, throttle }] };
  }

  private planTicks(impact: number, fireTick: number): number {
    let ticks = impact < 0.55 ? 7 : impact < 0.9 ? 10 : 13;
    if (fireTick > 0) ticks = Math.max(ticks, Math.min(fireTick + 3, MAX_PLAN_TICKS));
    return ticks;
  }

  /** True when this decision has already spent its safe compute share. */
  private overBudget(limitMs = 6): boolean {
    return performance.now() - this.decisionStart > limitMs;
  }

  /** Trace every live shell through its ricochets and sample its position per tick. */
  private traceShells(context: BotContext, arena: Arena): ShellPath[] {
    const self = context.self;
    const shellSpeed = context.rules.shellSpeed;
    const shells: ShellPath[] = [];
    for (const bullet of context.bullets) {
      if (bullet.life <= 0.01) continue;
      if (distance(bullet, self) > shellSpeed * bullet.life + 40) continue;
      const angle = Math.atan2(bullet.vy, bullet.vx);
      const segments = arena.trace(
        bullet.x,
        bullet.y,
        angle,
        10,
        shellSpeed * Math.min(bullet.life, 0.9),
        SHELL_RADIUS,
      );
      if (!segments.length) continue;
      let impact = Infinity;
      for (const segment of segments) {
        const dx = segment.x1 - segment.x0;
        const dy = segment.y1 - segment.y0;
        const t = sweepTank(segment.x0, segment.y0, dx, dy, self);
        if (t !== null) {
          impact = (segment.d0 + t * Math.hypot(dx, dy)) / shellSpeed;
          break;
        }
      }
      const steps = Math.min(MAX_EVAL_TICKS, Math.ceil(Math.min(bullet.life, 0.9) / TICK_DT));
      const xs = new Float32Array(steps + 1);
      const ys = new Float32Array(steps + 1);
      let segmentIndex = 0;
      for (let tick = 0; tick <= steps; tick++) {
        const travel = tick * TICK_DT * shellSpeed;
        while (segmentIndex < segments.length - 1 && travel > segments[segmentIndex].d1)
          segmentIndex++;
        const segment = segments[segmentIndex];
        const span = segment.d1 - segment.d0;
        const u = span > 1e-6 ? clamp((travel - segment.d0) / span, 0, 1) : 0;
        xs[tick] = segment.x0 + (segment.x1 - segment.x0) * u;
        ys[tick] = segment.y0 + (segment.y1 - segment.y0) * u;
      }
      // Earliest tick where the shell is close enough that our own movement could meet it.
      let reach = Infinity;
      const reachSq = 150 * 150;
      for (let tick = 0; tick <= steps; tick += 2) {
        const dx = xs[tick] - self.x;
        const dy = ys[tick] - self.y;
        if (dx * dx + dy * dy < reachSq) {
          reach = tick * TICK_DT;
          break;
        }
      }
      shells.push({
        owner: bullet.owner,
        bounces: bullet.bounces,
        xs,
        ys,
        steps,
        impact,
        reach,
      });
    }
    shells.sort((a, b) => Math.min(a.impact, a.reach) - Math.min(b.impact, b.reach));
    return shells;
  }

  /** Project every enemy forward under the controls it is currently holding. */
  private predictEnemies(context: BotContext, arena: Arena): Map<number, EnemyTrack> {
    const tracks = new Map<number, EnemyTrack>();
    const samples = Math.ceil(TRACK_HORIZON / TRACK_STEP);
    for (const enemy of context.enemies) {
      const speed = this.speedOf(enemy);
      const steer = clamp(enemy.steer, -1, 1);
      const throttle = clamp(enemy.throttle, -1, 1);
      const track: EnemyTrack = {
        id: enemy.id,
        speed,
        samples: [{ t: 0, x: enemy.x, y: enemy.y }],
      };
      let x = enemy.x;
      let y = enemy.y;
      let angle = enemy.angle;
      // Long-horizon intent guess: opponents close on our cell through the maze graph. Beyond the
      // first fraction of a second, follow their shortest route toward us instead of extrapolating
      // held controls into a turn they will not complete. Inside our own cell there is no route,
      // so held controls remain the best model.
      const route =
        arena.route(
          context.cellAt(enemy.x, enemy.y),
          context.cellAt(context.self.x, context.self.y),
        ) || [];
      const useRoute = route.length > 1;
      let waypoint = 1;
      for (let i = 1; i <= samples; i++) {
        angle += steer * ENEMY_TURN * TRACK_STEP;
        const travel = throttle * speed * TRACK_STEP;
        const t = i * TRACK_STEP;
        if (Math.abs(travel) > 0.05 && (!useRoute || t <= 0.3)) {
          const nx = x + Math.cos(angle) * travel;
          const ny = y + Math.sin(angle) * travel;
          if (arena.clearance(nx, ny) >= HULL_RADIUS - 1) {
            x = nx;
            y = ny;
          } else if (arena.clearance(nx, y) >= HULL_RADIUS - 1) {
            x = nx;
          } else if (arena.clearance(x, ny) >= HULL_RADIUS - 1) {
            y = ny;
          }
        } else if (useRoute) {
          let target = arena.center(route[Math.min(waypoint, route.length - 1)]);
          let step = Math.hypot(target.x - x, target.y - y);
          while (step < 6 && waypoint < route.length - 1) {
            waypoint++;
            target = arena.center(route[waypoint]);
            step = Math.hypot(target.x - x, target.y - y);
          }
          const move = Math.min(step, speed * TRACK_STEP);
          if (step > 1) {
            x += ((target.x - x) / step) * move;
            y += ((target.y - y) / step) * move;
          }
        }
        track.samples.push({ t, x, y });
      }
      tracks.set(enemy.id, track);
    }
    return tracks;
  }

  /** Estimate an opponent's top speed from its reported velocity and throttle. */
  private speedOf(enemy: Readonly<BotContext['self']>): number {
    const held = Math.abs(enemy.throttle);
    const measured = Math.hypot(enemy.vx, enemy.vy);
    if (held > 0.25 && measured > 15) {
      const estimate = clamp(measured / held, 60, 140);
      const previous = this.enemySpeed.get(enemy.id);
      this.enemySpeed.set(
        enemy.id,
        previous === undefined ? estimate : previous + (estimate - previous) * 0.35,
      );
    }
    return this.enemySpeed.get(enemy.id) ?? 108;
  }

  /** Target hysteresis: keep the current duel partner unless it died or a threat demands a swap. */
  private chooseTarget(context: BotContext, arena: Arena): BotContext['enemies'][number] {
    const self = context.self;
    const elapsed = context.match.elapsed;
    const current = context.enemies.find((enemy) => enemy.id === this.targetId);
    if (current && elapsed < this.targetUntil) return current;
    let best = context.enemies[0];
    let bestScore = Infinity;
    for (const enemy of context.enemies) {
      const steps = arena.route(
        context.cellAt(self.x, self.y),
        context.cellAt(enemy.x, enemy.y),
      ).length;
      const score =
        steps * 64 +
        distance(self, enemy) * 0.25 +
        (enemy.shield ? 45 : 0) +
        (enemy.powerTime > 0 ? 40 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    this.targetId = best.id;
    this.targetUntil = elapsed + 1.1;
    return best;
  }

  /** Best firing solution available from the current pose. */
  private solveAim(context: BotContext, arena: Arena, tracks: Map<number, EnemyTrack>): Aim | null {
    const self = context.self;
    const shellSpeed = context.rules.shellSpeed;
    const elapsed = context.match.elapsed;
    let best: Aim | null = null;
    const consider = (aim: Aim | null) => {
      if (!aim) return;
      if (!best || aim.quality > best.quality) best = aim;
    };
    for (const enemy of context.enemies) {
      const track = tracks.get(enemy.id);
      if (!track) continue;
      const base = this.interceptAngle(self, track, shellSpeed);
      for (const offset of [0, 0.02, -0.02]) {
        consider(this.evaluateAngle(context, arena, self, base + offset, track, enemy.id, 0));
      }
    }
    if (best) return this.rememberAim(best, elapsed);

    // No direct line. Re-validate the cached ricochet solution, then rescan occasionally.
    const cached = this.bankAim;
    if (cached) {
      const enemy = context.enemies.find((e) => e.id === cached.targetId);
      const track = enemy ? tracks.get(enemy.id) : null;
      if (enemy && track) {
        const refreshed = this.evaluateAngle(
          context,
          arena,
          self,
          cached.angle,
          track,
          enemy.id,
          cached.bounces,
        );
        if (refreshed) return this.rememberAim(refreshed, elapsed);
      }
    }
    if (elapsed - this.bankScanAt < SCAN_REFRESH) return null;
    // Ricochet scans are the most expensive step; skip them while the round-start code is still cold.
    if (this.fullDecisions <= 1) return null;
    if (this.overBudget(5)) return null;
    if (self.cooldown > 0.35 && self.ammo > 0) return null;
    this.bankScanAt = elapsed;
    let scan: Aim | null = null;
    for (const enemy of context.enemies) {
      const track = tracks.get(enemy.id);
      if (!track) continue;
      for (let index = 0; index < 24; index++) {
        if ((index & 3) === 3 && this.overBudget(4.5)) break;
        const angle = index * SCAN_STEP;
        const approach = this.approachShot(context, arena, self, angle, track, 1);
        if (!approach) continue;
        const quality =
          (1 - approach.miss / 20) * clamp(1.1 - (approach.time - 0.3) / 1.4, 0.05, 1) * 0.8;
        if (approach.miss < 20 && (!scan || quality > scan.quality)) {
          scan = {
            angle,
            targetId: enemy.id,
            bounces: 1,
            hitTime: approach.time,
            miss: approach.miss,
            quality,
          };
        }
      }
    }
    if (!scan) {
      this.bankAim = null;
      return null;
    }
    // Local refinement around the coarse angle, now allowing two reflections.
    let refined = scan;
    for (let step = SCAN_STEP / 2; step > 0.008; step /= 2) {
      for (const delta of [step, -step]) {
        const candidate = this.evaluateAngle(
          context,
          arena,
          self,
          refined.angle + delta,
          tracks.get(refined.targetId)!,
          refined.targetId,
          2,
        );
        if (candidate && candidate.quality > refined.quality) refined = candidate;
      }
    }
    this.bankAim = refined;
    return refined.quality > 0 ? this.rememberAim(refined, elapsed) : null;
  }

  private rememberAim(aim: Aim, elapsed: number): Aim {
    this.lastAim = { angle: aim.angle, at: elapsed, targetId: aim.targetId };
    return aim;
  }

  /** The live target id whose firing bearing should be kept while the shot is unavailable. */
  private rememberedTarget(elapsed: number): number | null {
    if (!this.lastAim || elapsed - this.lastAim.at > 0.5) return null;
    return this.lastAim.targetId;
  }

  /** Aim at the intercept point implied by the target's projected track. */
  private interceptAngle(from: Readonly<Point>, track: EnemyTrack, shellSpeed: number): number {
    let time = 0.25;
    let point = trackAt(track, time);
    for (let i = 0; i < 4; i++) {
      const travel = Math.max(0, distance(from, point) - MUZZLE_OFFSET);
      time = travel / shellSpeed;
      point = trackAt(track, time);
    }
    return Math.atan2(point.y - from.y, point.x - from.x);
  }

  /** Closest approach of one traced angle to a track, without accepting/rejecting it. */
  private approachShot(
    context: BotContext,
    arena: Arena,
    pose: Readonly<{ x: number; y: number; angle: number }>,
    angle: number,
    track: EnemyTrack,
    bounces: number,
  ): { time: number; miss: number } | null {
    const shellSpeed = context.rules.shellSpeed;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (arena.cast(pose.x, pose.y, cos, sin, MUZZLE_OFFSET, SHELL_RADIUS)) return null;
    const muzzle = { x: pose.x + cos * MUZZLE_OFFSET, y: pose.y + sin * MUZZLE_OFFSET };
    const maxTime = 2.1;
    const segments = arena.trace(muzzle.x, muzzle.y, angle, bounces, shellSpeed * maxTime);
    return closestApproach(segments, track, shellSpeed, 0, maxTime);
  }

  /** Trace one candidate angle and score it against a predicted target track. */
  private evaluateAngle(
    context: BotContext,
    arena: Arena,
    pose: Readonly<{ x: number; y: number; angle: number }>,
    angle: number,
    track: EnemyTrack,
    targetId: number,
    bounces: number,
  ): Aim | null {
    const approach = this.approachShot(context, arena, pose, angle, track, bounces);
    if (!approach || approach.miss > HIT_RADIUS + 4) return null;
    const quality =
      (1 - approach.miss / (HIT_RADIUS + 4)) *
      clamp(1.15 - (approach.time - 0.3) / 1.15, 0.05, 1) *
      (bounces ? 0.72 : 1);
    return {
      angle,
      targetId,
      bounces,
      hitTime: approach.time,
      miss: approach.miss,
      quality,
    };
  }

  /** Build and score the maneuver for this decision. */
  private plan(
    context: BotContext,
    arena: Arena,
    shells: ShellPath[],
    impact: number,
    horizon: number,
    tracks: Map<number, EnemyTrack>,
    target: BotContext['enemies'][number],
    aim: Aim | null,
  ): Decision {
    const self = context.self;
    const elapsed = context.match.elapsed;

    // Nominal intent: point the gun at the best solution, otherwise follow the route.
    let desired: number;
    let throttle: number;
    if (aim) {
      desired = aim.angle;
      const range = distance(self, target);
      throttle = range > 170 ? 1 : range > 120 ? 0.7 : range < 65 ? -0.7 : 0.15;
    } else {
      const remembered =
        this.lastAim && elapsed - this.lastAim.at < 0.45 ? this.lastAim.angle : null;
      const goal = this.goalCell(context, arena, target);
      const waypoint = this.navigator.waypoint(arena, context, goal);
      const routeHeading = Math.atan2(waypoint.y - self.y, waypoint.x - self.x);
      // While the firing bearing is still fresh, keep the hull trained on it and travel sideways.
      desired = remembered ?? routeHeading;
      const error = Math.abs(angleDiff(remembered ?? routeHeading, self.angle));
      throttle = error > 1.25 ? 0.2 : error > 0.5 ? 0.6 : 1;
      if (self.stuck > 0.25) throttle = -0.5;
    }
    if (elapsed < this.recoverUntil) {
      // Back out of the blockage while rotating toward the most open heading.
      let bestDelta = 0;
      let bestOpen = -Infinity;
      for (const delta of [2.4, 1.6, 0.9, -0.9, -1.6, -2.4]) {
        const heading = self.angle + delta;
        const reach = 80;
        const clear = !arena.cast(
          self.x,
          self.y,
          Math.cos(heading),
          Math.sin(heading),
          reach,
          HULL_RADIUS,
        );
        const score = (clear ? 2 : 0) + Math.cos(delta);
        if (score > bestOpen) {
          bestOpen = score;
          bestDelta = delta;
        }
      }
      desired = self.angle + bestDelta;
      throttle = -0.8;
    }
    const nominalSteer = clamp(angleDiff(desired, self.angle) / (this.turn * 0.1), -1, 1);

    // A shell that will actually reach our current hull takes priority over every other objective.
    // A shell merely passing nearby only widens the look-ahead, so it must not disarm the gun.
    const panic = impact < 0.5;
    const evalTicks = clamp(Math.ceil(horizon / TICK_DT), 32, MAX_EVAL_TICKS);

    const maneuvers: Maneuver[] = [
      { steer: nominalSteer, throttle },
      { steer: 0, throttle: 0 },
      { steer: nominalSteer, throttle: 0 },
    ];
    for (const steer of [-1, -0.7, -0.4, -0.15, 0.15, 0.4, 0.7, 1]) {
      for (const drive of [1, 0.45, -0.45, -1]) {
        maneuvers.push({ steer, throttle: drive });
      }
    }
    // Aiming candidates: turn exactly onto the current firing bearing within k ticks.
    if (aim) {
      const diff = angleDiff(aim.angle, self.angle);
      for (const ticks of [2, 3, 5, 8]) {
        const steer = clamp(diff / (this.turn * ticks * TICK_DT), -1, 1);
        for (const drive of [0.9, 0.2, -0.5]) maneuvers.push({ steer, throttle: drive });
      }
    }

    const fireWindow = Math.min(evalTicks, 16);
    const canFire = (tick: number): boolean => {
      if (self.ammo <= 0 && context.match.elapsed + tick * TICK_DT < 70) return false;
      return self.cooldown - tick * TICK_DT <= 0.002;
    };
    const goal = aim ? null : this.goalPoint(context, arena, target);
    // Commit to short lateral jinks while a loaded opponent has a clean line on us. Constant
    // velocity is what their lead projection expects; changing it is the cheapest defence.
    const watched = context.enemies.some(
      (enemy) =>
        enemy.cooldown < 0.2 &&
        (enemy.ammo > 0 || elapsed >= 70) &&
        distance(self, enemy) < 430 &&
        arena.lineClear(enemy.x, enemy.y, self.x, self.y, SHELL_RADIUS),
    );
    const canTrade = aim !== null && aim.quality > 0.5 && self.cooldown < 0.14;
    if (watched && !canTrade && elapsed >= this.jink.until) {
      this.jink = {
        until: elapsed + 0.2 + context.random() * 0.12,
        dir: context.random() < 0.5 ? -1 : 1,
      };
    }
    // A volley is only possible inside the plan window; while cooling down, movement matters more.
    const readySoon = self.cooldown <= Math.min(fireWindow, 12) * TICK_DT + 0.03;
    // Enemy gun lines: standing on a loaded opponent's barrel line is a free hit for them.
    const guns: { mx: number; my: number; ux: number; uy: number; ready: boolean }[] = [];
    for (const enemy of context.enemies) {
      const ready =
        enemy.cooldown < 0.14 &&
        (enemy.ammo > 0 ||
          elapsed >= context.rules.roundDuration - context.rules.infiniteAmmoDuration);
      const ux = Math.cos(enemy.angle);
      const uy = Math.sin(enemy.angle);
      const mx = enemy.x + ux * MUZZLE_OFFSET;
      const my = enemy.y + uy * MUZZLE_OFFSET;
      // A wall between us makes their direct shot impossible; bank shots are already rare.
      if (!ready || !arena.lineClear(mx, my, self.x, self.y, SHELL_RADIUS)) continue;
      guns.push({ mx, my, ux, uy, ready });
    }
    const tipX = self.x + Math.cos(self.angle) * (MUZZLE_OFFSET - 1.5);
    const tipY = self.y + Math.sin(self.angle) * (MUZZLE_OFFSET - 1.5);
    const tipNow = arena.clearance(tipX, tipY);
    const blockedNow = tipNow < 3 || self.stuck > 0.15 || elapsed < this.recoverUntil;

    let best: Candidate = {
      steer: nominalSteer,
      throttle,
      score: -Infinity,
      fireTick: -1,
    };
    const seen = new Set<string>();
    let evaluated = 0;
    for (const maneuver of maneuvers) {
      const key = `${maneuver.steer.toFixed(3)}:${maneuver.throttle.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Safety valve: never let one decision run past the dispatcher's budget.
      if ((++evaluated & 3) === 0 && this.overBudget(4.5)) break;
      const rollout = this.rollout(context, arena, maneuver, evalTicks);
      let score = 0;

      // --- Survival -------------------------------------------------------
      let hitPenalty = 0;
      let proximity = 0;
      const stalled = rollout.stalled * 30;
      for (const shell of shells) {
        if (shell.owner === self.id && shell.bounces === 0) continue;
        let closestSq = Infinity;
        let closestTick = 0;
        let hitTick = 0;
        const limit = Math.min(evalTicks, shell.steps);
        for (let tick = 1; tick <= limit; tick += 2) {
          const dx = shell.xs[tick] - rollout.xs[tick];
          const dy = shell.ys[tick] - rollout.ys[tick];
          const dSq = dx * dx + dy * dy;
          if (dSq < closestSq) {
            closestSq = dSq;
            closestTick = tick;
          }
          // Within reach of the hull or barrel: test the real silhouette along this interval.
          if (dSq < 38 * 38) {
            const from = Math.max(0, tick - 2);
            const to = Math.min(limit, tick + 2);
            const pose = {
              x: rollout.xs[tick],
              y: rollout.ys[tick],
              angle: rollout.angles[tick],
            };
            const hit = sweepTank(
              shell.xs[from],
              shell.ys[from],
              shell.xs[to] - shell.xs[from],
              shell.ys[to] - shell.ys[from],
              pose,
            );
            if (hit !== null && hitTick === 0) hitTick = tick;
          }
        }
        if (hitTick > 0) {
          const urgency = 1.3 - hitTick / (evalTicks + 1);
          hitPenalty += 260 * urgency;
        } else if (closestSq < (DANGER_RADIUS + 10) * (DANGER_RADIUS + 10)) {
          const urgency = 1.15 - closestTick / (evalTicks + 1);
          proximity +=
            Math.max(0, DANGER_RADIUS + 10 - Math.sqrt(closestSq)) ** 2 *
            0.08 *
            Math.max(0, urgency);
        }
      }
      score -= hitPenalty + proximity + stalled;

      // --- Terminal space -------------------------------------------------
      const endX = rollout.xs[evalTicks];
      const endY = rollout.ys[evalTicks];
      const endClearance = arena.clearance(endX, endY);
      if (endClearance < 20) score -= (20 - endClearance) * 2.5;
      const endTipX = endX + Math.cos(rollout.angles[evalTicks]) * (MUZZLE_OFFSET - 1.5);
      const endTipY = endY + Math.sin(rollout.angles[evalTicks]) * (MUZZLE_OFFSET - 1.5);
      const endTip = arena.clearance(endTipX, endTipY);
      if (endTip < 3) score -= (3 - endTip) * 4;
      if (blockedNow) {
        // When the barrel is buried or progress has stopped, opening room beats any route goal.
        score += (endTip - tipNow) * 14;
        score += Math.abs(endX - self.x) + Math.abs(endY - self.y);
        if (maneuver.throttle < 0) score += 3;
      }
      if (rollout.xs[evalTicks] === self.x && rollout.ys[evalTicks] === self.y && maneuver.throttle)
        score -= 6;

      // --- Offensive alignment -------------------------------------------
      let fireTick = -1;
      let closestDiff = Infinity;
      if (aim && !panic) {
        const track = tracks.get(aim.targetId);
        if (track) {
          for (let tick = 1; tick <= fireWindow; tick++) {
            if (!canFire(tick)) continue;
            const required = this.aimFromPoint(rollout.xs[tick], rollout.ys[tick], track, tick);
            const diff = Math.abs(angleDiff(required, rollout.angles[tick]));
            if (diff < closestDiff) closestDiff = diff;
            const tolerance = clamp(
              Math.atan2(12, Math.max(70, distance(self, trackAt(track, tick * TICK_DT)))),
              0.012,
              0.09,
            );
            if (diff <= tolerance) {
              fireTick = tick;
              break;
            }
          }
        }
      }
      // Hull-mounted gun: turning toward the firing bearing is part of defence, not only offence.
      // The bearing is tracked even while a shell forces a dodge, and briefly remembered after line
      // of sight flickers so the gun does not wander off the threat.
      const facingId = aim?.targetId ?? this.rememberedTarget(elapsed);
      const facingTrack = facingId === null ? undefined : tracks.get(facingId);
      if (!panic && facingTrack) {
        const endTick = Math.min(fireWindow, evalTicks);
        const requiredEnd = this.aimFromPoint(
          rollout.xs[endTick],
          rollout.ys[endTick],
          facingTrack,
          endTick,
        );
        const error = Math.abs(angleDiff(requiredEnd, rollout.angles[endTick]));
        const weight = (aim ? aim.quality : 0.45) * (readySoon ? 1 : 0.8);
        // Angular attraction from any heading plus a sharper bonus close to the bearing.
        score += 30 * weight * (1 - error / Math.PI);
        score += 26 * weight * Math.max(0, Math.cos(error));
        if (aim && closestDiff < Infinity) {
          const closeness = clamp(1 - closestDiff / 0.7, 0, 1);
          score += 55 * closeness * aim.quality;
        }
        if (aim && fireTick > 0) {
          score += 170 * aim.quality * clamp(1.1 - fireTick / 30, 0.4, 1);
        }
      }

      // --- Positioning ----------------------------------------------------
      if (!panic && (!aim || fireTick < 0)) {
        if (aim) {
          const range = distance({ x: rollout.xs[evalTicks], y: rollout.ys[evalTicks] }, target);
          score -= Math.abs(range - 190) * 0.05;
        } else if (goal) {
          const start = distance(self, goal);
          const end = Math.hypot(rollout.xs[evalTicks] - goal.x, rollout.ys[evalTicks] - goal.y);
          score += (start - end) * 1.4;
          // Keep the hull (and therefore the gun) pointed along the route unless congested.
          score += maneuver.throttle * 3.5;
          if (maneuver.throttle < 0 && !blockedNow) score -= 9;
        }
      }
      if (guns.length && !panic) {
        let exposure = 0;
        for (const gun of guns) {
          const dx = endX - gun.mx;
          const dy = endY - gun.my;
          const along = dx * gun.ux + dy * gun.uy;
          if (along < 0 || along > 620) continue;
          const lateral = Math.abs(dx * gun.uy - dy * gun.ux);
          if (lateral < 30) exposure += (30 - lateral) * 1.5;
        }
        // While the gun cannot fire yet, clearing their line is worth more than keeping the bead.
        const trade = readySoon && aim !== null && aim.quality > 0.5 ? 0.35 : readySoon ? 1 : 2.1;
        score -= exposure * (self.shield ? 0.55 : 1) * trade;
      }
      // Standing still is a gift to a loaded opponent; keep the hull moving while it fires.
      if (aim && !blockedNow) score += Math.abs(maneuver.throttle) * 1.6;
      if (watched && !canTrade && !blockedNow && elapsed < this.jink.until) {
        // Lateral displacement across the nearest threat's sight line, in the committed direction.
        const threat = context.enemies.reduce((a, b) =>
          distance(self, a) < distance(self, b) ? a : b,
        );
        const bx = self.x - threat.x;
        const by = self.y - threat.y;
        const length = Math.hypot(bx, by) || 1;
        const side =
          ((endX - self.x) * (-by / length) + (endY - self.y) * (bx / length)) * this.jink.dir;
        score += clamp(side, -6, 42) * 0.9;
        score -= (evalTicks - rollout.stalled * 120) * 0;
      }
      // Strong hysteresis: a dodge that changes direction every 0.1 s never gets anywhere.
      const stick = panic ? 9 : 4.2;
      score -= Math.abs(maneuver.steer - this.lastSteer) * stick;
      score -= Math.abs(maneuver.throttle - this.lastThrottle) * (stick * 0.8);

      if (score > best.score) {
        best = { steer: maneuver.steer, throttle: maneuver.throttle, score, fireTick };
      }
    }

    // Validate the selected trigger tick against the real shell trace.
    let fireTick = -1;
    if (best.fireTick > 0 && aim) {
      const track = tracks.get(aim.targetId);
      if (track) {
        for (let tick = best.fireTick; tick <= Math.min(best.fireTick + 3, evalTicks); tick++) {
          if (!canFire(tick)) continue;
          const rollout = this.rollout(context, arena, best, tick);
          const pose = {
            x: rollout.xs[tick],
            y: rollout.ys[tick],
            angle: rollout.angles[tick],
          };
          if (!this.triggerCheck(context, arena, pose, track, tick, aim)) continue;
          fireTick = tick;
          break;
        }
      }
    }
    const ticks = this.planTicks(impact, fireTick);
    this.lastSteer = best.steer;
    this.lastThrottle = best.throttle;
    const segments: DecisionSegment[] = [];
    let remaining = ticks;
    if (fireTick > 1) {
      const turn = Math.min(fireTick - 1, remaining);
      segments.push({ ticks: turn, steer: best.steer, throttle: best.throttle });
      remaining -= turn;
    }
    if (fireTick > 0 && remaining > 0) {
      segments.push({
        ticks: 1,
        steer: best.steer,
        throttle: best.throttle,
        fire: 'once',
      });
      remaining -= 1;
    }
    if (remaining > 0)
      segments.push({ ticks: remaining, steer: best.steer, throttle: best.throttle });
    return { segments };
  }

  /** Bearing from a future position to the intercept point at a future tick. */
  private aimFromPoint(x: number, y: number, track: EnemyTrack, tick: number): number {
    const now = tick * TICK_DT;
    let time = now + 0.2;
    let point = trackAt(track, time);
    for (let i = 0; i < 2; i++) {
      const travel = Math.max(0, Math.hypot(point.x - x, point.y - y) - MUZZLE_OFFSET) / 140;
      time = now + travel;
      point = trackAt(track, time);
    }
    return Math.atan2(point.y - y, point.x - x);
  }

  /** Final check that a planned trigger actually puts a shell on the predicted target. */
  private triggerCheck(
    context: BotContext,
    arena: Arena,
    pose: Readonly<{ x: number; y: number; angle: number }>,
    track: EnemyTrack,
    tick: number,
    aim: Aim,
  ): boolean {
    const shellSpeed = context.rules.shellSpeed;
    const angle = pose.angle;
    const muzzle = {
      x: pose.x + Math.cos(angle) * MUZZLE_OFFSET,
      y: pose.y + Math.sin(angle) * MUZZLE_OFFSET,
    };
    if (arena.cast(pose.x, pose.y, Math.cos(angle), Math.sin(angle), MUZZLE_OFFSET, SHELL_RADIUS))
      return false;
    const segments = arena.trace(
      muzzle.x,
      muzzle.y,
      angle,
      Math.max(aim.bounces, 8),
      shellSpeed * 7.5,
    );
    const offset = tick * TICK_DT;
    const approach = closestApproach(segments, track, shellSpeed, offset, 2.2);
    if (!approach || approach.miss > HIT_RADIUS + 2.5) return false;
    // Reject solutions whose shell loops back near our hull. A tank can drive into a returning
    // shell, so this uses an inflated hull radius over the first part of the flight.
    const guard = 34;
    for (let index = 1; index < segments.length; index++) {
      const segment = segments[index];
      const dx = segment.x1 - segment.x0;
      const dy = segment.y1 - segment.y0;
      const lengthSq = dx * dx + dy * dy;
      const u =
        lengthSq > 1e-9
          ? clamp(((pose.x - segment.x0) * dx + (pose.y - segment.y0) * dy) / lengthSq, 0, 1)
          : 0;
      const miss = Math.hypot(segment.x0 + dx * u - pose.x, segment.y0 + dy * u - pose.y);
      if (miss < guard) return false;
    }
    return true;
  }

  /** Simulate constant controls tick by tick with wall and tank collision. */
  private rollout(context: BotContext, arena: Arena, maneuver: Maneuver, ticks: number): Rollout {
    const self = context.self;
    const xs = new Float32Array(ticks + 1);
    const ys = new Float32Array(ticks + 1);
    const angles = new Float32Array(ticks + 1);
    xs[0] = self.x;
    ys[0] = self.y;
    angles[0] = self.angle;
    let x = self.x;
    let y = self.y;
    let angle = self.angle;
    let stalled = 0;
    const blockers = context.enemies;
    for (let tick = 1; tick <= ticks; tick++) {
      const target = angle + maneuver.steer * this.turn * TICK_DT;
      const tipX = x + Math.cos(target) * (MUZZLE_OFFSET - 2.5);
      const tipY = y + Math.sin(target) * (MUZZLE_OFFSET - 2.5);
      if (arena.clearance(x, y) >= TURN_RADIUS - 0.5 && arena.clearance(tipX, tipY) >= 0.9) {
        angle = target;
      } else stalled += TICK_DT;
      const travel = maneuver.throttle * this.speed * TICK_DT;
      if (Math.abs(travel) > 1e-6) {
        const dx = Math.cos(angle) * travel;
        const dy = Math.sin(angle) * travel;
        if (this.canStand(arena, x + dx, y + dy, angle, blockers)) {
          x += dx;
          y += dy;
        } else {
          let moved = false;
          if (this.canStand(arena, x + dx, y, angle, blockers)) {
            x += dx;
            moved = true;
          }
          if (this.canStand(arena, x, y + dy, angle, blockers)) {
            y += dy;
            moved = true;
          }
          if (!moved) stalled += TICK_DT;
        }
      }
      xs[tick] = x;
      ys[tick] = y;
      angles[tick] = angle;
    }
    return { xs, ys, angles, stalled };
  }

  private canStand(
    arena: Arena,
    x: number,
    y: number,
    angle: number,
    blockers: readonly Readonly<BotContext['self']>[],
  ): boolean {
    if (arena.clearance(x, y) < HULL_RADIUS) return false;
    // The barrel cannot pass through a wall, but a tank already touching one may still reverse,
    // so movement itself only requires hull clearance.
    for (const other of blockers) {
      if ((other.x - x) ** 2 + (other.y - y) ** 2 < 29 ** 2) return false;
    }
    return true;
  }

  /** Maneuver used when there are no enemies left to fight. */
  private bestManeuver(
    context: BotContext,
    arena: Arena,
    shells: ShellPath[],
    horizon: number,
  ): Maneuver {
    const evalTicks = clamp(Math.ceil(horizon / TICK_DT), 32, MAX_EVAL_TICKS);
    let best: Maneuver = { steer: 0, throttle: 0 };
    let bestScore = -Infinity;
    for (const steer of [-1, -0.6, -0.25, 0, 0.25, 0.6, 1]) {
      for (const throttle of [1, 0.5, 0, -0.5, -1]) {
        const rollout = this.rollout(context, arena, { steer, throttle }, evalTicks);
        let score = -rollout.stalled * 30;
        for (const shell of shells) {
          let closest = Infinity;
          let closestTick = 0;
          const limit = Math.min(evalTicks, shell.steps);
          for (let tick = 1; tick <= limit; tick++) {
            const d = Math.hypot(
              shell.xs[tick] - rollout.xs[tick],
              shell.ys[tick] - rollout.ys[tick],
            );
            if (d < closest) {
              closest = d;
              closestTick = tick;
            }
          }
          if (closest < DANGER_RADIUS) {
            score -= 300 * (1.25 - closestTick / (evalTicks + 1));
          } else if (closest < PROXIMITY_RADIUS) {
            score -= (PROXIMITY_RADIUS - closest) ** 2 * 0.14;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = { steer, throttle };
        }
      }
    }
    return best;
  }

  /** Head for a useful pickup when close, otherwise close on the target. */
  private goalCell(
    context: BotContext,
    arena: Arena,
    target: BotContext['enemies'][number],
  ): number {
    const self = context.self;
    const from = context.cellAt(self.x, self.y);
    const targetCell = context.cellAt(target.x, target.y);
    let goal = targetCell;
    let bestValue = 0;
    const enemySteps = arena.route(from, targetCell).length;
    for (const powerup of context.powerups) {
      const id = context.cellAt(powerup.x, powerup.y);
      const steps = arena.route(from, id).length;
      if (!steps) continue;
      const utility =
        powerup.type === 'shield' ? (self.shield ? 0.2 : 1) : powerup.type === 'rapid' ? 0.85 : 0.6;
      const value = (utility * 9) / steps - (powerup.life < 3 ? 0.4 : 0);
      if (value > bestValue && steps <= enemySteps + 4) {
        bestValue = value;
        goal = id;
      }
    }
    return goal;
  }

  private goalPoint(
    context: BotContext,
    arena: Arena,
    target: BotContext['enemies'][number],
  ): Point {
    return this.navigator.waypoint(arena, context, this.goalCell(context, arena, target));
  }
}
