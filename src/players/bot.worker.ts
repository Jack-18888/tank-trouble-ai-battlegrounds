import { serveBotWorker } from './worker-host.ts';
const scope = self as DedicatedWorkerGlobalScope;
serveBotWorker(
  (handler) => {
    scope.onmessage = (event) => handler(event.data);
  },
  (reply) => scope.postMessage(reply),
);
