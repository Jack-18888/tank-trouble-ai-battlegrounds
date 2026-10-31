---
name: build-competitive-bot
description: Build or improve a competing Tank Trouble bot in this repository using the observation API, shared bot registry, and measured strategy experiments. Use for bot implementation and strength improvements; for benchmark-only requests use run-bot-simulations.
---

# Build a competitive bot

Read [the competitor guide](../../../docs/competing-bots.md) for mechanics, strategy options, and
evaluation. Read [the API guide](../../../docs/bots.md) when implementing the controller. Resolve
these paths from this skill's directory and run project commands from the repository root.

## Establish the comparison

Follow the user's bot identity, allowed profile, opponents, and target game settings. If these are
unspecified, choose a unique bot ID, use the guide's Hard-profile baseline, and begin with Hard on
classic balanced maps. State these assumptions. The profile validator has no competitive upper
bounds; increasing speed or reducing cooldown changes the comparison. Do not describe a stat change
as a strategy improvement.

Native Decision plans choose their own horizons; profile.reaction only supplies timing for legacy
controls. Disclose plan lengths and decision frequency alongside the movement/firing profile when
comparing strategies. Do not infer an engine-enforced reaction limit from the Hard-profile convention.

Preserve other competitors and game rules. Ordinary changes belong in the bot's files, shared
catalog registration, and focused behavioral tests. An explicitly requested shared-engine change
is a separate scope with its own validation.

## Implement and improve

- Extend `AbstractPlayer`, implement `decide(PlayerContext)`, and register the class in
  `src/bots/index.ts` so browser and Node workers can construct it. Use `observe()` for the frozen
  snapshot and `observe().random()` for the private seeded stream.
- Prefer a finite `Decision` with ordered `segments`. Each segment holds allowed steering,
  throttle, and firing controls for positive integer ticks. The clock is 120 ticks per simulated
  second; `PlayerContext.tick` and `tickRate` expose it. Observations arrive at plan expiry.
  Follow the API guide's validation bounds and `once` versus `held` firing semantics.
- Existing `PlayerDecision` controls remain supported through an adapter using seeded reaction
  timing, rounded to four-tick boundaries. Native plans supply their own durations. Movement blocked
  by a wall still consumes segment ticks; only the engine applies physics, cooldowns, and ammo.
- Choose an approach rather than assuming the baseline is optimal. `CombatStrategy` and
  `MazeNavigator` are reusable starting points; independent planners are supported too.
- Keep target, route, and recovery memory in instance fields. Workers are recreated each round.
  Pause freezes plans and retains the instance; outstanding outcomes are buffered until resume.
  Use simulation ticks or observed match.elapsed for strategy timing, not wall clocks.
- Bound search by work count. Due bots observe one completed state and get a 10 ms
  dispatch-to-receipt deadline. Missing, invalid, or late plans cause four neutral ticks; late
  replies never replace that fallback. A busy worker receives no overlapping request or backlog.
  The separate ten-second unpaused watchdog marks stuck controllers OFFLINE.
- Synchronous and Promise-returning decisions work in both browser and Node workers; await time
  counts toward the same deadline. Do not introduce external model calls unless requested.
  Seeded strategies and bounded work help reproducibility, but hardware/load can change deadline
  misses, so do not promise identical whole-match results from a seed alone.
- Treat `predictShot` as geometry against frozen tank poses. It does not lead moving targets,
  incorporate firing error/scatter, or determine whether a shielded hit is lethal. Validate the
  current heading, ricochets, muzzle clearance, and ammunition.

Prefer measurable changes. Diagnose losses with replays before increasing planner complexity.
Collision-aware avoidance, route persistence, interception, selective ricochets, pickup routing,
and ammo-aware aggression are hypotheses to evaluate rather than a prescribed winning algorithm.

## Validate and deliver

Use [the simulation workflow](../run-bot-simulations/SKILL.md) and
[CLI documentation](../../../docs/simulations.md) when benchmarking. Start with a small smoke run,
retain an earlier candidate, and reserve fresh seeds for confirmation. The CLI accepts 2–6 bot
entries, including repeated IDs, and rotates starting slots by default. Use a multiple of the
roster size to balance slots, unless fixed sides are requested. Inspect ties, caps, map settings,
and opponents. Evaluate larger rosters explicitly when free-for-all strength matters; duel
results alone do not establish it. `--matches N --target 0 --max-rounds R` runs bounded endless
games, which are capped and excluded from outcome rates.

The CLI runs isolated Node workers. `InProcessConnection` is an explicit local test adapter, not
a production deadline-enforcement path. Keep reports/replays under ignored `.qa/` paths.
Report v2 records scheduling and per-player request, deadline-miss, busy-skip, invalid-plan, and
late-reply diagnostics; replay v1 remains a separate snapshot format. Raw results use actual
roster slots. `slotOrder[slot]` maps each slot to its original index in `plan.bots`, and
`summary.players` reports each original entry's rates, round wins, kills, and summed diagnostics.
Use this mapping when slots rotate or bot IDs repeat.

`--compare` tests execution modes on identical source, settings, and scheduling metadata, not
old-bot-versus-new-bot strength. Normal-browser claims require a 1x reference. Speed changes pacing,
not tick duration, but deadline misses may differ; report requested and achieved speed and skips.

Run `npm run check` and `npm run build`. Use behavioral tests for planner logic and browser checks
for worker/catalog integration. Report the ID, profile and plan horizons, algorithm, seeds/settings,
sample counts, outcomes/intervals, skips, execution mode, and replay paths. Distinguish controlled
admission trace tests from real deadline measurements. State missing checks and remaining limits;
claim improvement only to the extent supported by measurements.
