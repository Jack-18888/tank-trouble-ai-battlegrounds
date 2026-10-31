import type { Decision, PlayerContext, PlayerDecision, PlayerProfile } from './types.ts';
import { validateProfile } from './profile.ts';

const DEFAULT_PROFILE: Readonly<PlayerProfile> = Object.freeze({
  speed: 96,
  turn: 3.15,
  reaction: 0.24,
  error: 0.045,
  cooldown: 0.72,
});

/** One controller per tank, recreated each round. Keep strategy memory in instance fields. */
export abstract class AbstractPlayer {
  readonly profile: Readonly<PlayerProfile>;

  constructor(profile: Partial<PlayerProfile> = {}) {
    if (new.target === AbstractPlayer || typeof this.decide !== 'function') {
      throw new TypeError('AbstractPlayer is abstract: subclass it and implement decide(context).');
    }
    this.profile = validateProfile({ ...DEFAULT_PROFILE, ...profile });
    Object.defineProperty(this, 'profile', { writable: false, configurable: false });
  }

  /**
   * Produce desired controls without mutating the simulation. Bots may return a Promise;
   * legacy controls are adapted into a finite plan using the seeded reaction interval.
   */
  abstract decide(
    context: PlayerContext,
  ): Decision | PlayerDecision | Promise<Decision | PlayerDecision>;
}
