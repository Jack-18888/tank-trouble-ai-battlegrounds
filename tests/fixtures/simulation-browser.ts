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

/** RAF only paces and renders; an independent serial pump awaits decision boundaries. */
export function start(plan: SimulationPlan, index: number, browserSpeed = 1): void {
  validateBrowserSpeed(browserSpeed);
  stop();
  status = { result: null, error: null };
  const current = new BotSimulation(plan, index, false, browserBotConnection);
  simulation = current;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:960px;height:640px;max-width:100vw';
  document.body.append(canvas);
  renderer = new Renderer(canvas);
  let previous = 0;
  let accumulator = 0;
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (let steps = 0; accumulator >= SIMULATION_DT && !current.result && steps < 120; steps++) {
        await current.step();
        if (simulation !== current) return;
        accumulator -= SIMULATION_DT;
      }
      if (current.result) status.result = current.result;
    } catch (error) {
      if (simulation === current) {
        status.error = error instanceof Error ? error.message : String(error);
        current.dispose();
      }
    } finally {
      pumping = false;
    }
  };
  const frame = (time: number) => {
    if (simulation !== current || !renderer) return;
    accumulator = Math.min(
      1,
      accumulator + Math.min((time - (previous || time)) / 1000, 0.1) * browserSpeed,
    );
    previous = time;
    void pump();
    renderer.draw(current.game, time / 1000);
    if (!status.result && !status.error) frameId = requestAnimationFrame(frame);
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
