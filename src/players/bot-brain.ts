import { createBot } from '../bots/index.ts';
import { randomGenerator } from '../random.ts';
import { observeWorld } from './observation.ts';
import type { AbstractPlayer } from './abstract-player.ts';
import type { RoundInit, WorldFrame } from './connection.ts';
import type { PlayerDecision } from './types.ts';

/** Runs inside a worker; the explicit in-process test connection uses the same scheduler. */
export class BotBrain {
  readonly player: AbstractPlayer;
  private readonly random: () => number;
  private nextThink = 0;
  private epoch = -1;

  constructor(
    private readonly init: RoundInit,
    factory: (id: string) => AbstractPlayer = createBot,
  ) {
    this.player = factory(init.botId);
    this.random = randomGenerator(init.seed);
  }

  decide(frame: WorldFrame): PlayerDecision | undefined | Promise<PlayerDecision | undefined> {
    if (this.epoch !== frame.epoch) {
      this.epoch = frame.epoch;
      this.nextThink = frame.match.elapsed;
    }
    if (frame.match.elapsed + 1e-9 < this.nextThink) return;
    let snapshot: ReturnType<typeof observeWorld> | undefined;
    const result = this.player.decide(
      Object.freeze({
        input: Object.freeze({}),
        observe: () => (snapshot ??= observeWorld(this.init, frame, this.random)),
      }),
    );
    const complete = (decision: PlayerDecision): PlayerDecision => {
      if (!decision || typeof decision !== 'object')
        throw new TypeError('Expected a movement decision object.');
      const reaction = this.player.profile.reaction;
      this.nextThink =
        frame.match.elapsed + (reaction ? reaction * (0.85 + this.random() * 0.3) : 0);
      return decision;
    };
    return result instanceof Promise ? result.then(complete) : complete(result);
  }
}
