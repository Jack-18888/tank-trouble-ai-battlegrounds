# Headless bot simulations

Run two registered bots directly in Node.js, without Vite, a browser, rendering, or workers:

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --out .qa/headless.json
npm run simulate -- medium hard --matches 10 --target 3 --seed matches
npm run simulate -- easy hard --rounds 1 --replays .qa/sample-replays
```

Use `npm run simulate -- --help` for all options. Run commands from the repository root after
`npm ci`. The existing `tsx` development dependency runs the TypeScript CLI; no new packages
are needed. Custom registered bots are available automatically.

## CLI options

The two positional arguments are registered bot IDs, such as `easy`, `medium`, or `hard`.
Choose either independent rounds or whole matches; omitting both count options runs one round.

| Option              | Default                 | Meaning                                                                   |
| ------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `--rounds N`        | `1`                     | Sample N independent rounds                                               |
| `--matches N`       | Unset                   | Sample N whole matches instead of independent rounds                      |
| `--target N`        | `5` for matches         | First to 3, 5, or 10 wins; requires `--matches`                           |
| `--max-rounds N`    | `100`                   | Maximum rounds per match before reporting it as capped                    |
| `--seed TEXT`       | `simulation`            | Reproducible batch seed                                                   |
| `--size SIZE`       | `classic`               | `compact`, `classic`, or `large`                                          |
| `--density VALUE`   | `balanced`              | `open`, `balanced`, or `dense`                                            |
| `--no-powerups`     | Pickups enabled         | Disable pickups                                                           |
| `--fixed-sides`     | Slots alternate         | Keep the first named bot in roster slot zero                              |
| `--replays DIR`     | Recording disabled      | Save each completed round as a `.ttr.json` file                           |
| `--out FILE`        | Console only            | Write the JSON report; an existing report at this path is replaced        |
| `--browser`         | In-process execution    | Run browser workers; requires Vite and Chrome                             |
| `--browser-speed N` | `1`                     | Requested simulation speed from 1 to 64; requires `--browser`             |
| `--url URL`         | `http://127.0.0.1:5173` | Vite development server used by `--browser`                               |
| `--compare FILE`    | Unset                   | Compare headless or accelerated browser outcomes with a 1x browser report |
| `--tolerance RATE`  | `0.05`                  | Allowed difference per outcome as a fraction                              |
| `--help`            | Unset                   | Print usage and options                                                   |

Counts and round limits must be positive integers. The uppercased batch seed plus `:INDEX`
must fit the replay format's 128-character limit. `--browser` cannot be combined with
`--replays`, and `--out` cannot overwrite the reference passed to `--compare`.

For example, sample compact open maps with pickups disabled:

```sh
npm run simulate -- easy medium --rounds 100 --seed compact-open --size compact --density open --no-powerups --out .qa/compact-open.json
```

## Execution and replay export

Each sample uses a fresh Game, runtime, and strategy instances. Physics stays at 120 Hz and
observations at 30 Hz, with the same rules, queries, bot scheduler, and seeded randomness as the
game. The runner advances these steps as fast as the CPU permits. It retains cosmetic simulation
because effects currently consume the gameplay RNG. Browser gameplay scheduling is unchanged.

`--rounds N` samples N independent single rounds, each with a new seed. `--matches N` plays N
whole matches to `--target` wins (3, 5, or 10; default 5). `--max-rounds` defaults to 100 per match;
a match reaching this limit without a winner is **capped**, excluded from win/tie/loss rates,
and reported separately. Whole matches normally have no ties. Round ties use the game's existing
survival and kill-tiebreak rules.

Results always describe the first named bot. Starting slots alternate by default; `--fixed-sides`
disables this. Seeds are `BATCH_SEED:INDEX` with zero-based indices and do not repeat within a batch.
An even sample count balances slots exactly. Reusing the same seed, source, and settings reproduces
the synchronous headless batch. Bots must return synchronous decisions and use the provided seeded
random stream; asynchronous decisions and controller failures abort rather than silently affecting
the reported rates. In-process bots share the runner's thread, so an infinite loop can block it.

Recording is off by default. `--replays DIR` writes one `.ttr.json` per completed round using the
existing recorder and format, including all rounds of a match. Upload these through **Upload replay**
in the game. Only the current round's recording is retained. Existing replay filenames are never
overwritten; choose a fresh directory for a new batch. Recording adds CPU and memory cost.

Replay filenames use `sample-000001-round-1.ttr.json`: sample numbers in filenames are one-based,
while report indices and generated seed suffixes are zero-based. A match can produce several
round files. Reusing a replay directory with conflicting filenames aborts instead of replacing
the existing recordings.

## Reading the output

The console lists completed and capped samples, then each outcome's count, percentage, and
95% confidence interval. Wall time and simulated-time speed include recording/export work
when enabled. They are measurements of the current run, not guaranteed performance.

With `--out`, the report contains:

| Field               | Meaning                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `format`, `version` | `tank-trouble-simulation`, version `1`                                                             |
| `execution`         | `in-process` or `browser-workers`                                                                  |
| `environment`       | Node.js version or browser user agent                                                              |
| `browserSpeed`      | Requested browser speed; omitted for in-process runs, and absent in older browser reports means 1x |
| `sourceHash`        | SHA-256 of source, tooling, browser fixture, and dependency lockfile                               |
| `plan`              | Bots, count, seed, map settings, target, round limit, and slot policy                              |
| `results`           | One entry per completed or capped sample                                                           |
| `elapsedMs`         | Wall-clock duration of the run in milliseconds                                                     |
| `summary`           | Completed/capped counts and win/tie/loss rates with intervals                                      |
| `comparison`        | Present after a successful comparison computation, including an inconclusive result                |

Each result includes `index`, `seed`, `swapped`, `outcome`, `rounds`, `winnerId`, `scores`,
`kills`, and `simulatedSeconds`. `outcome` describes the first named bot; `winnerId`,
`scores`, and `kills` use the actual roster order. Thus a win by the first named bot can
have `winnerId: 1` in a sample where slots were swapped. Do not aggregate raw roster scores
as if slot zero always represented the same bot.

Headless reports are written when the batch finishes. Browser reports are checkpointed after
each completed sample and updated with the final browser environment and elapsed time. A failed
batch may leave a partial browser report or replay files; incomplete reports are not valid
evidence of equivalence. Report files under `.qa/` are local artifacts excluded from Git.

## Comparing against browser matches

Fast headless results are estimates of bot strength. Asynchronous browser worker timing can introduce
a systematic bias: increasing the sample count alone does not make the two distributions agree.
The initial acceptance target is **within 5 percentage points for each win, tie, and loss rate**,
from the first bot's perspective. Validate each matchup and configuration you intend to rely on.

Collect a reference using the same browser worker transport, renderer, and real-time RAF accumulator
as the game. Start Vite in one terminal, then collect in another:

```sh
npm run dev
```

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --browser --out .qa/browser.json
npm run simulate -- medium hard --rounds 1000 --seed benchmark --compare .qa/browser.json --out .qa/headless.json
```

Chrome/Chromium is detected automatically; set `CHROME_PATH` if necessary. The collector
uses a rendered 960-by-640 arena in headless Chromium and runs samples sequentially.
The default `--browser-speed 1` runs **at real time**, retaining normal worker timing. Large references can take hours. Results are
checkpointed after each sample, but incomplete references cannot establish equivalence. Use `--url`
if Vite is served elsewhere. The collector requires development source modules, not a production
preview server. Its dedicated fixture omits the game's surrounding settings and audio UI, so its
result applies to that browser workload and environment rather than every device or browser.

The JSON reports retain the full plan, outcomes, roster scores/kills, environment, source SHA-256,
and timings. Comparison requires matching plans, all planned samples, the same source fingerprint,
and no capped matches. Collect both reports from the same checkout and do not edit code between runs.
Reference collection deliberately uses a separate browser profile, cleaned up after completion.

### Accelerated browser runs

Pass `--browser-speed 2` or `--browser-speed 4` to request faster execution:

```sh
npm run simulate -- medium hard --rounds 100 --seed speed-check --browser --browser-speed 4 --out .qa/browser-4x.json
```

Speed must be a finite number from 1 to 64; fractional multipliers such as 2.5 are accepted.
The multiplier scales simulated time accumulated per rendered frame. Physics still advances in
1/120-second ticks, observations stay at 30 Hz of simulated time, and the renderer draws once per
browser frame. Each frame processes at most 120 physics ticks before yielding to worker replies
and rendering. CPU and rendering costs can make achieved throughput lower than the requested speed;
the console and report distinguish the requested `browserSpeed` from measured wall time.
Worker watchdogs continue to use real unpaused wall time.

Acceleration can change which physics ticks receive bot replies and which pending observations
workers skip. It therefore changes the sampled execution conditions. Accelerated reports cannot
be passed as the `--compare` reference for normal browser play, even if another accelerated run
previously passed a comparison. Use a 1x reference for each validation instead.

To compare acceleration against normal timing, collect both runs with the same plan and source:

```sh
npm run simulate -- medium hard --rounds 100 --seed speed-check --browser --out .qa/browser-1x.json
npm run simulate -- medium hard --rounds 100 --seed speed-check --browser --browser-speed 4 --compare .qa/browser-1x.json --out .qa/browser-4x.json
```

The comparison records candidate and reference execution modes and speeds. Its tolerance and
confidence rules are the same as for the headless comparison. A small comparison may be
inconclusive; requested speed alone does not establish statistical agreement. Historical reports
without `browserSpeed` are read as 1x browser reports, since earlier CLI versions supported only 1x.

The ordinary summary reports per-outcome 95% Wilson confidence intervals. Comparison pairs the
same seeds and slots, counts positive/negative outcome disagreements, and subtracts conservative
Wilson bounds on those disagreement probabilities. Six intervals use z=2.64 (a Bonferroni adjustment)
for approximately 95% simultaneous coverage across all three rate differences. This accounts for
paired outcomes without treating them as independent browser/headless samples. It assumes different
seeded samples represent independent trials. See [NIST's Wilson interval description](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).

A comparison reports:

- **equivalent**: every difference interval fits inside the tolerance; exit code 0.
- **different**: at least one interval lies entirely outside the tolerance; exit code 1.
- **inconclusive**: the sample cannot establish either conclusion; exit code 2.

Errors also exit 1. Matching point estimates, a small sample, or failure to detect a difference
do not count as equivalence. `--tolerance 0.05` is the default; pass another fraction explicitly
to change it. If a sufficiently large comparison finds a difference, the execution modes need
timing calibration or shared deterministic scheduling before headless results can stand in for
browser results. Do not repeatedly rerun a comparison until it happens to pass; choose a sample
size in advance and use fresh confirmation samples after changing timing or bot code.

## Validation results so far

These are observed development-test results for **Medium against Hard**, from Medium's perspective,
on classic balanced maps with pickups enabled and alternating slots:

| Run                        | Seed         | Rounds | Wins      | Ties        | Losses      |
| -------------------------- | ------------ | ------ | --------- | ----------- | ----------- |
| Headless performance batch | `validation` | 1,000  | 61 (6.1%) | 556 (55.6%) | 383 (38.3%) |
| Headless paired smoke test | `smoke`      | 2      | 0 (0%)    | 1 (50%)     | 1 (50%)     |
| Browser paired smoke test  | `smoke`      | 2      | 0 (0%)    | 2 (100%)    | 0 (0%)      |

The 1,000-round headless batch completed in about 206 seconds on Node.js 24.18.0, roughly
62 times its simulated duration. The paired browser run used headless Chromium on Windows with
the rendered reference fixture described above. Its result is a sample frequency, not the true
browser win/tie/loss distribution.

The two paired smoke reports share settings and a source fingerprint. Their observed differences
(headless minus browser) are 0 percentage points for wins, -50 for ties, and +50 for losses.
With only two trials, every difference interval is too wide for the 5-point target; the comparison
returns **inconclusive**, exit code 2. Even zero observed wins has a per-rate 95% interval of
approximately 0% to 65.8% at this sample size.

The 1,000-round performance batch used a different seed and an earlier source fingerprint, so
it cannot be paired with this two-round browser report. **Large-sample agreement with browser
outcomes has not yet been established.** Collect a fresh, sufficiently large matched browser and
headless batch before relying on headless results as a substitute for browser outcomes.

## Troubleshooting

| Message or situation             | Action                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| Unknown bot ID                   | Check the registrations in `src/bots/index.ts`                              |
| Synchronous decisions required   | Use a synchronous bot; async strategies need the browser path               |
| A bot failed                     | Fix the controller error; failures are not counted as losses                |
| Replay file already exists       | Choose a fresh directory for `--replays`                                    |
| Vite reference page not found    | Run `npm run dev` from this checkout and check `--url`                      |
| Chromium not found               | Set `CHROME_PATH` to the browser executable                                 |
| Source revision or plan mismatch | Collect reports from the same code with identical CLI settings              |
| A 1x reference is required       | Use a normal-speed browser report as `--compare`, not an accelerated report |
| Capped matches block comparison  | Choose a larger `--max-rounds` for both reference and headless runs         |
| Comparison is inconclusive       | Inspect the intervals; a larger preplanned sample may be needed             |

The reusable agent workflow is in
[`run-bot-simulations`](../.agents/skills/run-bot-simulations/SKILL.md).
