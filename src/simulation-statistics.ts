import type { Outcome, SimulationReport, SimulationResult } from './simulation.ts';
import { validateBrowserSpeed } from './simulation.ts';

export interface Rate {
  count: number;
  rate: number;
  interval: [number, number];
}
const OUTCOMES: Outcome[] = ['win', 'tie', 'loss'];

/** Wilson score interval, including nonzero uncertainty for zero observed events. */
export function proportionInterval(count: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = count / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function summarizeResults(results: SimulationResult[]) {
  const completed = results.filter((result) => result.outcome !== 'capped');
  const rates = Object.fromEntries(
    OUTCOMES.map((outcome) => {
      const count = completed.filter((result) => result.outcome === outcome).length;
      return [
        outcome,
        {
          count,
          rate: completed.length ? count / completed.length : 0,
          interval: proportionInterval(count, completed.length),
        },
      ];
    }),
  ) as Record<Outcome, Rate>;
  return { completed: completed.length, capped: results.length - completed.length, rates };
}

/**
 * Matched-seed comparison. Bound each outcome's positive and negative discordance probabilities
 * separately, then subtract bounds. z=2.64 Bonferroni-adjusts six Wilson intervals to approximately
 * 95% simultaneous coverage; small or identical samples must still carry uncertainty.
 */
export function compareReports(
  candidate: SimulationReport,
  browser: SimulationReport,
  tolerance = 0.05,
) {
  if (!(tolerance > 0 && tolerance < 1)) throw new Error('Tolerance must be between 0 and 1.');
  if (
    !['in-process', 'node-workers', 'browser-workers'].includes(candidate.execution) ||
    browser.execution !== 'browser-workers'
  )
    throw new Error('Compare a simulation report against a browser-workers reference.');
  const referenceSpeed = browser.browserSpeed ?? 1;
  validateBrowserSpeed(referenceSpeed);
  if (referenceSpeed !== 1)
    throw new Error(
      'Use a 1x browser reference. Accelerated reports cannot represent normal browser play.',
    );
  if (candidate.execution === 'browser-workers') validateBrowserSpeed(candidate.browserSpeed ?? 1);
  if (candidate.sourceHash !== browser.sourceHash)
    throw new Error('Comparison reports must come from the same source revision.');
  if (JSON.stringify(candidate.scheduling) !== JSON.stringify(browser.scheduling))
    throw new Error('Comparison reports must use the same scheduling settings.');
  const fields = [
    'bots',
    'count',
    'seed',
    'size',
    'density',
    'powerups',
    'target',
    'maxRounds',
    'swapSides',
  ] as const;
  if (
    fields.some(
      (field) => JSON.stringify(candidate.plan[field]) !== JSON.stringify(browser.plan[field]),
    )
  )
    throw new Error('Comparison reports must use the same bots, seeds, sides, and settings.');
  const count = candidate.plan.count;
  if (candidate.results.length !== count || browser.results.length !== count)
    throw new Error('Comparison reports must contain every planned sample.');
  for (let i = 0; i < count; i++) {
    const a = candidate.results[i];
    const b = browser.results[i];
    if (a.index !== i || b.index !== i || a.seed !== b.seed || a.swapped !== b.swapped)
      throw new Error('Comparison samples must be paired in seed and slot order.');
    if (a.outcome === 'capped' || b.outcome === 'capped')
      throw new Error(
        'Capped matches cannot establish outcome equivalence. Increase --max-rounds.',
      );
  }
  if (
    candidate.results.some((row) => !OUTCOMES.includes(row.outcome as Outcome)) ||
    browser.results.some((row) => !OUTCOMES.includes(row.outcome as Outcome))
  )
    throw new Error('Comparison samples must have a valid win, tie, or loss outcome.');
  const outcomes = OUTCOMES.map((outcome) => {
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < count; i++) {
      const a = candidate.results[i].outcome === outcome;
      const b = browser.results[i].outcome === outcome;
      if (a && !b) positive++;
      if (!a && b) negative++;
    }
    const plus = proportionInterval(positive, count, 2.64);
    const minus = proportionInterval(negative, count, 2.64);
    const interval: [number, number] = [plus[0] - minus[1], plus[1] - minus[0]];
    const status =
      interval[0] >= -tolerance && interval[1] <= tolerance
        ? 'equivalent'
        : interval[0] > tolerance || interval[1] < -tolerance
          ? 'different'
          : 'inconclusive';
    return { outcome, difference: (positive - negative) / count, interval, status };
  });
  return {
    candidate: {
      execution: candidate.execution,
      browserSpeed:
        candidate.execution === 'browser-workers' ? (candidate.browserSpeed ?? 1) : null,
    },
    reference: { execution: browser.execution, browserSpeed: referenceSpeed },
    tolerance,
    samples: count,
    status: outcomes.some((outcome) => outcome.status === 'different')
      ? 'different'
      : outcomes.every((outcome) => outcome.status === 'equivalent')
        ? 'equivalent'
        : 'inconclusive',
    outcomes,
  };
}
