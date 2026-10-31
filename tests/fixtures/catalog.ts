import { AbstractPlayer } from '../../src/players/abstract-player.ts';
import './plan-bot.ts';
import { registerBot } from '../../src/bots/index.ts';
import type { PlayerContext, PlayerDecision } from '../../src/players/types.ts';

let report: (event: string) => void = () => {};
export function setReporter(reporter: (event: string) => void) {
  report = reporter;
}
class SlowBot extends AbstractPlayer {
  private computed = false;
  constructor() {
    super({ reaction: 0, error: 0 });
  }
  override decide(): PlayerDecision {
    if (!this.computed) {
      this.computed = true;
      report('slow-start');
      const start = performance.now();
      while (performance.now() - start < 1000) {
        /* Deliberate CPU work confined to the QA worker. */
      }
      report('slow-finish');
    }
    return { throttle: 0.2 };
  }
}
class FastBot extends AbstractPlayer {
  constructor() {
    super({ reaction: 0 });
  }
  override decide(): PlayerDecision {
    report('fast-decision');
    return { steer: 0.1 };
  }
}
class ModuleBot extends AbstractPlayer {
  constructor() {
    super({ reaction: 0.05 });
  }
  override async decide({ observe }: PlayerContext): Promise<PlayerDecision> {
    const context = observe();
    if (
      !Object.isFrozen(context.self) ||
      context.self !== context.tanks.find((tank) => tank.id === context.self.id)
    )
      throw new Error('Invalid worker observation.');
    if (
      !context.findPath(
        context.cellAt(context.self.x, context.self.y),
        context.cellAt(context.self.x, context.self.y),
      ).length
    )
      throw new Error('Missing worker query.');
    await Promise.resolve();
    report('module-decision');
    return { throttle: 0.2 };
  }
}
class CrashBot extends AbstractPlayer {
  override decide(): PlayerDecision {
    throw new Error('Expected QA controller failure.');
  }
}
registerBot('qa-slow', SlowBot, { label: 'Slow fixture' });
registerBot('qa-fast', FastBot, { label: 'Fast fixture' });
registerBot('qa-module', ModuleBot, { label: 'Module fixture' });
registerBot('qa-crash', CrashBot, { label: 'Crash fixture' });
