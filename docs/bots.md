# Adding a bot

Extend `Bot`, implement `decide(context)`, and register the class. The engine and setup UI both use the registry, so new types do not need changes in either of those modules.

The public entry point is `src/bots/index.js`. It exports `Bot`, `EasyBot`, `MediumBot`, `HardBot`, `registerBot`, `createBot`, `hasBot`, `getBotType`, and `getBotTypes`.

## Implement a strategy

For example, add `src/bots/sentry-bot.js`. This bot stays still, remembers an enemy, turns toward it, and fires when its current shot would hit an opponent:

```js
import { Bot } from './bot.js';
import { angleDiff, clamp } from '../math.js';

export class SentryBot extends Bot {
  constructor() {
    super({ reaction: 0.1 });
    this.targetId = null;
  }

  decide(context) {
    const { self, enemies } = context;
    const target = enemies.find((tank) => tank.id === this.targetId) ?? enemies[0];
    if (!target) return {};

    this.targetId = target.id;
    const aim = Math.atan2(target.y - self.y, target.x - self.x);
    const hit = context.predictShot(self.angle);

    return {
      steer: clamp(angleDiff(aim, self.angle) * 3, -1, 1),
      throttle: 0,
      fire: hit !== null && hit.id !== self.id,
    };
  }
}
```

Add its import and registration to `src/bots/index.js`:

```js
import { SentryBot } from './sentry-bot.js';

registerBot('sentry', SentryBot, {
  label: 'Sentry',
  tagline: 'HOLD THE LINE',
  description: 'A stationary opponent that tracks its target.',
});
```

It now appears in the difficulty buttons and every opponent dropdown. `label`, `tagline`, and `description` are optional; sensible defaults are supplied. IDs must start with a lowercase letter and contain only lowercase letters, digits, and hyphens. Duplicate IDs and classes that do not implement the base contract are rejected.

For a programmatic match, use the registered ID in the existing configuration:

```js
import { Game } from './src/engine.js';

const game = new Game({
  opponents: 2,
  difficulties: ['sentry', 'hard'],
});
game.start();
```

Register before constructing the game or loading the setup UI. Unknown IDs in saved preferences fall back to Medium, allowing a removed custom bot to leave the game usable.

## Decision contract

`decide(context)` is synchronous. It returns an object with any of these controls:

| Field      | Meaning                                                             | Default |
| ---------- | ------------------------------------------------------------------- | ------- |
| `steer`    | -1 turns left; +1 turns right; intermediate values turn more slowly | 0       |
| `throttle` | -1 reverses; +1 moves forward; intermediate values reduce speed     | 0       |
| `fire`     | `true` holds the trigger; cooldown and ammo limits still apply      | false   |

Numbers are clamped to [-1, 1]. Missing or non-finite numbers become zero; only boolean `true` fires. The game owns movement, collisions, projectiles, scoring, and all timing. Returning a promise produces a clear contract error.

The last decision remains active until the next call. Each opponent receives its own controller instance, recreated at the beginning of each round. Store strategy memory in instance fields. Decisions stop while the game is paused, during countdowns, after elimination, and between rounds.

## Available game information

Observations are detached copies and deeply frozen. Strategies can read all of the following without modifying the live simulation:

| Field      | Contents                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `self`     | Own tank: ID, position, angle, velocity, cooldown, shield, power-up timers, and movement-stagnation timer `stuck` |
| `tanks`    | Every tank, including the player and eliminated tanks                                                             |
| `enemies`  | Living tanks other than `self`; order is not a targeting priority                                                 |
| `bullets`  | Shell positions, velocities, owners, remaining lifetime, age, and bounce count                                    |
| `powerups` | Available pickup types, positions, and lifetimes                                                                  |
| `map`      | Dimensions, cell coordinates and adjacency walls, collision wall segments, and seed                               |
| `match`    | State, round number, elapsed round seconds, scores, and win target                                                |
| `rules`    | `cellSize`, `playerSpeed`, `shellSpeed`, `shellLifetime`, and `maxShells`                                         |

Positions and velocities use world pixels and pixels per second. Angles use radians; zero faces right and positive rotation turns clockwise. Each cell's `walls` array is ordered north, east, south, west; `true` means blocked. `self.stuck` is a short-lived movement sensor, reset periodically after about 1.5 seconds of blockage.

Useful query methods are provided alongside the data:

| Method                               | Result                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `random()`                           | Seeded random value in [0, 1); use this instead of `Math.random()` for reproducible decisions |
| `cellAt(x, y)`                       | Cell ID for world coordinates                                                                 |
| `findPath(startId, goalId)`          | Reachable cell IDs including both endpoints                                                   |
| `lineOfSight(from, to)`              | Whether a wall obstructs visibility between positions                                         |
| `predictShot(angle, maxBounces = 0)` | First tank a hypothetical shot hits, as `{ id, distance }`, or `null`                         |

Visibility, path, and shot queries use the observation's snapshot, even if it is retained into a later frame. Shot prediction uses the same muzzle, tank silhouettes, ricochets, shell speed, and lifetime as the simulation. Check the hit ID: a bank shot can hit its owner. `random()` advances the match's seeded random stream when called.

## Movement profile and built-in bots

Pass overrides to `super(profile)` for the following immutable settings:

| Setting    | Default | Units                                                              |
| ---------- | ------- | ------------------------------------------------------------------ |
| `speed`    | 96      | Pixels per second at full throttle                                 |
| `turn`     | 3.15    | Radians per second at full steering                                |
| `reaction` | 0.24    | Seconds between decisions, with the existing ±15% timing variation |
| `error`    | 0.045   | Maximum random firing-angle error in radians                       |
| `cooldown` | 0.72    | Seconds between shots                                              |

All settings must be finite and positive, except `error`, which may be zero. Reaction time and strategy memory are separate from the fixed physics timestep. Power-ups can override firing cooldown just as they do for the player.

Easy, Medium, and Hard each extend `Bot` directly and implement their own `decide` method. Their original navigation, target selection, dodging, and bank-shot behavior is shared through `decideCombat` in `src/bots/combat.js`; their constructors retain the existing movement and firing profiles. Easy applies its own firing hesitation. A custom class can reuse `decideCombat` or implement a completely different strategy.

Run `npm run check` and `npm run build` after adding a bot. `tests/bots.test.js` covers the extension contract, registration, observations, query consistency, execution in the game, independent memory, and round resets. The browser check also registers a custom implementation and exercises it through the real setup UI.
