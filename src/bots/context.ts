import type { DeepReadonly, Point } from '../types.ts';
import type { BotContext, BotObservation, BotQueries } from './types.ts';

/** Freeze the cloned observation graph in place before sharing it with controllers. */
export function freezeTree<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value as DeepReadonly<T>;
}

/**
 * Clone/freeze observations and bind queries to that same snapshot. Retained contexts continue
 * querying their original map and tank poses after the live game advances; random stays a stream.
 */
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
