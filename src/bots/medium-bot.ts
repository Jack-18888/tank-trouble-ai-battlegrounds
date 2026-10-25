import { Bot } from './bot.ts';
import { CombatStrategy } from './combat.ts';
import type { BotContext, BotDecision } from './types.ts';

export class MediumBot extends Bot {
  private readonly strategy = new CombatStrategy(this.profile, { dodge: true });
  constructor() {
    super({ speed: 96, turn: 3.15, reaction: 0.24, error: 0.045, cooldown: 0.72 });
  }

  override decide(context: BotContext): BotDecision {
    return this.strategy.decide(context);
  }
}
