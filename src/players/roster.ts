import type { PlayerSlot } from '../types.ts';

/** Assign a controller, transferring the displaced bot to the previous human slot. */
export function assignController(
  players: readonly PlayerSlot[],
  index: number,
  controller: PlayerSlot,
): PlayerSlot[] {
  const next = players.map((slot) => ({ ...slot }));
  const previous = next[index];
  if (!previous) return next;
  if (controller.kind === 'human') {
    const human = next.findIndex((slot) => slot.kind === 'human');
    if (human !== -1 && human !== index) next[human] = previous;
  }
  next[index] = { ...controller };
  return next;
}
