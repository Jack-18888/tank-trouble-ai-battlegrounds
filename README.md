# Tank Trouble — Ricochet Arena

A browser arcade game inspired by Tank Trouble. Drive a tank through a procedurally generated maze, bounce shots around corners, and be the last tank standing. Built with strict TypeScript and Canvas 2D, with Vite for development and static builds. The compiled game has no runtime package dependencies.

## Play locally

Use Node.js 22.13 or newer on the 22.x line, or Node.js 24 or newer:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Vite compiles the TypeScript modules for the browser and updates the page as source files change. Installed packages are development tools.

```sh
npm test           # TypeScript simulation tests through tsx
npm run typecheck  # strict app and test/tooling type checks
npm run build      # type-checks, then creates the standalone static site in dist/
npm run preview    # serves the compiled production build locally
```

Serve `dist/` with any static host. Both development and preview use port 5173; pass `-- --port 5174` to either npm command to choose another port.

## Code quality

TypeScript checks browser code, Node.js tests/tooling, and Web Worker code with separate strict configurations. Shared simulation code also compiles in the DOM-free Node.js configuration. ESLint uses typescript-eslint to check code quality, and Prettier formats TypeScript, HTML, CSS, JSON, and Markdown: two spaces, single quotes, a 100-character preferred line width, and LF line endings. Both `npm run check` and `npm run build` require successful type checking; Vite transpilation alone does not replace the compiler checks.

| Command                | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `npm run typecheck`    | Check all application, test, and tooling types          |
| `npm run lint`         | Check TypeScript; warnings fail the check               |
| `npm run lint:fix`     | Apply available ESLint fixes                            |
| `npm run format`       | Format the project                                      |
| `npm run format:check` | Check formatting without changing files                 |
| `npm run check`        | Run type checks, lint, formatting, and simulation tests |

Run `npm run check` before committing changes. Build output, dependencies, browser-test artifacts, and local hosting runtime files are excluded from these tools. `.editorconfig` supplies matching whitespace defaults to compatible editors. The committed lockfile keeps tool versions reproducible with `npm ci`.

## Controls

| Action                  | Keys           |
| ----------------------- | -------------- |
| Drive forward / reverse | W / S or ↑ / ↓ |
| Turn left / right       | A / D or ← / → |
| Fire                    | Space          |
| Pause / resume          | Escape or P    |

Touchscreens get a direction pad and a fire button when a human is playing. Controls follow the tank assigned Human, regardless of its roster position. Bot-only matches hide driving controls and let you spectate; pause, help, sound, and fullscreen remain available. Switching away from the game automatically pauses it.

## Match options

- 2–6 tanks, each assigned Human or a registered bot difficulty. At most one human; choose all bots to watch them battle.
- Choosing Human on another tank swaps its controller with the previous human. Removing the human slot leaves a bot-only match. Setup changes during a match apply to the next match.
- Easy: slow reactions, reduced speed, and less accurate shots.
- Medium: maze navigation, enemy tracking, and some bullet avoidance.
- Hard: faster reactions, predictive aim, incoming shell avoidance, and single-bounce bank shots. Bots use the same movement and shell physics as the player.
- Compact, classic, and expansive maps; open, balanced, and labyrinth layouts.
- A new connected maze each round, with a visible map seed.
- First to 3, 5, or 10 round wins, or endless play. Rounds end after 90 seconds. Ties go to the tank with the most kills that round; shared kill leads remain a draw.
- Optional shield, rapid-fire, and triple-shot pickups.
- Each tank starts each round with ten bullets, capped at ten in reserve. One bullet refills every 2 seconds, speeding up to every 1.5 seconds at 20 seconds, 1 second at 40 seconds, and 0.5 seconds at 60 seconds. The final 20 seconds (from 70 seconds) grant unlimited ammo. Each shell in a triple-shot volley costs one bullet; shells in flight do not limit firing or refund ammo when they disappear. Ricochets can hit the tank that fired them.
- Shells travel about 23% faster than the player tank, leaving room to dodge.
- Tracks, hulls, and barrels use their rendered, rotated shapes for collisions. Shells start beyond the muzzle; a blocked muzzle does not fire a shell back inside the tank.
- Turning against a wall gently makes room for the tank to pivot. Gaps that cannot fit the tank and contact with other tanks still block movement.
- Per-player round wins and match-long kill totals, visible for humans and bots. Kills carry over between rounds and reset for a new match; self-inflicted ricochets do not earn a kill.
- Sound effects, saved match preferences, round scoring, and match results.

Match play runs locally, and preferences use browser local storage. There are no accounts, servers, telemetry, or multiplayer connections in the game itself. Google Fonts is optional; local fallback fonts keep the game playable offline.

## Round recording and replay

Turn on **Record my rounds** in the **Round replays** panel before starting a round. The preference is saved locally and defaults to off. Changes take effect at the next round boundary; turning recording off during a round still lets that recording finish. Paused time is excluded. Both human and bot-only matches can be recorded.

Completed rounds appear in the panel. Select a round and click **Save replay** to download a `.ttr.json` file. The latest three completed recordings stay in memory across matches until the page closes or reloads. Unfinished rounds are discarded when you start another match or load a replay. Recording does not automatically download files.

Click **Upload replay** and choose a supported file to watch it in the arena. Use play/pause (or Escape/P), the timeline, and 0.5×/1×/2×/4× speed. Playback stops on the recorded result. **Back to setup** returns to the game. Uploading pauses an active match; cancelling the picker or choosing an invalid file leaves that match available to resume. Files are read locally, with a 32 MB limit and validation before playback.

The observability layer records completed gameplay snapshots at 30 Hz, plus timestamped simulation events from every 120 Hz physics tick. Playback applies the recorded state without starting workers, recalculating decisions, or advancing physics, so asynchronous bot timing is preserved. Cosmetic particles, screen shake, track marks, and audio are omitted. See [the replay format](docs/replays.md) for the versioned JSON contract.

## Source layout

- `src/types.ts`: game entities, match states, configuration, physics shapes, and discriminated event types.
- `src/engine.ts`: DOM-free simulation, seeded maze generation, pathfinding, immutable observations, queued player command application, swept projectile collisions, power-ups, and match state.
- `src/players/`: shared abstract player contract, runtime, human/worker connections, bounded messaging, per-bot scheduling, profiles, and roster controller swaps.
- `src/bots/`: Easy/Medium/Hard subclasses, shared combat strategy, and the registry used by the game and setup UI.
- `src/scoreboard.ts`: live round-win, total kill, and current-round kill displays for every tank.
- `src/renderer.ts`: cached maze rendering, tanks, shells, tracks, and particles.
- `src/queries.ts`, `src/rules.ts`, `src/random.ts`: DOM-free pathfinding, visibility, shot prediction, rules, and seeded randomness shared with workers.
- `src/geometry.ts`: shared tank silhouettes and exact rounded-wall collision geometry.
- `src/main.ts`: settings, keyboard and touch input, fixed 120 Hz simulation loop, and interface state.
- `src/audio.ts`: synthesized Web Audio effects.
- `src/replay.ts`: optional round recorder, versioned file validation, and snapshot playback.
- `src/style.css`: responsive arcade interface and reduced-motion support.
- `tests/engine.test.ts`: maze connectivity across 270 layouts, spawning, collision rules, scoring, power-ups, pausing, and all three bot levels.
- `tests/collision-regressions.test.ts`: wall-edge firing and turning, muzzle clearance, rotated hitboxes, tight corridors, rounded wall caps, and relative shell/tank travel speed.
- `tests/bots.test.ts`: custom controller registration, immutable observations, query helpers, movement controls, and per-opponent lifecycle.
- `tests/connections.test.ts`: readiness, command ordering, backpressure, stale replies, pause/resume, lifecycle cleanup, worker failures/timeouts, and independent randomness.
- `tests/players.test.ts`: human input in any slot, controller swapping, roster validation, preference migration, reaction timing, and bot-only round progression.
- `tests/replay.test.ts`: recording boundaries, JSON round trips, immutable capture, playback controls, and malformed file rejection.

To add a strategy, extend `AbstractPlayer` from `src/players/index.ts`, implement `decide(context)` using `context.observe()` for world information, and register it in `src/bots/index.ts`. It becomes selectable in match setup automatically. `Player`, `EasyBot`, `MediumBot`, and `HardBot` share this base class; each bot runs in its own dedicated Web Worker, recreated each round. See [Adding a bot](docs/bots.md) for a complete implementation example and the observation/control API.

Programmatic browser matches create a `Game` with the desired roster and a `PlayerRuntime(game, browserBotConnection)` (import the factory from `src/players/browser-connection.ts`). Call `game.start()`, advance with `runtime.step(dt)`, and send keyboard/touch changes through `runtime.setInput(input)`. Dispose the runtime when replacing the game. Use only bot slots for spectator matches. Old saved preferences migrate automatically.

The game runs physics at 120 Hz and publishes completed world snapshots at 30 Hz. Bot decisions run independently in dedicated workers; a slow calculation does not hold up the game or other bots. The game retains each player's last commands until a newer decision arrives. Each worker has one observation in flight and one replaceable pending snapshot. Human commands take effect on the next physics tick without waiting for an observation.

Worker errors or ten seconds without a reply (excluding paused time) stop that tank's controls and mark it OFFLINE. The match continues; the controller is recreated next round. Pausing clears controls and invalidates pending decisions. Browser matches never fall back to calculating bots on the main thread.

Seeded maps and deterministic physics remain supported. Live worker reply timing can vary, so a seed alone does not reproduce an entire live match. Headless tests explicitly inject `InProcessConnection` through the runtime factory; `Game.update(dt)` itself only advances physics.

The simulation uses a fixed timestep independently of the display refresh rate. Maze generation starts with a randomized spanning tree, then adds openings, so every tile stays reachable at every density. Bot movement uses breadth-first paths; hard bots additionally trace candidate bank shots.

## Headless bot matches

Run bots directly in Node.js, as fast as the CPU permits, with optional compatible round replays:

```sh
npm run simulate -- medium hard --rounds 1000 --seed benchmark --out .qa/results.json
npm run simulate -- medium hard --matches 10 --target 3
npm run simulate -- easy hard --rounds 1 --replays .qa/sample-replays
```

Starting slots alternate, and win/tie/loss statistics describe the first named bot. The runner uses
the existing 120 Hz engine and in-process synchronous bot adapter. A seed does not guarantee parity
with asynchronous browser matches; statistical agreement must be measured. An optional real-time
browser reference collector compares rate differences against a default tolerance of 5 percentage
points, with confidence intervals and an explicit inconclusive result for insufficient evidence.
See [headless simulations and browser comparison](docs/simulations.md) for options and validation.

## Browser verification

With the development server running and Chrome or Chromium installed:

```sh
npm run test:browser
```

Set `CHROME_PATH` if needed. This uses Chromium’s debugging protocol without a browser automation dependency. It verifies real worker isolation during a one-second CPU calculation, asynchronous module-based bots, offline notices, worker loading in the production bundle, roster limits, human controller swaps, bot-only spectator matches, settings taking effect next match, mixed difficulties, input, pause, help, touch controls, preference migration and persistence, console errors, and layouts from 390 to 1440 pixels wide. Screenshots and an isolated temporary browser profile go in the ignored `.qa/` directory.

To check the compiled production bundle, start `npm run preview` after building, then run `npm run test:browser -- --preview`. This mode exercises the rendered game without importing development-only source modules.
