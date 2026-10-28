import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { SimulationPlan, SimulationResult } from '../src/simulation.ts';
import { validateBrowserSpeed } from '../src/simulation.ts';

interface CdpReply {
  id?: number;
  result?: unknown;
  error?: { message: string };
}
interface Evaluation {
  result: { value: unknown };
  exceptionDetails?: { text: string; exception?: { description: string } };
}

/** This optional reference collector is deliberately separate from the lightweight runner. */
export async function collectBrowserResults(
  plan: SimulationPlan,
  url: string,
  onResult: (result: SimulationResult, environment: string) => Promise<void>,
  browserSpeed = 1,
): Promise<string> {
  validateBrowserSpeed(browserSpeed);
  const chrome =
    process.env.CHROME_PATH ||
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find(existsSync);
  if (!chrome) throw new Error('Set CHROME_PATH to an installed Chromium browser.');
  const base = new URL(url);
  const page = new URL('/tests/fixtures/simulation.html', base);
  const response = await fetch(page);
  if (!response.ok || !(await response.text()).includes('Bot simulation reference'))
    throw new Error('Start npm run dev from this checkout before collecting a browser reference.');
  const root = path.resolve('.qa');
  await mkdir(root, { recursive: true });
  const profile = await mkdtemp(path.join(root, 'simulation-chrome-'));
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let log = '';
  browser.stderr.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  let failure: Error | undefined;
  browser.on('error', (error) => {
    failure = error;
  });
  let socket: WebSocket | undefined;
  const calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let sequence = 0;
  try {
    let endpoint = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure;
      const port = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)?.[1];
      if (port) {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[];
        endpoint = targets.find((target) => target.type === 'page')?.webSocketDebuggerUrl ?? '';
        if (endpoint) break;
      }
      await delay(100);
    }
    if (!endpoint) throw new Error(`Chromium did not start: ${log}`);
    const ws = new WebSocket(endpoint);
    socket = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to Chromium.'));
    });
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as CdpReply;
      if (!message.id) return;
      const call = calls.get(message.id);
      calls.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result);
    };
    ws.onclose = () => {
      for (const call of calls.values()) call.reject(new Error('Chromium disconnected.'));
      calls.clear();
    };
    const cdp = (method: string, params: object = {}) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++sequence;
        calls.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const value = (await cdp('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })) as Evaluation;
      if (value.exceptionDetails)
        throw new Error(
          value.exceptionDetails.exception?.description ?? value.exceptionDetails.text,
        );
      return value.result.value as T;
    };
    await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 960,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp('Page.navigate', { url: page.href });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (
          await evaluate<boolean>(
            "document.readyState === 'complete' && document.title === 'Bot simulation reference'",
          )
        )
          break;
      } catch (error) {
        // Navigation can destroy the initial about:blank execution context during a readiness poll.
        if (
          !(error instanceof Error) ||
          !/navigated|context.*destroyed|Cannot find context/i.test(error.message)
        )
          throw error;
      }
      if (attempt === 99) throw new Error('Browser reference page did not load.');
      await delay(100);
    }
    const module = "await import('/tests/fixtures/simulation-browser.ts')";
    const environment = await evaluate<string>('navigator.userAgent');
    for (let index = 0; index < plan.count; index++) {
      await evaluate(
        `(async () => { const fixture = ${module}; fixture.start(${JSON.stringify(plan)}, ${index}, ${browserSpeed}); })()`,
      );
      const deadline = Date.now() + (plan.target === 0 ? 1 : plan.maxRounds) * 150_000;
      while (true) {
        const status = await evaluate<{ result: SimulationResult | null; error: string | null }>(
          `(async () => (${module}).poll())()`,
        );
        if (status.error) throw new Error(status.error);
        if (status.result) {
          await onResult(status.result, environment);
          break;
        }
        if (Date.now() > deadline)
          throw new Error('Browser reference exceeded its wall-clock limit.');
        await delay(250);
      }
    }
    await evaluate(`(async () => (${module}).stop())()`);
    return environment;
  } finally {
    socket?.close();
    if (browser.exitCode === null) {
      const closed = new Promise<void>((resolve) => browser.once('close', () => resolve()));
      browser.kill();
      await Promise.race([closed, delay(5000)]);
    }
    // Only remove the profile created above, after checking its resolved parent stays in .qa.
    if (path.dirname(path.resolve(profile)) === root)
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
