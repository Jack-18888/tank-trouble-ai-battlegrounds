import type { BotContext } from '../bots/types.ts';
import type { PlayerInput } from '../types.ts';

export interface PlayerDecision {
  /** -1 turns left, +1 turns right. Omitted controls are neutral. */
  steer?: number;
  /** -1 reverses, +1 drives forward. */
  throttle?: number;
  fire?: boolean;
}

export interface PlayerProfile {
  speed: number;
  turn: number;
  /** Zero samples controls every simulation tick, without timing variation. */
  reaction: number;
  error: number;
  cooldown: number;
}

export interface PlayerContext {
  readonly input: Readonly<PlayerInput>;
  /** Request a detached, immutable world snapshot, shared within this decision. */
  readonly observe: () => BotContext;
}
