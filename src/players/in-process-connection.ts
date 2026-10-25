import { BotBrain } from './bot-brain.ts';
import { stampOf } from './connection.ts';
import type { ConnectionEvents, PlayerConnection, RoundInit, WorldFrame } from './connection.ts';
import type { AbstractPlayer } from './abstract-player.ts';
import type { PlayerDecision } from './types.ts';

/**
 * Explicit test/headless adapter using the same scheduler and bounded queue as bot workers.
 * It serializes Promise decisions but shares the caller's thread, so CPU-heavy work blocks it.
 * Browser matches always select the dedicated worker connection.
 */
export class InProcessConnection implements PlayerConnection {
  readonly brain: BotBrain;
  private sequence = 0;
  private busy = false;
  private closed = false;
  private pending?: WorldFrame;
  constructor(
    init: RoundInit,
    private readonly events: ConnectionEvents,
    factory?: (id: string) => AbstractPlayer,
  ) {
    this.brain = new BotBrain(init, factory);
    events.ready(this.brain.player.profile);
  }
  observe(frame: WorldFrame) {
    if (this.closed) return;
    if (this.busy) {
      this.pending = frame;
      return;
    }
    this.busy = true;
    const complete = (decision: PlayerDecision | undefined) => {
      if (this.closed) return;
      if (decision)
        this.events.decision({ ...stampOf(frame), sequence: ++this.sequence, decision });
      this.busy = false;
      const pending = this.pending;
      this.pending = undefined;
      if (pending) this.observe(pending);
    };
    try {
      const result = this.brain.decide(frame);
      if (result instanceof Promise) void result.then(complete).catch((error) => this.fail(error));
      else complete(result);
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown) {
    if (this.closed) return;
    this.events.failed(error instanceof Error ? error.message : 'Bot calculation failed.');
    this.dispose();
  }
  invalidate() {
    this.pending = undefined;
  }
  advance() {}
  dispose() {
    this.closed = true;
    this.pending = undefined;
  }
}
