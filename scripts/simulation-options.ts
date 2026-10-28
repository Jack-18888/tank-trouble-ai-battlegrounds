import { parseArgs } from 'node:util';
import path from 'node:path';
import type { SimulationPlan } from '../src/simulation.ts';
import { validateBrowserSpeed, validateSimulationPlan } from '../src/simulation.ts';

export const SIMULATION_HELP = `Usage: npm run simulate -- BOT_A BOT_B [options]

  --rounds N          Sample N independent rounds (default: 1)
  --matches N         Sample N whole matches instead
  --target 3|5|10      Wins needed per match (default: 5; requires --matches)
  --max-rounds N      Cap each match (default: 100; capped matches are not ties)
  --seed TEXT         Batch seed (default: simulation)
  --size SIZE         compact, classic, large (default: classic)
  --density DENSITY   open, balanced, dense (default: balanced)
  --no-powerups       Disable pickups
  --fixed-sides       Disable alternating starting slots
  --replays DIR       Save each completed round as an existing .ttr.json replay
  --out FILE          Save results, settings, source fingerprint, and statistics as JSON
  --browser           Run browser workers instead (requires Vite/Chrome; default: real time)
  --browser-speed N   Requested browser speed, 1 to 64 (default: 1; requires --browser)
  --url URL           Vite server for --browser (default: http://127.0.0.1:5173)
  --compare FILE      Compare against a completed 1x browser reference with the same plan
  --tolerance RATE    Allowed difference per outcome (default: 0.05 = 5 percentage points)
  --help              Show this help

Results describe the first named bot. Slots alternate, seeds differ for every sample.
Browser speed changes worker timing; accelerated runs are not 1x references. A comparison exits
0 for equivalent, 1 for different/error, or 2 for inconclusive. Large samples do not remove bias.
`;

export function parseSimulationOptions(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      rounds: { type: 'string' },
      matches: { type: 'string' },
      target: { type: 'string' },
      'max-rounds': { type: 'string', default: '100' },
      seed: { type: 'string', default: 'simulation' },
      size: { type: 'string', default: 'classic' },
      density: { type: 'string', default: 'balanced' },
      'no-powerups': { type: 'boolean', default: false },
      'fixed-sides': { type: 'boolean', default: false },
      replays: { type: 'string' },
      out: { type: 'string' },
      browser: { type: 'boolean', default: false },
      'browser-speed': { type: 'string' },
      url: { type: 'string', default: 'http://127.0.0.1:5173' },
      compare: { type: 'string' },
      tolerance: { type: 'string', default: '0.05' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true } as const;
  if (positionals.length !== 2)
    throw new Error('Provide exactly two bot IDs. Use --help for usage.');
  if (values.rounds !== undefined && values.matches !== undefined)
    throw new Error('Choose --rounds or --matches, not both.');
  if (values.target !== undefined && values.matches === undefined)
    throw new Error('--target requires --matches.');
  if (values.browser && values.replays) throw new Error('--replays is for in-process runs.');
  if (values['browser-speed'] !== undefined && !values.browser)
    throw new Error('--browser-speed requires --browser.');
  const browserSpeed = Number(values['browser-speed'] ?? 1);
  validateBrowserSpeed(browserSpeed);
  const canonicalPath = (file: string) => {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (values.compare && values.out && canonicalPath(values.compare) === canonicalPath(values.out))
    throw new Error('--out must not overwrite the browser reference used by --compare.');
  const plan: SimulationPlan = {
    bots: [positionals[0], positionals[1]],
    count: Number(values.matches ?? values.rounds ?? 1),
    seed: values.seed,
    size: values.size as SimulationPlan['size'],
    density: values.density as SimulationPlan['density'],
    powerups: !values['no-powerups'],
    target: (values.matches === undefined
      ? 0
      : Number(values.target ?? 5)) as SimulationPlan['target'],
    maxRounds: Number(values['max-rounds']),
    swapSides: !values['fixed-sides'],
  };
  if (values.matches !== undefined && plan.target === 0)
    throw new Error('Whole matches need a target of 3, 5, or 10.');
  validateSimulationPlan(plan);
  const tolerance = Number(values.tolerance);
  if (!(tolerance > 0 && tolerance < 1)) throw new Error('Tolerance must be between 0 and 1.');
  return { ...values, help: false, plan, tolerance, browserSpeed };
}
