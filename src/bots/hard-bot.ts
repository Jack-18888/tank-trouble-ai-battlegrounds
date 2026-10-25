import { AbstractPlayer } from '../players/abstract-player.ts';
import { CombatStrategy } from './combat.ts';
import type { PlayerContext, PlayerDecision } from '../players/types.ts';

/** Fast pursuit and shell dodging with predictive aiming and bank-shot searches. */
export class HardBot extends AbstractPlayer {
  private readonly strategy = new CombatStrategy(this.profile, { dodge: true, bank: true });
  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  override decide({ observe }: PlayerContext): PlayerDecision {
    return this.strategy.decide(observe());
  }
}
