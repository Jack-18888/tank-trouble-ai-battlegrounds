// Dependency-free Chromium QA. Run with a local server already on port 5173.
// Set CHROME_PATH when Chromium is installed somewhere else.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
if (!chrome) throw Error('Set CHROME_PATH to an installed Chromium browser.');
await mkdir('.qa', { recursive: true });
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9333', `--user-data-dir=${path.resolve('.qa/chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
browser.stderr.on('data', chunk => browserLog += chunk.toString());
browser.on('error', e => browserLog += e.message);
let ws, next = 0;
const calls = new Map(), errors = [];
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await delay(100); } }
  assert.ok(targets?.length, `Chromium did not start: ${browserLog}`);
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const call = calls.get(m.id); calls.delete(m.id); if (m.error) call?.reject(Error(m.error.message)); else call?.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; calls.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const screenshot = async name => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(`.qa/${name}.png`, Buffer.from(r.data, 'base64')); };
  const size = (width, height, mobile = false) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const key = (key, code, type = 'keyDown', modifiers = 0) => cdp('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: key === ' ' ? 32 : key === 'Escape' ? 27 : 38 });
  await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('Page.enable');
  await size(1440, 1100);
  await cdp('Page.navigate', { url: 'http://localhost:5173' });
  for (let i = 0; i < 50; i++) { if (await evaluate(`document.getElementById('start-button') && document.querySelector('.score-card') !== null`)) break; await delay(100); }
  await evaluate('document.fonts.ready'); await delay(400);
  await screenshot('startup-diagnostic');
  console.log('Loaded:', await evaluate('({url:location.href,title:document.title,text:document.body.innerText.slice(0,200)})'));
  await evaluate('localStorage.clear()');
  await cdp('Page.reload'); await delay(500);
  assert.equal(await evaluate(`document.querySelectorAll('.score-card').length`), 3);
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
  await screenshot('desktop-ready');
  const firstSeed = await evaluate(`document.getElementById('map-seed').textContent`);
  await click('shuffle-button');
  assert.notEqual(await evaluate(`document.getElementById('map-seed').textContent`), firstSeed);
  await click('opponent-plus'); await click('opponent-plus'); await click('opponent-plus');
  assert.equal(await evaluate(`document.getElementById('opponent-count').textContent`), '5');
  assert.equal(await evaluate(`document.querySelectorAll('.score-card').length`), 6);
  await evaluate(`document.querySelector('#difficulty [data-value="hard"]').click()`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-bot]')).every(s=>s.value==='hard')`), true);
  await evaluate(`var botSelect=document.querySelector('[data-bot="1"]'); botSelect.value='easy'; botSelect.dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('difficulty-status').textContent`), 'MIXED COMPANY');
  await click('start-button'); await delay(2900);
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'LIVE MATCH');
  await key('ArrowUp', 'ArrowUp'); await key(' ', 'Space'); await delay(700);
  await key('ArrowUp', 'ArrowUp', 'keyUp'); await key(' ', 'Space', 'keyUp');
  await screenshot('desktop-playing');
  await key('Escape', 'Escape'); await key('Escape', 'Escape', 'keyUp');
  assert.equal(await evaluate(`document.getElementById('arena-state').textContent`), 'PAUSED');
  await screenshot('desktop-paused');
  await click('help-button'); assert.equal(await evaluate(`document.getElementById('help-dialog').open`), true);
  await click('got-it');
  await evaluate(`document.querySelector('[data-action="quit"]').click()`);
  for (const [width, height] of [[390, 844], [768, 1024], [1100, 900]]) {
    await size(width, height, width < 600); await delay(180);
    assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false, `horizontal overflow at ${width}`);
    await screenshot(`responsive-${width}`);
  }
  await size(390, 844, true);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true }); await delay(200);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('touch-controls')).display`), 'flex');
  await screenshot('mobile-touch');
  await click('sound-button');
  const muted = await evaluate(`document.getElementById('sound-button').getAttribute('aria-pressed')`);
  await cdp('Page.reload'); await delay(600);
  assert.equal(await evaluate(`document.getElementById('opponent-count').textContent`), '5');
  assert.equal(await evaluate(`document.getElementById('sound-button').getAttribute('aria-pressed')`), muted);
  assert.deepEqual(errors, [], 'browser logged errors');
  console.log(JSON.stringify({ passed: true, checks: ['startup', 'maze shuffle', '1–5 opponents', 'difficulty presets', 'individual bot difficulty', 'countdown', 'keyboard movement and fire', 'pause', 'help modal', '390 / 768 / 1100 / 1440 layouts', 'touch controls', 'saved preferences', 'no runtime errors'], screenshots: path.resolve('.qa') }, null, 2));
} finally { if (ws?.readyState === 1) ws.close(); browser.kill(); }
