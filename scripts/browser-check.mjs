// Dependency-free Chromium QA. Run with a local server already on port 5173.
// Set CHROME_PATH when Chromium is installed somewhere else.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
let ws,
  next = 0;
const calls = new Map(),
  errors = [];
try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9333/json')).json();
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(targets?.length, `Chromium did not start: ${browserLog}`);
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const call = calls.get(m.id);
      calls.delete(m.id);
      if (m.error) call?.reject(Error(m.error.message));
      else call?.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(
        m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text,
      );
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
      errors.push(m.params.entry.text);
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      calls.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const screenshot = async (name) => {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.qa/${name}.png`, Buffer.from(r.data, 'base64'));
  };
  const size = (width, height, mobile = false) =>
    cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const key = (key, code, type = 'keyDown', modifiers = 0) =>
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
  await click('opponent-plus');
  await click('opponent-plus');
  await click('opponent-plus');
  assert.equal(await evaluate(`document.getElementById('opponent-count').textContent`), '5');
  assert.equal(await evaluate(`document.querySelectorAll('.score-card').length`), 6);
  await evaluate(`document.querySelector('#difficulty [data-value="hard"]').click()`);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('[data-bot]')).every(s=>s.value==='hard')`,
    ),
    true,
  );
  await evaluate(
    `var botSelect=document.querySelector('[data-bot="1"]'); botSelect.value='easy'; botSelect.dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  assert.equal(
    await evaluate(`document.getElementById('difficulty-status').textContent`),
    'MIXED COMPANY',
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
  await screenshot('desktop-playing');
  await key('Escape', 'Escape');
  await key('Escape', 'Escape', 'keyUp');
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'PAUSED');
  await screenshot('desktop-paused');
  await click('help-button');
  assert.equal(await evaluate(`document.getElementById('help-dialog').open`), true);
  await click('got-it');
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
  assert.equal(await evaluate(`document.getElementById('opponent-count').textContent`), '5');
  assert.equal(
    await evaluate(`document.getElementById('sound-button').getAttribute('aria-pressed')`),
    muted,
  );
  // A registered implementation should be usable through setup without a
  // special-case engine branch or a hand-maintained list of UI choices.
  await evaluate(`(async () => {
    const {Bot,registerBot} = await import('/src/bots/index.js');
    window.__customBotCalls=0;
    class BrowserTestBot extends Bot {
      decide(context) {
        if (!context.map.cells.length || !Object.isFrozen(context.self)) throw Error('Incomplete bot context');
        window.__customBotCalls++;
        return {throttle:0.5,steer:0.2};
      }
    }
    registerBot('browser-custom',BrowserTestBot,{label:'Custom',tagline:'CUSTOM STRATEGY'});
  })()`);
  await click('opponent-minus');
  assert.equal(await evaluate(`document.querySelectorAll('#difficulty button').length`), 4);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('[data-bot]')).every(s=>Array.from(s.options).some(o=>o.value==='browser-custom'))`,
    ),
    true,
  );
  await evaluate(`document.querySelector('#difficulty [data-value="browser-custom"]').click()`);
  assert.equal(
    await evaluate(`document.getElementById('difficulty-status').textContent`),
    'CUSTOM STRATEGY',
  );
  await click('start-button');
  await delay(2900);
  assert.ok(await evaluate(`window.__customBotCalls>0`));
  await screenshot('custom-bot-playing');
  await click('pause-button');
  await size(390, 844, true);
  await delay(100);
  assert.equal(
    await evaluate(`document.documentElement.scrollWidth>innerWidth`),
    false,
    'custom bot choices overflow mobile layout',
  );
  await size(1440, 900, false);
  await delay(100);
  await evaluate(`document.querySelector('[data-action="quit"]').click()`);
  // Exercise the actual engine and renderer in the reported wall-edge pose.
  // This fixture exists only in the isolated QA browser, not in the game UI.
  const corner = await evaluate(`(async () => {
    const [{Game}, {Renderer}, geometry] = await Promise.all([import('/src/engine.js'), import('/src/renderer.js'), import('/src/geometry.js')]);
    const g = new Game({opponents:1,powerups:false}, 'browser-corner');
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
  assert.deepEqual(errors, [], 'browser logged errors');
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'startup',
          'maze shuffle',
          '1–5 opponents',
          'difficulty presets',
          'individual bot difficulty',
          'countdown',
          'keyboard movement and fire',
          'pause',
          'help modal',
          '390 / 768 / 1100 / 1440 layouts',
          'touch controls',
          'saved preferences',
          'registered custom bot appears in setup and controls a live opponent',
          'wall-edge firing regression',
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
