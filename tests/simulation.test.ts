import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BotSimulation,
  runSimulation as driveSimulation,
  validateSimulationPlan,
} from '../src/simulation.ts';
import type { SimulationPlan, SimulationReport, SimulationResult } from '../src/simulation.ts';
import {
  compareReports,
  proportionInterval,
  summarizeResults,
} from '../src/simulation-statistics.ts';
import { parseSimulationOptions } from '../scripts/simulation-options.ts';
import { AbstractPlayer } from '../src/players/abstract-player.ts';
import type { PlayerDecision } from '../src/players/types.ts';
import { registerBot } from '../src/bots/index.ts';
import { parseReplay, ReplayPlayer, serializeReplay } from '../src/replay.ts';
import type { RoundReplay } from '../src/replay.ts';

import { InProcessConnection } from '../src/players/in-process-connection.ts';
const local = (
  init: Parameters<import('../src/players/connection.ts').BotConnectionFactory>[0],
  events: Parameters<import('../src/players/connection.ts').BotConnectionFactory>[1],
) => new InProcessConnection(init, events);
const runSimulation = (
  plan: SimulationPlan,
  index: number,
  onReplay?: (replay: RoundReplay) => void,
) => driveSimulation(plan, index, onReplay, local, () => 0);

const plan: SimulationPlan = {
  bots: ['medium', 'hard'],
  count: 2,
  seed: 'SIMULATION-QA',
  size: 'classic',
  density: 'balanced',
  powerups: true,
  target: 0,
  maxRounds: 20,
  swapSides: true,
};

class Idle extends AbstractPlayer {
  override decide(): PlayerDecision {
    return {};
  }
}
class AsyncBot extends AbstractPlayer {
  override async decide(): Promise<PlayerDecision> {
    return {};
  }
}
class BrokenBot extends AbstractPlayer {
  override decide(): PlayerDecision {
    throw new Error('Expected simulation failure');
  }
}
registerBot('simulation-idle', Idle);
registerBot('simulation-async', AsyncBot);
registerBot('simulation-broken', BrokenBot);

test('seeded in-process rounds are reproducible and recording preserves gameplay', async () => {
  const replays: RoundReplay[] = [];
  const plain = await runSimulation(plan, 0);
  const recorded = await runSimulation(plan, 0, (replay) => replays.push(replay));
  assert.deepEqual(recorded, plain);
  assert.equal(recorded.rounds, 1);
  assert.equal(recorded.seed, 'SIMULATION-QA:0');
  assert.equal(replays.length, 1);
  const replay = parseReplay(serializeReplay(replays[0]));
  const player = new ReplayPlayer(replay);
  player.seek(replay.duration);
  assert.equal(player.game.winner?.id ?? null, recorded.winnerId);
  assert.deepEqual(player.game.scores, recorded.scores);
  assert.deepEqual(player.game.kills, recorded.kills);
  assert.deepEqual(player.game.tanks, replay.frames.at(-1)?.tanks);
});

test('alternating slots retains outcomes from the first named bot perspective', async () => {
  for (const index of [0, 1]) {
    const simulation = new BotSimulation(plan, index, false, local, () => 0);
    try {
      assert.equal(simulation.swapped, index === 1);
      const slot = index === 1 ? 1 : 0;
      assert.deepEqual(simulation.game.config.players[slot], { kind: 'bot', botId: 'medium' });
      simulation.game.finishRound(simulation.game.tanks[slot]);
      assert.equal((await simulation.step())?.outcome, 'win');
      assert.equal(simulation.result?.winnerId, slot);
    } finally {
      simulation.dispose();
    }
  }
});

test('two to six bot entries rotate through every starting slot, including repeated IDs', async () => {
  for (const count of [2, 3, 4, 5, 6]) {
    const bots = Array.from({ length: count }, (_, i) => ['easy', 'medium', 'hard'][i % 3]);
    for (let index = 0; index < count; index++) {
      const rosterPlan = { ...plan, bots, count };
      const simulation = new BotSimulation(rosterPlan, index, false, local, () => 0);
      try {
        assert.equal(simulation.game.tanks.length, count);
        assert.equal(simulation.slotOrder.indexOf(0), index);
        assert.deepEqual(
          simulation.game.config.players,
          simulation.slotOrder.map((botIndex) => ({ kind: 'bot', botId: bots[botIndex] })),
        );
        simulation.game.finishRound(simulation.game.tanks[index]);
        const result = await simulation.step();
        assert.equal(result?.outcome, 'win');
        assert.equal(result?.winnerId, index);
        assert.deepEqual(result?.slotOrder, simulation.slotOrder);
        assert.equal(result?.scores.length, count);
        assert.equal(result?.kills.length, count);
      } finally {
        simulation.dispose();
      }
    }
    const fixed = new BotSimulation(
      { ...plan, bots, count, swapSides: false },
      count - 1,
      false,
      local,
    );
    assert.deepEqual(
      fixed.slotOrder,
      bots.map((_, index) => index),
    );
    fixed.dispose();
  }
});

test('free-for-all outcomes distinguish another winner from a shared draw', async () => {
  for (const winnerId of [0, null]) {
    const simulation = new BotSimulation(
      { ...plan, bots: ['easy', 'medium', 'hard'] },
      1,
      false,
      local,
      () => 0,
    );
    try {
      simulation.game.finishRound(winnerId === null ? null : simulation.game.tanks[winnerId]);
      assert.equal((await simulation.step())?.outcome, winnerId === null ? 'tie' : 'loss');
    } finally {
      simulation.dispose();
    }
  }
});

test('headless configurations preserve every bot-only browser gameplay setting', () => {
  for (const size of ['compact', 'classic', 'large'] as const)
    for (const density of ['open', 'balanced', 'dense'] as const)
      for (const target of [0, 3, 5, 10] as const)
        for (const powerups of [false, true]) {
          const bots = ['easy', 'medium', 'hard', 'easy', 'medium', 'hard'];
          const simulation = new BotSimulation(
            { ...plan, bots, mode: 'matches', size, density, target, powerups },
            0,
            false,
            local,
          );
          assert.deepEqual(simulation.game.config, {
            players: bots.map((botId) => ({ kind: 'bot', botId })),
            size,
            density,
            target,
            powerups,
          });
          simulation.dispose();
        }
});

test('whole matches finish at their win target and export every completed round', async () => {
  const rounds: RoundReplay[] = [];
  const result = await runSimulation({ ...plan, target: 3 }, 0, (replay) => rounds.push(replay));
  assert.ok(result.outcome === 'win' || result.outcome === 'loss');
  assert.equal(Math.max(...result.scores), 3);
  assert.equal(rounds.length, result.rounds);
  for (const [index, replay] of rounds.entries()) {
    const loaded = parseReplay(serializeReplay(replay));
    assert.equal(loaded.round, index + 1);
    assert.equal(loaded.frames[0].state, 'countdown');
  }
  assert.equal(rounds.at(-1)?.frames.at(-1)?.state, 'matchOver');
});

test('round ties and capped matches remain distinct in batch statistics', async () => {
  const idle: SimulationPlan = {
    ...plan,
    bots: ['simulation-idle', 'simulation-idle'],
    powerups: false,
  };
  const tie = await runSimulation(idle, 0);
  assert.equal(tie.outcome, 'tie');
  const capped = await runSimulation({ ...idle, target: 3, maxRounds: 2 }, 0);
  assert.equal(capped.outcome, 'capped');
  assert.equal(capped.rounds, 2);
  const summary = summarizeResults([tie, capped]);
  assert.equal(summary.completed, 1);
  assert.equal(summary.capped, 1);
  assert.equal(summary.rates.tie.rate, 1);
  assert.equal(summary.rates.win.rate, 0);
});

test('six-player endless matches advance rounds to the cap and export browser-compatible replays', async () => {
  const replays: RoundReplay[] = [];
  const endless: SimulationPlan = {
    ...plan,
    bots: Array<string>(6).fill('simulation-async'),
    mode: 'matches',
    target: 0,
    maxRounds: 2,
    powerups: false,
  };
  const result = await runSimulation(endless, 1, (replay) => replays.push(replay));
  assert.equal(result.outcome, 'capped');
  assert.equal(result.winnerId, null);
  assert.equal(result.rounds, 2);
  assert.equal(replays.length, 2);
  assert.deepEqual(result.slotOrder, [5, 0, 1, 2, 3, 4]);
  for (const [index, replay] of replays.entries()) {
    const loaded = parseReplay(serializeReplay(replay));
    assert.equal(loaded.round, index + 1);
    assert.equal(loaded.config.players.length, 6);
    assert.equal(loaded.config.target, 0);
    assert.equal(loaded.frames.at(-1)?.state, 'roundOver');
  }
  assert.equal(result.decisionStatistics?.length, 6);
  assert.ok(result.decisionStatistics?.every((stats) => stats.requests > 0));
});

test('a six-player match ends at its target and reports the rotated winner', async () => {
  const simulation = new BotSimulation(
    { ...plan, bots: Array<string>(6).fill('medium'), count: 6, mode: 'matches', target: 3 },
    5,
    false,
    local,
    () => 0,
  );
  try {
    await simulation.step();
    simulation.game.scores[5] = 2;
    simulation.game.state = 'playing';
    simulation.game.settleTimer = 0;
    for (const tank of simulation.game.tanks) tank.alive = tank.id === 5;
    const result = await simulation.step();
    assert.equal(result?.outcome, 'win');
    assert.equal(result?.winnerId, 5);
    assert.equal(result?.scores[5], 3);
  } finally {
    simulation.dispose();
  }
});

test('async strategies are supported and failures abort a benchmark', async () => {
  const result = await runSimulation(
    { ...plan, bots: ['simulation-async', 'simulation-idle'], powerups: false },
    0,
  );
  assert.equal(result.outcome, 'tie');
  await assert.rejects(
    runSimulation({ ...plan, bots: ['simulation-broken', 'medium'] }, 0),
    /Expected simulation failure/,
  );
  await assert.rejects(
    runSimulation({ ...plan, bots: ['missing-bot', 'medium'] }, 0),
    /registered/,
  );
});

test('CLI rejects ambiguous modes, unknown settings, and invalid counts', () => {
  const parsed = parseSimulationOptions(['medium', 'hard', '--rounds', '100', '--seed', 'batch']);
  assert.equal(parsed.help, false);
  if (parsed.help) throw new Error('Unexpected help');
  assert.equal(parsed.plan.count, 100);
  assert.equal(parsed.plan.swapSides, true);
  assert.equal(parsed.tolerance, 0.05);
  for (const flags of [
    ['--rounds', '0'],
    ['--rounds', '1.5'],
    ['--rounds', 'NaN'],
    ['--rounds', '2', '--matches', '2'],
    ['--target', '3'],
    ['--matches', '2', '--target', '2'],
    ['--size', 'huge'],
    ['--density', 'invalid'],
    ['--tolerance', '0'],
    ['--tolerance', '1'],
    ['--browser', '--replays', '.qa/replays'],
    ['--browser-speed', '4'],
    ['--browser', '--browser-speed', '0'],
    ['--browser', '--browser-speed', '0.5'],
    ['--browser', '--browser-speed', '-1'],
    ['--browser', '--browser-speed', 'NaN'],
    ['--browser', '--browser-speed', 'Infinity'],
    ['--browser', '--browser-speed', '65'],
    ['--compare', '.qa/reference.json', '--out', '.qa/reference.json'],
    ['--seed', 's'.repeat(128)],
  ])
    assert.throws(() => parseSimulationOptions(['medium', 'hard', ...flags]));
});

test('CLI accepts full bot rosters and bounded endless matches, rejecting humans and invalid rosters', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    const bots = Array<string>(count).fill('hard');
    const parsed = parseSimulationOptions([
      ...bots,
      '--matches',
      '2',
      '--target',
      '0',
      '--max-rounds',
      '3',
      '--fixed-sides',
    ]);
    if (parsed.help) throw new Error('Unexpected help');
    assert.deepEqual(parsed.plan.bots, bots);
    assert.equal(parsed.plan.mode, 'matches');
    assert.equal(parsed.plan.target, 0);
    assert.equal(parsed.plan.maxRounds, 3);
    assert.equal(parsed.plan.swapSides, false);
  }
  for (const bots of [
    [],
    ['hard'],
    Array<string>(7).fill('hard'),
    ['human', 'hard'],
    ['easy', 'missing'],
  ]) {
    assert.throws(() => parseSimulationOptions(bots), /bot IDs/);
    assert.throws(() => validateSimulationPlan({ ...plan, bots }), /bot IDs/);
  }
  assert.throws(() => validateSimulationPlan({ ...plan, mode: 'rounds', target: 3 }), /target 0/);
});

test('per-entry summaries map rotated slots, scores, kills and diagnostics back to repeated bot IDs', () => {
  const rosterPlan: SimulationPlan = { ...plan, bots: ['hard', 'hard', 'easy'], count: 3 };
  const results: SimulationResult[] = [
    {
      index: 0,
      seed: 'summary:0',
      swapped: false,
      slotOrder: [0, 1, 2],
      outcome: 'loss',
      rounds: 1,
      winnerId: 1,
      scores: [0, 1, 0],
      kills: [1, 2, 3],
      simulatedSeconds: 1,
    },
    {
      index: 1,
      seed: 'summary:1',
      swapped: true,
      slotOrder: [2, 0, 1],
      outcome: 'win',
      rounds: 1,
      winnerId: 1,
      scores: [0, 1, 0],
      kills: [4, 5, 6],
      simulatedSeconds: 1,
      decisionStatistics: [1, 2, 3].map((n) => ({
        requests: 10 * n,
        deadlineMisses: n,
        busySkips: n + 1,
        invalidPlans: 0,
        lateReplies: n + 2,
      })),
    },
    {
      index: 2,
      seed: 'summary:2',
      swapped: true,
      slotOrder: [1, 2, 0],
      outcome: 'capped',
      rounds: 2,
      winnerId: null,
      scores: [1, 1, 0],
      kills: [7, 8, 9],
      simulatedSeconds: 1,
    },
  ];
  const summary = summarizeResults(results, rosterPlan);
  assert.equal(summary.capped, 1);
  assert.deepEqual(
    summary.players?.map((p) => p.rates.win.count),
    [1, 1, 0],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.rates.loss.count),
    [1, 1, 2],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.roundWins),
    [1, 2, 1],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.kills),
    [15, 15, 15],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.decisionStatistics.requests),
    [20, 30, 10],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.decisionStatistics.deadlineMisses),
    [2, 3, 1],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.decisionStatistics.busySkips),
    [3, 4, 2],
  );
  assert.deepEqual(
    summary.players?.map((p) => p.decisionStatistics.invalidPlans),
    [0, 0, 0],
  );
});

test('browser speed defaults to 1x and can compare accelerated browser runs with a reference', () => {
  const baseline = parseSimulationOptions(['medium', 'hard', '--browser']);
  assert.equal(baseline.help, false);
  if (baseline.help) throw new Error('Unexpected help');
  assert.equal(baseline.browserSpeed, 1);
  const accelerated = parseSimulationOptions([
    'medium',
    'hard',
    '--browser',
    '--browser-speed',
    '4',
    '--compare',
    '.qa/browser-1x.json',
  ]);
  assert.equal(accelerated.help, false);
  if (accelerated.help) throw new Error('Unexpected help');
  assert.equal(accelerated.browserSpeed, 4);
  assert.equal(accelerated.compare, '.qa/browser-1x.json');
  assert.deepEqual(accelerated.plan, baseline.plan);
});

function reports(count: number, different = false): [SimulationReport, SimulationReport] {
  const results: SimulationResult[] = Array.from({ length: count }, (_, index) => ({
    index,
    seed: `stats:${index}`,
    swapped: index % 2 === 1,
    outcome: 'win',
    rounds: 1,
    winnerId: 0,
    scores: [1, 0],
    kills: [1, 0],
    simulatedSeconds: 10,
  }));
  const headless: SimulationReport = {
    format: 'tank-trouble-simulation',
    version: 1,
    execution: 'in-process',
    environment: 'test',
    sourceHash: 'test-source',
    plan: { ...plan, seed: 'stats', count },
    results,
    elapsedMs: 1,
  };
  const browser: SimulationReport = structuredClone(headless);
  browser.execution = 'browser-workers';
  if (different) for (const result of browser.results) result.outcome = 'loss';
  return [headless, browser];
}

test('small identical samples remain inconclusive; large equivalent or biased samples are classified', () => {
  assert.equal(compareReports(...reports(10)).status, 'inconclusive');
  assert.equal(compareReports(...reports(1000)).status, 'equivalent');
  assert.equal(compareReports(...reports(1000, true)).status, 'different');
  const zero = proportionInterval(0, 100);
  assert.ok(zero[1] > 0.03);
  assert.deepEqual(proportionInterval(0, 0), [0, 1]);
  const [lower, upper] = proportionInterval(50, 100);
  assert.ok(Math.abs(lower - 0.40383) < 0.0001);
  assert.ok(Math.abs(upper - 0.59617) < 0.0001);
});

test('comparison rejects mismatched plans, revisions, incomplete samples, and capped outcomes', () => {
  for (const mutate of [
    (report: SimulationReport) => {
      report.plan.seed = 'other';
    },
    (report: SimulationReport) => {
      report.sourceHash = 'other';
    },
    (report: SimulationReport) => {
      report.results.pop();
    },
    (report: SimulationReport) => {
      report.results[0].seed = 'other';
    },
    (report: SimulationReport) => {
      report.results[0].outcome = 'capped';
    },
  ]) {
    const [headless, browser] = reports(10);
    mutate(browser);
    assert.throws(() => compareReports(headless, browser));
  }
});

test('accelerated browser reports are candidates, never normal-play reference reports', () => {
  const [candidate, baseline] = reports(1000);
  candidate.execution = 'browser-workers';
  candidate.browserSpeed = 4;
  baseline.browserSpeed = 1;
  const comparison = compareReports(candidate, baseline);
  assert.equal(comparison.status, 'equivalent');
  assert.deepEqual(comparison.candidate, { execution: 'browser-workers', browserSpeed: 4 });
  assert.deepEqual(comparison.reference, { execution: 'browser-workers', browserSpeed: 1 });
  baseline.browserSpeed = 4;
  assert.throws(() => compareReports(candidate, baseline), /1x browser reference/);
  candidate.execution = 'in-process';
  delete candidate.browserSpeed;
  assert.throws(() => compareReports(candidate, baseline), /1x browser reference/);
});

test('comparison accepts legacy 1x references and rejects invalid speed metadata', () => {
  const [candidate, baseline] = reports(10);
  assert.equal(compareReports(candidate, baseline).reference.browserSpeed, 1);
  baseline.browserSpeed = 0;
  assert.throws(() => compareReports(candidate, baseline), /Browser speed/);
  baseline.browserSpeed = 1;
  candidate.execution = 'browser-workers';
  candidate.browserSpeed = Infinity;
  assert.throws(() => compareReports(candidate, baseline), /Browser speed/);
});

test('free-for-all comparison checks every competitor even when the first bot always loses', () => {
  const [candidate, baseline] = reports(1000);
  for (const report of [candidate, baseline]) {
    report.plan.bots = ['easy', 'medium', 'hard'];
    report.plan.swapSides = false;
    for (const result of report.results) {
      result.swapped = false;
      result.slotOrder = [0, 1, 2];
      result.outcome = 'loss';
      result.winnerId = 1;
      result.scores = [0, 1, 0];
      result.kills = [0, 1, 0];
    }
  }
  assert.equal(compareReports(candidate, baseline).status, 'equivalent');
  for (const result of baseline.results) result.winnerId = 2;
  const comparison = compareReports(candidate, baseline);
  assert.equal(comparison.status, 'different');
  assert.ok(comparison.outcomes.every((outcome) => outcome.status === 'equivalent'));
  assert.equal(comparison.players?.length, 3);
  assert.ok(comparison.players?.[1].outcomes.some((outcome) => outcome.status === 'different'));
  candidate.results[0].slotOrder = [2, 1, 0];
  assert.throws(() => compareReports(candidate, baseline), /roster rotation/);
  candidate.results[0].slotOrder = [0, 1, 2];
  candidate.results[0].winnerId = 3;
  assert.throws(() => compareReports(candidate, baseline), /per-player/);
  candidate.results[0].winnerId = 0;
  assert.throws(() => compareReports(candidate, baseline), /roster winner/);
});

test('comparison distinguishes endless matches from independent rounds while accepting legacy mode inference', () => {
  const [candidate, baseline] = reports(10);
  candidate.plan.mode = 'rounds';
  assert.doesNotThrow(() => compareReports(candidate, baseline));
  baseline.plan.mode = 'matches';
  assert.throws(() => compareReports(candidate, baseline), /settings/);
});
