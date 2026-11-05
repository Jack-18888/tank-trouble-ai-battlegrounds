# GPT-6 Astra

Registered ID: `gpt-6-astra`. Developed on `gpt-6-astra`, created from `main`.
No other model's bot implementation was inspected or used as an opponent. Evaluation opponents
are the repository's built-in difficulties; navigation fixtures use an idle human slot.

## Self-iteration, 2026-11-04

The firing guard now projects Astra's position and heading through its committed plan before
approving a volley. Shells originate at the next physics tick's muzzle, after turning and moving.
The guard forecasts each shell that ammunition permits, including partial scatter volleys, at
the center and both limits of the profile's firing error. It rejects a returning shell that
intersects Astra before the next observation. It also withholds fire when predicted tank contact
makes the simplified muzzle forecast unreliable. This adds bounded work only to proposed shots.
It does not change movement scoring, stats, decision horizons, shared physics, or opponents.

This fixes a failure found in fresh diagnostic replays: baseline samples 2 and 7 killed themselves
25 milliseconds after firing, before another decision was possible. Sample 7 supplies the new
behavioral regression test. Replays were validated with `parseReplay`, inspected using their
snapshots and timestamped events, and checked with `ReplayPlayer`. On 24 tuning rounds against
built-in Hard, the baseline scored **19 wins / 2 ties / 3 losses**, and the candidate scored
**24 / 0 / 0**. Astra self-deaths fell from two to zero in these recorded batches. These are
selection results, not fresh confirmation. The candidate was frozen before the confirmation runs.

All evidence is under ignored `.qa/astra-nov4/`: `baseline.ts` and `v1.ts` preserve the source,
`baseline-replays/` and `v1-replays/` contain the diagnostic recordings, and `analyze.ts` produces
their analysis. Reports are format v2 with scheduling diagnostics; replays remain format v1.
The original frozen source is the already-improved November 1 version, not the initial bot.

Settings remain the exact Hard comparison profile
`{ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 }`, with native plans of
8 ticks near shells/in combat and 12 otherwise (15/10 observations per simulated second).
The new guard samples error angles rather than proving safety over every angle, and forecasts
only through plan expiry. It does not guarantee survival after a missed deadline or against
unobserved future shots. Contact rejection can forgo useful firing opportunities.

### Confirmation and second iteration

These isolated Node-worker batches use real 10 ms deadlines, independent rounds, rotating slots,
target 0, and no capped samples. Both versions use the same seeds, suffixed `:0` through `:N-1`.
Execution is unpaced on Windows / Node 24.18.0. Counts are Astra wins / ties / losses; Hard's
wins and losses are the inverse. The 95% intervals below are Wilson intervals for Astra wins.

| Map / seed                             | Rounds per version | Baseline W / T / L | Updated W / T / L | Baseline / updated win 95% CI | Achieved speed, baseline / updated |
| -------------------------------------- | ------------------ | ------------------ | ----------------- | ----------------------------- | ---------------------------------- |
| Classic/balanced, `astra-nov4-confirm` | 120                | 99 / 8 / 13        | 96 / 6 / 18       | 74.7–88.3% / 72.0–86.2%       | 16.45x / 14.69x                    |
| Compact/open, `astra-nov4-open`        | 40                 | 37 / 1 / 2         | 35 / 1 / 4        | 80.1–97.4% / 73.9–94.5%       | 13.71x / 13.49x                    |
| Large/dense, `astra-nov4-dense`        | 40                 | 26 / 9 / 5         | 30 / 8 / 2        | 49.5–77.9% / 59.8–85.8%       | 29.37x / 23.71x                    |

Pickups are enabled except on compact/open maps. Reports are `baseline-{confirm,open,dense}.json`
and `v1-{confirm,open,dense}.json`. The combined worker result is **162/200 baseline wins versus
161/200 updated wins**. These data do **not** establish an overall strength improvement. The
change is retained as a targeted correction for a reproducible immediate self-hit.

The known neutral-only scheduling failure remains: both players made one request, missed its
deadline, and received 2,719 busy skips each. Classic baseline indices 21, 34, 67 and updated index
92 had this failure. Dense baseline indices 3, 6, 12, 13, 16, 26, 35, 37, 38 and updated indices
5, 12, 21, 27, 30, 32 also had it. All remain in the denominators. Dense-map throughput therefore
includes rapid neutral fallback ticks; it is not a measure of useful combat throughput.

| Batch   | Version  | Player | Requests | Deadline misses | Busy skips | Invalid plans | Late replies |
| ------- | -------- | ------ | -------- | --------------- | ---------- | ------------- | ------------ |
| Classic | Baseline | Astra  | 13875    | 201             | 8574       | 0             | 193          |
| Classic | Baseline | Hard   | 9127     | 47              | 8158       | 0             | 44           |
| Classic | Updated  | Astra  | 14416    | 242             | 3209       | 0             | 231          |
| Classic | Updated  | Hard   | 9544     | 47              | 2719       | 0             | 46           |
| Open    | Baseline | Astra  | 3953     | 53              | 69         | 0             | 52           |
| Open    | Baseline | Hard   | 2237     | 4               | 0          | 0             | 4            |
| Open    | Updated  | Astra  | 3895     | 65              | 119        | 0             | 64           |
| Open    | Updated  | Hard   | 2269     | 8               | 0          | 0             | 8            |
| Dense   | Baseline | Astra  | 6999     | 103             | 24595      | 0             | 91           |
| Dense   | Baseline | Hard   | 5192     | 33              | 24471      | 0             | 24           |
| Dense   | Updated  | Astra  | 8375     | 105             | 16443      | 0             | 98           |
| Dense   | Updated  | Hard   | 6135     | 32              | 16314      | 0             | 26           |

Late replies can overlap deadline misses and must not be counted again. The 24-round tuning
batches requested unpaced execution and achieved 12.77x / 13.95x. Baseline Astra/Hard diagnostics
were 2,987/1,920 requests, 32/3 misses, 41/0 busy skips, 0/0 invalid plans, 32/3 late replies;
updated diagnostics were 3,007/1,916 requests, 36/8 misses, 78/0 busy skips, 0/0 invalid plans,
36/8 late replies. Complete rates and intervals for every outcome are retained in each report.

A separate 120-round fresh-seed controlled comparison (`astra-nov4-controlled`, classic/balanced,
pickups on) alternated version order for each seed. Baseline scored **107 / 4 / 9** and updated
**107 / 3 / 10**; both win intervals are **82.3–93.6%**. This uses `InProcessConnection` with a
constant admission clock, so every miss, busy skip, invalid plan, and late reply is zero by
construction. Baseline Astra/Hard request counts were 14,979/9,745; updated counts were
15,092/9,803. It isolates strategy behavior and is not a production timing benchmark. Its
throughput is not reported because other controlled tests and required checks overlapped it.
The runner and results are `controlled.ts` and `controlled.json`.

After the mixed worker results, a second candidate allowed later predicted contact, keeping
the projected tank stationary when blocked. A 48-round controlled development comparison on
`astra-nov4-tune` scored baseline **44 / 0 / 4**, original guard **45 / 0 / 3**, and relaxed guard
**45 / 0 / 3**. The relaxed guard was rejected: it gave no measured gain to justify the less
conservative contact assumption. Source, runner, outcomes, intervals, and per-player diagnostics
are in `v2-runnable.ts`, `variants.ts`, and `variants.json`. The selected source remains v1.
The controlled fresh-seed results above were not used to tune another version.

### Validation for this revision

`npm run check` passes strict types, lint, formatting, and **129 tests**. `npm run build` passes
and creates the browser worker bundle. The new regression covers the replay-derived immediate
self-hit; the existing exposed-target, empty-ammo, shell-dodging, and maze-navigation tests pass.

Browser verification remains incomplete. The two-round 1x Chrome collector failed with
`Chromium disconnected` before returning a result; an Edge fallback failed the same way.
The browser verification suite, using a fresh
profile and this checkout's Vite server on port 5177, also stopped at `Runtime.enable` with an
unsettled top-level await. No browser outcome rate, achieved speed, or execution-equivalence
claim is available. The suite copy changes only local import paths, port, and profile directory;
its log is `browser-check.log`. No other model's implementation or results were consulted.

Use the existing optional Windows account-lookup preload described below if needed. For example:

```powershell
$env:NODE_OPTIONS='--require=./.qa/astra-iterate/node-compat.cjs'
npm run simulate -- gpt-6-astra hard --rounds 120 --seed astra-nov4-confirm --out .qa/astra-nov4/rerun.json
```

## Self-iteration, 2026-11-01

The current version adds an allocation-light wall-overlap query using the same rounded tank
silhouettes as the engine. The forecast now holds an evasive candidate for 0.5 seconds when an
observed shell has a dangerous flight segment, instead of returning to pursuit after 0.25 seconds.
Quiet navigation and hypothetical enemy volleys retain the shorter forecast commitment. These are
rollout assumptions: actual plans remain **8 or 12 ticks**, and the full Hard profile below is
unchanged. No shared physics, scheduler, observations, registration, or opponents changed.

Only built-in Hard was used as a benchmark opponent in this iteration. The initial temporary
Sentinel registration was removed after the user confirmed Astra's identity; none of those
preliminary results are used here. No other AI competitor implementation or benchmark was read.

### Selection and confirmation

All batches below use independent rounds, classic/balanced maps, pickups enabled, target 0,
rotating starting slots, and no capped samples. Seeds append `:0` through `:N-1`. Node is 24.18.0.
Reports and the original source snapshot are under ignored `.qa/astra-iterate/`.

| Version                                          | Tuning W / T / L | Astra deadline misses | Selection                                          |
| ------------------------------------------------ | ---------------- | --------------------- | -------------------------------------------------- |
| Original                                         | 18 / 2 / 4       | 65                    | Baseline                                           |
| v1: faster wall checks                           | 19 / 0 / 5       | 37                    | Behavioral checks pass                             |
| v2: always forecast 0.5 seconds of the candidate | 21 / 3 / 0       | 44                    | Rejected: idle-target and maze navigation failures |
| v3: longer forecast only for observed threats    | 21 / 2 / 1       | 35                    | Selected; behavioral checks pass                   |

Tuning used 24 rounds per version, seed `astra-iterate-tune`. Reports are `baseline-tune.json`,
`v1-tune.json`, `v2-tune.json`, and `v3-tune.json`. The v3 tuning run includes two neutral-only
scheduling failures, retained as draws. Selection preceded the following confirmation results.

| Execution                                                    | Seed                       | Rounds per version | Original W / T / L | Updated W / T / L | Original / updated win rate, 95% Wilson interval |
| ------------------------------------------------------------ | -------------------------- | ------------------ | ------------------ | ----------------- | ------------------------------------------------ |
| Isolated Node workers, real 10 ms deadlines                  | `astra-iterate-confirm`    | 120                | 85 / 10 / 25       | 90 / 14 / 16      | 70.8% (62.2–78.2%) / 75.0% (66.6–81.9%)          |
| Controlled in-process test adapter, constant admission clock | `astra-iterate-controlled` | 120                | 96 / 8 / 16        | 108 / 3 / 9       | 80.0% (72.0–86.2%) / 90.0% (83.3–94.2%)          |

The production reports are `baseline-confirm.json` and `v3-confirm.json`. Requested execution is
unpaced; achieved speed was **13.31x / 17.13x**. The original had one neutral-only round (index 76),
and the updated bot had four (21, 61, 83, 89). Each such round had one request and 2,719 busy skips
per player. These remain in the headline denominators. Faster throughput includes these neutral
ticks and does not establish more useful combat throughput. Real-worker gains are suggestive,
not proof of a statistically significant win-rate increase or browser equivalence.

| Production version | Entry | Requests | Deadline misses | Busy skips | Invalid plans | Late replies |
| ------------------ | ----- | -------- | --------------- | ---------- | ------------- | ------------ |
| Original           | Astra | 14,237   | 368             | 3,480      | 0             | 358          |
| Original           | Hard  | 9,652    | 41              | 2,719      | 0             | 40           |
| Updated            | Astra | 14,025   | 267             | 11,331     | 0             | 258          |
| Updated            | Hard  | 9,385    | 45              | 10,876     | 0             | 41           |

The controlled comparison (`controlled.json`, runner `controlled.ts`) alternates old/new versions
on each seed. It uses `InProcessConnection` and a constant test clock, so all misses, busy skips,
invalid plans, and late replies are zero by construction. Request counts were 16,005 / 10,471 for
original Astra / Hard and 15,480 / 10,091 for updated Astra / Hard. This isolates strategy behavior;
it is **not** a production timing benchmark or evidence that the deadline problem is fixed. Its
throughput is not reported because required checks overlapped it. The extra seed set was not used
for tuning. No claim is made about other AI competitors or general free-for-all strength.

Replays from the original diagnostic run are in `baseline-replays/`; the rejected v2's replays are
in `v2-replays/`. Original and selected source snapshots are `baseline.ts` and `v3.ts`. Production
reports use format v2; replays remain format v1. Do not use CLI `--compare` for old/new strength:
that flag compares execution modes of identical source.

### Current validation

`npm run check` passes all **128 tests**, strict types, lint, and formatting; `npm run build` passes.
New tests compare the optimized geometry to shared collision geometry over 12,000 seeded poses
and verify survival against two converging shells. The latter fixture kills the original bot and
is survived by the updated bot with controlled admission. Existing idle-target and generated-maze
navigation tests pass. Profile and actual decision horizons are unchanged.

Browser verification was attempted but is **incomplete for this revision**. The development
browser check stopped at `Runtime.enable` with an unsettled await; Edge failed during startup.
A separate two-round, 1x Chrome collector using a fresh profile ended with `Chromium disconnected`
before returning any result. No achieved browser speed or browser win rate is available. Earlier
browser results below belong to the original version, not this update.

This restricted Windows session also requires the ignored `node-compat.cjs` preload to let tsx
read the account name: `uv_os_get_passwd` otherwise throws `ENOMEM`. It only supplies environment
account fields when that OS lookup fails; no game or timing code is changed. Reproduce locally:

```powershell
$env:NODE_OPTIONS='--require=./.qa/astra-iterate/node-compat.cjs' # only if that OS lookup fails
npm run simulate -- gpt-6-astra hard --rounds 120 --seed astra-iterate-confirm --out .qa/astra-iterate/rerun.json
```

## Competition settings

The profile matches the guide's Hard comparison convention exactly:
`{ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 }`.
The engine does not enforce equal profiles. Astra does not change shared physics, scheduling,
observations, built-in strategies, or game rules.

Native plans last 8 ticks in combat or near shells and 12 ticks otherwise, on the shared 120 Hz
clock: nominally 15 or 10 observations per simulated second. Each plan has a one-tick first segment
that can attempt one volley, followed by the same movement controls with firing off. Native plans
do not use the profile's legacy reaction adapter. This is a timing difference from built-in Hard.

## Strategy

- One breadth-first search supplies costs to enemies and pickups. Persistent cell-center waypoints,
  clearance checks, target preference, and seeded recovery prevent unnecessary route resets.
- Direct aiming iterates a moving-target intercept and stops extrapolation at walls. A bounded
  mirror search checks potential bank shots with the shared shot query. Firing checks muzzle
  clearance, cooldown, ammo, current heading, and predicted friendly ricochets.
- Up to 16 nearby observed shells are forecast through exact rounded-wall collisions over 1.05
  seconds, including the point when friendly shells first become dangerous. Aimed enemies also
  contribute lower-confidence forecasts of their next volley.
- Up to 13 distinct steering/throttle candidates are rolled forward at 50 ms intervals. Scoring
  prioritizes shell avoidance, then aim, route progress, spacing, and avoiding blocked movement.
  Later forecast steps return to the current navigation/combat intent; only the first 8–12 ticks
  are committed. Collision queries reuse the engine's silhouettes and swept geometry, with local
  wall filtering and swept bounding boxes to reduce work.
- State belongs to each bot instance and resets each round. Recovery uses only the supplied seeded
  RNG. Browser strategy code has no Node dependencies, network calls, or wall-clock decisions.

The movement forecast is an approximation: it does not reproduce engine contact pivots or forecast
enemy steering. Shell forecasts do not remove shells that might first hit another tank. Limits on
shells, bank candidates, and prediction time keep decision work bounded, but do not guarantee a
10 ms dispatch-to-receipt latency on every machine.

## Original development experiments (historical)

Each batch below used 80 independent rounds, rotating slots, seed `astra-train` (sample suffixes
`:0` through `:79`), classic/balanced maps, pickups enabled, and isolated Node workers. Counts are
Astra wins / ties / losses. These are tuning data, not independent confirmation of strength.

| Candidate    | Change                                              | W / T / L   | Astra deadline misses |
| ------------ | --------------------------------------------------- | ----------- | --------------------- |
| v1           | Initial planner                                     | 50 / 6 / 24 | 426                   |
| v2           | Swept wall-bounds filtering                         | 56 / 4 / 20 | 274                   |
| v3           | Anticipated fire, longer lead, altered reversing    | 61 / 5 / 14 | 353                   |
| v4, selected | Restore reliable reversing; skip duplicate controls | 59 / 8 / 13 | 239                   |

v3 exposed a stall on the generated-maze fixture `astra-route-4`; it was rejected despite its
slightly higher development win count. v4 passes that fixture. Timing admission varies with machine
load, so these changes are not seed-only reproducible and the differences are not a proof of a
statistically significant strength improvement. Required checks overlapped the end of the v4 run;
use the separate confirmation runs for final measurements.

Reports are under ignored `.qa/astra-train-v1.json` through `.qa/astra-train-v4.json`.
The initial eight-round diagnostic replays are under `.qa/astra-smoke-v1-replays/`; these are replay
format v1. Benchmark reports use format v2 and include scheduler metadata and per-entry diagnostics.
Earlier strategy snapshots are retained locally as `.qa/astra-v1.ts` through `.qa/astra-v3.ts`.

## Original fresh-seed confirmation (historical)

All samples are independent rounds with rotating slots, target 0, no capped samples, and Node
24.18.0. Pickups are enabled except in the compact/open batch. No strategy changes followed the
selection of v4. Sample seeds append `:0` through `:N-1` to the batch seed below. All intervals are
95% Wilson intervals. The complete reports retain intervals for every player's outcomes.

| Report under `.qa/`        | Batch seed               | Roster after Astra               | Map                      | Rounds | Astra W / T / L | Win rate (95% interval) | Achieved speed |
| -------------------------- | ------------------------ | -------------------------------- | ------------------------ | ------ | --------------- | ----------------------- | -------------- |
| `astra-confirm.json`       | `astra-confirm-20261101` | Hard                             | classic/balanced         | 120    | 94 / 9 / 17     | 78.3% (70.1–84.8%)      | 16.46x         |
| `astra-confirm-ffa.json`   | `astra-confirm-ffa`      | Hard, Medium, Hard               | classic/balanced         | 48     | 27 / 8 / 13     | 56.3% (42.3–69.3%)      | 11.69x         |
| `astra-confirm-open.json`  | `astra-confirm-open`     | Hard                             | compact/open, no pickups | 40     | 31 / 2 / 7      | 77.5% (62.5–87.7%)      | 12.28x         |
| `astra-confirm-dense.json` | `astra-confirm-dense`    | Hard                             | large/dense              | 40     | 15 / 16 / 9     | 37.5% (24.2–53.0%)      | 36.28x         |
| `astra-six-final.json`     | `astra-six-final`        | Hard, Medium, Hard, Medium, Hard | classic/balanced         | 6      | 4 / 1 / 1       | 66.7% (30.0–90.3%)      | 16.87x         |
| `astra-browser-final.json` | `astra-browser-final`    | Hard                             | classic/balanced         | 4      | 4 / 0 / 0       | 100% (51.0–100%)        | 0.95x          |
| `astra-browser-dense.json` | `astra-browser-dense`    | Hard                             | large/dense              | 4      | 3 / 0 / 1       | 75.0% (30.1–95.4%)      | 0.98x          |

The Node worker runs request unpaced execution. The browser run uses actual browser workers and
requests 1x speed; its achieved speed includes startup and decision waits. Six-player and browser
results are smoke tests, not strong rate estimates. No statistical browser/headless equivalence
claim is made; the browser samples use different seeds and were not passed to `--compare`.

**Observed headless limitation:** 15 of the 16 large/dense draws recorded exactly one request per
bot, one missed deadline, and 2,719 busy skips per bot, with no reply admitted before the round
expired. Five classic duel samples and one four-player sample had the same pattern. These draws
remain in the reported denominators. This is evidence of timing/admission failure, not evidence
of strategic stalemate. The high achieved speed on dense maps includes neutral fallback ticks and
must not be interpreted as useful controller throughput. Shared scheduling was left unchanged.

Per-player production diagnostics follow. Entry numbers preserve repeated bot IDs through slot
rotation. `late` overlaps missed decisions and must not be added to skipped-decision totals.
Every entry had **zero invalid plans**.

| Batch               | Entry     | Requests | Deadline misses | Busy skips | Late replies |
| ------------------- | --------- | -------- | --------------- | ---------- | ------------ |
| classic duel        | Astra     | 14135    | 313             | 14147      | 302          |
| classic duel        | Hard      | 9467     | 36              | 13595      | 31           |
| four-player         | Astra     | 7631     | 166             | 2933       | 164          |
| four-player         | Hard #2   | 3447     | 35              | 2749       | 34           |
| four-player         | Medium #3 | 1461     | 12              | 2723       | 11           |
| four-player         | Hard #4   | 3608     | 36              | 2760       | 35           |
| compact/open        | Astra     | 3928     | 100             | 101        | 99           |
| compact/open        | Hard      | 2280     | 3               | 0          | 3            |
| large/dense         | Astra     | 4778     | 216             | 40934      | 198          |
| large/dense         | Hard      | 3497     | 33              | 40785      | 18           |
| six-player          | Astra     | 944      | 11              | 2740       | 10           |
| six-player          | Hard #2   | 322      | 6               | 2723       | 5            |
| six-player          | Medium #3 | 124      | 7               | 2723       | 6            |
| six-player          | Hard #4   | 311      | 6               | 2725       | 5            |
| six-player          | Medium #5 | 168      | 6               | 2722       | 5            |
| six-player          | Hard #6   | 167      | 6               | 2723       | 5            |
| browser classic, 1x | Astra     | 447      | 8               | 1          | 8            |
| browser classic, 1x | Hard      | 277      | 5               | 1          | 5            |
| browser dense, 1x   | Astra     | 1034     | 27              | 0          | 27           |
| browser dense, 1x   | Hard      | 771      | 4               | 0          | 4            |

The dense browser smoke had no busy skips or invalid plans for either player; all four rounds
ran actual combat. This checks operation on that layout but is too small to resolve its win rate.

Final-candidate six-player replays are in `.qa/astra-final-replays/` and can be loaded in the game's
replay UI. Reproduce a batch using `npm run simulate -- gpt-6-astra hard --rounds 120 --seed
astra-confirm-20261101 --out .qa/astra-rerun.json`, adjusting roster, map, pickups, and browser options
from the table. Timing diagnostics and outcomes may differ on a rerun.

## Original validation (historical)

`npm run check` passed: strict type checks, lint, formatting, and all 126 tests. `npm run build`
passed and produced the browser worker bundle. Both `npm run test:browser` against Vite development
and `npm run test:browser -- --preview` against the compiled production build passed, including
worker integration, responsive layouts, replay controls, and absence of runtime errors. The two
normal-speed browser batches above separately exercised the actual `gpt-6-astra` worker.

Focused tests cover registration/profile, firing and empty ammo, crossing shells, already-bounced
friendly shells, forecasting a first friendly bounce, open-arena engagement, and generated-maze
navigation. These use the explicit in-process test adapter and establish behavior, not production
deadline performance.

Only builtin opponents have been evaluated. Results cannot establish strength against unseen
model submissions, universal browser/headless equivalence, or all battleground configurations.
