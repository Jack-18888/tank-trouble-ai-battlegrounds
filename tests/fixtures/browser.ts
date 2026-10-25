import './catalog.ts';
import { Game } from '../../src/engine.ts';
import { Renderer } from '../../src/renderer.ts';
import { PlayerRuntime } from '../../src/players/runtime.ts';
import { WorkerConnection } from '../../src/players/worker-connection.ts';
import { scoreCards } from '../../src/scoreboard.ts';

export function startScoreboardFixture() {
  const game = new Game(
    {
      players: Array.from({ length: 6 }, (_, id) =>
        id === 2 ? { kind: 'human' } : { kind: 'bot', botId: 'medium' },
      ),
    },
    'kill-display',
  );
  game.start();
  game.destroyTank(game.tanks[1], 0);
  game.destroyTank(game.tanks[3], 2);
  game.finishRound(game.tanks[0]);
  game.prepareRound('score-round-two');
  game.destroyTank(game.tanks[4], 2);
  game.finishRound(game.tanks[2]);
  const site = document.querySelector<HTMLElement>('.site-wrap');
  if (site) site.style.display = 'none';
  const wrap = document.createElement('main');
  wrap.className = 'site-wrap';
  wrap.style.cssText = 'padding:32px;max-width:1100px;margin:auto';
  wrap.innerHTML =
    '<h1 style="font-size:36px;margin-bottom:12px">Wins and kills. Every tank counted.</h1><p style="margin-bottom:24px">Match totals stay visible for every player and carry over to the next maze.</p><div class="arena-shell"><div class="scoreboard many" id="kills-qa"></div></div>';
  document.body.append(wrap);
  const board = wrap.querySelector<HTMLElement>('#kills-qa')!;
  const render = () => {
    board.innerHTML = scoreCards(game);
  };
  render();
  return {
    nextRound() {
      game.prepareRound('score-round-three');
      render();
    },
    restart() {
      game.start();
      render();
    },
    dispose() {
      wrap.remove();
      if (site) site.style.display = '';
    },
  };
}

/** Loaded only by browser QA; these fixtures never enter the production bundle. */
export function startWorkerFixture() {
  const game = new Game(
    {
      players: [
        { kind: 'human' },
        { kind: 'bot', botId: 'qa-slow' },
        { kind: 'bot', botId: 'qa-fast' },
        { kind: 'bot', botId: 'qa-module' },
        { kind: 'bot', botId: 'qa-crash' },
      ],
      powerups: false,
    },
    'worker-isolation',
  );
  let slowStarted = false,
    slowFinished = false,
    fastDecisions = 0,
    moduleDecisions = 0,
    spawned = 0,
    drawn = 0;
  const runtime = new PlayerRuntime(game, (init, events) => {
    spawned++;
    const worker = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
    return new WorkerConnection(init, events, {
      listen(message, failure) {
        worker.onmessage = (event) => {
          if (event.data?.type === 'fixture-event') {
            if (event.data.event === 'slow-start') slowStarted = true;
            if (event.data.event === 'slow-finish') slowFinished = true;
            if (event.data.event === 'fast-decision') fastDecisions++;
            if (event.data.event === 'module-decision') moduleDecisions++;
          } else message(event.data);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          failure(event.message);
        };
        worker.onmessageerror = () => failure('Fixture message error');
      },
      post(message) {
        worker.postMessage(message);
      },
      terminate() {
        worker.terminate();
      },
    });
  });
  if (spawned !== 0) throw new Error('Preview started workers.');
  game.start();
  game.state = 'playing';
  game.map.walls = game.map.walls.filter((wall) => wall.border);
  const positions = [
    [100, 100],
    [600, 100],
    [600, 400],
    [100, 400],
    [350, 250],
  ];
  for (const [id, tank] of game.tanks.entries())
    Object.assign(tank, { x: positions[id][0], y: positions[id][1], angle: 0, cooldown: 999 });
  const wrap = document.createElement('main');
  wrap.style.cssText = 'max-width:800px;margin:32px auto';
  wrap.innerHTML =
    '<h1 style="font-size:36px">One bot thinks. The game keeps moving.</h1><p style="margin:12px 0 24px">A one-second CPU calculation runs in its own worker while physics, human input, drawing, and other bots continue.</p><canvas style="width:768px;height:512px;max-width:100%"></canvas>';
  const site = document.querySelector<HTMLElement>('.site-wrap');
  if (site) site.style.display = 'none';
  document.body.append(wrap);
  const canvas = wrap.querySelector('canvas')!;
  const painter = new Renderer(canvas);
  let running = true,
    previous = 0,
    accumulator = 0,
    animation = 0;
  const frame = (time: number) => {
    if (!running) return;
    accumulator += Math.min(previous ? (time - previous) / 1000 : 0, 0.1);
    previous = time;
    while (accumulator >= 1 / 120) {
      runtime.step(1 / 120);
      accumulator -= 1 / 120;
    }
    painter.draw(game, time / 1000);
    drawn++;
    animation = requestAnimationFrame(frame);
  };
  animation = requestAnimationFrame(frame);
  const down = (event: KeyboardEvent) => {
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      runtime.setInput({ forward: true });
    }
  };
  const up = (event: KeyboardEvent) => {
    if (event.code === 'ArrowUp') runtime.setInput({});
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  const waitFor = (predicate: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const check = () => {
        if (predicate()) resolve();
        else if (performance.now() - start > 5000) reject(new Error('Worker fixture timed out.'));
        else setTimeout(check, 10);
      };
      check();
    });
  return {
    waitForStart: () => waitFor(() => slowStarted),
    waitForFinish: () => waitFor(() => slowFinished && moduleDecisions > 0),
    measure: () => ({
      tick: game.tick,
      x: game.tanks[0].x,
      drawn,
      spawned,
      slowStarted,
      slowFinished,
      fastDecisions,
      moduleDecisions,
      statuses: [...game.players.values()].map((state) => state.status),
    }),
    dispose() {
      running = false;
      cancelAnimationFrame(animation);
      runtime.dispose();
      painter.observer.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      wrap.remove();
      if (site) site.style.display = '';
    },
  };
}
