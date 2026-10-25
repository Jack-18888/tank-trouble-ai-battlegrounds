import type { PlayerContext, PlayerDecision, PlayerProfile } from './types.ts';

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
    const settings = { ...DEFAULT_PROFILE, ...profile };
    for (const [key, value] of Object.entries(settings)) {
      const allowZero = key === 'error' || key === 'reaction';
      if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
        throw new TypeError(
          `Player profile.${key} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`,
        );
      }
    }
    this.profile = Object.freeze(settings);
    Object.defineProperty(this, 'profile', { writable: false, configurable: false });
  }

  abstract decide(context: PlayerContext): PlayerDecision;
}
