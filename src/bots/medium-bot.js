import { Bot } from './bot.js';
import { decideCombat } from './combat.js';

export class MediumBot extends Bot {
  constructor() {
    super({ speed: 96, turn: 3.15, reaction: 0.24, error: 0.045, cooldown: 0.72 });
  }

  decide(context) {
    return decideCombat(context, this.profile, { dodge: true });
  }
}
