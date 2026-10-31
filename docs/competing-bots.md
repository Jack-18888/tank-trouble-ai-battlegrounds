# Building a competitive bot

This guide is for an AI coding model implementing a strong controller in this repository. The model
writes a TypeScript strategy; the game runs that strategy locally for every decision. No external
AI service is required during play. Models without skill support can use this document directly.

Start with [the bot API](bots.md) for the full contract and [simulations](simulations.md) for benchmark
options. The reusable agent entry point is
[`build-competitive-bot`](../.agents/skills/build-competitive-bot/SKILL.md).

## Define what the bot should win

Honor the competition's stated profile, opponents, maps, player count, pickups, and scoring. This
repository supplies no enforced tournament profile or submission format. If the task leaves those
open, a useful initial comparison is a new bot against Hard, with the same profile as Hard:

```ts
const profile = { speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 };
```

Keep that profile fixed while measuring strategy changes. These are comparison defaults, not
limits enforced by the engine: the validator accepts any finite positive speed, turn, and cooldown,
and any finite nonnegative reaction and error. A bot with higher speed or lower cooldown may win
because of its stats. Disclose the entire profile, and distinguish that from better decisions.
Use `this.profile.speed` for your movement model; `context.rules.playerSpeed` is the human's speed.

A round normally rewards the last surviving tank. When at most one tank remains or the 90-second
limit is reached, physics continues through a 0.65-second settling period, so remaining shells matter.
When there is no survival winner, a unique leader in **current-round kills** wins; a shared lead is
a draw. That leader can be eliminated. Match wins depend on round wins, not match-long kill totals.
Survival, aggression, and timeout play therefore need to be evaluated together.

The game supports 2–6 tanks, while the existing simulation CLI accepts exactly two bot IDs. Duel
results do not establish free-for-all strength. For a larger roster, use the setup UI or a separate
fixture using `Game` and `PlayerRuntime`, and rotate roster slots.

## Implement a valid competitor first

Add a uniquely named class under `src/bots/`, then import and register it in `src/bots/index.ts`.
Keep existing competitors intact. Both the page and worker load that shared catalog; registering
only in a test or the main page does not make a bot available to production workers.

This is a working starting point for `src/bots/contender-bot.ts`. It deliberately reuses the current
Hard strategy so that you can establish integration before replacing or improving its decisions;
it is not evidence of a stronger bot.

```ts
import { AbstractPlayer } from '../players/abstract-player.ts';
import type { PlayerContext, PlayerDecision } from '../players/types.ts';
import { CombatStrategy } from './builtin/combat.ts';

export class ContenderBot extends AbstractPlayer {
  private readonly strategy = new CombatStrategy(this.profile, { dodge: true, bank: true });

  constructor() {
    super({ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 });
  }

  override decide({ observe }: PlayerContext): PlayerDecision {
    return this.strategy.decide(observe());
  }
}
```

Add the import and registration alongside the existing entries in `src/bots/index.ts`:

```ts
import { ContenderBot } from './contender-bot.ts';

registerBot('contender', ContenderBot, {
  label: 'Contender',
  tagline: 'READY TO COMPETE',
  description: 'A competing strategy under development.',
});
```

Choose your own unique ID before submitting. IDs start with a lowercase letter and contain only
lowercase letters, digits, and hyphens. Duplicate registrations throw. Keep helper code in dedicated
bot files if changing shared helpers would also change opponents. Scope ordinary bot work to the
controller, registration, and relevant tests; request shared-engine changes only when the task
actually calls for them.

## Mechanics that change strategy decisions

Use source as the authority if these details change.

| Mechanic                                                                                                              | Consequence for the planner                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positions are world pixels; angles are radians, clockwise from right. Cells are 64 pixels.                            | Convert cell indices to centers with `(cell.x + 0.5) * context.rules.cellSize`, and likewise for y. Cell walls are north/east/south/west.                                                     |
| One hull heading controls both driving and firing.                                                                    | There is no independent turret or strafe control. Reverse can create space without turning away from a shot.                                                                                  |
| `steer` and `throttle` are continuous in [-1, 1]; `fire` is boolean.                                                  | Controls are held until replaced. Returning `{}` releases all controls; it does not preserve earlier fields.                                                                                  |
| Physics is 120 Hz; observations are 30 Hz. Positive reaction has ±15% scheduling variation.                           | Plan for the time controls remain active. `reaction: 0` allows decisions on available observations, not on every physics tick. `CombatStrategy` assumes positive reaction.                    |
| A worker has one operation in flight and one replaceable pending observation.                                         | Slow searches skip intermediate observations while old controls stay active. A ten-second unpaused reply timeout marks the controller OFFLINE. Aim for much shorter computation.              |
| Observations are detached and deeply frozen, including query state.                                                   | Copy data for rollouts; retained observations never become fresh. Use instance fields for memory, which resets each round but survives pause/resume.                                          |
| The observation exposes the whole maze, living enemies, all tanks, shells, and pickups.                               | There is no visibility-based fog of war. `lineOfSight` describes wall clearance, not permission to know an enemy's position. Enemy movement profiles are not included.                        |
| Shells move at 140 pixels/second, live 7.5 seconds, and ricochet.                                                     | Use observed velocities and remaining life when predicting hazards. The nominal path budget is 1,050 pixels; walls and tanks can end it sooner.                                               |
| A shell ignores its owner until its first bounce, then can hit it.                                                    | Treat returning friendly shells as hazards. New firing lanes can become future traps.                                                                                                         |
| Tanks collide using rotated tracks, hull, and barrel; walls have rounded ends.                                        | A center ray or circular tank approximation alone cannot establish movement clearance. Tank-to-tank contact also blocks routes.                                                               |
| Firing starts beyond the muzzle; blocked muzzle clearance prevents a volley.                                          | `lineOfSight(self, enemy)` alone is not a reliable firing test.                                                                                                                               |
| `predictShot(angle, bounces)` traces against frozen tank poses.                                                       | It returns the first tank hit, possibly yourself, and total path distance. It does not extrapolate movement, model random firing error, trace all scatter shells, or assess shield lethality. |
| Each round starts with ten reserve bullets, capped at ten.                                                            | Shells in flight do not cap firing, disappearances do not refund ammo, and empty reserves can waste a good firing window.                                                                     |
| Refill intervals are 2/1.5/1/0.5 seconds starting at 0/20/40/60 seconds; ammo is unlimited from 70 seconds.           | Adapt aggression to `match.elapsed`, reserve, and refill progress. Unlimited ammo does not remove cooldown.                                                                                   |
| `shield` absorbs one shell. `rapid` gives a 0.13-second cooldown; `scatter` fires at offsets -0.17, 0, +0.17 radians. | A predicted hit need not kill. Offensive power lasts seven seconds; shield is a boolean, not that timer. Each scatter shell costs a bullet; a low-ammo volley can be partial.                 |
| The provided RNG belongs to this bot; firing error is applied by the engine.                                          | Use `context.random()` for strategy randomness. Querying a shot at a precise angle does not remove profile firing error.                                                                      |

## Strategy directions worth testing

The following are candidate improvements, not claims about an optimal controller. Measure them
independently; a more elaborate planner can lose because it reacts too slowly or models physics
poorly. The existing Hard bot is a useful baseline, with nearest-visible targeting, persistent BFS
routes, short linear aim lead, a straight-segment dodge heuristic, and one-bounce shot checking.

### Navigation and recovery

Use the cell graph for global reachability, then follow persistent waypoints with local collision
checks. `findPath` includes both endpoints. Keep moving toward the current waypoint until reached;
rebuilding the next waypoint from the tank's current cell every decision can cause corner loops.
`MazeNavigator` already handles that route progress.

Brake before turns and scale steering to the expected held-control interval. When useful, compare
forward and reverse approaches. Avoid switching goals or travel headings on every observation just
to chase a transient shot. Add target hysteresis, especially when several enemies are nearby.

`self.stuck` is a short-lived blockage sensor, periodically reset after about 1.5 seconds. Supplement
it with progress over simulation time. A bounded recovery mode can reverse, turn, and invalidate the
route after repeated blockage. Include other tanks in local clearance checks; a graph route does
not guarantee an empty corridor.

### Collision-aware avoidance

For a cheap initial threat estimate, use relative position `r = bulletPosition - tankPosition` and
relative velocity `v = bulletVelocity - tankVelocity`. The closest-approach time on the current
straight segment is `clamp(-dot(r, v) / dot(v, v), 0, horizon)`; handle zero relative speed. The miss
distance at that time can reject distant threats before expensive geometry work.

This estimate omits turns, walls, ricochets, and changes in your own controls. A stronger local
planner can simulate a small set of steer/throttle choices over a short horizon, resolve projected
shell bounces, and score collision risk, wall clearance, escape space, and progress. Import the
shared geometry helpers for exact checks when practical; a locally copied approximate model needs
scenario validation. Avoid choosing a perpendicular dodge that immediately drives into a wall.

Keep the search bounded by candidate counts and rollout steps. Use `match.elapsed` for controller
timers. Wall-clock cutoffs can make identical headless seeds choose different actions across
machines; measure computation cost separately. Recheck safety as new observations arrive.

### Interception and firing

Direct aim at the current enemy position can miss a moving target. A constant-velocity intercept
starts from `r = targetPosition - muzzlePosition`, target velocity `v`, and shell speed `s`. Solve
`dot(v, v) * t² + 2 * dot(r, v) * t + dot(r, r) = s² * t²`, choosing the earliest positive solution
within shell lifetime. Handle the linear case and cases with no valid intercept. Shell velocity
does not inherit the firing tank's velocity in this engine.

Treat that solution as a proposal: enemies may turn, stop at a wall, or dodge. Add the time needed
to turn toward the shot and the delay before firing. The muzzle also depends on your future pose.
Validate candidate trajectories against walls and tank silhouettes. `predictShot` supplies an
accurate snapshot check but cannot by itself confirm a moving-target intercept.

For ricochets, wall reflection can generate candidate aim angles; the actual swept geometry must
still validate rounded wall ends, muzzle clearance, earlier tank hits, and self-hits. Start with a
small candidate set rather than scanning every angle and bounce on every observation. Separate
travel objectives from opportunistic firing so bank-shot searches do not create navigation loops.

Fire from the heading the tank will actually have when the engine fires. A query at a desired
future angle does not rotate the tank or fire at that angle. Held `fire: true` may produce several
volleys while steering, especially under rapid fire; release the trigger when that becomes unsafe.
Scatter needs safety checks for its side shells as well as its center. With one reserve bullet,
the current scatter implementation fires the -0.17-radian shell first, not the center shell.

### Targeting, pickups, and round state

Rank enemies by reachable travel distance, exposure, shield state, firing opportunity, and threats,
rather than array order or Euclidean distance alone. In a free-for-all, account for third-party
shells and the possibility of winning by outliving a duel elsewhere.

Compare pickup value with route cost, shell danger, and remaining pickup lifetime. A shield may
justify a detour; a duplicate shield does not stack. Rapid fire consumes reserve quickly. Avoid
tying all aggression to ammo count once the unlimited-ammo phase begins. Near timeout, consult
`self.kills` and other tanks' current-round kills, not `match.kills`, when estimating the tiebreak.

## Measure improvement without fooling yourself

Run commands from the repository root with dependencies installed as described in
[README](../README.md). The examples below require the `contender` registration above. Choose new
report paths and replay directories for later experiments; reports can be overwritten, while
conflicting replay filenames cause an error.

First verify that the controller runs and inspect a few rounds:

```sh
npm run simulate -- contender hard --rounds 4 --seed contender-smoke --out .qa/contender-smoke.json --replays .qa/contender-smoke-replays
```

Then choose a development batch and preserve the current candidate before changing it:

```sh
npm run simulate -- contender hard --rounds 200 --seed contender-train --out .qa/contender-train-v1.json
```

Use the same development settings for a changed candidate to investigate differences, then confirm
the selected version on fresh seeds that were not used for tuning. For example:

```sh
npm run simulate -- contender hard --rounds 500 --seed contender-confirm --out .qa/contender-confirm.json
npm run simulate -- contender medium --rounds 200 --seed contender-medium --out .qa/contender-medium.json
npm run simulate -- contender hard --rounds 100 --seed contender-compact --size compact --density open --no-powerups --out .qa/contender-compact.json
npm run simulate -- contender hard --rounds 100 --seed contender-dense --size large --density dense --out .qa/contender-dense.json
npm run simulate -- contender hard --matches 10 --target 3 --seed contender-matches --out .qa/contender-matches.json
```

These sample sizes illustrate a staged workflow, not guaranteed statistical power. Select the
matrix and confirmation count before looking at those results, within the available time. Include
other submitted competitors when available, and previous versions or self-play when useful. Save
replays from small diagnostic batches rather than every throughput run. Inspect losses, draws,
self-hits, and route stalls; high survival with almost all draws may still fail the match objective.

The runner alternates slots by default; even counts balance them exactly. Results describe the
**first named bot**, while raw `winnerId`, `scores`, and `kills` use roster order; check `swapped`.
Retain outcome counts and 95% confidence intervals, not just win percentages. Match caps are
excluded from outcome rates, so disclose the capped count. A controller error aborts evaluation;
it is not an ordinary loss. The fast runner requires synchronous decisions and seeded strategy
randomness. Use browser execution for asynchronous controllers.

`--compare` has a narrower purpose: comparing execution modes using the **same bots, source
fingerprint, and full plan**. It cannot compare v1 source against v2, or two different bot pairings.
Preserve each version's reports and profile for strength comparisons; do not edit fingerprints or
misuse the execution-equivalence result as a ranking test.

### Browser timing matters

Headless batches run synchronously in process. Actual browser bots run independently in workers;
reply latency can change outcomes. Large-sample headless/browser agreement has not been established
for arbitrary competitors. A runnable worker or an accurate replay does not prove that agreement.

After the source is final, start `npm run dev` in another terminal. A small browser run checks the
worker path, but runs at real time and may take minutes. For a planned execution-mode comparison,
collect both reports without editing source between them:

```sh
npm run simulate -- contender hard --rounds 4 --seed contender-timing --browser --out .qa/contender-browser.json
npm run simulate -- contender hard --rounds 4 --seed contender-timing --compare .qa/contender-browser.json --out .qa/contender-headless.json
```

Four rounds are a smoke test; expect wide intervals and possibly an `inconclusive` result. Plan a
larger matched sample when equivalence matters. A 1x browser report is the reference for normal
play. `--browser-speed 4` accelerates simulation but changes worker scheduling and needs its own
comparison with 1x. The CLI's equivalence tolerance defaults to five percentage points per outcome;
`equivalent`, `different`, and `inconclusive` exit with 0, 1, and 2 respectively. See
[the full procedure](simulations.md#comparing-against-browser-matches).

## Verify and submit the result

Run `npm run check` and `npm run build`. Add focused behavioral tests for new mechanics, such as
escaping a corridor threat, reaching an idle target, refusing a self-hit, handling empty ammo, or
recovering from a blocked route. Test observable outcomes rather than private scoring constants.
Use the existing test helper or a `PlayerRuntime` with `InProcessConnection`; `Game.update()` alone
does not calculate bot decisions. Test instance independence and round resets if adding memory.

For browser integration, with the development server running, use `npm run test:browser` and
exercise the new ID in a real worker match. Verify the production worker bundle with the build and
the documented preview/browser check where available. Report unavailable browser checks explicitly.

Deliver the registered ID, full profile, strategy explanation, changed files, and validation. For
strength claims, include opponents, rounds versus matches, counts, seed, maps, pickups, side policy,
outcome counts/rates/intervals, capped count, execution mode, and report/replay paths. State which
settings were actually tested. A useful finding is a measured improvement with clear limits, even
when the available evidence cannot establish a universal winner.

## Source map

| Question                                                   | Read                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What can a controller read and return?                     | [`src/players/types.ts`](../src/players/types.ts), [`src/bots/types.ts`](../src/bots/types.ts), [bot API](bots.md)                                       |
| How do profiles and decision timing work?                  | [`abstract-player.ts`](../src/players/abstract-player.ts), [`profile.ts`](../src/players/profile.ts), [`bot-brain.ts`](../src/players/bot-brain.ts)      |
| What does Hard do today?                                   | [`hard-bot.ts`](../src/bots/builtin/hard-bot.ts), [`combat.ts`](../src/bots/builtin/combat.ts), [`navigation.ts`](../src/bots/builtin/navigation.ts)     |
| How exact are the queries and collisions?                  | [`src/queries.ts`](../src/queries.ts), [`src/geometry.ts`](../src/geometry.ts)                                                                           |
| Where are ammo, firing, movement, and scoring implemented? | [`src/rules.ts`](../src/rules.ts), [`src/engine.ts`](../src/engine.ts)                                                                                   |
| How should tests and evaluations run?                      | [`tests/bots.test.ts`](../tests/bots.test.ts), [`tests/helpers/game.ts`](../tests/helpers/game.ts), [simulations](simulations.md), [replays](replays.md) |

## Prompt to hand to a competing model

```text
Build the strongest Tank Trouble bot you can within the available task budget. Read AGENTS.md,
docs/competing-bots.md, and docs/bots.md. Follow any competition settings supplied with this task;
otherwise use the guide's Hard-profile comparison baseline and state your assumptions. Choose a
unique bot ID and add it to the shared catalog without replacing existing competitors or changing
the game rules. You may reuse the built-in strategy or implement a different planner. Improve it
through measured experiments, inspect diagnostic replays, and confirm on fresh seeds. Keep browser
worker timing and headless limits explicit. Run the relevant checks and deliver the bot, profile,
algorithm, and actual benchmark evidence, including any limits on the claims.
```
