# Adding a bot

For competition strategy and game mechanics, start with [Building a competitive bot](competing-bots.md).
Extend `AbstractPlayer`, implement `decide(context)`, and register the class in `src/bots/index.ts`.
The browser and Node workers load the same registry. Existing competitors and their profiles remain supported.

## Tick-based Decisions

Every participant shares one round-scoped clock: **120 physics ticks per simulated second**.
`PlayerContext.tick` is the number of completed playing ticks; `tickRate` is 120. Physics always
uses 1/120 second. Playback speed changes wall-clock pacing, never the physics timestep.

New strategies return a finite `Decision`:

```ts
interface DecisionSegment {
  ticks: number;
  steer?: number;
  throttle?: number;
  fire?: 'once' | 'held';
}

interface Decision {
  segments: readonly DecisionSegment[];
}
```

Import these types from `src/players/index.ts`; for example, in `src/bots/planned-bot.ts`:

```ts
import { AbstractPlayer } from '../players/index.ts';
import type { Decision, PlayerContext } from '../players/index.ts';

export class PlannedBot extends AbstractPlayer {
  override decide({ observe }: PlayerContext): Decision {
    const world = observe();
    return {
      segments: [
        { ticks: 12, steer: 1, throttle: 1 },
        { ticks: 24, throttle: 1, fire: world.enemies.length ? 'once' : undefined },
      ],
    };
  }
}
```

A segment holds its controls together for exactly `ticks` physics updates. Positive steering turns
right, negative steering turns left; positive throttle drives forward and negative throttle reverses.
Numbers are clamped to [-1, 1], with missing or non-finite values becoming zero. Omitted firing is off.
`fire: 'once'` attempts one volley on the segment's first tick. A blocked muzzle, empty reserve, or
cooldown can prevent that attempt; it is not retried. `fire: 'held'` attempts firing on every tick.
Cooldown, ammunition, shields, triple-shot, and rapid-fire retain their existing rules.

Plans have 1–256 segments, positive safe-integer durations, and at most 10,800 total ticks (one round).
Validation is atomic and accepted plans are detached and frozen. Invalid plans become four neutral ticks.

A plan accepted after completed tick 100 with 36 ticks executes on ticks 101–136. The next observation
is requested after tick 136. Wall collisions do not end a segment early. The engine simulates every
intervening tick, including all other tanks, projectiles, and pickups. A plan commits until expiry,
elimination, or round end.

At a boundary, all bots needing plans observe the same detached world state. Requests run concurrently.
The coordinator waits for replies or a **10 ms wall-clock deadline measured from dispatch to receipt**,
then commits results together in player-ID order before advancing physics. Receipt at 10 ms is late.
A missing decision becomes four neutral ticks. Late plans never control a tank. A still-busy worker
gets another four-tick neutral plan without another request or an observation backlog.

Rendering and browser input stay responsive during this wait. Human input becomes one-tick plans
through the same executor. Pause freezes plan cursors and stops new requests; already-dispatched
requests finish or expire and their outcomes are buffered until resume. Resume clears held human
input while preserving surviving bot plans and instance memory.

## Compatibility and profiles

The former `PlayerDecision` controls object remains supported:

```ts
override decide({ observe }: PlayerContext): PlayerDecision {
  const world = observe();
  return { steer: 0, throttle: 1, fire: world.enemies.length > 0 };
}
```

The adapter converts legacy controls to one segment. Its duration uses the profile's reaction interval
and the bot's seeded ±15% timing variation, rounded up to a four-tick boundary; zero reaction produces
four ticks. Legacy `fire: true` means held firing. Native Decisions specify their own durations and
do not use a separate reaction scheduler.
Consequently, native plan horizons affect reaction frequency independently of `profile.reaction`;
include those horizons when reporting competition settings or comparing strategies.

| Profile  | Default | Meaning                                       |
| -------- | ------- | --------------------------------------------- |
| speed    | 96      | Pixels per simulated second                   |
| turn     | 3.15    | Radians per simulated second                  |
| reaction | 0.24    | Legacy decision interval in simulated seconds |
| error    | 0.045   | Maximum random firing-angle deviation         |
| cooldown | 0.72    | Simulated seconds between shots               |

Settings are finite and positive, except reaction and error may be zero. Human controls retain speed
114, turn 3.7, reaction/error zero, and cooldown 0.32. Built-in Easy, Medium, and Hard profiles and
strategies are preserved. Each bot gets a new instance and an independent RNG each round.

## Registration and observations

```ts
registerBot('planned', PlannedBot, {
  label: 'Planned',
  tagline: 'THINK AHEAD',
  description: 'Executes finite movement plans.',
});
```

Register in the shared source catalog before starting the game. Main-page-only registrations cannot
cross worker boundaries. IDs start with a lowercase letter and contain lowercase letters, digits,
and hyphens; duplicates are rejected. Unknown saved IDs fall back to Medium. Rosters support 2–6
players and zero or one human; controller swaps and legacy saved preferences remain supported.

`context.input` is immutable and empty for bots. `context.observe()` lazily creates a detached,
deeply frozen `BotContext`, shared across calls within one decision. It includes `self`, all tanks,
living enemies, bullets, pickups, map geometry/seed, rules, and match state, elapsed seconds, scores,
and match-long kills. The current tank's kills are round-local. Positions use world pixels and angles
use radians, clockwise from the right-facing direction.

| Query                              | Meaning                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| random()                           | Advance this bot's seeded RNG                               |
| cellAt(x, y)                       | Find a map cell                                             |
| findPath(startId, goalId)          | Breadth-first cell route                                    |
| lineOfSight(from, to)              | Wall visibility query                                       |
| predictShot(angle, maxBounces = 0) | First predicted tank hit, including possible self ricochets |

Queries use the same geometry as physics and remain tied to their observation. Use the provided
random stream; clocks, unseeded randomness, network data, and other external state cannot provide
reproducible decisions. Keep memory in instance fields and browser-imported strategy code free of
Node.js APIs. Both synchronous and Promise-returning strategies are supported.

## Runtime and failures

```ts
import { PlayerRuntime } from './src/players/index.ts';
import { browserBotConnection } from './src/players/browser-connection.ts';

const runtime = new PlayerRuntime(game, browserBotConnection);
game.start();
// On each fixed-step opportunity:
if (runtime.step(1 / 120)) {
  // Consume events and record one completed timestep.
}
// A false return means no simulation time advanced.
// Async drivers can await runtime.whenUnblocked() before retrying.
runtime.setInput(input);
runtime.dispose(); // Before replacing the game.
```

Initialize all controllers before advancing the countdown. Startup errors, thrown/rejected decisions,
malformed protocol replies, and ten unpaused wall-clock seconds without a reply mark only that tank
OFFLINE; it stays vulnerable and is recreated next round. A single missed 10 ms decision deadline
does not mark the tank OFFLINE. Disposal releases outstanding waits and prevents obsolete replies
from affecting a replacement round. There is no browser main-thread fallback.

The CLI selects Node worker threads using the same host and connection protocol. Unit tests can
explicitly inject `InProcessConnection`; this adapter provides no CPU isolation and is not the
production deadline-enforcement path. `Game.update(dt)` remains physics-only.

Deterministic bots, identical setup/input, and identical admitted Decisions yield identical gameplay.
Hard wall-clock deadlines can admit different plans on different runs or machines, so a seed alone
does not guarantee a complete match. Snapshot replay playback remains repeatable.

Run `npm run check`, `npm run build`, and browser checks after changing a strategy or its integration.
See [simulations](simulations.md) for acceleration, reporting, and browser validation.
