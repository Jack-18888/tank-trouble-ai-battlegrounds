# Tank Trouble — Ricochet Arena

A browser arcade game inspired by Tank Trouble. Drive a tank through a procedurally generated maze, bounce shots around corners, and be the last tank standing. Built with vanilla JavaScript and Canvas 2D, with no runtime dependencies.

## Play locally

Use Node.js 22 or newer:

```sh
npm run dev
```

Open http://localhost:5173. No installation step is required. The game needs a web server because it uses JavaScript modules.

```sh
npm test       # deterministic simulation tests
npm run build # creates the standalone static site in dist/
```

Serve `dist/` with any static host. `node scripts/serve.mjs --dist` previews the built site. Set `PORT` to use a different local port.

## Controls

| Action | Keys |
| --- | --- |
| Drive forward / reverse | W / S or ↑ / ↓ |
| Turn left / right | A / D or ← / → |
| Fire | Space |
| Pause / resume | Escape or P |

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
- Sound effects, saved match preferences, round scoring, and match results.

Match play runs locally, and preferences use browser local storage. There are no accounts, servers, telemetry, or multiplayer connections in the game itself. Google Fonts is optional; local fallback fonts keep the game playable offline.

## Source layout

- `src/engine.js`: DOM-free simulation, seeded maze generation, pathfinding, bot decisions, swept projectile collisions, power-ups, and match state.
- `src/renderer.js`: cached maze rendering, tanks, shells, tracks, and particles.
- `src/main.js`: settings, keyboard and touch input, fixed 120 Hz simulation loop, and interface state.
- `src/audio.js`: synthesized Web Audio effects.
- `src/style.css`: responsive arcade interface and reduced-motion support.
- `tests/engine.test.js`: maze connectivity across 270 layouts, spawning, collision rules, scoring, power-ups, pausing, and all three bot levels.

The simulation uses a fixed timestep independently of the display refresh rate. Maze generation starts with a randomized spanning tree, then adds openings, so every tile stays reachable at every density. Bot movement uses breadth-first paths; hard bots additionally trace candidate bank shots.

## Browser verification

With the development server running and Chrome or Chromium installed:

```sh
node scripts/browser-check.mjs
```

Set `CHROME_PATH` if needed. This uses Chromium’s debugging protocol without a browser automation dependency. It checks settings, mixed difficulties, input, pause, help, touch controls, persistence, console errors, and layouts from 390 to 1440 pixels wide. Screenshots and an isolated temporary browser profile go in the ignored `.qa/` directory.
