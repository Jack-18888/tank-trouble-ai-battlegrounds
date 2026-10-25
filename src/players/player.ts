import { AbstractPlayer } from './abstract-player.ts';
import type { PlayerContext, PlayerDecision } from './types.ts';

export const HUMAN_PROFILE = Object.freeze({
  speed: 114,
  turn: 3.7,
  reaction: 0,
  error: 0,
  cooldown: 0.32,
});

/** Keyboard and touch events are translated to input by the browser layer. */
export class Player extends AbstractPlayer {
  constructor() {
    super(HUMAN_PROFILE);
  }

  override decide({ input }: PlayerContext): PlayerDecision {
    return {
      steer: Number(Boolean(input.right)) - Number(Boolean(input.left)),
      throttle: Number(Boolean(input.forward)) - Number(Boolean(input.backward)),
      fire: input.fire === true,
    };
  }
}
