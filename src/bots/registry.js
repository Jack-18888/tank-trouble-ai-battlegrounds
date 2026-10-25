import { Bot } from './bot.js';

const types = new Map();

export function registerBot(
  id,
  BotClass,
  {
    label = id,
    tagline = 'CUSTOM BOT',
    description = 'A custom opponent. A different kind of trouble.',
  } = {},
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

export function hasBot(id) {
  return types.has(id);
}
export function getBotType(id) {
  return types.get(id)?.metadata;
}
export function getBotTypes() {
  return [...types.values()].map((type) => type.metadata);
}
export function createBot(id) {
  const type = types.get(id);
  if (!type) throw new Error(`Unknown bot type "${id}". Register it before creating the game.`);
  return new type.BotClass();
}
