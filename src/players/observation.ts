import { createBotContext } from '../bots/context.ts';
import { cellAt, findPath, lineOfSight, predictShot } from '../queries.ts';
import type { BotContext } from '../bots/types.ts';
import type { RoundInit, WorldFrame } from './connection.ts';

/** Combine static round data and a dynamic frame into detached observations and local queries. */
export function observeWorld(init: RoundInit, frame: WorldFrame, random: () => number): BotContext {
  const self = frame.tanks.find((tank) => tank.id === init.playerId);
  if (!self) throw new Error('Missing observed player.');
  return createBotContext(
    {
      self,
      tanks: frame.tanks,
      enemies: frame.tanks.filter((tank) => tank.alive && tank.id !== self.id),
      bullets: frame.bullets,
      powerups: frame.powerups,
      match: frame.match,
      map: init.map,
      rules: init.rules,
    },
    { random, cellAt, findPath, lineOfSight, predictShot },
  );
}
