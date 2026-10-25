import { Bot } from './bot.js';
import { decideCombat } from './combat.js';

export class HardBot extends Bot {
  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  decide(context) {
    return decideCombat(context, this.profile, { dodge: true, bank: true });
  }
}
