import { WorkerConnection } from './worker-connection.ts';
import type { BotConnectionFactory } from './connection.ts';

/** Create a dedicated module worker; startup failures propagate instead of using the main thread. */
export const browserBotConnection: BotConnectionFactory = (init, events) => {
  const worker = new Worker(new URL('./bot.worker.ts', import.meta.url), {
    type: 'module',
    name: `${init.botId}-${init.playerId}`,
  });
  return new WorkerConnection(init, events, {
    listen(message, failure) {
      worker.onmessage = (event) => message(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        failure(event.message || 'Bot worker crashed.');
      };
      worker.onmessageerror = () => failure('Could not read bot worker message.');
    },
    post(message) {
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
  });
};
