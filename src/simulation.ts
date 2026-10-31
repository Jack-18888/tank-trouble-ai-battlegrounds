import { Game } from './engine.ts';
import { hasBot } from './bots/index.ts';
import { PlayerRuntime } from './players/runtime.ts';
import { DECISION_BUDGET_MS, RETRY_TICKS, TICK_DT, TICK_RATE } from './players/decision.ts';
import type { DecisionStatistics } from './players/runtime.ts';
import type { BotConnectionFactory } from './players/connection.ts';
import { ReplayRecorder } from './replay.ts';
import type { RoundReplay } from './replay.ts';
import type { GameConfig } from './types.ts';

export const SIMULATION_DT = TICK_DT;
export const SIMULATION_SCHEDULING = Object.freeze({
  version: 1,
  tickRate: TICK_RATE,
  decisionBudgetMs: DECISION_BUDGET_MS,
  retryTicks: RETRY_TICKS,
});
export type Outcome = 'win' | 'tie' | 'loss';
export interface SimulationPlan {
  bots: [string, string];
  count: number;
  seed: string;
  size: GameConfig['size'];
  density: GameConfig['density'];
  powerups: boolean;
  /** Zero samples independent single rounds; a positive target samples whole matches. */
  target: GameConfig['target'];
  maxRounds: number;
  swapSides: boolean;
}
export interface SimulationResult {
  index: number;
  seed: string;
  swapped: boolean;
  /** Outcome from the perspective of the first named bot, independent of roster position. */
  outcome: Outcome | 'capped';
  rounds: number;
  winnerId: number | null;
  /** Roster order, matching the replay's tank IDs. */
  scores: number[];
  kills: number[];
  simulatedSeconds: number;
  decisionStatistics?: DecisionStatistics[];
}
export interface SimulationReport {
  format: 'tank-trouble-simulation';
  version: 1 | 2;
  execution: 'in-process' | 'node-workers' | 'browser-workers';
  scheduling?: typeof SIMULATION_SCHEDULING;
  environment: string;
  /** Requested wall-time multiplier for browser runs; absent in older reports means 1x. */
  browserSpeed?: number;
  sourceHash: string;
  plan: SimulationPlan;
  results: SimulationResult[];
  elapsedMs: number;
}

export function validateBrowserSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed < 1 || speed > 64)
    throw new Error('Browser speed must be a finite number between 1 and 64.');
}

export function validateSimulationPlan(plan: SimulationPlan): void {
  if (plan.bots.length !== 2 || !plan.bots.every(hasBot))
    throw new Error('Choose two registered bot IDs.');
  if (!Number.isSafeInteger(plan.count) || plan.count < 1)
    throw new Error('The sample count must be a positive integer.');
  if (!Number.isSafeInteger(plan.maxRounds) || plan.maxRounds < 1)
    throw new Error('The round limit must be a positive integer.');
  if (![0, 3, 5, 10].includes(plan.target)) throw new Error('Target must be 0, 3, 5, or 10.');
  if (!['compact', 'classic', 'large'].includes(plan.size)) throw new Error('Unknown map size.');
  if (!['open', 'balanced', 'dense'].includes(plan.density))
    throw new Error('Unknown maze density.');
  if (typeof plan.seed !== 'string' || !plan.seed.length)
    throw new Error('Provide a nonempty seed.');
  if (`${plan.seed}:${plan.count - 1}`.toUpperCase().length > 128)
    throw new Error("The seed plus sample index must fit the replay format's 128-character limit.");
  if (typeof plan.powerups !== 'boolean' || typeof plan.swapSides !== 'boolean')
    throw new Error('Powerups and side swapping must be booleans.');
}

/** Shared async stepping/recording driver; callers choose only transport and wall-clock pacing. */
export class BotSimulation {
  readonly game: Game;
  readonly runtime: PlayerRuntime;
  /** A completed replay is exposed for one step only, so callers can save and release it. */
  replay: RoundReplay | null = null;
  result: SimulationResult | null = null;
  private readonly recorder: ReplayRecorder | null;
  private steps = 0;
  readonly seed: string;
  readonly swapped: boolean;
  private stepping = false;

  constructor(
    readonly plan: SimulationPlan,
    readonly index: number,
    record = false,
    factory: BotConnectionFactory,
    now?: () => number,
  ) {
    validateSimulationPlan(plan);
    if (!Number.isSafeInteger(index) || index < 0 || index >= plan.count)
      throw new Error('Sample index is outside the plan.');
    this.seed = `${plan.seed}:${index}`;
    this.swapped = plan.swapSides && index % 2 === 1;
    const ids = this.swapped ? [...plan.bots].reverse() : plan.bots;
    this.game = new Game(
      { ...plan, players: ids.map((botId) => ({ kind: 'bot', botId })) },
      this.seed,
    );
    this.runtime = new PlayerRuntime(this.game, factory, now);
    this.recorder = record ? new ReplayRecorder() : null;
    if (this.recorder) this.recorder.enabled = true;
    this.game.start();
    this.recorder?.observe(this.game, 0, this.game.drainEvents());
    if (!this.recorder) this.game.drainEvents();
  }

  async step(): Promise<SimulationResult | null> {
    if (this.result) return this.result;
    if (this.stepping) throw new Error('Simulation steps must not overlap.');
    this.stepping = true;
    try {
      while (!this.runtime.step(SIMULATION_DT)) {
        if (this.runtime.isDisposed) throw new Error('Simulation was disposed.');
        await this.runtime.whenUnblocked();
      }
      this.steps++;
      for (const [id, state] of this.game.players) {
        if (state.status === 'failed')
          throw new Error(`Bot in slot ${id} failed: ${state.failure ?? 'unknown error'}`);
      }
      const events = this.game.drainEvents();
      this.replay = this.recorder?.observe(this.game, SIMULATION_DT, events) ?? null;
      const game = this.game;
      const ended = game.state === 'roundOver' || game.state === 'matchOver';
      if (
        ended &&
        (this.plan.target === 0 || game.state === 'matchOver' || game.round >= this.plan.maxRounds)
      ) {
        const capped = this.plan.target !== 0 && game.state !== 'matchOver';
        const winnerId = game.winner?.id ?? null;
        this.result = {
          index: this.index,
          seed: this.seed,
          swapped: this.swapped,
          outcome: capped
            ? 'capped'
            : winnerId === null
              ? 'tie'
              : winnerId === (this.swapped ? 1 : 0)
                ? 'win'
                : 'loss',
          rounds: game.round,
          winnerId,
          scores: [...game.scores],
          kills: [...game.kills],
          simulatedSeconds: this.steps * SIMULATION_DT,
          decisionStatistics: this.game.tanks.map((t) => ({
            ...this.runtime.statistics.get(t.id)!,
          })),
        };
        this.runtime.dispose();
      }
      if (this.steps > this.plan.maxRounds * 120 * 100)
        throw new Error('Simulation exceeded its physics-step limit.');
      return this.result;
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      this.stepping = false;
    }
  }

  dispose(): void {
    this.runtime.dispose();
    this.recorder?.discard();
    this.replay = null;
  }
}

/** Advance without real-time pacing, awaiting only controller initialization and decision boundaries. */
export async function runSimulation(
  plan: SimulationPlan,
  index: number,
  onReplay: ((replay: RoundReplay) => void) | undefined,
  factory: BotConnectionFactory,
  now?: () => number,
): Promise<SimulationResult> {
  const simulation = new BotSimulation(plan, index, Boolean(onReplay), factory, now);
  try {
    while (!simulation.result) {
      await simulation.step();
      if (simulation.replay) onReplay?.(simulation.replay);
    }
    return simulation.result;
  } finally {
    simulation.dispose();
  }
}
