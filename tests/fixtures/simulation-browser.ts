import { BotSimulation, SIMULATION_DT, validateBrowserSpeed } from '../../src/simulation.ts';
import type { SimulationPlan, SimulationResult } from '../../src/simulation.ts';
import { browserBotConnection } from '../../src/players/browser-connection.ts';
import { Renderer } from '../../src/renderer.ts';

let frameId = 0;
let simulation: BotSimulation | undefined;
let renderer: Renderer | undefined;
let status: { result: SimulationResult | null; error: string | null } = {
  result: null,
  error: null,
};

/** At 1x, uses main.ts's real-time accumulator. Faster modes scale time, retaining fixed ticks. */
export function start(plan: SimulationPlan, index: number, browserSpeed = 1): void {
  validateBrowserSpeed(browserSpeed);
  stop();
  status = { result: null, error: null };
  simulation = new BotSimulation(plan, index, false, browserBotConnection);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:960px;height:640px;max-width:100vw';
  document.body.append(canvas);
  renderer = new Renderer(canvas);
  let previous = 0;
  let accumulator = 0;
  const frame = (time: number) => {
    if (!simulation || !renderer) return;
    try {
      accumulator += Math.min((time - (previous || time)) / 1000, 0.1) * browserSpeed;
      previous = time;
      // Bound each batch so higher requested speeds still yield to worker replies and rendering.
      for (
        let steps = 0;
        accumulator >= SIMULATION_DT && !simulation.result && steps < 120;
        steps++
      ) {
        simulation.step();
        accumulator -= SIMULATION_DT;
      }
      renderer.draw(simulation.game, time / 1000);
      if (simulation.result) status.result = simulation.result;
      else frameId = requestAnimationFrame(frame);
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
      simulation.dispose();
    }
  };
  frameId = requestAnimationFrame(frame);
}

export function poll() {
  return status;
}

export function stop(): void {
  cancelAnimationFrame(frameId);
  simulation?.dispose();
  renderer?.observer.disconnect();
  renderer?.canvas.remove();
  simulation = undefined;
  renderer = undefined;
}
