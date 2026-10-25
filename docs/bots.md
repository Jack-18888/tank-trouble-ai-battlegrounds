# Adding a bot

Extend `AbstractPlayer`, implement `decide(context)`, and register the class as a bot. The engine and setup UI both use the registry, so new types do not need changes in either of those modules. Every tank can select a bot controller, including the first tank; matches support zero or one human.

The shared entry point is `src/players/index.ts`. It exports `AbstractPlayer`, the keyboard/touch-controlled `Player`, `HUMAN_PROFILE`, `assignController`, and the `PlayerContext`, `PlayerDecision`, and `PlayerProfile` types. `AbstractPlayer` is a TypeScript abstract class, so missing implementations and incompatible decisions are compiler errors. The former `Bot` export has been removed.

`src/bots/index.ts` exports `EasyBot`, `MediumBot`, `HardBot`, `registerBot`, `createBot`, `hasBot`, `getBotType`, and `getBotTypes`, plus the bot-specific `BotContext`, `BotMetadata`, and `BotConstructor` types.

## Implement a strategy

For example, add `src/bots/sentry-bot.ts`. This bot stays still, remembers an enemy, turns toward it, and fires when its current shot would hit an opponent:

```ts
import { AbstractPlayer } from '../players/index.ts';
import type { PlayerContext, PlayerDecision } from '../players/index.ts';
import { angleDiff, clamp } from '../math.ts';

export class SentryBot extends AbstractPlayer {
  private targetId: number | null = null;

  constructor() {
    super({ reaction: 0.1 });
  }

  override decide({ observe }: PlayerContext): PlayerDecision {
    const context = observe();
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

Add its import and registration to `src/bots/index.ts`:

```ts
import { SentryBot } from './sentry-bot.ts';

registerBot('sentry', SentryBot, {
  label: 'Sentry',
  tagline: 'HOLD THE LINE',
  description: 'A stationary opponent that tracks its target.',
});
```

It now appears in the difficulty buttons and every tank's controller dropdown alongside Human. Difficulty presets update bot slots only. `label`, `tagline`, and `description` are optional; sensible defaults are supplied. IDs must start with a lowercase letter and contain only lowercase letters, digits, and hyphens. Duplicate IDs and classes that do not implement the base contract are rejected.

For a programmatic match, use the registered ID in the existing configuration:

```ts
import { Game } from './src/engine.ts';

const game = new Game({
  players: [{ kind: 'human' }, { kind: 'bot', botId: 'sentry' }, { kind: 'bot', botId: 'hard' }],
});
game.start();
```

Register before constructing the game or loading the setup UI. Unknown IDs in saved preferences fall back to Medium, allowing a removed custom bot to leave the game usable. Omit the human slot for a bot-only match. Rosters contain 2–6 tanks; validation pads short rosters with Medium bots, truncates long ones, and retains only the first human (additional humans become Medium bots). Saved settings from the old `opponents`/`difficulties` format migrate automatically; an explicit `players` field takes precedence.

## Decision contract

`abstract decide(context: PlayerContext): PlayerDecision` is the required method. It is synchronous. `context.input` is immutable and contains the current keyboard/touch input for the human slot, or an empty object for bots. `context.observe()` lazily creates the existing detached, frozen `BotContext` world snapshot and returns the same snapshot on repeated calls within a decision. Human controllers do not need to request observations. It returns an object with any of these controls:

| Field      | Meaning                                                             | Default |
| ---------- | ------------------------------------------------------------------- | ------- |
| `steer`    | -1 turns left; +1 turns right; intermediate values turn more slowly | 0       |
| `throttle` | -1 reverses; +1 moves forward; intermediate values reduce speed     | 0       |
| `fire`     | `true` holds the trigger; cooldown and ammo limits still apply      | false   |

Numbers are clamped to [-1, 1]. Missing or non-finite numbers become zero; only boolean `true` fires. The game owns movement, collisions, projectiles, scoring, and all timing. Returning a promise produces a clear contract error.

The last decision remains active until the next call. Every tank receives its own controller instance in `game.players`, recreated at the beginning of each round. Store strategy memory in instance fields. Decisions stop while the game is paused, during countdowns, after elimination, and between rounds. `game.humanId` identifies the human tank, or is `null` in bot-only matches. `game.update(dt, input)` supplies human input regardless of its slot. Each tank's `controller` metadata describes its human or bot configuration.

## Available game information

`BotContext` is defined in `src/bots/types.ts` using deeply read-only versions of the game entities in `src/types.ts`. Observations are detached copies and deeply frozen. The compiler rejects mutation of observation fields as well as incompatible controls; runtime checks also protect JavaScript callers. Strategies can read all of the following without modifying the live simulation:

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

All settings must be finite and positive, except `error` and `reaction`, which may be zero. Zero reaction samples controls every simulation tick without random timing variation; strategies using `CombatStrategy` should retain a positive reaction interval. The human `Player` uses speed 114, turn rate 3.7, reaction 0, error 0, and cooldown 0.32. Reaction time and strategy memory are separate from the fixed physics timestep. Power-ups can override firing cooldown for all players.

`Player`, `EasyBot`, `MediumBot`, and `HardBot` each extend `AbstractPlayer` directly and implement their own `decide` method. Each bot owns a `CombatStrategy` from `src/bots/combat.ts`, with independent route memory in `MazeNavigator`. A route keeps its cell-center waypoint until the tank reaches it, then advances; crossing a cell boundary does not reset the waypoint. Bots align before driving through a corridor and brake near turns. Hard predicts moving targets and takes opportunistic bank shots while pursuing, so firing decisions do not keep replacing its travel heading. Medium and Hard dodge nearby shells; Easy applies its own firing hesitation. Their constructors retain the existing movement and firing profiles. A custom class can compose `CombatStrategy` or implement a completely different strategy.

Run `npm run check` and `npm run build` after adding a bot. `tests/bots.test.ts` covers the extension contract, registration, observations, query consistency, execution in the game, independent memory, and round resets. The browser check also registers a custom implementation and exercises it through the real setup UI.
