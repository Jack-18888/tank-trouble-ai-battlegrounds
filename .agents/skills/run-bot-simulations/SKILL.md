---
name: run-bot-simulations
description: Run this repository's Tank Trouble simulation CLI, export round replays, and compare headless bot outcome rates with browser references. Use for bot benchmarks, seeded batches, and statistical browser validation.
---

# Run bot simulations

Read [the CLI guide](../../../docs/simulations.md) for options, async programmatic APIs, report
fields, comparison requirements, and validation limits. Run commands from the repository root.

## Choose the experiment

- Use `--rounds N` for independent rounds or `--matches N --target 3|5|10` for whole matches
  (default target 5). Capped matches are separate from ties and excluded from outcome rates.
- Identify outcomes by the first named bot. Slots alternate; use an even count for exact balance
  unless fixed sides are requested. Raw winner IDs, scores, kills, and diagnostics use roster order.
- Fix the seed, map size/density, pickups, target, round cap, sides, profiles, and native plan
  horizons. Each sample uses `BATCH_SEED:INDEX`, with zero-based indices.
- Keep recording off for throughput tests unless replay export is requested. Store artifacts
  under ignored `.qa/` paths; use distinct report paths and fresh replay directories.

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --out .qa/headless.json
npm run simulate -- medium hard --matches 10 --target 3 --seed matches --out .qa/matches.json
npm run simulate -- easy hard --rounds 1 --seed replay-check --replays .qa/replay-check
```

The shared source catalog `src/bots/index.ts` supplies registered IDs. The CLI runs isolated
Node worker threads; both synchronous and asynchronous strategies are supported. Main-process-only
registrations do not cross into workers. A controller failure aborts evaluation rather than becoming
a loss or a silent replacement. The CLI supports two bots; use separate fixtures for 3–6 players.

## Understand timing and diagnostics

Physics uses 120 ticks per simulated second at every speed. Native plans contain ordered segments
and trigger another observation at expiry. Legacy controls use seeded reaction timing quantized
to four ticks. Due players see the same completed state; the coordinator commits admitted plans
together before the next tick.

Each dispatched request has a 10 ms wall-clock deadline. Missing, invalid, or late plans become
four neutral ticks. Busy workers get no overlapping request or pending snapshot. Initialization and
the separate ten-second unpaused stuck-worker watchdog retain their own failure handling.
Headless execution awaits decision boundaries without real-time pacing; async entry points require
an explicit connection factory. `InProcessConnection` is a local test adapter without CPU isolation.

Report v2 includes scheduling settings and per-slot decisionStatistics: requests, deadlineMisses,
busySkips, invalidPlans, and lateReplies. Sum the first three skip reasons (deadlineMisses, busySkips,
invalidPlans) for total skipped Decisions; lateReplies can describe already-counted misses.
Keep these diagnostics alongside outcomes and throughput.

Identical deterministic bots and admitted Decisions yield reproducible gameplay, but a seed cannot
guarantee identical deadline admissions across loads, devices, or speeds. Separate exact trace tests
with controlled admission from real-worker timing evidence; neither alone establishes competitive
strength or statistical execution equivalence.

## Validate against browser outcomes

Use the CLI's paired comparison with the same bots, plan, source fingerprint, and scheduling
metadata. It does not compare old versus new strategy strength. Legacy report v1 and new scheduling
results cannot be treated as a matched experiment. Replay files remain snapshot format v1.

Start Vite, then collect a real-time reference and the matching headless batch:

```sh
npm run dev
```

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --browser --out .qa/browser.json
npm run simulate -- medium hard --rounds 1000 --seed benchmark --compare .qa/browser.json --out .qa/headless.json
```

The rendered reference uses real browser workers at 1x. Large collections can take hours; state the
expected duration before starting one, using observed round durations. Keep source, tooling,
fixtures, and the lockfile unchanged between matched runs. Require complete reports and no caps.

For acceleration use `--browser-speed 2` or `4`; finite speeds from 1 to 64 are accepted. Physics
tick duration stays fixed, while deadline misses and achieved throughput can differ. Compare each
accelerated candidate against a matching 1x report before making normal-play claims. Accelerated
reports never serve as the 1x reference. `CHROME_PATH` selects Chromium and `--url` selects Vite;
production preview does not expose the collector fixtures. Do not substitute simulated delays for
observed browser performance.

Comparison uses a default tolerance of five percentage points per outcome and reports equivalent
(exit 0), different/error (exit 1), or inconclusive (exit 2). Small identical samples or overlapping
intervals are not evidence of equivalence. Choose sample sizes in advance and use fresh confirmation
seeds after tuning. Report incomplete or failed coverage without presenting it as a passing comparison.

## Report the evidence

Give the first-bot perspective, sample unit/count, seeds/settings, profiles and plan horizons,
caps, outcome counts/rates/intervals, environment, requested browserSpeed, achieved throughput,
skip diagnostics, and comparison status. Link saved reports and replays. Do not extrapolate a smoke
run to other bots, devices, or large-sample strength.

For replay verification use `parseReplay` and `ReplayPlayer` from `src/replay.ts`. Replays can be
uploaded in the game's replay panel. Only completed simulation steps count toward recording time;
decision waits add wall time without adding ticks. Snapshot playback needs no workers or plan
re-execution and does not depend on reconstructing admissions from a seed.
