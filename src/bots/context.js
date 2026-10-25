function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeTree(child);
  return value;
}

// Strategies receive detached observations; query helpers use the same snapshot,
// even if a controller keeps a reference across subsequent simulation updates.
export function createBotContext(state, queries) {
  const snapshot = structuredClone(state);
  return freezeTree({
    ...snapshot,
    random: queries.random,
    cellAt: (x, y) => queries.cellAt(snapshot.map, x, y),
    findPath: (start, goal) => queries.findPath(snapshot.map, start, goal),
    lineOfSight: (from, to) => queries.lineOfSight(from, to, snapshot.map),
    predictShot: (angle, maxBounces = 0) =>
      queries.predictShot(snapshot.self, angle, maxBounces, snapshot),
  });
}
