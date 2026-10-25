import type { DeepReadonly, Point } from '../types.ts';
import type { BotContext, BotObservation, BotQueries } from './types.ts';

function freezeTree<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value as DeepReadonly<T>;
}

// Strategies receive detached observations; query helpers use the same snapshot,
// even if a controller keeps a reference across subsequent simulation updates.
export function createBotContext(state: BotObservation, queries: BotQueries): BotContext {
  const snapshot = structuredClone(state);
  return Object.freeze({
    ...freezeTree(snapshot),
    random: queries.random,
    cellAt: (x: number, y: number) => queries.cellAt(snapshot.map, x, y),
    findPath: (start: number, goal: number) => queries.findPath(snapshot.map, start, goal),
    lineOfSight: (from: Readonly<Point>, to: Readonly<Point>) =>
      queries.lineOfSight(from, to, snapshot.map),
    predictShot: (angle: number, maxBounces = 0) =>
      queries.predictShot(snapshot.self, angle, maxBounces, snapshot),
  });
}
