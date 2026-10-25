import type { PlayerProfile } from './types.ts';

/** Copy and freeze finite settings; only reaction and aim error may be zero. Invalid input throws. */
export function validateProfile(profile: PlayerProfile): Readonly<PlayerProfile> {
  const settings: PlayerProfile = {
    speed: profile.speed,
    turn: profile.turn,
    reaction: profile.reaction,
    error: profile.error,
    cooldown: profile.cooldown,
  };
  for (const [key, value] of Object.entries(settings)) {
    const allowZero = key === 'error' || key === 'reaction';
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
      throw new TypeError(
        `Player profile.${key} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`,
      );
    }
  }
  return Object.freeze(settings);
}
