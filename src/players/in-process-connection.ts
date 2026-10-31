import { BotBrain } from './bot-brain.ts';
import { stampOf } from './connection.ts';
import type { ConnectionEvents, PlayerConnection, RoundInit, WorldFrame } from './connection.ts';
import type { AbstractPlayer } from './abstract-player.ts';
import type { Decision } from './types.ts';

/** Explicit local test adapter. Production and CLI use isolated workers. */
export class InProcessConnection implements PlayerConnection {
  readonly brain: BotBrain;
  busy = false;
  private sequence = 0;
  private closed = false;
  constructor(
    init: RoundInit,
    private readonly events: ConnectionEvents,
    factory?: (id: string) => AbstractPlayer,
  ) {
    this.brain = new BotBrain(init, factory);
    events.ready(this.brain.player.profile);
  }
  observe(frame: WorldFrame) {
    if (this.closed || this.busy) return;
    this.busy = true;
    const complete = (decision: Decision) => {
      if (this.closed) return;
      this.busy = false;
      this.events.decision({ ...stampOf(frame), sequence: ++this.sequence, decision });
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
  invalidate() {}
  advance() {}
  dispose() {
    this.closed = true;
    this.busy = false;
  }
}
