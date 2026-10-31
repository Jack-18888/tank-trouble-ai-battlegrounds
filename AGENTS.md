# Working on competing bots

When asked to build or improve a competing Tank Trouble bot, start with
[the competitor guide](docs/competing-bots.md). It covers the actual game mechanics, useful strategy
directions, and evaluation pitfalls. [The bot API guide](docs/bots.md) defines the extension contract.

Agents with skill support can use
[`build-competitive-bot`](.agents/skills/build-competitive-bot/SKILL.md). Other models can follow the
same Markdown documents directly; no particular model provider or external service is required.

For ordinary bot development:

- Add a uniquely named strategy under `src/bots/` and register it in `src/bots/index.ts`, which is
  loaded by both the browser and workers. Preserve existing competitors and built-in bots.
- Use immutable observations and the provided seeded RNG. Keep strategy state in the bot instance;
  a new instance is created each round. Keep browser-imported strategy code free of Node.js APIs.
- Prefer finite `Decision` plans with ordered segments on the shared 120 Hz clock. Observations
  arrive at plan expiry; legacy `PlayerDecision` controls use the seeded reaction adapter. A native
  plan supplies its own duration, so disclose its horizon as well as its movement/firing profile.
- Keep decisions within the 10 ms dispatch-to-receipt budget. Missing, late, or invalid plans cause
  four neutral ticks; busy workers receive no overlapping request. Use bounded work and seeded
  randomness, but do not claim seed-only reproducibility when deadline misses can differ.
- Follow any competition rules supplied by the user. The engine does not enforce equal movement or
  firing profiles. Without a specified profile, use the guide's Hard-profile baseline for a useful
  strategy comparison and disclose it in the result. This is a comparison convention, not an
  engine-enforced tournament rule.
- Scope changes to the strategy, its registration, and relevant tests. Changes to shared physics,
  scheduling, observations, or opponents need an explicit task reason.
- Use [the simulation guide](docs/simulations.md) for benchmarks. The CLI supports 2–6 bots using
  Node workers; both synchronous and asynchronous decisions are supported. Starting slots rotate
  across the full roster, and per-entry summaries preserve repeated bot IDs. `InProcessConnection`
  is a test adapter, not the production path for enforcing CPU isolation or decision deadlines.
- Report measured outcomes, seeds, settings, profile, and execution mode. Distinguish small smoke
  tests from evidence of strength, and headless measurements from browser measurements. Include
  requested/achieved speed and per-player deadline misses, busy skips, and invalid-plan counts;
  distinguish report v2 scheduling metadata from the unchanged replay v1 format.

Use the checks documented in [README.md](README.md) for the files changed. Bot implementations should
pass `npm run check` and `npm run build`; browser verification matters for worker integration.
