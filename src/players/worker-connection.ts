import { stampOf } from './connection.ts';
import { validateProfile } from './profile.ts';
import type {
  ConnectionEvents,
  PlayerConnection,
  RoundInit,
  WorkerRequest,
  WorldFrame,
} from './connection.ts';
import type { PlayerProfile } from './types.ts';

/** Minimal worker I/O surface; fake ports let tests control reply ordering and failures. */
export interface WorkerPort {
  listen(message: (data: unknown) => void, failure: (reason: string) => void): void;
  post(message: WorkerRequest): void;
  terminate(): void;
}

/**
 * Main-thread worker transport with one outstanding operation and no observation backlog.
 * A missing reply fails only this connection after ten unpaused wall-clock seconds.
 */
export class WorkerConnection implements PlayerConnection {
  private phase: 'starting' | 'idle' | 'busy' | 'closed' = 'starting';
  private requested?: WorldFrame;
  private waitingMs = 0;
  private sequence = 0;
  get busy(): boolean {
    return this.phase === 'busy' || this.phase === 'starting';
  }

  constructor(
    private readonly init: RoundInit,
    private readonly events: ConnectionEvents,
    private readonly port: WorkerPort,
  ) {
    port.listen(
      (data) => this.receive(data),
      (reason) => this.fail(reason),
    );
    try {
      port.post({ type: 'init', init });
    } catch {
      this.fail('Could not initialize bot worker.');
    }
  }
  observe(frame: WorldFrame) {
    if (this.phase !== 'idle') return;
    this.requested = frame;
    this.phase = 'busy';
    this.waitingMs = 0;
    try {
      this.port.post({ type: 'observe', frame: this.requested });
    } catch {
      this.fail('Could not send bot observation.');
    }
  }
  private receive(data: unknown) {
    if (this.phase === 'closed') return;
    try {
      if (!data || typeof data !== 'object' || !('type' in data))
        throw new Error('Malformed bot reply.');
      if (data.type === 'failure' && 'reason' in data && typeof data.reason === 'string') {
        this.fail(data.reason);
        return;
      }
      if (data.type === 'ready' && this.phase === 'starting') {
        if (
          !('generation' in data) ||
          data.generation !== this.init.generation ||
          !('round' in data) ||
          data.round !== this.init.round ||
          !('profile' in data) ||
          !data.profile ||
          typeof data.profile !== 'object'
        )
          throw new Error('Malformed bot readiness reply.');
        const profile = validateProfile(data.profile as PlayerProfile);
        this.phase = 'idle';
        this.waitingMs = 0;
        this.events.ready(profile);
        return;
      }
      if (
        data.type !== 'result' ||
        this.phase !== 'busy' ||
        !this.requested ||
        !('stamp' in data) ||
        !data.stamp ||
        typeof data.stamp !== 'object' ||
        !('sequence' in data) ||
        typeof data.sequence !== 'number' ||
        !Number.isSafeInteger(data.sequence)
      )
        throw new Error('Malformed bot result.');
      // Late replies still release the worker. The coordinator decides whether to admit a plan.
      const expected = stampOf(this.requested);
      for (const key of ['generation', 'round', 'epoch', 'tick'] as const) {
        if (!(key in data.stamp) || data.stamp[key as keyof typeof data.stamp] !== expected[key])
          throw new Error('Mismatched bot observation reply.');
      }
      if (data.sequence <= this.sequence) throw new Error('Mismatched bot sequence.');
      this.sequence = data.sequence;
      this.events.decision({
        ...expected,
        sequence: this.sequence,
        decision: 'decision' in data ? data.decision : undefined,
      });
      this.requested = undefined;
      this.phase = 'idle';
      this.waitingMs = 0;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Invalid bot reply.');
    }
  }
  advance(unpausedMilliseconds: number) {
    if (this.phase !== 'starting' && this.phase !== 'busy') return;
    this.waitingMs += Math.max(0, unpausedMilliseconds);
    if (this.waitingMs >= 10_000) this.fail('Bot did not reply within 10 seconds.');
  }
  /** In-flight replies remain matchable; plan cancellation belongs to the coordinator. */
  invalidate() {}
  private fail(reason: string) {
    if (this.phase === 'closed') return;
    this.dispose();
    this.events.failed(reason);
  }
  dispose() {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.requested = undefined;
    this.port.terminate();
  }
}
