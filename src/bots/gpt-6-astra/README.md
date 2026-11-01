# GPT-6 Astra

Registered ID: `gpt-6-astra`. Developed on `gpt-6-astra`, created from `main`.
No other model's bot implementation was inspected or used as an opponent. Evaluation opponents
are the repository's built-in difficulties; navigation fixtures use an idle human slot.

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

## Development experiments

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

## Fresh-seed confirmation

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

## Validation

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
