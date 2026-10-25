import type { BotObservation } from '../bots/types.ts';
import type { GameMap, PlayerInput } from '../types.ts';
import type { PlayerDecision, PlayerProfile } from './types.ts';

/** Identifies the simulation state behind a command; counters belong to a single Game instance. */
export interface ControlStamp {
  /** Changes whenever the game rebuilds its round entities. */
  generation: number;
  /** Match round number, distinct from an entity-generation replacement. */
  round: number;
  /** Changes when controls are invalidated, including pause and resume. */
  epoch: number;
  /** Completed playing-state physics steps since the round was prepared. */
  tick: number;
}
/** A command is queued for the next physics step only if its stamp and ordering are current. */
export interface DecisionEnvelope extends ControlStamp {
  /** Strictly increasing per connection; observation acknowledgments do not advance it. */
  sequence: number;
  decision: PlayerDecision;
}
/** Dynamic data from one completed tick; map and rules are supplied separately by RoundInit. */
export interface WorldFrame extends ControlStamp {
  tanks: BotObservation['tanks'];
  bullets: BotObservation['bullets'];
  powerups: BotObservation['powerups'];
  match: BotObservation['match'];
}
/** Serializable initialization sent once to each newly created round connection. */
export interface RoundInit {
  generation: number;
  round: number;
  playerId: number;
  botId: string;
  /** Per-player random stream seed, isolated from physics and other controllers. */
  seed: string;
  map: GameMap;
  rules: BotObservation['rules'];
}
/** Main-thread bookkeeping, not a reference to a bot instance running inside a worker. */
export interface PlayerState {
  status: 'connecting' | 'ready' | 'failed' | 'closed';
  /** Null until a bot reports a validated profile; pending controllers have neutral controls. */
  profile: Readonly<PlayerProfile> | null;
  /** Sequence and observation tick of the most recently accepted command. */
  sequence: number;
  observationTick: number;
  failure?: string;
}
/** Connection callbacks; PlayerRuntime binds them to one player and guards their lifetime. */
export interface ConnectionEvents {
  ready(profile: Readonly<PlayerProfile>): void;
  decision(envelope: DecisionEnvelope): void;
  failed(reason: string): void;
}
/** Transport boundary shared by the human adapter, bot workers, and explicit test adapters. */
export interface PlayerConnection {
  /** Offer a snapshot without waiting for a calculation or transport reply. */
  observe(frame: WorldFrame): void;
  /** Discard unsent observations; outstanding work may finish but its old epoch cannot act. */
  invalidate(): void;
  /** Advance watchdogs using unpaused wall-clock milliseconds, not simulated dt. */
  advance(unpausedMilliseconds: number): void;
  /** Release resources permanently; repeated disposal must be harmless. */
  dispose(): void;
  /** Human-only input path, independent of the observation broadcast cadence. */
  setInput?(input: Readonly<PlayerInput>, stamp: ControlStamp): void;
}
export type BotConnectionFactory = (init: RoundInit, events: ConnectionEvents) => PlayerConnection;

export type WorkerRequest =
  { type: 'init'; init: RoundInit } | { type: 'observe'; frame: WorldFrame };
/** Successful observations are acknowledged even when reaction timing produces no decision. */
export type WorkerReply =
  | { type: 'ready'; generation: number; round: number; profile: PlayerProfile }
  | { type: 'result'; stamp: ControlStamp; sequence: number; decision?: PlayerDecision }
  | { type: 'failure'; reason: string };

export function stampOf(frame: ControlStamp): ControlStamp {
  return { generation: frame.generation, round: frame.round, epoch: frame.epoch, tick: frame.tick };
}
