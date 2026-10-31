import { BotBrain } from './bot-brain.ts';
import { stampOf } from './connection.ts';
import type { AbstractPlayer } from './abstract-player.ts';
import type { WorkerRequest, WorkerReply } from './connection.ts';

/**
 * Serve the worker protocol using the local catalog, with an injectable catalog for QA.
 * Constructors and queries stay in this realm; only serializable data crosses the transport.
 */
export function serveBotWorker(
  listen: (handler: (message: WorkerRequest) => void) => void,
  send: (reply: WorkerReply) => void,
  factory?: (id: string) => AbstractPlayer,
) {
  let brain: BotBrain | undefined;
  let sequence = 0;
  let busy = false;
  listen((message) => {
    void (async () => {
      try {
        if (message.type === 'init') {
          if (brain) throw new Error('Worker already initialized.');
          brain = new BotBrain(message.init, factory);
          send({
            type: 'ready',
            generation: message.init.generation,
            round: message.init.round,
            profile: brain.player.profile,
          });
        } else if (message.type === 'observe') {
          if (!brain || busy) throw new Error('Invalid worker observation order.');
          busy = true;
          const decision = await brain.decide(message.frame);
          // Each requested boundary produces one finite plan; there is no worker-side scheduler.
          sequence++;
          send({
            type: 'result',
            stamp: stampOf(message.frame),
            sequence,
            decision,
          });
          busy = false;
        } else throw new Error('Unknown worker message.');
      } catch (error) {
        send({
          type: 'failure',
          reason: error instanceof Error ? error.message : 'Bot calculation failed.',
        });
      }
    })();
  });
}
