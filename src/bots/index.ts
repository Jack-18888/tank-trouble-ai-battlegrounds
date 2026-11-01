import { TerraBot } from './gpt-6-1-terra/index.ts';
import { Gpt61SolBot } from './gpt-6-1-sol/index.ts';
import { DsV41FlashBot } from './ds-flash/index.ts';
import { EasyBot } from './builtin/easy-bot.ts';
import { MediumBot } from './builtin/medium-bot.ts';
import { HardBot } from './builtin/hard-bot.ts';
import { registerBot } from './registry.ts';

export type { BotContext, BotMetadata, BotConstructor } from './types.ts';
export { EasyBot, MediumBot, HardBot };
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
  description: 'Tick-native trajectory prediction and ricochet targeting.',
});

registerBot('gpt-6-1-sol', Gpt61SolBot, {
  label: 'GPT-6.1 Sol',
  tagline: 'READ THE RICOCHET',
  description: 'Predictive intercepts and receding-horizon evasion.',
});

registerBot('gpt-6-1-terra', TerraBot, {
  label: 'GPT-6.1 Terra',
  tagline: 'CALCULATED SURVIVAL',
  description: 'Navigates the maze and forecasts incoming shells.',
});

export { DsV41FlashBot, Gpt61SolBot, TerraBot };
