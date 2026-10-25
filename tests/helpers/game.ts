import { Game } from '../../src/engine.ts';
import { PlayerRuntime } from '../../src/players/runtime.ts';
import { InProcessConnection } from '../../src/players/in-process-connection.ts';
import type { AbstractPlayer } from '../../src/players/abstract-player.ts';
import type { GameConfig, PlayerInput, Seed } from '../../src/types.ts';

/** Preserve compact physics fixtures while explicitly selecting deterministic local controllers. */
export function createTestGame(config: Partial<GameConfig> = {}, seed?: Seed) {
  const game = new Game(config, seed);
  const controllers = new Map<number, AbstractPlayer>();
  const runtime = new PlayerRuntime(game, (init, events) => {
    const connection = new InProcessConnection(init, events);
    controllers.set(init.playerId, connection.brain.player);
    return connection;
  });
  return Object.assign(game, {
    runtime,
    controllers,
    update(dt: number, input: PlayerInput = {}) {
      runtime.setInput(input);
      runtime.step(dt);
    },
  });
}
