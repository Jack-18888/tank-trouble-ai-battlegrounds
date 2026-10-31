import { Worker } from 'node:worker_threads';
import { WorkerConnection } from '../src/players/worker-connection.ts';
import type { BotConnectionFactory } from '../src/players/connection.ts';

/** Node isolation with exactly the same messages and deadline handling as browser workers. */
export function createNodeBotConnection(catalog?: URL): BotConnectionFactory {
  return (init, events) => {
    const worker = new Worker(new URL('./node-bot-worker.mjs', import.meta.url), {
      execArgv: [],
      workerData: { catalog: catalog?.href },
    });
    return new WorkerConnection(init, events, {
      listen(message, failure) {
        worker.on('message', message);
        worker.on('error', (error) => failure(error.message));
        worker.on('exit', (code) => failure(`Bot worker exited with code ${code}.`));
        worker.on('messageerror', () => failure('Could not read bot worker message.'));
      },
      post(message) {
        worker.postMessage(message);
      },
      terminate() {
        void worker.terminate();
      },
    });
  };
}
export const nodeBotConnection = createNodeBotConnection();
