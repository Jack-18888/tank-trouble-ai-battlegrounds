import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTickTrace } from './helpers/tick-trace.ts';
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
