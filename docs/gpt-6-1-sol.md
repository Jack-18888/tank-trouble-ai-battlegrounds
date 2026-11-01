# GPT-6.1 Sol

Registered ID: `gpt-6-1-sol`. Implementation: `src/bots/gpt-6-1-sol/index.ts`.
Branch: `gpt-6-1-sol`, created from `main` at `254e83b`.

This is an original controller. Development opponents were exclusively the built-in Hard and
Medium bots, plus idle human fixtures. No other model's bot implementation or benchmark was read,
and no other model's bot was used as an opponent. Shared physics, scheduling, and opponents are
unchanged.

## Profile and decisions

The complete, unchanged Hard comparison profile is:

```ts
{ speed: 108, turn: 3.9, reaction: 0.11, error: 0.012, cooldown: 0.46 }
```

Native plans have one segment: **6 ticks under nearby projectile pressure, otherwise 10 ticks**
(50 or 83.33 ms, approximately 20 or 12 decisions/second). During last-survivor settling the horizon
is 8 ticks (66.67 ms). These are committed plan lengths, not the longer internal search horizon.
Native plans do not use the profile's legacy reaction adapter: Sol therefore observes more often
than built-in Hard. This is not an equal-reaction comparison or an engine-enforced tournament rule.
Shots use `once` on the first tick rather than firing throughout a turn.

## Strategy

- Persistent BFS cell routes, radius-clearance waypoint smoothing, feedback steering toward each
  waypoint inside rollouts, and braking before arrival. Progress memory triggers a seeded reverse
  and turn recovery when blocked.
- Target hysteresis using reachable path cost, visibility, and shield state. Shield pickups can
  justify a detour; offensive pickups depend on ammunition and current power.
- Iterative moving-target lead that accounts for turn time, bounded velocity forecasts stopped at
  walls, and bank-shot proposals from reflecting targets across wall capsule surfaces.
- Swept moving-target shot checks using shared tank silhouettes and rounded-wall intersections.
  Actual first-tick heading, muzzle clearance, cooldown, ammunition, partial scatter volleys, and
  short self-return ricochets are checked before firing.
- A one-second receding-horizon movement search: 15 coarse rollout steps per policy, forward and
  reverse approaches, turn-only actions, and lateral escapes. It uses 5 policies in quiet states,
  15 under nearby pressure, and optionally one recovery policy. Exact tank-wall checks follow an
  allocation-free conservative broad phase. Contact pivots are deliberately not reproduced.
- Shell hazards include wall ricochets, returning friendly shells, and lower-confidence hypothetical
  shots from eligible enemy muzzles. The nearest 32 observed shells are considered, bounded to a
  1.25-second forecast and at most seven ricochet transitions. Offense traces are bounded to 3.4
  seconds and four transitions. Target prediction and repeated angle proposals share cached work.
- Evasion continues during the settling interval, even when no enemy remains alive.

All memory is per instance and all strategy randomness uses the supplied seeded stream. No Node.js
APIs, clocks, external calls, or unseeded randomness occur in strategy code. Bounded work does not
guarantee a deadline on every machine: measured misses below are part of the result.

## Iteration and behavioral checks

Eight development revisions addressed excessive allocation/latency, repeated target forecasts,
short self-ricochets, scatter muzzle offsets, settling-phase evasion, fixed-heading corner loops,
lead-aim priority, recovery throttling, and unnecessary quiet-state search.

`tests/gpt-6-1-sol.test.ts` contains ten focused tests: registration/profile/plan validity, aligned
fire and finite/infinite ammo, blocked muzzle, idle-target elimination, incoming-shell evasion,
returning friendly shells during settling, moving-target lead, future ricochets, maze pursuit,
and instance/snapshot independence. Local controlled tests use `InProcessConnection`; they do not
establish real-worker deadline performance.

Development artifacts use `.qa/sol-v*-*.json` and replay directories. These are tuning data, not
independent confirmation. The final strategy was fixed before the following fresh-seed matrix.

## Fresh-seed confirmation

Windows, Node.js `v24.18.0`, isolated Node workers, report format **v2**, 120 Hz, 10 ms decision budget.
All samples are independent rounds (`target: 0`), with rotating starting slots, no caps, and normal
90-second round rules. Pickups are on except in the compact/open batch. Requested headless speed
is unpaced/as-fast-as-possible, not a fixed playback multiplier. Intervals below are 95% Wilson win
intervals; the JSON reports also retain tie/loss intervals and every original roster entry.

| Opponent(s) | Map                      | Rounds | Wins / ties / losses | Win rate (95% interval) | Achieved speed | Seed                  |
| ----------- | ------------------------ | -----: | -------------------: | ----------------------- | -------------: | --------------------- |
| Hard        | classic/balanced         |    200 |        164 / 18 / 18 | 82.0% (76.1–86.7%)      |          17.5× | `sol-confirm-classic` |
| Five Hards  | classic/balanced         |     72 |         43 / 10 / 19 | 59.7% (48.2–70.3%)      |          13.9× | `sol-confirm-six`     |
| Hard        | compact/open, no pickups |     40 |           33 / 0 / 7 | 82.5% (68.0–91.3%)      |          15.6× | `sol-confirm-open`    |
| Hard        | large/dense              |     40 |           35 / 1 / 4 | 87.5% (73.9–94.5%)      |          16.1× | `sol-confirm-dense`   |
| Medium      | classic/balanced         |     40 |           37 / 0 / 3 | 92.5% (80.1–97.4%)      |          17.7× | `sol-confirm-medium`  |

Reports: `.qa/sol-final-classic.json`, `.qa/sol-final-six.json`, `.qa/sol-final-open.json`,
`.qa/sol-final-dense.json`, and `.qa/sol-final-medium.json`.

### Per-entry scheduling diagnostics

Repeated Hard entries below are distinct original roster entries, not raw rotated slots.
Late replies are **not** added a second time to skipped decisions. All listed invalid-plan counts
are zero.

| Batch / entry      | Requests | Deadline misses | Busy skips | Invalid plans | Late replies |
| ------------------ | -------: | --------------: | ---------: | ------------: | -----------: |
| Classic / Sol      |   25,350 |             340 |      5,934 |             0 |          334 |
| Classic / Hard     |   13,228 |              10 |      5,438 |             0 |            8 |
| Six / Sol          |   11,566 |             144 |     13,894 |             0 |          139 |
| Six / Hard entry 2 |    3,132 |              48 |     13,635 |             0 |           43 |
| Six / Hard entry 3 |    3,201 |              53 |     13,641 |             0 |           48 |
| Six / Hard entry 4 |    2,811 |              54 |     13,641 |             0 |           49 |
| Six / Hard entry 5 |    3,273 |              57 |     13,644 |             0 |           52 |
| Six / Hard entry 6 |    3,645 |              51 |     13,643 |             0 |           46 |
| Open / Sol         |    4,004 |              49 |        101 |             0 |           47 |
| Open / Hard        |    1,870 |               1 |         27 |             0 |            0 |
| Dense / Sol        |    7,775 |              80 |        136 |             0 |           80 |
| Dense / Hard       |    4,505 |               6 |          3 |             0 |            6 |
| Medium / Sol       |    4,513 |              64 |        232 |             0 |           62 |
| Medium / Medium    |    1,221 |               0 |          0 |             0 |            0 |

Two classic samples (indices 23 and 101) and five six-player samples (22, 28, 29, 54, 67) dispatched
only one request per player, then accumulated thousands of busy skips. These scheduling anomalies
remain in the outcomes and explain most of the large busy-skip totals; they were not removed or
rerun selectively. Hardware/load and deadline admissions affect results, so these are not claims of
seed-only whole-match reproducibility.

## Browser and production integration

- `npm run check`: passed, **129 tests**, including the ten Sol tests.
- `npm run build`: passed, including the production worker bundle.
- `npm run test:browser`: passed on retry. An initial existing-profile run timed out; a subsequent
  cold run hit the suite's fixed-delay countdown assertion. An isolated-profile run and a later
  unmodified invocation passed. No shared test timing or engine changes were made.
- `npm run test:browser -- --preview`: passed against the built production bundle.
- An additional ignored copy of the browser harness selected `gpt-6-1-sol` and Hard in the production
  UI, started the match, verified no failed controllers and countdown completion, and captured
  `.qa/preview-sol-production-worker.png`. Log: `.qa/sol-production-check.log`.

A **four-round smoke test**, not a browser-strength estimate, used real Chromium 156 workers at
requested **1×**, classic/balanced with pickups and rotating slots, seed `sol-browser-final`.
It achieved **0.924×** (36.858 simulated seconds in 39.886 wall seconds) and finished **2 wins,
0 ties, 2 losses**. The win interval is 15.0–85.0%. No caps or controller errors occurred.

| Execution / entry   | Requests | Deadline misses | Busy skips | Invalid plans | Late replies |
| ------------------- | -------: | --------------: | ---------: | ------------: | -----------: |
| Browser 1× / Sol    |      378 |              41 |          1 |             0 |           41 |
| Browser 1× / Hard   |      209 |               3 |          0 |             0 |            3 |
| Matched Node / Sol  |      496 |               4 |          7 |             0 |            4 |
| Matched Node / Hard |      246 |               0 |          0 |             0 |            0 |

The matched Node run won 4/4 and achieved 16.1×. The repository's paired comparison is
**inconclusive** (expected CLI exit 2), not an equivalence pass. Sol missed 10.8% of dispatched plans
in this tiny browser sample, versus about 1–1.4% in the confirmation headless batches. This is an
important limitation: do not transfer the headline Node win rates to normal browser play.
Reports: `.qa/sol-final-browser.json` and `.qa/sol-final-browser-pair.json`.

Final-source replay smoke artifacts (4/4 wins, a separate non-confirmation seed `sol-final-replays`)
are in `.qa/sol-final-replays/` with report `.qa/sol-final-replays.json`. Replays use the unchanged
snapshot **v1** format, not report v2. Local `.qa/` artifacts are intentionally ignored by Git.

## Reproduce

```sh
npm run check
npm run build
npm run simulate -- gpt-6-1-sol hard --rounds 200 --seed sol-confirm-classic --out .qa/sol-repeat-classic.json
npm run simulate -- gpt-6-1-sol hard hard hard hard hard --rounds 72 --seed sol-confirm-six --out .qa/sol-repeat-six.json
npm run simulate -- gpt-6-1-sol hard --rounds 40 --seed sol-confirm-open --size compact --density open --no-powerups --out .qa/sol-repeat-open.json
npm run simulate -- gpt-6-1-sol hard --rounds 40 --seed sol-confirm-dense --size large --density dense --out .qa/sol-repeat-dense.json
npm run simulate -- gpt-6-1-sol medium --rounds 40 --seed sol-confirm-medium --out .qa/sol-repeat-medium.json
```

No result establishes strength against other submitted models, other hardware, or every game
configuration. The shorter native observation horizon, approximate future enemy motion, coarse
movement rollouts, finite projectile subset, and real deadline misses are explicit limitations.
