import test from 'node:test';
import assert from 'node:assert/strict';
import { BotSimulation, runSimulation } from '../src/simulation.ts';
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

test('seeded in-process rounds are reproducible and recording preserves gameplay', () => {
  const replays: RoundReplay[] = [];
  const plain = runSimulation(plan, 0);
  const recorded = runSimulation(plan, 0, (replay) => replays.push(replay));
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

test('alternating slots retains outcomes from the first named bot perspective', () => {
  for (const index of [0, 1]) {
    const simulation = new BotSimulation(plan, index);
    try {
      assert.equal(simulation.swapped, index === 1);
      const slot = index === 1 ? 1 : 0;
      assert.deepEqual(simulation.game.config.players[slot], { kind: 'bot', botId: 'medium' });
      simulation.game.finishRound(simulation.game.tanks[slot]);
      assert.equal(simulation.step()?.outcome, 'win');
      assert.equal(simulation.result?.winnerId, slot);
    } finally {
      simulation.dispose();
    }
  }
});

test('whole matches finish at their win target and export every completed round', () => {
  const rounds: RoundReplay[] = [];
  const result = runSimulation({ ...plan, target: 3 }, 0, (replay) => rounds.push(replay));
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

test('round ties and capped matches remain distinct in batch statistics', () => {
  const idle: SimulationPlan = {
    ...plan,
    bots: ['simulation-idle', 'simulation-idle'],
    powerups: false,
  };
  const tie = runSimulation(idle, 0);
  assert.equal(tie.outcome, 'tie');
  const capped = runSimulation({ ...idle, target: 3, maxRounds: 2 }, 0);
  assert.equal(capped.outcome, 'capped');
  assert.equal(capped.rounds, 2);
  const summary = summarizeResults([tie, capped]);
  assert.equal(summary.completed, 1);
  assert.equal(summary.capped, 1);
  assert.equal(summary.rates.tie.rate, 1);
  assert.equal(summary.rates.win.rate, 0);
});

test('async decisions and controller failures abort instead of producing misleading outcomes', () => {
  assert.throws(
    () => runSimulation({ ...plan, bots: ['simulation-async', 'medium'] }, 0),
    /synchronous/,
  );
  assert.throws(
    () => runSimulation({ ...plan, bots: ['simulation-broken', 'medium'] }, 0),
    /Expected simulation failure/,
  );
  assert.throws(() => runSimulation({ ...plan, bots: ['missing-bot', 'medium'] }, 0), /registered/);
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
    ['--matches', '2', '--target', '0'],
    ['--size', 'huge'],
    ['--density', 'invalid'],
    ['--tolerance', '0'],
    ['--tolerance', '1'],
    ['--browser', '--replays', '.qa/replays'],
    ['--compare', '.qa/reference.json', '--out', '.qa/reference.json'],
    ['--seed', 's'.repeat(128)],
  ])
    assert.throws(() => parseSimulationOptions(['medium', 'hard', ...flags]));
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
