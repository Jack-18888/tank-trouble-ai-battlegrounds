import type { BotContext } from '../bots/types.ts';
import type { PlayerInput } from '../types.ts';

/** Controls executed together for an exact number of physics ticks. */
export interface DecisionSegment {
  ticks: number;
  steer?: number;
  throttle?: number;
  fire?: 'once' | 'held';
}

/** A finite program; another observation is requested when all segments finish. */
export interface Decision {
  segments: readonly DecisionSegment[];
}

/** Held controls, replaced together when the game accepts the next decision. */
export interface PlayerDecision {
  /** -1 turns left, +1 turns right. Omitted controls are neutral. */
  steer?: number;
  /** -1 reverses, +1 drives forward. */
  throttle?: number;
  /** Hold the trigger; the simulation still enforces cooldown and ammunition. */
  fire?: boolean;
}

/** Immutable movement, reaction, and firing settings validated before use. */
export interface PlayerProfile {
  /** World pixels per second at full throttle. */
  speed: number;
  /** Radians per second at full steering. */
  turn: number;
  /** Legacy control-plan interval in simulation seconds; native Decisions specify their own ticks. */
  reaction: number;
  /** Maximum random firing-angle deviation in radians; zero gives exact aim. */
  error: number;
  /** Seconds between shots before power-up overrides. */
  cooldown: number;
}

/** Local strategy API; query functions are rebuilt in each worker rather than sent in messages. */
export interface PlayerContext {
  /** Completed playing ticks in the current round. */
  readonly tick: number;
  readonly tickRate: number;
  /** Current human controls, or an empty object for bots. */
  readonly input: Readonly<PlayerInput>;
  /** Request a detached, immutable world snapshot, shared within this decision. */
  readonly observe: () => BotContext;
}
