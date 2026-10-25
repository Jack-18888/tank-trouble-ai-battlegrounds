import { setReporter } from './catalog.ts';
import { serveBotWorker } from '../../src/players/worker-host.ts';

const scope = self as DedicatedWorkerGlobalScope;
setReporter((event) => scope.postMessage({ type: 'fixture-event', event }));
serveBotWorker(
  (handler) => {
    scope.onmessage = (event) => handler(event.data);
  },
  (reply) => scope.postMessage(reply),
);
