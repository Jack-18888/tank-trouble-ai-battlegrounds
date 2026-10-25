import type { BotObservation } from '../bots/types.ts';
import type { GameMap, PlayerInput } from '../types.ts';
import type { PlayerDecision, PlayerProfile } from './types.ts';

export interface ControlStamp {
  generation: number;
  round: number;
  epoch: number;
  tick: number;
}
export interface DecisionEnvelope extends ControlStamp {
  sequence: number;
  decision: PlayerDecision;
}
export interface WorldFrame extends ControlStamp {
  tanks: BotObservation['tanks'];
  bullets: BotObservation['bullets'];
  powerups: BotObservation['powerups'];
  match: BotObservation['match'];
}
export interface RoundInit {
  generation: number;
  round: number;
  playerId: number;
  botId: string;
  seed: string;
  map: GameMap;
  rules: BotObservation['rules'];
}
export interface PlayerState {
  status: 'connecting' | 'ready' | 'failed' | 'closed';
  profile: Readonly<PlayerProfile> | null;
  sequence: number;
  observationTick: number;
  failure?: string;
}
export interface ConnectionEvents {
  ready(profile: Readonly<PlayerProfile>): void;
  decision(envelope: DecisionEnvelope): void;
  failed(reason: string): void;
}
export interface PlayerConnection {
  observe(frame: WorldFrame): void;
  invalidate(): void;
  advance(unpausedMilliseconds: number): void;
  dispose(): void;
  setInput?(input: Readonly<PlayerInput>, stamp: ControlStamp): void;
}
export type BotConnectionFactory = (init: RoundInit, events: ConnectionEvents) => PlayerConnection;

export type WorkerRequest =
  { type: 'init'; init: RoundInit } | { type: 'observe'; frame: WorldFrame };
export type WorkerReply =
  | { type: 'ready'; generation: number; round: number; profile: PlayerProfile }
  | { type: 'result'; stamp: ControlStamp; sequence: number; decision?: PlayerDecision }
  | { type: 'failure'; reason: string };

export function stampOf(frame: ControlStamp): ControlStamp {
  return { generation: frame.generation, round: frame.round, epoch: frame.epoch, tick: frame.tick };
}
