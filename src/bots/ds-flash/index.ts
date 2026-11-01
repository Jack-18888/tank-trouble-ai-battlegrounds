import { AbstractPlayer } from '../../players/abstract-player.ts';
import type { PlayerContext } from '../../players/types.ts';
import type { Decision } from '../../players/types.ts';
import { FlashBrain } from './brain.ts';
import { warmFlashBrain } from './warmup.ts';

/**
 * DS V4.1 Flash: a tick-native duelling controller.
 *
 * Strength comes from decisions, not from faster physics: the profile matches the human tank
 * (and the other submitted competitors) exactly, with no aim error. Each observation runs a short
 * receding-horizon search over collision-checked control pairs, traces every live shell through
 * its ricochets, projects enemy motion from the controls they hold, and emits a finite plan whose
 * trigger fires exactly on the tick the barrel crosses the predicted intercept bearing.
 */
export class DsV41FlashBot extends AbstractPlayer {
  private readonly brain: FlashBrain;

  constructor() {
    super({ speed: 114, turn: 3.7, reaction: 0, error: 0, cooldown: 0.32 });
    warmFlashBrain(this.profile.speed, this.profile.turn);
    this.brain = new FlashBrain(this.profile.speed, this.profile.turn);
  }

  override decide({ observe }: PlayerContext): Decision {
    return this.brain.decide(observe());
  }
}
