import { AbstractPlayer } from '../../players/abstract-player.ts';
import { CombatStrategy } from './combat.ts';
import type { PlayerContext, PlayerDecision } from '../../players/types.ts';

/** Slow maze pursuit with imprecise aim and an extra chance to hesitate before firing. */
export class EasyBot extends AbstractPlayer {
  private readonly strategy = new CombatStrategy(this.profile);
  constructor() {
    super({ speed: 78, turn: 2.4, reaction: 0.55, error: 0.16, cooldown: 1.15 });
  }

  override decide({ observe }: PlayerContext): PlayerDecision {
    const context = observe();
    const decision = this.strategy.decide(context);
    if (context.enemies.length && context.random() < 0.3) decision.fire = false;
    return decision;
  }
}
