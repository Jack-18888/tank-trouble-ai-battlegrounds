/**
 * @typedef {object} BotDecision
 * @property {number} [steer=0] Turn left (-1) or right (+1).
 * @property {number} [throttle=0] Reverse (-1) or drive forward (+1).
 * @property {boolean} [fire=false] Hold the trigger.
 */

/**
 * @typedef {object} BotContext
 * @property {Readonly<object>} self This bot's tank, including pose, velocity,
 * cooldown, power-up state, and time spent stuck.
 * @property {ReadonlyArray<object>} tanks All tanks, including eliminated tanks.
 * @property {ReadonlyArray<object>} enemies Living opponents, including the player.
 * @property {ReadonlyArray<object>} bullets Shell positions, velocities, owners,
 * lifetimes, and bounce counts.
 * @property {ReadonlyArray<object>} powerups Available pickups.
 * @property {Readonly<object>} map Maze dimensions, cells, walls, and seed.
 * @property {Readonly<object>} match Round, elapsed seconds, scores, and win target.
 * @property {Readonly<object>} rules Cell size, shell speed/lifetime, and ammo limit.
 * @property {function(): number} random Seeded random number in [0, 1).
 * @property {function(number, number): number} cellAt World position to cell ID.
 * @property {function(number, number): number[]} findPath Cell IDs, start to goal.
 * @property {function(object, object): boolean} lineOfSight Unobstructed visibility.
 * @property {function(number, number=): ?{id: number, distance: number}} predictShot
 * First tank a shot would hit at an angle, allowing the specified ricochet count.
 */

const DEFAULT_PROFILE = Object.freeze({
  speed: 96,
  turn: 3.15,
  reaction: 0.24,
  error: 0.045,
  cooldown: 0.72,
});

/**
 * Abstract, DOM-free bot controller. Implement decide(context) in a subclass.
 * The game creates one instance per opponent each round, so instance fields
 * provide private strategy memory without modifying the game-state snapshot.
 */
export class Bot {
  constructor(profile = {}) {
    if (
      new.target === Bot ||
      typeof this.decide !== 'function' ||
      this.decide === Bot.prototype.decide
    ) {
      throw new TypeError('Bot is abstract: subclass it and implement decide(context).');
    }
    const settings = { ...DEFAULT_PROFILE, ...profile };
    for (const key of Object.keys(DEFAULT_PROFILE)) {
      if (
        !Number.isFinite(settings[key]) ||
        (key === 'error' ? settings[key] < 0 : settings[key] <= 0)
      ) {
        throw new TypeError(
          `Bot profile.${key} must be a finite ${key === 'error' ? 'non-negative' : 'positive'} number.`,
        );
      }
    }
    Object.defineProperty(this, 'profile', { value: Object.freeze(settings), enumerable: true });
  }

  /** @param {BotContext} context @returns {BotDecision} */
  decide() {
    throw new Error('Implement decide(context) in your Bot subclass.');
  }
}
