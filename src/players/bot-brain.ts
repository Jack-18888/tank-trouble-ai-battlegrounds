import { createBot } from '../bots/index.ts';
import { randomGenerator } from '../random.ts';
import { observeWorld } from './observation.ts';
import { MAX_DECISION_TICKS, RETRY_TICKS, TICK_RATE } from './decision.ts';
import type { AbstractPlayer } from './abstract-player.ts';
import type { RoundInit, WorldFrame } from './connection.ts';
import type { Decision, PlayerDecision } from './types.ts';

/** Strategy instance and private RNG; the coordinator owns all decision deadlines. */
export class BotBrain {
  readonly player: AbstractPlayer;
  private readonly random: () => number;
  constructor(
    private readonly init: RoundInit,
    factory: (id: string) => AbstractPlayer = createBot,
  ) {
    this.player = factory(init.botId);
    this.random = randomGenerator(init.seed);
  }
  decide(frame: WorldFrame): Decision | Promise<Decision> {
    let snapshot: ReturnType<typeof observeWorld> | undefined;
    const result = this.player.decide(
      Object.freeze({
        tick: frame.tick,
        tickRate: TICK_RATE,
        input: Object.freeze({}),
        observe: () => (snapshot ??= observeWorld(this.init, frame, this.random)),
      }),
    );
    const complete = (value: Decision | PlayerDecision): Decision => {
      // Invalid native plans reach coordinator validation instead of failing the controller.
      if (!value || typeof value !== 'object' || 'segments' in value) return value as Decision;
      const reaction = this.player.profile.reaction;
      const interval = reaction ? reaction * (0.85 + this.random() * 0.3) : 0;
      const ticks = Math.min(
        MAX_DECISION_TICKS,
        Math.max(RETRY_TICKS, Math.ceil(interval * 30 - 1e-9) * RETRY_TICKS),
      );
      return {
        segments: [
          {
            ticks,
            steer: value.steer,
            throttle: value.throttle,
            ...(value.fire === true ? { fire: 'held' as const } : {}),
          },
        ],
      };
    };
    return result instanceof Promise ? result.then(complete) : complete(result);
  }
}
