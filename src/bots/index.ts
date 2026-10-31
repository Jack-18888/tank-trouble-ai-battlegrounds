import { EasyBot } from './builtin/easy-bot.ts';
import { MediumBot } from './builtin/medium-bot.ts';
import { HardBot } from './builtin/hard-bot.ts';
import { DsV41FlashBot } from './ds-v41-flash.ts';
import { registerBot } from './registry.ts';

export type { BotContext, BotMetadata, BotConstructor } from './types.ts';
export { EasyBot, MediumBot, HardBot, DsV41FlashBot };
export { registerBot, createBot, getBotType, getBotTypes, hasBot } from './registry.ts';

// Add custom class imports and registrations here to make them available both
// in match configuration and in the setup UI. No engine changes are needed.
registerBot('easy', EasyBot, {
  label: 'Easy',
  tagline: 'EASE INTO IT',
  description: 'Slower reactions. Plenty of room to find your feet.',
});
registerBot('medium', MediumBot, {
  label: 'Medium',
  tagline: 'A FAIR FIGHT',
  description: 'Quick on the trigger. A little less forgiving.',
});
registerBot('hard', HardBot, {
  label: 'Hard',
  tagline: 'GOOD LUCK, HUMAN',
  description: 'Bank shots. Bullet dodges. Absolutely no mercy.',
});
registerBot('ds-v41-flash', DsV41FlashBot, {
  label: 'DS V4.1 Flash',
  tagline: 'SOLVE THE ARENA',
  description:
    'Predicts every bounce, simulates every dodge, and fires on the exact intercept tick.',
});
