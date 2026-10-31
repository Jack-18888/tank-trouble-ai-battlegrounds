# Round replay format

Supported files are UTF-8 JSON, conventionally named `*.ttr.json`, up to 32 MiB. The format identifier is `tank-trouble-round` and the current version is `1`. Extensions alone do not identify a replay; uploads validate the contents. Unsupported versions, malformed or incomplete rounds, non-finite numbers, invalid entity references, and excessive data are rejected before the active game is replaced.

`RoundReplay` and `ReplayFrame` in [`src/replay.ts`](../src/replay.ts) define the complete TypeScript contract. All time values are seconds. Positions and map dimensions use world pixels. Tank and projectile ownership IDs are zero-based roster indices.

| Field               | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `format`, `version` | `"tank-trouble-round"`, `1`                                                            |
| `recordedAt`        | ISO timestamp when recording began                                                     |
| `snapshotHz`        | `30`                                                                                   |
| `config`            | Active round configuration, including the complete player roster                       |
| `map`               | Complete map with seed, dimensions, cells, and walls; playback does not regenerate it  |
| `round`             | One-based round number within its original match                                       |
| `duration`          | Recording duration, including countdown and excluding paused time                      |
| `winner`            | Winning tank ID, or `null` for a draw                                                  |
| `frames`            | Initial countdown, periodic gameplay snapshots, state transitions, and final result    |
| `events`            | Every observed game event, with recording-relative `time` and completed physics `tick` |

Each frame contains `time`, `tick`, `elapsed` (playing time), `timer` (countdown or result timer), `state`, `tanks`, `bullets` (including trails), `powerups`, `scores` (match round wins), `kills` (match kill totals), and per-player connection `statuses`. Tanks retain their round kill totals, ammunition, powers, pose, movement, and applied control values. Cosmetic particles, screen shake, and track marks are excluded; replay audio is silent.

Frame times increase strictly from zero to `duration`. Event times are nondecreasing and bounded by the recording duration; several events may share a physics tick. The first frame is a countdown and the final frame is `roundOver` or `matchOver`. A file holds exactly one completed round. Matches preserve prior scores in their round snapshots. Version 1 allows up to six players, 3,000 frames, 100,000 events, and 96 seconds of unpaused recording time.

`ReplayRecorder.observe(game, dt, events)` observes completed simulation steps and returns a replay once, when a recorded round ends. Pass drained events to both the observer and UI consumers. Observing never drains events or changes the game. Set `enabled` before a round begins and call `discard()` when abandoning a match. With recording disabled, no round snapshots or event history are retained.

When using `PlayerRuntime`, pass `1 / 120` only after `runtime.step(1 / 120)` returns `true`.
If a decision or startup barrier prevents advancement, skip recording or pass zero to capture
status events without adding simulated time. Paused and decision-wait wall time never extends
recording duration. `tick` counts completed playing steps in the round; countdown steps advance
recording time while the playing tick remains zero.

Finite Decision plans and report v2 do not change replay v1. Replays store completed snapshots
and events, not an executable plan queue, and playback does not recalculate deadline admissions.

`serializeReplay(replay)` produces downloadable JSON. `parseReplay(source)` validates JSON before returning a `RoundReplay`. `ReplayPlayer` applies the last snapshot at or before its playback time, supports seeking and playback speed, and pauses at the final result. It creates no player runtime or workers. Snapshot playback preserves recorded bot timing and does not depend on reconstructing simulation randomness from the map seed.
