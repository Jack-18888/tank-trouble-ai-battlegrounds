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

Preserve other competitors and the game rules. Ordinary implementation changes belong in the new
bot's files, its shared catalog registration, and focused behavioral tests. An explicitly requested
shared-engine change is a separate scope with its own validation.

## Implement and improve

- Extend `AbstractPlayer`; implement `decide(PlayerContext)` and call `observe()` for a frozen
  snapshot. Register the class in `src/bots/index.ts` so workers can construct it too.
- Choose an approach rather than assuming the provided baseline is optimal. Existing
  `CombatStrategy` and `MazeNavigator` are reusable starting points. Independent planners are also
  supported. Use the guide's source map to inspect collision and scheduling details as needed.
- Keep target, route, and recovery memory in instance fields. Round workers are recreated, while
  pause/resume retains the surviving instance. Use `match.elapsed` for strategy timing and
  `context.random()` for randomness.
- Account for held controls and the shared hull/barrel heading. Physics runs at 120 Hz, observations
  at up to 30 Hz, and delayed worker replies keep old controls active. Bound search by work count so
  browser latency stays useful and seeded headless decisions remain reproducible.
- Use synchronous decisions if fast headless evaluation is needed. Promises work in browser
  workers, but the fast simulation runner rejects them. Do not introduce external model calls into
  the decision loop unless the user specifically requests that architecture.
- Treat `predictShot` as geometry against frozen tank poses. It does not lead moving targets,
  incorporate firing error or scatter volleys, or determine whether a shielded hit is lethal.
  Validate the current firing heading, returning ricochets, wall clearance, and ammunition.

Prefer a sequence of measurable changes. Diagnose losses with replays before increasing planner
complexity. Useful directions include collision-aware short-horizon avoidance, persistent route
following, interception, selective ricochets, pickup routing, and ammo-aware aggression. They are
hypotheses to evaluate, not a prescribed winning algorithm.

## Validate and deliver

Use [the simulation workflow](../run-bot-simulations/SKILL.md) and
[CLI documentation](../../../docs/simulations.md) when benchmarking. Select an experiment size
proportional to the task; begin with a small smoke run, retain an earlier candidate for comparison,
and reserve fresh seeds for confirmation. Alternate slots, inspect ties and capped matches, and
check relevant map settings and opponents. The two-bot CLI cannot establish free-for-all strength.

Keep reports and replay exports under ignored `.qa/` paths. The CLI's `--compare` validates execution
modes on identical source and plans; it is not an old-bot-versus-new-bot ranking command. Normal
browser claims require 1x worker evidence. Accelerated browser runs and deterministic headless
batches change scheduling conditions.

Run `npm run check` and `npm run build` for a submitted implementation. Use focused behavioral tests
for new planner logic, and browser verification for worker/catalog integration when available.
Report the registered ID, files changed, profile, algorithm, exact experiment settings and counts,
win/tie/loss intervals, relevant replay paths, and remaining limits. If a check cannot run, state
that explicitly. Claim an improvement only to the extent supported by the measurements.
