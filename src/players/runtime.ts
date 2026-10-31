import type { Game } from '../engine.ts';
import { RULES } from '../rules.ts';
import { HumanConnection } from './human-connection.ts';
import { freezeTree } from '../bots/context.ts';
import {
  DECISION_BUDGET_MS,
  DecisionExecutor,
  neutralDecision,
  TICK_DT,
  validateDecision,
} from './decision.ts';
import type { PlayerInput } from '../types.ts';
import type { Decision } from './types.ts';
import type {
  BotConnectionFactory,
  ConnectionEvents,
  PlayerConnection,
  PlanEnvelope,
  RoundInit,
} from './connection.ts';

export interface DecisionStatistics {
  requests: number;
  deadlineMisses: number;
  busySkips: number;
  invalidPlans: number;
  lateReplies: number;
}
interface Request {
  generation: number;
  round: number;
  tick: number;
  started: number;
  result?: Decision;
}

/** Shared tick scheduler. Transports can finish in any order; physics cannot. */
export class PlayerRuntime {
  readonly connections = new Map<number, PlayerConnection>();
  readonly statistics = new Map<number, DecisionStatistics>();
  private readonly tokens = new Map<number, { active: boolean }>();
  private readonly executor = new DecisionExecutor();
  private readonly requests = new Map<number, Request>();
  private readonly sequences = new Map<number, number>();
  private readonly waiters = new Set<() => void>();
  private readonly physicsStep: (dt: number) => void;
  private roundKey = '';
  private state: Game['state'] = 'ready';
  private input: Readonly<PlayerInput> = {};
  private disposed = false;
  private lastWall: number;
  private wakeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly game: Game,
    private readonly botFactory: BotConnectionFactory,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.physicsStep = game.update.bind(game);
    this.lastWall = now();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
  get blocked(): boolean {
    if (this.disposed) return false;
    if (this.game.state === 'ready' || this.game.state === 'matchOver') return false;
    if (this.game.state === 'paused') return true;
    return (
      this.game.tanks.some(
        (t) => t.alive && this.game.players.get(t.id)?.status === 'connecting',
      ) || [...this.requests.values()].some((request) => !request.result)
    );
  }

  sync(): void {
    if (this.disposed || this.game.state === 'ready') return;
    const game = this.game;
    const key = `${game.generation}:${game.round}`;
    if (key !== this.roundKey) {
      this.closeConnections();
      this.roundKey = key;
      this.lastWall = this.now();
      for (const tank of game.tanks) {
        if (!tank.alive) continue;
        const token = { active: true };
        this.tokens.set(tank.id, token);
        if (!this.statistics.has(tank.id))
          this.statistics.set(tank.id, {
            requests: 0,
            deadlineMisses: 0,
            busySkips: 0,
            invalidPlans: 0,
            lateReplies: 0,
          });
        const init: RoundInit = {
          generation: game.generation,
          round: game.round,
          playerId: tank.id,
          botId: tank.controller.kind === 'bot' ? tank.controller.botId : 'human',
          seed: `${game.map.seed}:${game.round}:${tank.id}`,
          map: structuredClone(game.map),
          rules: RULES,
        };
        const current = () =>
          token.active &&
          game.generation === init.generation &&
          game.round === init.round &&
          game.tanks[tank.id]?.alive;
        const events: ConnectionEvents = {
          ready: (profile) => {
            if (current()) game.playerReady(tank.id, profile);
            this.signal();
          },
          decision: (envelope) => {
            if (!current()) return;
            if (tank.controller.kind === 'human') {
              if (game.state === 'playing')
                this.executor.accept(tank.id, validateDecision(envelope.decision), game.tick);
            } else this.receive(tank.id, envelope);
          },
          failed: (reason) => {
            if (!current()) return;
            token.active = false;
            this.requests.delete(tank.id);
            this.executor.remove(tank.id);
            game.playerFailed(tank.id, reason);
            this.connections.get(tank.id)?.dispose();
            this.signal();
          },
        };
        try {
          const connection =
            tank.controller.kind === 'human'
              ? new HumanConnection(init, events)
              : this.botFactory(init, events);
          this.connections.set(tank.id, connection);
          if (!token.active) connection.dispose();
        } catch (error) {
          events.failed(error instanceof Error ? error.message : 'Could not start bot worker.');
        }
      }
    }
    if (this.state !== game.state) {
      if (this.state === 'paused' || game.state === 'paused') this.input = {};
      this.lastWall = this.now();
      this.state = game.state;
    }
    for (const [id, connection] of this.connections) {
      if (!game.tanks[id]?.alive || game.state === 'roundOver' || game.state === 'matchOver') {
        const token = this.tokens.get(id);
        if (token) token.active = false;
        connection.dispose();
        this.requests.delete(id);
        this.executor.remove(id);
        game.playerClosed(id);
      }
    }
    this.signal();
  }

  setInput(input: Readonly<PlayerInput>): void {
    if (this.disposed) return;
    this.sync();
    this.input = Object.freeze({ ...input });
  }
  private receive(id: number, envelope: PlanEnvelope): void {
    const request = this.requests.get(id);
    const stats = this.statistics.get(id)!;
    if (
      !request ||
      request.generation !== envelope.generation ||
      request.round !== envelope.round ||
      request.tick !== envelope.tick
    ) {
      stats.lateReplies++;
      return;
    }
    if (!request.result && this.now() - request.started >= DECISION_BUDGET_MS) {
      stats.deadlineMisses++;
      request.result = neutralDecision();
    }
    if (request.result) {
      stats.lateReplies++;
      this.signal();
      return;
    }
    try {
      request.result = validateDecision(envelope.decision);
    } catch {
      stats.invalidPlans++;
      request.result = neutralDecision();
    }
    this.signal();
  }

  /** Watchdogs use unpaused wall time; decision deadlines continue during a pause. */
  private poll(): void {
    const now = this.now();
    const wall = Math.max(0, now - this.lastWall);
    this.lastWall = now;
    if (this.game.state === 'playing' || this.game.state === 'countdown') {
      for (const connection of this.connections.values()) connection.advance(wall);
    }
    for (const [id, request] of this.requests) {
      if (!request.result && now - request.started >= DECISION_BUDGET_MS) {
        this.statistics.get(id)!.deadlineMisses++;
        request.result = neutralDecision();
      }
    }
    this.signal();
    this.armWake();
  }
  private armWake(): void {
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
    if (this.disposed || !this.blocked) return;
    const deadlines = [...this.requests.values()]
      .filter((r) => !r.result)
      .map((r) => Math.max(1, r.started + DECISION_BUDGET_MS - this.now()));
    const delay = deadlines.length ? Math.min(...deadlines) : 100;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      this.sync();
      this.poll();
    }, delay);
  }
  private signal(): void {
    if (this.blocked) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
  async whenUnblocked(): Promise<void> {
    this.sync();
    this.poll();
    if (!this.blocked) return;
    await new Promise<void>((resolve) => {
      this.waiters.add(resolve);
      this.armWake();
    });
  }

  /** Returns false while waiting or paused. Only true consumes one simulation timestep. */
  step(dt = TICK_DT): boolean {
    if (this.disposed || dt <= 0) return false;
    this.sync();
    this.poll();
    const game = this.game;
    if (game.state === 'ready' || game.state === 'paused' || game.state === 'matchOver')
      return false;
    if (this.blocked) return false;
    if (game.state === 'playing') {
      // Existing results belong to this boundary, including outcomes buffered during pause.
      this.commit();
      const due = game.tanks.filter(
        (t) =>
          t.alive &&
          t.controller.kind === 'bot' &&
          game.players.get(t.id)?.status === 'ready' &&
          this.executor.due(t.id, game.tick),
      );
      if (due.length) {
        const frame = game.snapshot();
        freezeTree(frame);
        for (const tank of due) {
          const connection = this.connections.get(tank.id)!;
          const stats = this.statistics.get(tank.id)!;
          if (connection.busy) {
            stats.busySkips++;
            this.executor.accept(tank.id, neutralDecision(), game.tick);
            continue;
          }
          const request: Request = {
            generation: game.generation,
            round: game.round,
            tick: game.tick,
            started: this.now(),
          };
          this.requests.set(tank.id, request);
          stats.requests++;
          connection.observe(frame);
        }
        this.poll();
        if (this.blocked) return false;
        this.commit();
      }
      if (game.humanId !== null)
        this.connections.get(game.humanId)?.setInput?.(this.input, game.controlStamp());
      for (const tank of game.tanks) {
        if (!tank.alive || game.players.get(tank.id)?.status !== 'ready') continue;
        const sequence = (this.sequences.get(tank.id) ?? 0) + 1;
        this.sequences.set(tank.id, sequence);
        game.submitDecision(tank.id, {
          ...game.controlStamp(),
          sequence,
          decision: this.executor.controls(tank.id, game.tick),
        });
      }
    }
    this.physicsStep(dt);
    this.sync();
    return true;
  }
  private commit(): void {
    for (const [id, request] of [...this.requests].sort(([a], [b]) => a - b)) {
      if (
        request.result &&
        this.game.tanks[id]?.alive &&
        this.game.players.get(id)?.status === 'ready'
      )
        this.executor.accept(id, request.result, this.game.tick);
    }
    this.requests.clear();
  }
  private closeConnections(): void {
    for (const token of this.tokens.values()) token.active = false;
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
    this.tokens.clear();
    this.executor.clear();
    this.requests.clear();
    this.sequences.clear();
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer);
    this.wakeTimer = undefined;
    // A generation change cancels the old boundary even if replacement controllers are starting.
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closeConnections();
    for (const tank of this.game.tanks) this.game.playerClosed(tank.id);
    this.input = {};
    this.signal();
  }
}
