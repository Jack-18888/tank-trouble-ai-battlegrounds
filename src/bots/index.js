import { EasyBot } from './easy-bot.js';
import { MediumBot } from './medium-bot.js';
import { HardBot } from './hard-bot.js';
import { registerBot } from './registry.js';

export { Bot } from './bot.js';
export { EasyBot, MediumBot, HardBot };
export { registerBot, createBot, getBotType, getBotTypes, hasBot } from './registry.js';

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
