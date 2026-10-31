import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runSimulation, SIMULATION_SCHEDULING } from '../src/simulation.ts';
import { nodeBotConnection } from './node-bot-connection.ts';
import type { SimulationReport } from '../src/simulation.ts';
import { compareReports, summarizeResults } from '../src/simulation-statistics.ts';
import { serializeReplay } from '../src/replay.ts';
import { parseSimulationOptions, SIMULATION_HELP } from './simulation-options.ts';

try {
  const options = parseSimulationOptions(process.argv.slice(2));
  if (options.help) {
    console.log(SIMULATION_HELP);
  } else {
    const hash = createHash('sha256');
    const files = [
      'package-lock.json',
      'tests/fixtures/simulation.html',
      'tests/fixtures/simulation-browser.ts',
    ];
    for (const directory of ['src', 'scripts']) {
      for (const file of await readdir(directory, { recursive: true }))
        if (file.endsWith('.ts') || file.endsWith('.mjs')) files.push(path.join(directory, file));
    }
    for (const file of files.sort())
      hash
        .update(file.replaceAll('\\', '/'))
        .update('\0')
        .update(await readFile(file))
        .update('\0');
    const report: SimulationReport = {
      format: 'tank-trouble-simulation',
      version: 2,
      execution: options.browser ? 'browser-workers' : 'node-workers',
      scheduling: SIMULATION_SCHEDULING,
      environment: process.version,
      browserSpeed: options.browser ? options.browserSpeed : undefined,
      sourceHash: hash.digest('hex'),
      plan: options.plan,
      results: [],
      elapsedMs: 0,
    };
    const started = performance.now();
    const save = async () => {
      report.elapsedMs = performance.now() - started;
      if (options.out) {
        await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
        await writeFile(
          options.out,
          JSON.stringify(
            { ...report, summary: summarizeResults(report.results, report.plan) },
            null,
            2,
          ) + '\n',
        );
      }
    };
    if (options.browser) {
      console.error(`Browser speed: ${options.browserSpeed}x requested`);
      const { collectBrowserResults } = await import('./simulation-browser.ts');
      report.environment = await collectBrowserResults(
        options.plan,
        options.url,
        async (result, environment) => {
          report.environment = environment;
          report.results.push(result);
          console.error(
            `Browser sample ${result.index + 1}/${options.plan.count}: ${result.outcome}`,
          );
          await save();
        },
        options.browserSpeed,
      );
    } else {
      const replayDir = options.replays ? path.resolve(options.replays) : undefined;
      if (replayDir) mkdirSync(replayDir, { recursive: true });
      for (let index = 0; index < options.plan.count; index++) {
        const result = await runSimulation(
          options.plan,
          index,
          replayDir
            ? (replay) => {
                const filename = `sample-${String(index + 1).padStart(6, '0')}-round-${replay.round}.ttr.json`;
                writeFileSync(path.join(replayDir, filename), serializeReplay(replay), {
                  flag: 'wx',
                });
              }
            : undefined,
          nodeBotConnection,
        );
        report.results.push(result);
        if ((index + 1) % 100 === 0)
          console.error(`Node-worker sample ${index + 1}/${options.plan.count}`);
      }
    }
    await save();
    const summary = summarizeResults(report.results, report.plan);
    console.log(
      `${options.plan.bots.join(' vs ')}: ${summary.completed} completed, ${summary.capped} capped`,
    );
    for (const [outcome, value] of Object.entries(summary.rates)) {
      const percent = (rate: number) => `${(100 * rate).toFixed(1)}%`;
      console.log(
        `${outcome}: ${value.count} (${percent(value.rate)}; 95% interval ${value.interval.map(percent).join(' to ')})`,
      );
    }
    for (const player of summary.players ?? []) {
      const stats = player.decisionStatistics;
      console.log(
        `Entry ${player.botIndex + 1} (${player.botId}): ${player.rates.win.count} wins, ${player.rates.tie.count} ties, ${player.rates.loss.count} losses; ${player.roundWins} round wins, ${player.kills} kills`,
      );
      console.log(
        `  Decisions: ${stats.requests} requests, ${stats.deadlineMisses} deadline misses, ${stats.busySkips} busy skips, ${stats.invalidPlans} invalid plans, ${stats.lateReplies} late replies`,
      );
    }
    const simulated = report.results.reduce((sum, result) => sum + result.simulatedSeconds, 0);
    const skipped = report.results
      .flatMap((r) => r.decisionStatistics ?? [])
      .reduce((n, s) => n + s.deadlineMisses + s.busySkips + s.invalidPlans, 0);
    console.log(
      `Skipped decisions: ${skipped} (10 ms budget; includes busy workers and invalid plans)`,
    );
    console.log(
      `${(report.elapsedMs / 1000).toFixed(2)}s wall time; ${(simulated / (report.elapsedMs / 1000)).toFixed(1)}x simulated time`,
    );
    if (options.compare) {
      const reference = JSON.parse(await readFile(options.compare, 'utf8')) as SimulationReport;
      if (reference.format !== report.format || ![1, 2].includes(reference.version))
        throw new Error('Unsupported simulation report.');
      const comparison = compareReports(report, reference, options.tolerance);
      console.log(JSON.stringify(comparison, null, 2));
      if (options.out) {
        await writeFile(
          options.out,
          JSON.stringify({ ...report, summary, comparison }, null, 2) + '\n',
        );
      }
      process.exitCode =
        comparison.status === 'equivalent' ? 0 : comparison.status === 'different' ? 1 : 2;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
