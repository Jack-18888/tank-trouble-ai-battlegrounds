import { Player } from './player.ts';
import { observeWorld } from './observation.ts';
import type { PlayerInput } from '../types.ts';
import type {
  ConnectionEvents,
  ControlStamp,
  PlayerConnection,
  RoundInit,
  WorldFrame,
} from './connection.ts';

/** Publishes human input changes synchronously; world snapshots are optional for this controller. */
export class HumanConnection implements PlayerConnection {
  private readonly player = new Player();
  private frame?: WorldFrame;
  private sequence = 0;
  private closed = false;

  constructor(
    private readonly init: RoundInit,
    private readonly events: ConnectionEvents,
  ) {
    events.ready(this.player.profile);
  }
  observe(frame: WorldFrame) {
    this.frame = frame;
  }
  setInput(input: Readonly<PlayerInput>, stamp: ControlStamp) {
    if (this.closed) return;
    const decision = this.player.decide({
      input,
      observe: () => {
        if (!this.frame) throw new Error('No human observation yet.');
        return observeWorld(this.init, this.frame, () => 0);
      },
    });
    this.events.decision({ ...stamp, sequence: ++this.sequence, decision });
  }
  invalidate() {
    this.frame = undefined;
  }
  advance() {}
  dispose() {
    this.closed = true;
    this.invalidate();
  }
}
