# Tank Trouble — Ricochet Arena

A browser arcade game inspired by Tank Trouble. Drive a tank through a procedurally generated maze, bounce shots around corners, and be the last tank standing. Built with vanilla JavaScript and Canvas 2D, with no runtime dependencies.

## Play locally

Use Node.js 22.13 or newer on the 22.x line, or Node.js 24 or newer:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. The game needs a web server because it uses JavaScript modules. Installed packages are development tools; the game itself has no runtime dependencies.

```sh
npm test       # deterministic simulation tests
npm run build # creates the standalone static site in dist/
```

Serve `dist/` with any static host. `node scripts/serve.mjs --dist` previews the built site. Set `PORT` to use a different local port.

## Code quality

ESLint checks JavaScript for errors and unused code, with separate browser and Node.js environments. The simulation and geometry modules do not receive browser globals. Prettier handles JavaScript, HTML, CSS, JSON, and Markdown formatting: two spaces, single quotes in JavaScript, a 100-character preferred line width, and LF line endings.

| Command                | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `npm run lint`         | Check JavaScript; warnings fail the check         |
| `npm run lint:fix`     | Apply available ESLint fixes                      |
| `npm run format`       | Format the project                                |
| `npm run format:check` | Check formatting without changing files           |
| `npm run check`        | Run lint, formatting checks, and simulation tests |

Run `npm run check` before committing changes. Build output, dependencies, browser-test artifacts, and local hosting runtime files are excluded from these tools. `.editorconfig` supplies matching whitespace defaults to compatible editors. The committed lockfile keeps tool versions reproducible with `npm ci`.

## Controls

| Action                  | Keys           |
| ----------------------- | -------------- |
| Drive forward / reverse | W / S or ↑ / ↓ |
| Turn left / right       | A / D or ← / → |
| Fire                    | Space          |
| Pause / resume          | Escape or P    |

Touchscreens get a direction pad and a fire button. The arena also supports fullscreen. Switching away from the game automatically pauses it.

## Match options

- One human against 1–5 bots, with individual difficulty settings.
- Easy: slow reactions, reduced speed, and less accurate shots.
- Medium: maze navigation, enemy tracking, and some bullet avoidance.
- Hard: faster reactions, predictive aim, incoming shell avoidance, and single-bounce bank shots. Bots use the same movement and shell physics as the player.
- Compact, classic, and expansive maps; open, balanced, and labyrinth layouts.
- A new connected maze each round, with a visible map seed.
- First to 3, 5, or 10 round wins, or endless play. A 90-second round limit resolves stalemates as a draw.
- Optional shield, rapid-fire, and triple-shot pickups.
- Five active shells per tank; ricochets can hit the tank that fired them.
- Shells travel about 23% faster than the player tank, leaving room to dodge.
- Tracks, hulls, and barrels use their rendered, rotated shapes for collisions. Shells start beyond the muzzle; a blocked muzzle does not fire a shell back inside the tank.
- Sound effects, saved match preferences, round scoring, and match results.

Match play runs locally, and preferences use browser local storage. There are no accounts, servers, telemetry, or multiplayer connections in the game itself. Google Fonts is optional; local fallback fonts keep the game playable offline.

## Source layout

- `src/engine.js`: DOM-free simulation, seeded maze generation, pathfinding, bot decisions, swept projectile collisions, power-ups, and match state.
- `src/renderer.js`: cached maze rendering, tanks, shells, tracks, and particles.
- `src/geometry.js`: shared tank silhouettes and exact rounded-wall collision geometry.
- `src/main.js`: settings, keyboard and touch input, fixed 120 Hz simulation loop, and interface state.
- `src/audio.js`: synthesized Web Audio effects.
- `src/style.css`: responsive arcade interface and reduced-motion support.
- `tests/engine.test.js`: maze connectivity across 270 layouts, spawning, collision rules, scoring, power-ups, pausing, and all three bot levels.
- `tests/collision-regressions.test.js`: wall-edge firing, muzzle clearance, rotated hitboxes, rounded wall caps, and relative shell/tank travel speed.

The simulation uses a fixed timestep independently of the display refresh rate. Maze generation starts with a randomized spanning tree, then adds openings, so every tile stays reachable at every density. Bot movement uses breadth-first paths; hard bots additionally trace candidate bank shots.

## Browser verification

With the development server running and Chrome or Chromium installed:

```sh
node scripts/browser-check.mjs
```

Set `CHROME_PATH` if needed. This uses Chromium’s debugging protocol without a browser automation dependency. It checks settings, mixed difficulties, input, pause, help, touch controls, persistence, console errors, and layouts from 390 to 1440 pixels wide. Screenshots and an isolated temporary browser profile go in the ignored `.qa/` directory.
