import type { BotContext, BotDecision, BotProfile } from './types.ts';

const DEFAULT_PROFILE: Readonly<BotProfile> = Object.freeze({
  speed: 96,
  turn: 3.15,
  reaction: 0.24,
  error: 0.045,
  cooldown: 0.72,
});

/** One controller per opponent, recreated each round. Keep strategy memory in instance fields. */
export abstract class Bot {
  readonly profile: Readonly<BotProfile>;

  constructor(profile: Partial<BotProfile> = {}) {
    if (new.target === Bot || typeof this.decide !== 'function') {
      throw new TypeError('Bot is abstract: subclass it and implement decide(context).');
    }
    const settings = { ...DEFAULT_PROFILE, ...profile };
    for (const [key, value] of Object.entries(settings)) {
      if (!Number.isFinite(value) || (key === 'error' ? value < 0 : value <= 0)) {
        throw new TypeError(
          `Bot profile.${key} must be a finite ${key === 'error' ? 'non-negative' : 'positive'} number.`,
        );
      }
    }
    this.profile = Object.freeze(settings);
    Object.defineProperty(this, 'profile', { writable: false, configurable: false });
  }

  abstract decide(context: BotContext): BotDecision;
}
