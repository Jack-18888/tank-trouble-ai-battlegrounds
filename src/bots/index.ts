import { EasyBot } from './builtin/easy-bot.ts';
import { MediumBot } from './builtin/medium-bot.ts';
import { HardBot } from './builtin/hard-bot.ts';
import { Gpt61SolBot } from './gpt-6-1-sol.ts';
import { registerBot } from './registry.ts';

export type { BotContext, BotMetadata, BotConstructor } from './types.ts';
export { EasyBot, MediumBot, HardBot, Gpt61SolBot };
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
registerBot('gpt-6-1-sol', Gpt61SolBot, {
  label: 'GPT-6.1 Sol',
  tagline: 'READ THE RICOCHET',
  description:
    'Predictive intercepts, reflected firing lanes, and collision-aware receding-horizon evasion.',
});
