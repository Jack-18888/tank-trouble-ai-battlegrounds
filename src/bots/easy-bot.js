import { Bot } from './bot.js';
import { decideCombat } from './combat.js';

export class EasyBot extends Bot {
  constructor() {
    super({ speed: 78, turn: 2.4, reaction: 0.55, error: 0.16, cooldown: 1.15 });
  }

  decide(context) {
    const decision = decideCombat(context, this.profile);
    if (context.enemies.length && context.random() < 0.3) decision.fire = false;
    return decision;
  }
}
