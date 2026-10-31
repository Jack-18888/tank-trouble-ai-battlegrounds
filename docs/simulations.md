# Headless bot simulations

Run two to six registered bots in isolated Node worker threads, without rendering or real-time pacing.
The headless runner uses the same game engine and 120 Hz scheduler as browser play, and supports
every bot-only gameplay configuration: mixed or repeated bots, all map sizes/densities, optional
pickups, win targets, and endless play. Human controllers require the browser.

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --out .qa/headless.json
npm run simulate -- medium hard --matches 10 --target 3 --seed matches
npm run simulate -- easy hard --rounds 1 --replays .qa/sample-replays
npm run simulate -- easy medium hard --rounds 30 --seed free-for-all --out .qa/ffa.json
npm run simulate -- easy medium hard easy medium hard --matches 1 --target 0 --max-rounds 10
```

The installed `tsx` loader supports worker TypeScript imports; no additional package is needed.
Both synchronous and asynchronous strategies are supported. Registrations must be in the shared
source catalog; main-process-only registrations are not transferred to workers.

## Shared tick scheduler

Physics advances at 120 Hz of simulated time. Every bot submits a finite sequence of control
segments, and receives a new observation when that plan expires. Legacy bots are adapted using
their existing seeded reaction timing. See [the Decision contract](bots.md).

All due bots observe the same completed world state. The runner awaits replies or the 10 ms
wall-clock deadline, then commits their plans at the same physics boundary. Missing, late, or
invalid plans produce four neutral ticks. Busy workers do not receive overlapping requests.
Initialization gates the countdown; startup/crash handling and the ten-second stuck-worker watchdog
are separate from individual decision deadlines.

Headless runs advance ticks as fast as decisions and CPU permit. Browser speed changes wall-clock
pacing, never physics dt, plan lengths, cooldowns, or simulated time. Cosmetics remain simulated
because particle creation currently consumes gameplay randomness.

Identical deterministic strategies and admitted Decisions produce identical gameplay. **A hard
wall-clock deadline can skip different Decisions on different runs**, especially under load.
Seed-only reproducibility is conditional; inspect skipped-decision statistics. Exact trace tests
use controlled admission separately from deadline tests. A visible map seed alone does not specify
spawn randomness, subsequent rounds, roster, profiles, human input, or strategy version.

## Programmatic execution

Shared simulation code requires an explicit connection factory. From a root-level TypeScript
module, select Node workers and await the runner:

```ts
import { runSimulation } from './src/simulation.ts';
import { nodeBotConnection } from './scripts/node-bot-connection.ts';

const plan = {
  bots: ['easy', 'medium', 'hard'],
  mode: 'rounds' as const,
  count: 3,
  seed: 'programmatic',
  size: 'classic' as const,
  density: 'balanced' as const,
  powerups: true,
  target: 0 as const,
  maxRounds: 100,
  swapSides: true,
};
const result = await runSimulation(plan, 0, undefined, nodeBotConnection);
console.log(result);
```

`runSimulation(plan, index, onReplay, factory)` returns a Promise. Supply a replay callback in place
of `undefined` to record completed rounds. For manual driving, construct
`new BotSimulation(plan, index, record, factory)`, await each `step()`, and call `dispose()` in a
`finally` block. Steps must not overlap. Browser callers select `browserBotConnection`; production
drivers keep their render loop separate from asynchronous stepping. `InProcessConnection` remains
an explicitly injected local test adapter, with no CPU isolation for enforcing real deadlines.

`mode: 'rounds'` samples one independent round with `target: 0`. `mode: 'matches'` runs until a
win target or `maxRounds`; with `target: 0` it preserves the browser's endless game behavior,
including scores and kills across rounds, then stops at the cap. For existing programmatic plans
that omit `mode`, target 0 still means a single round and positive targets mean matches.

## Options

| Option               | Default               | Meaning                                            |
| -------------------- | --------------------- | -------------------------------------------------- |
| --rounds N           | 1                     | Independent rounds                                 |
| --matches N          | Unset                 | Whole matches                                      |
| --target 0\|3\|5\|10 | 5                     | Wins needed; 0 endless; requires --matches         |
| --max-rounds N       | 100                   | Cap a whole match                                  |
| --seed TEXT          | simulation            | Batch seed                                         |
| --size SIZE          | classic               | compact, classic, large                            |
| --density VALUE      | balanced              | open, balanced, dense                              |
| --no-powerups        | Pickups on            | Disable pickups                                    |
| --fixed-sides        | Slots rotate          | Keep every bot in its original starting slot       |
| --replays DIR        | Off                   | Save compatible .ttr.json round replays            |
| --out FILE           | Console only          | Save report JSON                                   |
| --browser            | Node workers          | Collect rendered browser-worker results            |
| --browser-speed N    | 1                     | Requested browser speed from 1 to 64               |
| --url URL            | http://127.0.0.1:5173 | Vite server                                        |
| --compare FILE       | Unset                 | Statistical comparison against a 1× browser report |
| --tolerance RATE     | 0.05                  | Allowed per-outcome rate difference                |
| --help               | Unset                 | Print complete help                                |

Counts and caps must be positive integers. Fractional browser speeds are accepted within [1, 64].
Browser replay export is not supported by this CLI. Output must not overwrite the comparison input.
The seed plus sample suffix must fit the replay format's 128-character limit.

Each sample uses seed BATCH_SEED:INDEX. Starting slots rotate by one each sample unless disabled,
so a multiple of the roster size gives every named entry equal time in every starting slot. For
duels this preserves alternating sides. Repeated bot IDs remain separate named entries.
Headline outcomes describe the first named entry; `winnerId`, `scores`, `kills`, and per-player
diagnostics use actual roster order. Each result's `slotOrder[slot]` identifies that slot's original
zero-based index in `plan.bots`. `swapped` is retained for compatibility and means any nonzero
rotation; use `slotOrder` for larger rosters.

Capped matches, including bounded endless matches, are reported separately and excluded from
win/tie/loss rates. Their `winnerId` is null because there is no overall match winner. Scores,
kills, diagnostics, and replays still cover all completed rounds. A controller failure aborts a
benchmark rather than silently treating it as a loss.

## Reports and replay export

New reports use version 2 and execution `node-workers` or `browser-workers`. They retain the plan,
source fingerprint, environment, requested browserSpeed, results, elapsedMs, and outcome summaries.
The scheduling metadata records scheduler version, tick rate, decision budget, and neutral retry length.
Each result includes per-slot decisionStatistics: requests, deadlineMisses, busySkips, invalidPlans,
and lateReplies. The console reports measured simulated-time throughput and total skipped Decisions.
`summary.players` reports win/tie/loss rates with 95% intervals, total round wins, total kills, and
summed diagnostics for each original named entry, mapped back through roster rotation. Round wins,
kills, and diagnostics include capped samples; outcome rates exclude them. The console also prints
these per-entry totals. These are additive report v2 fields; snapshot replay format v1 is unchanged.
Total skipped Decisions sum deadlineMisses, busySkips, and invalidPlans. lateReplies is separate
diagnostic evidence and can refer to an already-counted miss; do not add it again.

Only completed physics steps count toward simulatedSeconds or replay duration. Initialization and
decision waits add wall time without adding simulation time. Recording is optional and retains no
history when disabled. Completed recordings use the existing replay v1 format and can be uploaded
through the game. Never overwrite earlier replay evidence; use a fresh output directory.

Legacy version 1 reports remain understood by statistical comparison. Comparison requires matching
plans, source fingerprints, and scheduling metadata; legacy and new scheduler results cannot be
treated as a matched experiment. Store local evidence under ignored .qa/.

## Browser verification and comparison

Start Vite and collect a real-time reference:

```sh
npm run dev
npm run simulate -- medium hard --rounds 100 --seed check --browser --out .qa/browser-1x.json
npm run simulate -- medium hard --rounds 100 --seed check --browser --browser-speed 4 --compare .qa/browser-1x.json --out .qa/browser-4x.json
```

Chrome/Chromium is detected automatically; set CHROME_PATH if needed. The collector uses rendered
960×640 arenas with actual workers and preserves worker startup and deadline behavior. It requires
a development server; production preview does not expose the fixture modules.

Acceleration may alter wall-clock deadline misses. An accelerated report is a candidate, never the
normal-play reference. Retain the 1× reference and matching plan/source/scheduler. Requested speed
can exceed achieved throughput. Long reference collections can take hours; use measured round
durations to estimate the cost before starting one.

Outcome summaries retain 95% Wilson intervals. Paired comparison uses the existing conservative
simultaneous confidence bounds and tolerance, reporting equivalent (exit 0), different/error (exit 1),
or inconclusive (exit 2). Small samples, even with matching outcomes, do not establish equivalence.
For three to six bots the comparison checks every named entry's outcome rates, with conservative
simultaneous bounds covering up to six competitors. A change in which opponent wins can therefore
be detected even when the first entry's loss rate stays the same. `comparison.players` retains
these per-entry comparisons; `comparison.outcomes` retains the first-entry view. Paired reports must
also agree on sample mode and roster rotation. The browser collector supports the same 2–6-bot
plans, including capped endless matches, though capped results cannot establish outcome equivalence.

The verification suite separately checks exact gameplay traces across local execution, Node workers,
and real browser workers with different batching cadences under controlled admission. Deadline
boundary tests use an injected clock; production smoke runs measure real deadline misses.
These checks establish scheduler behavior, not competitive strength or universal device performance.
