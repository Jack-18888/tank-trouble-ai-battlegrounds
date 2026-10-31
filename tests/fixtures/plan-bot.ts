import { AbstractPlayer } from '../../src/players/abstract-player.ts';
import { registerBot } from '../../src/bots/index.ts';
import type { Decision, PlayerContext } from '../../src/players/types.ts';

class PlanBot extends AbstractPlayer {
  override decide({ tick, tickRate, observe }: PlayerContext): Decision {
    if (tickRate !== 120 || !Number.isSafeInteger(tick)) throw new Error('Invalid tick context');
    const world = observe();
    return {
      segments: [
        {
          ticks: 5 + world.self.id,
          steer: (world.random() - 0.5) * 0.4,
          throttle: 0.4,
          fire: 'once',
        },
        { ticks: 7, throttle: -0.2 },
      ],
    };
  }
}
registerBot('qa-plan', PlanBot, { label: 'Tick plan fixture' });
