import '../fixtures/plan-bot.ts';
import { Game } from '../../src/engine.ts';
import { PlayerRuntime } from '../../src/players/runtime.ts';
import { BotSimulation } from '../../src/simulation.ts';
import type { BotConnectionFactory } from '../../src/players/connection.ts';

/** Controlled admission isolates simulation determinism from the separate wall-clock deadline rule. */
export async function collectTickTrace(factory: BotConnectionFactory, batch = 1) {
  const game = new Game(
    {
      players: Array.from({ length: 3 }, () => ({ kind: 'bot', botId: 'qa-plan' })),
      powerups: true,
    },
    'tick-parity',
  );
  const runtime = new PlayerRuntime(game, factory, () => 0);
  game.start();
  game.state = 'playing';
  const trace = [];
  try {
    for (let index = 0; index < 144; index++) {
      while (!runtime.step()) await runtime.whenUnblocked();
      for (const state of game.players.values())
        if (state.status === 'failed') throw new Error(state.failure);
      const frame = game.snapshot();
      // Track animation distances are cosmetic; Math.hypot may differ by an ULP across V8 versions.
      frame.tanks = frame.tanks.map((tank) => ({ ...tank, tread: 0, leftTread: 0, rightTread: 0 }));
      trace.push({
        frame,
        events: game.drainEvents().filter((e) => e.type !== 'playerStatus'),
      });
      if ((index + 1) % batch === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { trace, statistics: [...runtime.statistics.values()] };
  } finally {
    runtime.dispose();
  }
}

/** Exercise the simulation driver and rotated result mapping with a full six-worker roster. */
export async function collectSimulationTrace(
  factory: BotConnectionFactory,
  batch = 1,
  botCount = 6,
) {
  const simulation = new BotSimulation(
    {
      bots: Array<string>(botCount).fill('qa-plan'),
      count: botCount,
      seed: 'tick-parity',
      size: 'classic',
      density: 'balanced',
      target: 0,
      maxRounds: 1,
      swapSides: true,
      powerups: true,
    },
    botCount - 1,
    false,
    factory,
    () => 0,
  );
  const { game, runtime } = simulation;
  game.state = 'playing';
  const trace = [];
  try {
    for (let index = 0; index < 144; index++) {
      await simulation.step();
      const frame = game.snapshot();
      // Track animation distances are cosmetic; Math.hypot may differ by an ULP across V8 versions.
      frame.tanks = frame.tanks.map((tank) => ({ ...tank, tread: 0, leftTread: 0, rightTread: 0 }));
      trace.push(frame);
      if ((index + 1) % batch === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    game.finishRound(game.tanks[botCount - 1]);
    const result = await simulation.step();
    return { trace, result, statistics: [...runtime.statistics.values()] };
  } finally {
    simulation.dispose();
  }
}
