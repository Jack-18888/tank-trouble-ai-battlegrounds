import { AbstractPlayer } from '../../players/abstract-player.ts';
import { CombatStrategy } from './combat.ts';
import type { PlayerContext, PlayerDecision } from '../../players/types.ts';

/** Maze pursuit with shell dodging and direct-fire aiming. */
export class MediumBot extends AbstractPlayer {
  private readonly strategy = new CombatStrategy(this.profile, { dodge: true });
  constructor() {
    super({ speed: 96, turn: 3.15, reaction: 0.24, error: 0.045, cooldown: 0.72 });
  }

  override decide({ observe }: PlayerContext): PlayerDecision {
    return this.strategy.decide(observe());
  }
}
