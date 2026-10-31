import type { Outcome, SimulationPlan, SimulationReport, SimulationResult } from './simulation.ts';
import { simulationMode, simulationSlotOrder, validateBrowserSpeed } from './simulation.ts';
import type { DecisionStatistics } from './players/runtime.ts';

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

function outcomeRates(outcomes: Outcome[]): Record<Outcome, Rate> {
  return Object.fromEntries(
    OUTCOMES.map((outcome) => {
      const count = outcomes.filter((value) => value === outcome).length;
      return [
        outcome,
        {
          count,
          rate: outcomes.length ? count / outcomes.length : 0,
          interval: proportionInterval(count, outcomes.length),
        },
      ];
    }),
  ) as Record<Outcome, Rate>;
}

function slotOrder(result: SimulationResult, plan: SimulationPlan): number[] {
  return result.slotOrder ?? simulationSlotOrder(plan, result.index);
}

function playerOutcome(result: SimulationResult, plan: SimulationPlan, botIndex: number): Outcome {
  // Retain the established headline semantics, including when reading legacy reports.
  if (botIndex === 0) return result.outcome as Outcome;
  return result.winnerId === null
    ? 'tie'
    : slotOrder(result, plan)[result.winnerId] === botIndex
      ? 'win'
      : 'loss';
}

export function summarizeResults(results: SimulationResult[], plan?: SimulationPlan) {
  const completed = results.filter((result) => result.outcome !== 'capped');
  const players = plan?.bots.map((botId, botIndex) => {
    let roundWins = 0;
    let kills = 0;
    const decisionStatistics: DecisionStatistics = {
      requests: 0,
      deadlineMisses: 0,
      busySkips: 0,
      invalidPlans: 0,
      lateReplies: 0,
    };
    for (const result of results) {
      const slot = slotOrder(result, plan).indexOf(botIndex);
      roundWins += result.scores[slot];
      kills += result.kills[slot];
      const statistics = result.decisionStatistics?.[slot];
      if (statistics)
        for (const key of Object.keys(decisionStatistics) as (keyof DecisionStatistics)[])
          decisionStatistics[key] += statistics[key];
    }
    return {
      botIndex,
      botId,
      rates: outcomeRates(completed.map((result) => playerOutcome(result, plan, botIndex))),
      roundWins,
      kills,
      decisionStatistics,
    };
  });
  return {
    completed: completed.length,
    capped: results.length - completed.length,
    rates: outcomeRates(completed.map((result) => result.outcome as Outcome)),
    players,
  };
}

/**
 * Matched-seed comparison. Bound each outcome's positive and negative discordance probabilities
 * separately, then subtract bounds. z=2.64 Bonferroni-adjusts six Wilson intervals to approximately
 * 95% simultaneous coverage for duels. For larger rosters z=3.2 covers up to 36 intervals (six per
 * competitor). Small or identical samples must still carry uncertainty.
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
    simulationMode(candidate.plan) !== simulationMode(browser.plan) ||
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
    const expectedOrder = JSON.stringify(simulationSlotOrder(candidate.plan, i));
    if (
      JSON.stringify(slotOrder(a, candidate.plan)) !== expectedOrder ||
      JSON.stringify(slotOrder(b, browser.plan)) !== expectedOrder
    )
      throw new Error('Comparison samples must use the planned roster rotation.');
    if (a.outcome === 'capped' || b.outcome === 'capped')
      throw new Error(
        'Capped matches cannot establish outcome equivalence. Increase --max-rounds.',
      );
    if (candidate.plan.bots.length > 2) {
      for (const result of [a, b]) {
        const roster = slotOrder(result, candidate.plan);
        if (
          result.scores.length !== roster.length ||
          result.kills.length !== roster.length ||
          (result.winnerId !== null &&
            (!Number.isInteger(result.winnerId) ||
              result.winnerId < 0 ||
              result.winnerId >= roster.length))
        )
          throw new Error('Comparison samples must contain valid per-player results.');
        const expectedOutcome =
          result.winnerId === null ? 'tie' : roster[result.winnerId] === 0 ? 'win' : 'loss';
        if (result.outcome !== expectedOutcome)
          throw new Error('Comparison outcomes must agree with the roster winner.');
      }
    }
  }
  if (
    candidate.results.some((row) => !OUTCOMES.includes(row.outcome as Outcome)) ||
    browser.results.some((row) => !OUTCOMES.includes(row.outcome as Outcome))
  )
    throw new Error('Comparison samples must have a valid win, tie, or loss outcome.');
  const comparePlayer = (botIndex: number) =>
    OUTCOMES.map((outcome) => {
      let positive = 0;
      let negative = 0;
      for (let i = 0; i < count; i++) {
        const a = playerOutcome(candidate.results[i], candidate.plan, botIndex) === outcome;
        const b = playerOutcome(browser.results[i], browser.plan, botIndex) === outcome;
        if (a && !b) positive++;
        if (!a && b) negative++;
      }
      const z = candidate.plan.bots.length > 2 ? 3.2 : 2.64;
      const plus = proportionInterval(positive, count, z);
      const minus = proportionInterval(negative, count, z);
      const interval: [number, number] = [plus[0] - minus[1], plus[1] - minus[0]];
      const status =
        interval[0] >= -tolerance && interval[1] <= tolerance
          ? 'equivalent'
          : interval[0] > tolerance || interval[1] < -tolerance
            ? 'different'
            : 'inconclusive';
      return { outcome, difference: (positive - negative) / count, interval, status };
    });
  const outcomes = comparePlayer(0);
  const players =
    candidate.plan.bots.length > 2
      ? candidate.plan.bots.map((botId, botIndex) => ({
          botIndex,
          botId,
          outcomes: botIndex === 0 ? outcomes : comparePlayer(botIndex),
        }))
      : undefined;
  const allOutcomes = players ? players.flatMap((player) => player.outcomes) : outcomes;
  return {
    candidate: {
      execution: candidate.execution,
      browserSpeed:
        candidate.execution === 'browser-workers' ? (candidate.browserSpeed ?? 1) : null,
    },
    reference: { execution: browser.execution, browserSpeed: referenceSpeed },
    tolerance,
    samples: count,
    status: allOutcomes.some((outcome) => outcome.status === 'different')
      ? 'different'
      : allOutcomes.every((outcome) => outcome.status === 'equivalent')
        ? 'equivalent'
        : 'inconclusive',
    outcomes,
    players,
  };
}
