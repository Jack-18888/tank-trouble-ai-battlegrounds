// Dependency-free Chromium QA. Run with a local server already on port 5173.
// Set CHROME_PATH when Chromium is installed somewhere else.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
interface BrowserTarget {
  type: string;
  webSocketDebuggerUrl: string;
}
interface ExceptionDetails {
  text: string;
  exception?: { description?: string };
}
interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: { exceptionDetails?: ExceptionDetails; entry?: { level: string; text: string } };
}
interface EvaluateResponse {
  result: { value?: unknown };
  exceptionDetails?: ExceptionDetails;
}
interface WorkerMetrics {
  tick: number;
  x: number;
  drawn: number;
  spawned: number;
  slowFinished: boolean;
  fastDecisions: number;
  moduleDecisions: number;
  statuses: string[];
}
let workerIsolation:
  { ticks: number; frames: number; humanPixels: number; otherDecisions: number } | undefined;
interface CornerResult {
  fired: boolean;
  alive: boolean;
  bounces: number;
  blocked: boolean;
  x: number;
}
interface TurnResult {
  clear: boolean;
  x: number;
  y: number;
  angle: number;
}
const preview = process.argv.includes('--preview');
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const chrome =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(existsSync);
if (!chrome) throw Error('Set CHROME_PATH to an installed Chromium browser.');
await mkdir('.qa', { recursive: true });
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=9333',
    `--user-data-dir=${path.resolve('.qa/chrome')}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let browserLog = '';
browser.stderr.on('data', (chunk) => (browserLog += chunk.toString()));
browser.on('error', (e) => (browserLog += e.message));
let ws: WebSocket | undefined,
  next = 0;
const calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >(),
  errors: string[] = [];
try {
  let targets: BrowserTarget[] | undefined;
  for (let i = 0; i < 50; i++) {
    try {
      const data: unknown = await (await fetch('http://127.0.0.1:9333/json')).json();
      if (!Array.isArray(data)) throw new Error('Invalid Chromium target list');
      targets = data.filter(
        (target: unknown): target is BrowserTarget =>
          typeof target === 'object' &&
          target !== null &&
          'type' in target &&
          typeof target.type === 'string' &&
          'webSocketDebuggerUrl' in target &&
          typeof target.webSocketDebuggerUrl === 'string',
      );
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(targets?.length, `Chromium did not start: ${browserLog}`);
  const target = targets.find((t) => t.type === 'page');
  assert.ok(target, 'Chromium did not create a page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  ws = socket;
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = reject;
  });
  socket.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    const m = JSON.parse(e.data) as CdpMessage;
    if (m.id) {
      const call = calls.get(m.id);
      calls.delete(m.id);
      if (m.error) call?.reject(Error(m.error.message));
      else call?.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(
        m.params?.exceptionDetails?.exception?.description ||
          m.params?.exceptionDetails?.text ||
          'Unknown browser exception',
      );
    if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error')
      errors.push(m.params.entry.text);
  };
  const cdp = <T = unknown>(method: string, params: object = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      calls.set(id, { resolve: (value) => resolve(value as T), reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T = unknown>(expression: string): Promise<T> => {
    const r = await cdp<EvaluateResponse>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value as T;
  };
  const click = (id: string) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const closeHelp = () =>
    evaluate(`new Promise(resolve => {
    document.getElementById('help-dialog').addEventListener('close', resolve, {once:true});
    document.getElementById('got-it').click();
  })`);
  const selectController = (index: number, value: string) =>
    evaluate(`(() => {
    const select = document.querySelector('[data-player="${index}"]');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const screenshot = async (name: string) => {
    const r = await cdp<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.qa/${preview ? 'preview-' : ''}${name}.png`, Buffer.from(r.data, 'base64'));
  };
  const size = (width: number, height: number, mobile = false) =>
    cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const key = (key: string, code: string, type = 'keyDown', modifiers = 0) =>
    cdp('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: key === ' ' ? 32 : key === 'Escape' ? 27 : 38,
    });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await size(1440, 1100);
  await cdp('Page.navigate', { url: 'http://localhost:5173' });
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        `document.getElementById('start-button') && document.querySelector('.score-card') !== null`,
      )
    )
      break;
    await delay(100);
  }
  await evaluate('document.fonts.ready');
  await delay(400);
  await evaluate('localStorage.clear()');
  await evaluate(`localStorage.setItem('tank-trouble.preferences.v1', JSON.stringify({
    config: {opponents:2,difficulties:['hard','easy'],size:'large',density:'dense',target:10,powerups:false}, sound:false
  }))`);
  await cdp('Page.reload');
  await delay(500);
  assert.deepEqual(
    await evaluate(
      `JSON.parse(localStorage.getItem('tank-trouble.preferences.v1')).config.players`,
    ),
    [{ kind: 'human' }, { kind: 'bot', botId: 'hard' }, { kind: 'bot', botId: 'easy' }],
  );
  assert.equal(await evaluate(`document.getElementById('map-size').value`), 'large');
  assert.equal(await evaluate(`document.getElementById('maze-density').value`), 'dense');
  assert.equal(await evaluate(`document.getElementById('win-target').value`), '10');
  assert.equal(await evaluate(`document.getElementById('powerups').checked`), false);
  assert.equal(
    await evaluate(`document.getElementById('sound-button').getAttribute('aria-pressed')`),
    'false',
  );
  await evaluate('localStorage.clear()');
  await cdp('Page.reload');
  await delay(500);
  assert.equal(await evaluate(`document.querySelectorAll('.score-card').length`), 3);
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
  assert.equal(
    await evaluate(
      `Math.abs(document.getElementById('canvas-wrap').getBoundingClientRect().width-document.getElementById('scoreboard').getBoundingClientRect().width)<2`,
    ),
    true,
    'arena does not fill its frame',
  );
  await screenshot('desktop-ready');
  const firstSeed = await evaluate(`document.getElementById('map-seed').textContent`);
  await click('shuffle-button');
  assert.notEqual(await evaluate(`document.getElementById('map-seed').textContent`), firstSeed);
  await click('tank-plus');
  await click('tank-plus');
  await click('tank-plus');
  assert.equal(await evaluate(`document.getElementById('tank-count').textContent`), '6');
  assert.equal(await evaluate(`document.getElementById('tank-plus').disabled`), true);
  assert.equal(await evaluate(`document.querySelectorAll('.score-card').length`), 6);
  await evaluate(`document.querySelector('#difficulty [data-value="hard"]').click()`);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('[data-player]')).every(s=>s.value==='human'||s.value==='bot:hard')`,
    ),
    true,
  );
  await selectController(1, 'bot:easy');
  assert.equal(
    await evaluate(`document.getElementById('difficulty-status').textContent`),
    'MIXED COMPANY',
  );
  await selectController(2, 'human');
  assert.equal(await evaluate(`document.querySelector('[data-player="0"]').value`), 'bot:hard');
  assert.equal(await evaluate(`document.querySelector('[data-player="2"]').value`), 'human');
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[data-player] option:checked[value="human"]').length`,
    ),
    1,
  );
  assert.equal(
    await evaluate(`document.querySelector('[data-tank="2"] .score-sub').textContent`),
    'THE HUMAN',
  );
  assert.equal(
    await evaluate(`document.querySelector('[data-tank="0"] .score-name').textContent`),
    'Moss',
  );
  const previewSeed = await evaluate(`document.getElementById('map-seed').textContent`);
  await click('start-button');
  await delay(2900);
  assert.equal(
    await evaluate(`document.getElementById('map-seed').textContent`),
    previewSeed,
    'starting changed the selected maze',
  );
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'LIVE MATCH');
  await key('ArrowUp', 'ArrowUp');
  await key(' ', 'Space');
  await delay(700);
  await key('ArrowUp', 'ArrowUp', 'keyUp');
  await key(' ', 'Space', 'keyUp');
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-controller-status="failed"]').length`),
    0,
  );
  await screenshot('desktop-playing');
  await key('Escape', 'Escape');
  await key('Escape', 'Escape', 'keyUp');
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'PAUSED');
  await screenshot('desktop-paused');
  await click('help-button');
  assert.equal(await evaluate(`document.getElementById('help-dialog').open`), true);
  await closeHelp();
  await evaluate(`document.querySelector('[data-action="quit"]').click()`);
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1100, 900],
  ]) {
    await size(width, height, width < 600);
    await delay(180);
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth > innerWidth`),
      false,
      `horizontal overflow at ${width}`,
    );
    await screenshot(`responsive-${width}`);
  }
  await size(390, 844, true);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await delay(200);
  assert.equal(
    await evaluate(`getComputedStyle(document.getElementById('touch-controls')).display`),
    'flex',
  );
  await screenshot('mobile-touch');
  await click('start-button');
  const fireButton = await evaluate<{ x: number; y: number }>(`(() => {
    const button = document.querySelector('[data-key="Space"]');
    button.scrollIntoView({block:'center'});
    const rect = button.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  await cdp('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...fireButton, id: 0 }],
  });
  assert.equal(
    await evaluate(`document.querySelector('[data-key="Space"]').classList.contains('active')`),
    true,
  );
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(
    await evaluate(`document.querySelector('[data-key="Space"]').classList.contains('active')`),
    false,
  );
  await click('pause-button');
  await evaluate(`document.querySelector('[data-action="quit"]').click()`);
  await evaluate('window.scrollTo(0,0)');
  await size(1440, 900, false);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await delay(200);
  await screenshot('desktop-900');
  await click('sound-button');
  const muted = await evaluate(
    `document.getElementById('sound-button').getAttribute('aria-pressed')`,
  );
  await cdp('Page.reload');
  await delay(600);
  assert.equal(await evaluate(`document.getElementById('tank-count').textContent`), '6');
  assert.equal(await evaluate(`document.querySelector('[data-player="2"]').value`), 'human');
  assert.equal(
    await evaluate(`document.getElementById('sound-button').getAttribute('aria-pressed')`),
    muted,
  );

  // Settings selected during a match must not change its active controllers.
  await click('start-button');
  await delay(2900);
  await selectController(2, 'bot:medium');
  assert.equal(
    await evaluate(`document.getElementById('start-caption').textContent`),
    'NEW SETTINGS APPLY TO YOUR NEXT MATCH.',
  );
  assert.equal(
    await evaluate(`document.querySelector('[data-tank="2"] .score-sub').textContent`),
    'THE HUMAN',
  );
  assert.equal(
    await evaluate(`document.getElementById('arena-shell').classList.contains('spectating')`),
    false,
  );
  await click('pause-button');
  await evaluate(`document.querySelector('[data-action="quit"]').click()`);
  assert.equal(
    await evaluate(`document.getElementById('arena-shell').classList.contains('spectating')`),
    true,
  );
  assert.equal(await evaluate(`document.querySelectorAll('.score-sub').length`), 6);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.score-sub')).some(s=>s.textContent==='THE HUMAN')`,
    ),
    false,
  );
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('.keyboard-legend')).display`),
    'none',
  );
  assert.equal(await evaluate(`document.getElementById('spectator-note').hidden`), false);
  assert.equal(
    await evaluate(`document.getElementById('start-label').textContent`),
    'Watch the battle',
  );
  await size(390, 844, true);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await delay(200);
  assert.equal(
    await evaluate(`getComputedStyle(document.getElementById('touch-controls')).display`),
    'none',
  );
  assert.equal(
    await evaluate(`getComputedStyle(document.getElementById('below-arena'),'::before').display`),
    'none',
  );
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
  await screenshot('mobile-spectator');
  await size(1440, 1100);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await click('start-button');
  await delay(2900);
  for (const code of ['ArrowUp', 'Space']) {
    assert.equal(
      await evaluate(`(() => {
      const event = new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true, cancelable: true });
      document.getElementById('arena').dispatchEvent(event);
      return event.defaultPrevented;
    })()`),
      false,
      'spectators must not capture driving keys',
    );
  }
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-controller-status="ready"]').length`),
    6,
  );
  await screenshot('desktop-spectator-playing');
  await click('help-button');
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'PAUSED');
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('.help-controls')).display`),
    'none',
  );
  await closeHelp();
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'LIVE MATCH');
  await key('Escape', 'Escape');
  await key('Escape', 'Escape', 'keyUp');
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'PAUSED');
  await evaluate(`document.querySelector('[data-action="quit"]').click()`);
  await cdp('Page.reload');
  await delay(500);
  assert.equal(
    await evaluate(`document.getElementById('arena-shell').classList.contains('spectating')`),
    true,
  );
  for (let i = 0; i < 4; i++) await click('tank-minus');
  assert.equal(await evaluate(`document.getElementById('tank-count').textContent`), '2');
  assert.equal(await evaluate(`document.getElementById('tank-minus').disabled`), true);
  await click('tank-plus');
  await selectController(2, 'human');
  await click('tank-minus');
  assert.equal(
    await evaluate(`document.getElementById('arena-shell').classList.contains('spectating')`),
    true,
    'removing the human slot leaves a bot-only match',
  );
  await selectController(1, 'human');
  await evaluate(`document.querySelector('#difficulty [data-value="medium"]').click()`);
  if (!preview) {
    await evaluate(
      `(async()=>{const module=await import('/tests/fixtures/browser.ts'); window.__workerQA=module.startWorkerFixture();})()`,
    );
    await evaluate('window.__workerQA.waitForStart()');
    const before = await evaluate<WorkerMetrics>('window.__workerQA.measure()');
    await key('ArrowUp', 'ArrowUp');
    await delay(250);
    const during = await evaluate<WorkerMetrics>('window.__workerQA.measure()');
    await key('ArrowUp', 'ArrowUp', 'keyUp');
    assert.equal(during.slowFinished, false, 'fixture must still be calculating');
    assert.equal(during.spawned, 4, 'each bot gets its own worker');
    assert.ok(during.tick - before.tick > 5, 'physics stalled behind a slow bot');
    assert.ok(during.drawn - before.drawn >= 2, 'drawing stalled behind a slow bot');
    assert.ok(during.x > before.x, 'human input stalled behind a slow bot');
    assert.ok(during.fastDecisions > before.fastDecisions, 'another bot stalled behind a slow bot');
    workerIsolation = {
      ticks: during.tick - before.tick,
      frames: during.drawn - before.drawn,
      humanPixels: during.x - before.x,
      otherDecisions: during.fastDecisions - before.fastDecisions,
    };
    await screenshot('worker-isolation');
    await evaluate('window.__workerQA.waitForFinish()');
    const finished = await evaluate<WorkerMetrics>('window.__workerQA.measure()');
    assert.ok(finished.moduleDecisions > 0, 'importable asynchronous custom bot did not run');
    assert.ok(finished.statuses.slice(0, 4).every((status) => status === 'ready'));
    assert.equal(
      finished.statuses[4],
      'failed',
      'a thrown worker decision stops only its own tank',
    );
    await evaluate('window.__workerQA.dispose()');
    // A main-only registration is intentionally absent from the production worker catalog.
    // Its startup failure must stop one tank, show a notice, and leave the match running.
    await click('tank-plus');
    await selectController(2, 'bot:qa-crash');
    await click('start-button');
    await delay(2900);
    assert.equal(
      await evaluate(`document.querySelector('[data-tank="2"]').dataset.controllerStatus`),
      'failed',
    );
    assert.ok(
      await evaluate(
        `document.querySelector('[data-tank="2"] .score-sub').textContent.includes('OFFLINE')`,
      ),
    );
    assert.equal(
      await evaluate(`document.getElementById('arena-state').textContent`),
      'LIVE MATCH',
    );
    assert.ok(
      await evaluate(
        `document.getElementById('round-toast').textContent.includes('controller stopped')`,
      ),
      'countdown must not replace the worker failure notice',
    );
    await screenshot('worker-offline');
    await click('pause-button');
    await evaluate(`document.querySelector('[data-action="quit"]').click()`);
    // Exercise the actual engine and renderer in the reported wall-edge pose.
    // This fixture exists only in the isolated QA browser, not in the game UI.
    const corner = await evaluate<CornerResult>(`(async () => {
    const [{createTestGame}, {Renderer}, geometry] = await Promise.all([import('/tests/helpers/game.ts'), import('/src/renderer.ts'), import('/src/geometry.ts')]);
    const g = createTestGame({players: [{ kind: 'human' }, { kind: 'bot', botId: 'medium' }],powerups:false}, 'browser-corner');
    const edge = {x1:32,y1:96,x2:128,y2:96};
    g.map = {...g.map, cols:4, rows:3, width:256, height:192, walls:[edge], cells:g.map.cells.filter(c=>c.x<4&&c.y<3)};
    const tank = g.tanks[0]; Object.assign(tank, {x:168,y:102,angle:-3*Math.PI/4,cooldown:0});
    g.tanks[1].alive=false;
    for(let i=0;i<40;i++)g.moveTank(tank,-1,0);
    const fired=g.fire(tank);
    for(let i=0;i<12;i++)g.updateBullets(1/120);
    document.querySelector('.site-wrap').style.display='none';
    document.body.insertAdjacentHTML('beforeend','<main style="max-width:800px;margin:32px auto"><h1 style="font-size:36px">Clear barrel. Clean shot.</h1><p style="margin:12px 0 24px">Wall-edge regression: tracks stop at the wall, the shell clears the muzzle, and the tank survives.</p><canvas id="corner-qa" style="width:768px;height:576px;max-width:100%;background:#dce3c8;border-radius:8px"></canvas></main>');
    const painter=new Renderer(document.getElementById('corner-qa'));
    window.__cornerQa={g,painter};
    painter.draw(g,0);
    return {fired,alive:tank.alive,bounces:g.bullets[0]?.bounces,blocked:geometry.tankWall({...tank,x:tank.x-1},edge),x:tank.x};
  })()`);
    assert.equal(corner.fired, true);
    assert.equal(corner.alive, true);
    assert.equal(corner.bounces, 0);
    assert.equal(corner.blocked, true);
    await delay(100);
    // ResizeObserver clears its canvas while adjusting backing resolution.
    await evaluate(`window.__cornerQa.painter.draw(window.__cornerQa.g,0)`);
    await screenshot('wall-edge-fixed');
    const turnStart = await evaluate<TurnResult & { naiveBlocked: boolean }>(`(() => {
    const {g,painter}=window.__cornerQa;
    g.map={...g.map,walls:[{x1:122,y1:16,x2:122,y2:176}]};
    Object.assign(g.tanks[0],{x:100,y:100,angle:-Math.PI/3,alive:true});
    g.bullets=[];g.particles=[];g.tracks=[];g.state='playing';g.elapsed=0;g.settleTimer=null;
    const tank=g.tanks[0];
    const naiveBlocked=!g.canPlaceTank({...tank,angle:tank.angle+3.7/120});
    const parent=document.getElementById('corner-qa').parentElement;
    parent.querySelector('h1').textContent='Wall contact should not lock steering.';
    parent.querySelector('p').textContent='Before: the track touches the wall and an in-place right turn would collide.';
    painter.draw(g,0);
    return {clear:g.canPlaceTank(tank),naiveBlocked,x:tank.x,y:tank.y,angle:tank.angle};
  })()`);
    assert.equal(turnStart.clear, true);
    assert.equal(turnStart.naiveBlocked, true, 'fixture must recreate the blocked in-place turn');
    await screenshot('wall-turn-before');
    const turnEnd = await evaluate<TurnResult>(`(() => {
    const {g,painter}=window.__cornerQa;
    let clear=true;
    for(let i=0;i<40;i++){
      g.update(1/120,{right:true});
      clear=clear&&g.canPlaceTank(g.tanks[0]);
    }
    const tank=g.tanks[0];
    const parent=document.getElementById('corner-qa').parentElement;
    parent.querySelector('h1').textContent='Turn right. Stay clear.';
    parent.querySelector('p').textContent='After: steering gently makes room beside the wall without clipping the tracks or barrel.';
    painter.draw(g,1/3);
    return {clear,x:tank.x,y:tank.y,angle:tank.angle};
  })()`);
    assert.equal(turnEnd.clear, true);
    assert.ok(Math.abs(turnEnd.angle - turnStart.angle - 3.7 / 3) < 1e-8);
    assert.ok(turnEnd.x < turnStart.x && turnEnd.x > turnStart.x - 8);
    assert.ok(Math.abs(turnEnd.y - turnStart.y) < 1e-8);
    await screenshot('wall-turn-after');
    const trackStart = await evaluate<TurnResult>(`(() => {
    const {g,painter}=window.__cornerQa;
    g.map={...g.map,walls:[{x1:32,y1:100,x2:100,y2:100}]};
    const angle=-5*Math.PI/6;
    Object.assign(g.tanks[0],{x:100-18*Math.cos(angle)-11.5*Math.sin(angle)+.002,
      y:100-18*Math.sin(angle)+11.5*Math.cos(angle),angle,leftTread:0,rightTread:0});
    const tank=g.tanks[0];
    const parent=document.getElementById('corner-qa').parentElement;
    parent.querySelector('h1').textContent='One track touches. The other can move.';
    parent.querySelector('p').textContent='Forward movement should pivot the tank around the wall end.';
    painter.draw(g,0);
    return {clear:g.canPlaceTank(tank),x:tank.x,y:tank.y,angle:tank.angle};
  })()`);
    assert.equal(trackStart.clear, true);
    await screenshot('free-track-before');
    const trackEnd = await evaluate<TurnResult & { left: number; right: number }>(`(() => {
    const {g,painter}=window.__cornerQa;
    let clear=true;
    for(let i=0;i<30;i++){
      g.update(1/120,{forward:true});
      clear=clear&&g.canPlaceTank(g.tanks[0]);
    }
    const tank=g.tanks[0];
    painter.draw(g,.25);
    return {clear,x:tank.x,y:tank.y,angle:tank.angle,left:tank.leftTread,right:tank.rightTread};
  })()`);
    assert.equal(trackEnd.clear, true);
    assert.ok(Math.hypot(trackEnd.x - trackStart.x, trackEnd.y - trackStart.y) > 5);
    assert.ok(trackEnd.angle < trackStart.angle - 0.1);
    assert.notEqual(trackEnd.left, trackEnd.right);
    await screenshot('free-track-after');
  }
  assert.deepEqual(errors, [], 'browser logged errors');
  console.log(
    JSON.stringify(
      {
        passed: true,
        ...(workerIsolation ? { workerIsolation } : {}),
        checks: [
          'startup',
          'maze shuffle',
          '2–6 tanks and at most one human',
          'difficulty presets',
          'individual controllers and human slot swaps',
          'bot-only matches and spectator controls',
          'settings apply to the next match',
          'legacy preference migration',
          'countdown',
          'keyboard movement and fire',
          'pause',
          'help modal',
          '390 / 768 / 1100 / 1440 layouts',
          'touch controls',
          'saved preferences',
          ...(!preview
            ? [
                'one-second bot computation does not block physics, drawing, human input, or another bot',
                'importable asynchronous custom bot executes inside a worker',
                'failed worker is marked offline while the match continues',
                'wall-edge firing regression',
                'right steering at wall contact with no silhouette overlap',
                'free track drives and pivots around a wall endpoint',
              ]
            : ['compiled production bundle']),
          'no runtime errors',
        ],
        screenshots: path.resolve('.qa'),
      },
      null,
      2,
    ),
  );
} finally {
  if (ws?.readyState === 1) ws.close();
  browser.kill();
}
