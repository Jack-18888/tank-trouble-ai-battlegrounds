import { Bot } from './bot.ts';
import { CombatStrategy } from './combat.ts';
import type { BotContext, BotDecision } from './types.ts';

export class HardBot extends Bot {
  private readonly strategy = new CombatStrategy(this.profile, { dodge: true, bank: true });
  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  override decide(context: BotContext): BotDecision {
    return this.strategy.decide(context);
  }
}
