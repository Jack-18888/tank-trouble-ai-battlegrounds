import { Game } from '../../src/engine.ts';
import { ReplayRecorder } from '../../src/replay.ts';
import type { RoundReplay } from '../../src/replay.ts';
import { HUMAN_PROFILE } from '../../src/players/player.ts';

/** A real recorded round with countdown, movement, a shot, and a final score. No workers needed. */
export function recordedRound(): RoundReplay {
  const game = new Game(
    {
      players: [{ kind: 'human' }, { kind: 'bot', botId: 'medium' }],
      powerups: false,
    },
    'REPLAY-QA',
  );
  const recorder = new ReplayRecorder();
  recorder.enabled = true;
  game.start();
  game.playerReady(0, HUMAN_PROFILE);
  recorder.observe(game, 0, game.drainEvents());
  while (game.state === 'countdown') {
    game.update(1 / 120);
    recorder.observe(game, 1 / 120, game.drainEvents());
  }
  game.tanks[0].throttle = 1;
  for (let i = 0; i < 180; i++) {
    if (i === 90) game.fire(game.tanks[0]);
    game.update(1 / 120);
    recorder.observe(game, 1 / 120, game.drainEvents());
  }
  game.finishRound(game.tanks[0]);
  const replay = recorder.observe(game, 0, game.drainEvents());
  if (!replay) throw new Error('Replay fixture did not complete.');
  return replay;
}
