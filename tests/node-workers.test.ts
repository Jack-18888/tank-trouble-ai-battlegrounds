import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSimulationTrace, collectTickTrace } from './helpers/tick-trace.ts';
import { InProcessConnection } from '../src/players/in-process-connection.ts';
import { createNodeBotConnection } from '../scripts/node-bot-connection.ts';

test('Node workers and local execution produce identical tick traces across batching speeds', async () => {
  const local = await collectTickTrace((init, events) => new InProcessConnection(init, events), 64);
  const workers = await collectTickTrace(
    createNodeBotConnection(new URL('./fixtures/plan-bot.ts', import.meta.url)),
    1,
  );
  assert.deepEqual(workers, local);
});

test('six-worker simulation traces and rotated outcomes match local execution', async () => {
  const local = await collectSimulationTrace(
    (init, events) => new InProcessConnection(init, events),
    64,
  );
  const workers = await collectSimulationTrace(
    createNodeBotConnection(new URL('./fixtures/plan-bot.ts', import.meta.url)),
    1,
  );
  assert.deepEqual(workers, local);
  assert.equal(workers.result?.outcome, 'win');
  assert.equal(workers.result?.winnerId, 5);
  assert.ok(workers.statistics.every((stats) => stats.requests > 0));
});
