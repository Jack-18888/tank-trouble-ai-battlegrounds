---
name: run-bot-simulations
description: Run this repository's Tank Trouble simulation CLI, export round replays, and compare headless bot outcome rates with browser references. Use for bot benchmarks, seeded batches, and statistical browser validation.
---

# Run bot simulations

Read [the CLI guide](../../../docs/simulations.md) for options, report fields, comparison
requirements, and the current validation evidence. Run commands from the repository root.

## Choose the experiment

- Use `--rounds N` for independent round win/tie/loss rates. Use `--matches N --target 3|5|10`
  when the requested outcome is a complete match; omitting `--target` uses 5 wins.
- Identify results by the first named bot. Slots alternate by default; use an even sample count
  for exact slot balance unless the user requests fixed sides.
- Set an explicit seed and preserve map size, density, powerups, target, round cap, and side policy
  when comparing runs. Each sample has seed `BATCH_SEED:INDEX` with a zero-based index.
- Keep recording disabled for throughput measurements unless replays are part of the request.
  Store local reports and recordings under `.qa/`, which Git ignores. Use distinct report paths
  and a fresh replay directory to preserve previous artifacts.

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --out .qa/headless.json
npm run simulate -- medium hard --matches 10 --target 3 --seed matches --out .qa/matches.json
npm run simulate -- easy hard --rounds 1 --seed replay-check --replays .qa/replay-check
```

Registered bot IDs come from `src/bots/index.ts`. Fast in-process runs require synchronous
decisions. A controller failure aborts the run; do not turn it into a loss or silently replace
the bot. Capped matches are reported separately and excluded from outcome rates.

## Validate against browser outcomes

Headless throughput and accurate replay playback do not establish browser outcome equivalence.
The default acceptance target is within 5 percentage points for each win, tie, and loss rate.
Use the CLI's paired comparison rather than comparing percentages from unrelated batches.

Start the Vite development server, then collect a browser reference and run the matching
headless batch. Reuse every experiment option in both commands:

```sh
npm run dev
```

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --browser --out .qa/browser.json
npm run simulate -- medium hard --rounds 1000 --seed benchmark --compare .qa/browser.json --out .qa/headless.json
```

Browser collection uses real-time workers and a rendered reference arena; a large batch can
take hours. State the expected duration before starting a long collection, using observed
round durations when available. Do not accelerate that reference or substitute simulated
worker delays for measured browser results. `CHROME_PATH` selects Chromium; `--url` selects
the Vite development server. The production preview server does not expose the required modules.

Keep source, tooling, fixtures, and the lockfile unchanged between reference and headless runs:
their fingerprint must match. Compare complete reports with the same plan and no capped matches.
If an experiment fails, report its error and incomplete coverage rather than treating its
partial report as a successful comparison.

Interpret the result as `equivalent` (exit 0), `different` (exit 1), or `inconclusive` (exit 2).
Errors also exit 1. A small sample or overlapping intervals is not evidence of equivalence.
Choose the sample size in advance; after adjusting bots or scheduling, use fresh confirmation
samples rather than repeatedly sampling until a comparison passes.

## Report the evidence

Give the named-bot perspective, sample unit and count, seed/settings, capped count, outcome
counts and rates, confidence intervals, execution environment, and comparison status when present.
`outcome` follows the first named bot, but `winnerId`, `scores`, and `kills` follow roster order;
account for `swapped` when examining those fields.

Separate measured browser sample frequencies from estimates of its underlying rates. Do not
describe the historical two-round smoke test as large-sample validation, or extrapolate one
passing matchup to other bots, settings, or devices. Link the saved reports and any replay files.
For requested replay verification, use `parseReplay` and `ReplayPlayer` from `src/replay.ts`;
replays are per round and can be uploaded through the game's existing replay panel.
