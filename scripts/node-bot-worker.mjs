import { parentPort, workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

const loader = register({ namespace: 'tank-bot' });
if (workerData.catalog) await loader.import(workerData.catalog, import.meta.url);
const { serveBotWorker } = await loader.import('../src/players/worker-host.ts', import.meta.url);
serveBotWorker(
  (handler) => parentPort.on('message', handler),
  (reply) => parentPort.postMessage(reply),
);
