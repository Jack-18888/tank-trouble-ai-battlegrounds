import { Bot } from './bot.ts';
import type { BotConstructor, BotMetadata } from './types.ts';

const types = new Map<string, { BotClass: BotConstructor; metadata: BotMetadata }>();

export function registerBot(
  id: string,
  BotClass: BotConstructor,
  {
    label = id,
    tagline = 'CUSTOM BOT',
    description = 'A custom opponent. A different kind of trouble.',
  }: Partial<Omit<BotMetadata, 'id'>> = {},
) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))
    throw new TypeError(
      'Bot IDs must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.',
    );
  if (types.has(id)) throw new Error(`Bot "${id}" is already registered.`);
  if (
    typeof BotClass !== 'function' ||
    !(BotClass.prototype instanceof Bot) ||
    typeof BotClass.prototype.decide !== 'function' ||
    BotClass.prototype.decide === Bot.prototype.decide
  )
    throw new TypeError('Registered bot classes must extend Bot and implement decide(context).');
  if ([label, tagline, description].some((value) => typeof value !== 'string' || !value.trim()))
    throw new TypeError('Bot metadata must contain non-empty strings.');
  types.set(id, { BotClass, metadata: Object.freeze({ id, label, tagline, description }) });
}

export function hasBot(id: unknown): id is string {
  return typeof id === 'string' && types.has(id);
}
export function getBotType(id: string | null | undefined): BotMetadata | undefined {
  return typeof id === 'string' ? types.get(id)?.metadata : undefined;
}
export function getBotTypes(): BotMetadata[] {
  return [...types.values()].map((type) => type.metadata);
}
export function createBot(id: string): Bot {
  const type = types.get(id);
  if (!type) throw new Error(`Unknown bot type "${id}". Register it before creating the game.`);
  return new type.BotClass();
}
