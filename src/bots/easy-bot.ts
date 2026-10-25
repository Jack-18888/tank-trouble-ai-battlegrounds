import { Bot } from './bot.ts';
import { CombatStrategy } from './combat.ts';
import type { BotContext, BotDecision } from './types.ts';

export class EasyBot extends Bot {
  private readonly strategy = new CombatStrategy(this.profile);
  constructor() {
    super({ speed: 78, turn: 2.4, reaction: 0.55, error: 0.16, cooldown: 1.15 });
  }

  override decide(context: BotContext): BotDecision {
    const decision = this.strategy.decide(context);
    if (context.enemies.length && context.random() < 0.3) decision.fire = false;
    return decision;
  }
}
