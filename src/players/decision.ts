import type { Decision, PlayerDecision } from './types.ts';
import { RULES } from '../rules.ts';

export const TICK_RATE = 120;
export const TICK_DT = 1 / TICK_RATE;
export const DECISION_BUDGET_MS = 10;
export const RETRY_TICKS = 4;
export const MAX_DECISION_SEGMENTS = 256;
export const MAX_DECISION_TICKS = RULES.roundDuration * TICK_RATE;

const control = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;

/** Validate atomically and detach before any part of a plan can run. */
export function validateDecision(value: unknown): Decision {
  if (!value || typeof value !== 'object' || !('segments' in value))
    throw new TypeError('Expected a Decision with segments.');
  if (
    !Array.isArray(value.segments) ||
    !value.segments.length ||
    value.segments.length > MAX_DECISION_SEGMENTS
  )
    throw new TypeError('A Decision requires 1 to 256 segments.');
  let total = 0;
  const segments = Array.from(value.segments, (segment: unknown) => {
    if (
      !segment ||
      typeof segment !== 'object' ||
      !('ticks' in segment) ||
      typeof segment.ticks !== 'number' ||
      !Number.isSafeInteger(segment.ticks) ||
      segment.ticks < 1
    )
      throw new TypeError('Segment ticks must be positive integers.');
    total += segment.ticks;
    if (total > MAX_DECISION_TICKS) throw new TypeError('Decision exceeds one round.');
    const fire = 'fire' in segment ? segment.fire : undefined;
    if (fire !== undefined && fire !== 'once' && fire !== 'held')
      throw new TypeError('Segment fire must be once or held.');
    return Object.freeze({
      ticks: segment.ticks,
      steer: control('steer' in segment ? segment.steer : undefined),
      throttle: control('throttle' in segment ? segment.throttle : undefined),
      ...(fire ? { fire } : {}),
    });
  });
  return Object.freeze({ segments: Object.freeze(segments) });
}

export function neutralDecision(): Decision {
  return { segments: [{ ticks: RETRY_TICKS }] };
}

/** One executor for human, adapted legacy, and native plan decisions. */
export class DecisionExecutor {
  private readonly plans = new Map<number, { decision: Decision; start: number; end: number }>();

  due(id: number, tick: number): boolean {
    return tick >= (this.plans.get(id)?.end ?? 0);
  }
  accept(id: number, decision: Decision, tick: number): void {
    this.plans.set(id, {
      decision,
      start: tick,
      end: tick + decision.segments.reduce((n, s) => n + s.ticks, 0),
    });
  }
  controls(id: number, tick: number): PlayerDecision {
    const plan = this.plans.get(id);
    if (!plan || tick < plan.start || tick >= plan.end) return {};
    let offset = tick - plan.start;
    for (const segment of plan.decision.segments) {
      if (offset < segment.ticks)
        return {
          steer: segment.steer,
          throttle: segment.throttle,
          fire: segment.fire === 'held' || (segment.fire === 'once' && offset === 0),
        };
      offset -= segment.ticks;
    }
    return {};
  }
  remove(id: number): void {
    this.plans.delete(id);
  }
  clear(): void {
    this.plans.clear();
  }
}
